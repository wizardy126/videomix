import invariant from 'tiny-invariant';

import { getPlanAxisLengths } from '../planner/types';
import type { ColumnPlacement, LayoutKeyframe, MixPlan } from '../planner/types';
import { getAnimatedColumn } from '../planner/validatePlan';

// Frame-based view of a MixPlan (ADR-001 "todo en fotogramas"): every time is converted once with f = round(t·fps),
// so chunk cuts, xfades and the per-frame geometry agree on the same frame numbers.
// Geometry is along the plan's main axis (T29): `x`/`width` are an output x/width for columns and an output y/height
// for rows (`getCellRect` gives the output rect); "left"/"right" read "top"/"bottom" for rows.

export const smoothstep = (p: number) => p * p * (3 - 2 * p);

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

export interface TimelineSettings {
  fps: number,
  /** Separation between adjacent columns, output px. */
  gap: number,
  /** Global transition duration (s): end-of-video fades into fill. */
  transitionDuration: number,
}

export interface PlacementFrames {
  placement: ColumnPlacement,
  /** Index in `plan.placements`. */
  index: number,
  /** Output frames [f0, f1). */
  f0: number,
  f1: number,
  /** Previous clip of the same column (the xfade into this one covers [f0, previous.f1)). */
  previous?: PlacementFrames | undefined,
  next?: PlacementFrames | undefined,
  /**
   * The clip ends without successor while its column stays in the layout (end of the video, 01-requisitos §4.3):
   * its area becomes fill, reached with the global transition during its last `fadeOutFrames` frames (0 = cut).
   */
  endsInFill: boolean,
  fadeOutFrames: number,
}

export interface KeyframeFrames {
  keyframe: LayoutKeyframe,
  /** The change starts at frame f0 and is complete at frame f1 (f0 = f1 for an instant change). */
  f0: number,
  f1: number,
}

export interface RenderTimeline {
  plan: MixPlan,
  settings: TimelineSettings,
  totalFrames: number,
  placements: PlacementFrames[],
  keyframes: KeyframeFrames[],
}

/** Offset and length of a column (row) along the main axis, output px. */
export interface ColumnGeometry { x: number, width: number }

/** Index of the keyframe whose change has started at frame `f` (the last one with `f0 ≤ f`). */
export function getKeyframeIndexAtFrame(tl: RenderTimeline, f: number) {
  let k = 0;
  tl.keyframes.forEach((kf, i) => {
    if (kf.f0 <= f) k = i;
  });
  return k;
}

function getKeyframeAtFrame(tl: RenderTimeline, f: number) {
  return tl.keyframes[getKeyframeIndexAtFrame(tl, f)]!;
}

export function getRenderTimeline(plan: MixPlan, settings: TimelineSettings): RenderTimeline {
  const { fps } = settings;
  const toFrame = (t: number) => Math.round(t * fps);
  const totalFrames = toFrame(plan.duration);
  invariant(plan.layouts.length > 0, 'Plan without layouts');

  const keyframes = plan.layouts.map((keyframe) => ({
    keyframe,
    f0: toFrame(keyframe.time),
    f1: toFrame(keyframe.time + keyframe.transitionDuration),
  }));

  const placements: PlacementFrames[] = plan.placements.map((placement, index) => ({
    placement,
    index,
    f0: toFrame(placement.startTime),
    f1: Math.min(totalFrames, toFrame(placement.endTime)),
    endsInFill: false,
    fadeOutFrames: 0,
  }));

  const byColumn = new Map<number, PlacementFrames[]>();
  for (const p of placements) byColumn.set(p.placement.column, [...(byColumn.get(p.placement.column) ?? []), p]);
  for (const list of byColumn.values()) {
    list.sort((a, b) => a.placement.startTime - b.placement.startTime);
    for (const [i, p] of list.entries()) {
      p.previous = list[i - 1];
      p.next = list[i + 1];
    }
  }

  const tl: RenderTimeline = { plan, settings, totalFrames, placements, keyframes };

  for (const p of placements) {
    const fadeOut = p.placement.transitionOut ?? 0;
    // Derived as well, because the planner leaves transitionOut out when the global transition is 0 (a plain cut to
    // fill). A column removed by a re-layout ends with its clip (it is no longer in the layout by then): no fill.
    const stays = p.next == null && p.f1 < totalFrames
      && getKeyframeAtFrame(tl, p.f1).keyframe.columns.some((c) => c.column === p.placement.column);
    if (fadeOut > 0 || stays) {
      p.endsInFill = true;
      p.fadeOutFrames = clamp(Math.round(fadeOut * fps), 0, p.f1 - p.f0);
    }
  }
  return tl;
}

