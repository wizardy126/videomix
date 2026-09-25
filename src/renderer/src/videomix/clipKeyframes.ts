import { clampRect, normalizeRectEven } from './geometry';
import type { ClipRects, Size } from './overlayMath';
import { rotateRect } from './clipRotation';
import type { SourceFrameChange } from './sourceResize';
import type { MixClip, MixClipKeyframe, MixClipRotation, MixKeyframeInterpolation, Rect } from './types';

// A9 (v5, T44): keyframes of a clip's framing (pan and zoom). See 04-diseno §10.3.
//
// A keyframe stores a *transform* of the clip's base `maxRect`: its centre and a uniform `scale` of its size, so the
// proportion of the max (and of the min, transformed the same way, keeping its relative position inside the max) never
// changes. That's why the aspect range, the fit chips (F1) and the planner keep working on the base rects.
//
// Between two keyframes every edge of the rects moves with the same eased weight `w` (see `easeKeyframe`):
// centre = c0 + w·(c1 − c0), scale = s0 + w·(s1 − s0). Before the first keyframe the first one holds, after the last
// one the last one holds (keyframes outside the clip's range are kept and act as those extremes).

/** Keyframes closer than this (s) are the same keyframe (editing helpers and validation). */
export const KEYFRAME_TIME_EPSILON = 1e-3;

export const DEFAULT_KEYFRAME_INTERPOLATION: MixKeyframeInterpolation = 'smooth';

