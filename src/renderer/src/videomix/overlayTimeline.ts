import type { MixOverlay, MixOverlayType, OverlayAnchor, OverlayBox } from './types';
import type { MixOverlayPatch } from './projectReducer';
import type { ResolvedOverlayTime } from './overlays/resolveOverlayTimes';
import { getOverlaysById, getLinkedCountdown } from './overlays/anchors';
import { applyRectDrag } from './overlayMath';
import type { DragHandle, Size } from './overlayMath';

// Pure helpers for editing overlays in the Mix view (T22, components/MixPlanView.tsx and OverlayPanel.tsx): lane
// layout of the overlay blocks, block drags → anchor/duration patches, the boxes shown on the mini frame and box drags.
// No React, so they can be unit tested.

export type OverlayLaneId = 'images' | 'countdownsAndBars' | 'sounds';

export const overlayLaneIds: readonly OverlayLaneId[] = ['images', 'countdownsAndBars', 'sounds'];

export function getOverlayLane(type: MixOverlayType): OverlayLaneId {
  if (type === 'image') return 'images';
  if (type === 'sound') return 'sounds';
  return 'countdownsAndBars';
}

export interface OverlayLaneItem {
  overlayId: string,
  /** Times shown on the axis (cut to the video, like the render). */
  start: number,
  end: number,
  /** Sub-row inside the lane, so blocks overlapping in time don't hide each other. */
  row: number,
}

export interface OverlayLaneLayout {
  lane: OverlayLaneId,
  /** ≥ 1, so an empty lane still shows (as a drop target for the eye and for its label). */
  rows: number,
  items: OverlayLaneItem[],
}

const EPS = 1e-6;

/**
 * Blocks of every overlay lane, packed greedily into sub-rows by start time (first row where the block fits).
 * `minDuration` is the shortest a block is considered for the packing (a 0 s sound still takes some width on screen).
 */
export function layoutOverlayLanes(
  overlays: readonly MixOverlay[],
  resolved: ReadonlyMap<string, Pick<ResolvedOverlayTime, 'start' | 'end'>>,
  { minDuration = 0 }: { minDuration?: number } = {},
): OverlayLaneLayout[] {
  return overlayLaneIds.map((lane) => {
    const entries = overlays
      .map((overlay, layer) => ({ overlay, layer, times: resolved.get(overlay.id) }))
      .filter(({ overlay }) => getOverlayLane(overlay.type) === lane)
      .map(({ overlay, layer, times }) => ({ overlayId: overlay.id, layer, start: times?.start ?? 0, end: times?.end ?? 0 }))
      .sort((a, b) => a.start - b.start || a.layer - b.layer);

    const rowEnds: number[] = [];
    const items = entries.map(({ overlayId, start, end }): OverlayLaneItem => {
      const packEnd = Math.max(end, start + minDuration);
      let row = rowEnds.findIndex((rowEnd) => rowEnd <= start + EPS);
      if (row === -1) row = rowEnds.length;
      rowEnds[row] = packEnd;
      return { overlayId, start, end, row };
    });
    return { lane, rows: Math.max(1, rowEnds.length), items };
  });
}

/** Seconds of a horizontal drag of `dx` px on an axis of `axisWidth` px showing `duration` s. */
export function pixelsToSeconds(dx: number, axisWidth: number, duration: number) {
  if (axisWidth <= 0) return 0;
  return (dx / axisWidth) * duration;
}

/** Times typed or dragged are kept to 1/100 s, like the durations shown. */
export const roundOverlayTime = (seconds: number) => Math.round(seconds * 100) / 100;

/** A bar linked to a countdown takes its times from it: its own anchor and duration aren't used. */
export function isTimeLinked(overlay: MixOverlay, overlays: readonly MixOverlay[]) {
  return getLinkedCountdown(overlay, getOverlaysById(overlays)) != null;
}

/**
 * Moving a block by `dt` s: changes `offset` if the overlay is anchored, else its absolute `time`.
 * `start` is the overlay as it was when the drag started (the patch is always computed from it, so there's no drift) and
 * `rawStart` its resolved start then: the start can't go below 0 s.
 * Returns undefined for a bar linked to a countdown (its times come from the countdown).
 */
export function getOverlayMovePatch({ start, rawStart, dt, overlays }: {
  start: MixOverlay,
  rawStart: number,
  dt: number,
  overlays: readonly MixOverlay[],
}): MixOverlayPatch | undefined {
  if (isTimeLinked(start, overlays)) return undefined;
  const delta = Math.max(dt, -Math.max(0, rawStart));
  const { anchor } = start;
  const newAnchor: OverlayAnchor = anchor.kind === 'absolute'
    ? { kind: 'absolute', time: Math.max(0, roundOverlayTime(anchor.time + delta)) }
    : { ...anchor, offset: roundOverlayTime(anchor.offset + delta) };
  return { anchor: newAnchor };
}

export const MIN_OVERLAY_DURATION = 0.1;

/**
 * Dragging the right edge of a block by `dt` s: changes the duration (≥ MIN_OVERLAY_DURATION).
 * Undefined for sounds (they last as long as their file) and for linked bars.
 */
export function getOverlayResizePatch({ start, dt, overlays }: {
  start: MixOverlay,
  dt: number,
  overlays: readonly MixOverlay[],
}): MixOverlayPatch | undefined {
  if (start.type === 'sound' || isTimeLinked(start, overlays)) return undefined;
  return { duration: Math.max(MIN_OVERLAY_DURATION, roundOverlayTime(start.duration + dt)) };
}

/**
 * The anchor after switching its kind in the properties panel. Switching to absolute keeps the current start;
 * anchoring to a clip/overlay starts at its `start` edge with no offset (then the user tweaks edge and offset).
 */