/**
 * Geometry of every layout column at frame `f` (real numbers while animating), including columns whose clips have
 * ended (end of the video) and columns growing from / shrinking to width 0. Widths are eased with smoothstep.
 */
export function getColumnsAtFrame(tl: RenderTimeline, f: number): Map<number, ColumnGeometry> {
  const { gap } = tl.settings;
  const { main } = getPlanAxisLengths(tl.plan);
  const k = getKeyframeIndexAtFrame(tl, f);
  const { keyframe, f0, f1 } = tl.keyframes[k]!;
  const res = new Map<number, ColumnGeometry>();
  if (k > 0 && f < f1) {
    const prev = tl.keyframes[k - 1]!.keyframe;
    const p = smoothstep(clamp((f - f0) / (f1 - f0), 0, 1));
    const ids = new Set([...prev.columns, ...keyframe.columns].map((c) => c.column));
    for (const id of ids) {
      // a column missing from one end is there at width 0 next to its right neighbour (same rule as the planner)
      const a = getAnimatedColumn(prev, keyframe, id, main, gap);
      const b = getAnimatedColumn(keyframe, prev, id, main, gap);
      res.set(id, { x: lerp(a.x, b.x, p), width: lerp(a.width, b.width, p) });
    }
    return res;
  }
  for (const c of keyframe.columns) res.set(c.column, { x: c.x, width: c.width });
  return res;
}

/**
 * Fill areas at frame `f`, from the (interpolated) columns: the row edges the columns don't reach, and during a
 * re-layout any space that opens between two columns beyond the gap (e.g. the last column collapsing past W while
 * a right fill appears). Keyed by position so an area can be followed across frames: `L`, `R` and `<a>-<b>` (between
 * columns a and b). A fill touches its neighbours without gap, as the planner lays it out (04-diseno §3.1); between two
 * columns the gap stays next to the right one, so when that one is past W the fill is exactly the right edge fill.
 */
export function getFillSpansAtFrame(tl: RenderTimeline, columns: Map<number, ColumnGeometry>) {
  const { main: W } = getPlanAxisLengths(tl.plan);
  const { gap } = tl.settings;
  const res = new Map<string, ColumnGeometry>();
  const sorted = [...columns.entries()].sort(([, a], [, b]) => a.x - b.x);
  if (sorted.length === 0) {
    res.set('L', { x: 0, width: W });
    return res;
  }
  const add = (key: string, x0: number, x1: number) => {
    const x = Math.max(0, x0);
    const end = Math.min(W, x1);
    if (end - x > 1e-6) res.set(key, { x, width: end - x });
  };
  add('L', 0, sorted[0]![1].x);
  sorted.slice(0, -1).forEach(([id, g], i) => {
    const [nextId, next] = sorted[i + 1]!;
    add(`${id}-${nextId}`, g.x + g.width, next.x - gap);
  });
  const [, last] = sorted.at(-1)!;
  add('R', last.x + last.width, W);
  return res;
}

/** Placements with at least one frame in [f0, f1). */
export function getPlacementsInRange(tl: RenderTimeline, f0: number, f1: number) {
  return tl.placements.filter((p) => p.f1 > p.f0 && p.f0 < f1 && p.f1 > f0);
}