/** Position and size of the animated max rect, see `MixClipKeyframe`. */
export interface KeyframeTransform {
  centerX: number,
  centerY: number,
  /** Relative to the base `maxRect` size. */
  scale: number,
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const roundEven = (v: number) => 2 * Math.round(v / 2) + 0;
const floorEven = (v: number) => 2 * Math.floor(v / 2 + 1e-6) + 0;

export const getKeyframeInterpolation = (keyframe: Pick<MixClipKeyframe, 'interpolation'>): MixKeyframeInterpolation => keyframe.interpolation ?? DEFAULT_KEYFRAME_INTERPOLATION;

/** Whether the clip's framing is animated (has at least one keyframe). */
export const isClipAnimated = (clip: Pick<MixClip, 'keyframes'>) => (clip.keyframes?.length ?? 0) > 0;

/**
 * Eased weight (0..1) of the way from a keyframe to the next one, at `u` (0..1) of the time between them, for the
 * first keyframe's interpolation:
 * - `smooth`: ease in-out, the cubic smoothstep `u²·(3 − 2u)` (easy to write as an ffmpeg expression);
 * - `linear`: `u`;
 * - `hold`: 0 until the next keyframe (a hard jump there).
 */
export function easeKeyframe(interpolation: MixKeyframeInterpolation, u: number) {
  const t = clamp(u, 0, 1);
  if (interpolation === 'hold') return t >= 1 ? 1 : 0;
  if (interpolation === 'linear') return t;
  return t * t * (3 - 2 * t);
}

/** The transform of the base max rect itself (its centre, scale 1): what the first keyframe of "Animate" stores. */
export const getBaseTransform = (maxRect: Rect): KeyframeTransform => ({ centerX: maxRect.x + maxRect.width / 2, centerY: maxRect.y + maxRect.height / 2, scale: 1 });

/**
 * The transform that puts the base max rect at `rect` (e.g. the rect the user just moved or scaled with the
 * proportion locked): its centre, and the scale of its area (the geometric mean of both axes, so a rect off by a
 * rounding pixel still gives a sensible scale).
 */
export function getTransformFromMaxRect(maxRect: Rect, rect: Rect): KeyframeTransform {
  return {
    centerX: rect.x + rect.width / 2,
    centerY: rect.y + rect.height / 2,
    scale: Math.sqrt((rect.width * rect.height) / (maxRect.width * maxRect.height)),
  };
}

const lerp = (a: number, b: number, w: number) => a + w * (b - a);

/** Keyframes sorted by time (stable), without mutating. */
const sortKeyframes = (keyframes: readonly MixClipKeyframe[]) => [...keyframes].sort((a, b) => a.time - b.time);

/**
 * The (continuous, unrounded and unclamped) transform at `time` (source seconds), or undefined if there are no
 * keyframes. See the comment at the top for the curves.
 */
export function getKeyframeTransformAt(keyframes: readonly MixClipKeyframe[] | undefined, time: number): KeyframeTransform | undefined {
  if (keyframes == null || keyframes.length === 0) return undefined;
  const sorted = sortKeyframes(keyframes);
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  const pick = ({ centerX, centerY, scale }: MixClipKeyframe) => ({ centerX, centerY, scale });
  if (time <= first.time) return pick(first);
  if (time >= last.time) return pick(last);
  const next = sorted.findIndex((k) => k.time > time);
  const a = sorted[next - 1]!;
  const b = sorted[next]!;
  const w = easeKeyframe(getKeyframeInterpolation(a), (time - a.time) / (b.time - a.time));
  return { centerX: lerp(a.centerX, b.centerX, w), centerY: lerp(a.centerY, b.centerY, w), scale: lerp(a.scale, b.scale, w) };
}

/**
 * A segment between two consecutive keyframes (for the render, T48): from `from` to `to` (source s) the transform goes
 * from `start` to `end` with `easeKeyframe(interpolation, (t − from) / (to − from))`. Outside the segments the first
 * or last keyframe holds.
 */
export interface KeyframeSegment {
  from: number,
  to: number,
  start: KeyframeTransform,
  end: KeyframeTransform,
  interpolation: MixKeyframeInterpolation,
}

/** Segments between consecutive keyframes (sorted; keyframes with the same time make no segment). */
export function getKeyframeSegments(keyframes: readonly MixClipKeyframe[] | undefined): KeyframeSegment[] {
  const sorted = sortKeyframes(keyframes ?? []);
  return sorted.slice(1).flatMap((b, i) => {
    const a = sorted[i]!;
    if (!(b.time > a.time)) return [];
    return [{
      from: a.time,
      to: b.time,
      start: { centerX: a.centerX, centerY: a.centerY, scale: a.scale },
      end: { centerX: b.centerX, centerY: b.centerY, scale: b.scale },
      interpolation: getKeyframeInterpolation(a),
    }];
  });
}

/**
 * The transform kept inside `frame` (the clip's frame): the scale at most what fits the base max in it, then the
 * centre moved just enough. Without a frame it's returned as is.
 */
export function clampTransform(maxRect: Rect, transform: KeyframeTransform, frame: Size | undefined): KeyframeTransform {
  if (frame == null) return transform;
  const scale = Math.min(transform.scale, frame.width / maxRect.width, frame.height / maxRect.height);
  const halfWidth = (maxRect.width * scale) / 2;
  const halfHeight = (maxRect.height * scale) / 2;
  return {
    centerX: clamp(transform.centerX, halfWidth, frame.width - halfWidth),
    centerY: clamp(transform.centerY, halfHeight, frame.height - halfHeight),
    scale,
  };
}

/**
 * The base rects moved and scaled by `transform` (clamped into `frame`, if given), unrounded (real numbers): for
 * consumers that interpolate themselves (e.g. per-frame expressions in the render). `minRect` stays undefined if the
 * clip has none (min = max).
 */
export function getTransformedRects({ maxRect, minRect }: ClipRects, transform: KeyframeTransform, frame?: Size | undefined): ClipRects {
  const { centerX, centerY, scale } = clampTransform(maxRect, transform, frame);
  const width = maxRect.width * scale;
  const height = maxRect.height * scale;
  const x = centerX - width / 2;
  const y = centerY - height / 2;
  const max = { x, y, width, height };
  if (minRect == null) return { maxRect: max };
  return {
    maxRect: max,
    minRect: {
      x: x + (minRect.x - maxRect.x) * scale,
      y: y + (minRect.y - maxRect.y) * scale,
      width: minRect.width * scale,
      height: minRect.height * scale,
    },
  };
}

/**
 * The rects for `transform` as the pipeline uses them: even edges, inside `frame` (even-floored, if given), the min
 * inside the max. The proportion is kept up to the even rounding of each side (≤ 1 px each).
 */
export function getRectsForTransform(base: ClipRects, transform: KeyframeTransform, frame?: Size | undefined): ClipRects {
  const bounds = frame != null ? { width: floorEven(frame.width), height: floorEven(frame.height) } : undefined;
  const { maxRect: max, minRect: min } = getTransformedRects(base, transform, bounds);
  const width = Math.max(2, Math.min(roundEven(max.width), bounds?.width ?? Infinity));
  const height = Math.max(2, Math.min(roundEven(max.height), bounds?.height ?? Infinity));
  const place = (center: number, length: number, limit: number | undefined) => {
    const start = roundEven(center - length / 2);
    return limit != null ? clamp(start, 0, limit - length) : Math.max(0, start);
  };
  const maxRect = {
    x: place(max.x + max.width / 2, width, bounds?.width),
    y: place(max.y + max.height / 2, height, bounds?.height),
    width,
    height,
  };
  if (min == null) return { maxRect };
  return { maxRect, minRect: clampRect(normalizeRectEven(min, 'grow'), maxRect) };
}

/**
 * The clip's max/min rects at `sourceTime` (source seconds). Without keyframes, exactly the stored `maxRect`/`minRect`
 * (so nothing changes for clips that aren't animated). With keyframes, the interpolated framing: even edges, inside
 * `frame` (the clip's turned frame, `getClipFrame`; unknown = not clamped), same proportion as the base rects.
 */
export function getClipRectsAt(clip: Pick<MixClip, 'maxRect' | 'minRect' | 'keyframes'>, sourceTime: number, frame?: Size | undefined): ClipRects {
  const transform = getKeyframeTransformAt(clip.keyframes, sourceTime);
  if (transform == null) return { maxRect: clip.maxRect, minRect: clip.minRect };
  return getRectsForTransform(clip, transform, frame);
}

// Editing helpers. They never mutate and always return the keyframes sorted by time; `undefined` means "no keyframes"
// (how `MixClip.keyframes` stores an empty list).

/** Sorted by time; keyframes at the same time (within `epsilon`) keep the last one; empty → undefined. */
export function normalizeKeyframes(keyframes: readonly MixClipKeyframe[] | undefined, epsilon = KEYFRAME_TIME_EPSILON): MixClipKeyframe[] | undefined {
  if (keyframes == null || keyframes.length === 0) return undefined;
  const ret: MixClipKeyframe[] = [];
  sortKeyframes(keyframes).forEach((keyframe) => {
    const prev = ret.at(-1);
    if (prev != null && keyframe.time - prev.time <= epsilon) ret[ret.length - 1] = keyframe;
    else ret.push(keyframe);
  });
  return ret;
}

/** Index of the keyframe at `time` (within `epsilon`, the closest one), or -1. */
export function findKeyframeIndex(keyframes: readonly MixClipKeyframe[] | undefined, time: number, epsilon = KEYFRAME_TIME_EPSILON) {
  let best = -1;
  (keyframes ?? []).forEach((keyframe, i) => {
    const distance = Math.abs(keyframe.time - time);
    if (distance <= epsilon && (best === -1 || distance < Math.abs(keyframes![best]!.time - time))) best = i;
  });
  return best;
}

/**
 * Auto-key: adds a keyframe with `transform` at `time`, or updates the one already there (keeping its time and, unless
 * `interpolation` is given, its interpolation). A new keyframe takes `interpolation`, or the default (not stored).
 */
export function setKeyframe(keyframes: readonly MixClipKeyframe[] | undefined, time: number, transform: KeyframeTransform, { interpolation, epsilon = KEYFRAME_TIME_EPSILON }: {
  interpolation?: MixKeyframeInterpolation | undefined,
  epsilon?: number | undefined,
} = {}): MixClipKeyframe[] {
  const list = [...(keyframes ?? [])];
  const index = findKeyframeIndex(list, time, epsilon);
  const existing = list[index];
  const { centerX, centerY, scale } = transform;
  const keyframe: MixClipKeyframe = { time: existing?.time ?? time, centerX, centerY, scale };
  const resolved = interpolation ?? existing?.interpolation;
  if (resolved != null && resolved !== DEFAULT_KEYFRAME_INTERPOLATION) keyframe.interpolation = resolved;
  if (existing != null) list[index] = keyframe;
  else list.push(keyframe);
  return sortKeyframes(list);
}

/** Removes the keyframe at `time` (within `epsilon`). An unchanged copy if there's none there; undefined if none is left. */
export function removeKeyframe(keyframes: readonly MixClipKeyframe[] | undefined, time: number, epsilon = KEYFRAME_TIME_EPSILON): MixClipKeyframe[] | undefined {
  const index = findKeyframeIndex(keyframes, time, epsilon);
  if (keyframes == null || index === -1) return keyframes == null ? undefined : [...keyframes];
  return normalizeKeyframes(keyframes.filter((_k, i) => i !== index), 0);
}

/** Sets the interpolation of the keyframe at `time` (within `epsilon`); the default isn't stored. Unchanged copy if there's none there. */
export function setKeyframeInterpolation(keyframes: readonly MixClipKeyframe[] | undefined, time: number, interpolation: MixKeyframeInterpolation, epsilon = KEYFRAME_TIME_EPSILON): MixClipKeyframe[] | undefined {
  if (keyframes == null) return undefined;
  const index = findKeyframeIndex(keyframes, time, epsilon);
  return sortKeyframes(keyframes.map((keyframe, i) => {
    if (i !== index) return keyframe;
    const { time: keyframeTime, centerX, centerY, scale } = keyframe;
    const rest = { time: keyframeTime, centerX, centerY, scale };
    return interpolation === DEFAULT_KEYFRAME_INTERPOLATION ? rest : { ...rest, interpolation };
  }));
}

/** The last keyframe before `time` (more than `epsilon` before), for "previous keyframe". */
export function getPrevKeyframe(keyframes: readonly MixClipKeyframe[] | undefined, time: number, epsilon = KEYFRAME_TIME_EPSILON) {
  return sortKeyframes(keyframes ?? []).reverse().find((k) => k.time < time - epsilon);
}

/** The first keyframe after `time` (more than `epsilon` after), for "next keyframe". */
export function getNextKeyframe(keyframes: readonly MixClipKeyframe[] | undefined, time: number, epsilon = KEYFRAME_TIME_EPSILON) {
  return sortKeyframes(keyframes ?? []).find((k) => k.time > time + epsilon);
}

// Transforms of the whole animation when the base rects move with the picture (keep them in sync with the base rects).

const mapKeyframes = (keyframes: MixClipKeyframe[] | undefined, fn: (k: MixClipKeyframe) => MixClipKeyframe) => (keyframes == null ? undefined : keyframes.map((k) => fn(k)));

/**
 * E9: the keyframes of a clip whose picture turns by `turn` (clockwise) in a frame of `frame` size (the frame before the
 * turn), like `rotateClipRects` turns its rects: the centres turn, the scale stays (the base max turns with them).
 */
export function rotateKeyframes(keyframes: MixClipKeyframe[] | undefined, frame: Size, turn: MixClipRotation) {
  if (turn === 0) return keyframes;
  return mapKeyframes(keyframes, (k) => {
    const { x, y } = rotateRect({ x: k.centerX, y: k.centerY, width: 0, height: 0 }, frame, turn);
    return { ...k, centerX: x, centerY: y };
  });
}

/**
 * B2 / A5: the keyframes for a frame that changes size (`change`, as `rescaleClipRects` gets it): the centres are mapped
 * with the frame (each axis by its own factor, like the rects' centres), the scale stays (it's relative to the base max,
 * which is rescaled too). Rects that no longer fit are clamped into the frame when evaluated.
 */
export function rescaleKeyframes(keyframes: MixClipKeyframe[] | undefined, change: Pick<SourceFrameChange, 'from' | 'to'>) {
  return mapKeyframes(keyframes, (k) => ({
    ...k,
    centerX: (k.centerX * change.to.width) / change.from.width,
    centerY: (k.centerY * change.to.height) / change.from.height,
  }));
}

/** A5: the keyframes moved in time by `delta` s (to keep their offset from the clip start when pasted on another clip). */
export const shiftKeyframes = (keyframes: MixClipKeyframe[] | undefined, delta: number) => (
  delta === 0 ? keyframes : mapKeyframes(keyframes, (k) => ({ ...k, time: k.time + delta }))
);