export function getAnchorOfKind(kind: OverlayAnchor['kind'], { current, rawStart, targetId }: {
  current: OverlayAnchor,
  rawStart: number,
  /** Clip or overlay id for the anchored kinds. */
  targetId: string | undefined,
}): OverlayAnchor | undefined {
  if (kind === current.kind) return current;
  if (kind === 'absolute') return { kind, time: Math.max(0, roundOverlayTime(rawStart)) };
  if (targetId == null) return undefined;
  if (kind === 'clip') return { kind, clipId: targetId, edge: 'start', offset: 0 };
  return { kind, elementId: targetId, edge: 'start', offset: 0 };
}

export interface OverlayFrameBox {
  overlay: Exclude<MixOverlay, { type: 'sound' }>,
  /** False for the selected overlay when it isn't on screen at that time (it's still shown, to place it). */
  visible: boolean,
  /** 0..1 progress through its duration at that time (for the bar fill). */
  progress: number,
  /** Seconds since its start (clamped to its duration). */
  elapsed: number,
  /** Resolved times (T19), for the countdown text (overlayFrames.getCountdownTextAt): undefined if unresolved. */
  times: Pick<ResolvedOverlayTime, 'start' | 'end' | 'rawStart' | 'rawEnd'> | undefined,
}

/**
 * Visual overlays on screen at `time`, in layer order (the last one on top), like the render draws them.
 * The selected overlay is always included so it can be placed even when it isn't on screen at that time.
 */
export function getOverlayFrameBoxes(
  overlays: readonly MixOverlay[],
  resolved: ReadonlyMap<string, Pick<ResolvedOverlayTime, 'start' | 'end' | 'rawStart' | 'rawEnd'>>,
  time: number,
  selectedId?: string | undefined,
): OverlayFrameBox[] {
  const ret: OverlayFrameBox[] = [];
  overlays.forEach((overlay) => {
    if (overlay.type === 'sound') return;
    const times = resolved.get(overlay.id);
    const visible = times != null && times.end > times.start && time >= times.start && time < times.end;
    if (!visible && overlay.id !== selectedId) return;
    const duration = times != null ? times.rawEnd - times.rawStart : 0;
    const elapsed = times != null ? Math.min(Math.max(0, time - times.rawStart), Math.max(0, duration)) : 0;
    ret.push({ overlay, visible, elapsed, progress: duration > 0 ? elapsed / duration : 0, times });
  });
  return ret;
}

/**
 * Moving/resizing a box on the mini frame, in output px (`frame` = output size), from the box at the start of the drag.
 * Reuses the rect drag math of the clip rects (overlayMath.applyRectDrag): the box stays inside the frame, ≥ 16 px,
 * with even edges, and `aspect` (width / height in px) locks the proportion.
 */
export function applyOverlayBoxDrag({ start, handle, dx, dy, frame, aspect }: {
  start: OverlayBox,
  handle: DragHandle,
  dx: number,
  dy: number,
  frame: Size,
  aspect?: number | undefined,
}): OverlayBox {
  const px = { x: start.x * frame.width, y: start.y * frame.height, width: start.width * frame.width, height: start.height * frame.height };
  const { maxRect } = applyRectDrag({ start: { maxRect: px }, target: 'max', handle, dx, dy, videoSize: frame, aspect });
  return { x: maxRect.x / frame.width, y: maxRect.y / frame.height, width: maxRect.width / frame.width, height: maxRect.height / frame.height };
}

/**
 * Box of an image of `imageSize` px, `width` (fraction of the frame width) wide and centered, keeping the image's
 * proportion on the `frame`. Scaled down if it would be taller than the frame.
 */
export function getImageBox(imageSize: Size, frame: Size, width = 0.3): OverlayBox {
  if (imageSize.width <= 0 || imageSize.height <= 0 || frame.height <= 0) return { x: (1 - width) / 2, y: (1 - width) / 2, width, height: width };
  let w = width;
  let h = (w * frame.width * imageSize.height) / (imageSize.width * frame.height);
  if (h > 1) {
    w /= h;
    h = 1;
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h };
}

/**
 * Refits an image overlay's `box` (T34, pending from T29) after the output frame's aspect changes, so the image stays
 * undistorted on the new `frame`: same width (fraction) as before, height recomputed from `imageSize`'s proportion,
 * centered on the box's previous center (not the frame's). Scaled down if it would be taller than the frame, same as
 * {@link getImageBox}.
 */
export function refitImageOverlayBox(box: OverlayBox, imageSize: Size, frame: Size): OverlayBox {
  if (imageSize.width <= 0 || imageSize.height <= 0 || frame.width <= 0 || frame.height <= 0) return box;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  let w = box.width;
  let h = (w * frame.width * imageSize.height) / (imageSize.width * frame.height);
  if (h > 1) {
    w /= h;
    h = 1;
  }
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

/** `#rrggbb` + alpha (0..1) → `#rrggbb` or `#rrggbbaa` (opaque colors stay short). */
export function joinOverlayColor(rgb: string, alpha: number) {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  if (a === 255) return rgb.toLowerCase();
  return `${rgb}${a.toString(16).padStart(2, '0')}`.toLowerCase();
}

/** `#rrggbb[aa]` → `{ rgb: '#rrggbb', alpha: 0..1 }` (for `<input type="color">`, which has no alpha). */
export function splitOverlayColor(color: string) {
  const rgb = color.slice(0, 7);
  const alphaHex = color.slice(7, 9);
  return { rgb, alpha: alphaHex.length === 2 ? Number.parseInt(alphaHex, 16) / 255 : 1 };
}
