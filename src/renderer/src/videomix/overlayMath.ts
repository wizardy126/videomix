import { clampRect, normalizeRectEven } from './geometry';
import type { Rect } from './types';
import { MIN_RECT_SIZE } from './types';

// Pure math for the max/min rect overlay drawn over the <video> (04-diseno §6.4).
// "Source" coords are oriented source pixels (like Rect), "screen" coords are CSS px relative to the video container.

export interface Size { width: number, height: number }
export interface Point { x: number, y: number }
/** A box in screen (CSS) pixels, not rounded. */
export interface Box { x: number, y: number, width: number, height: number }

export type RectTarget = 'max' | 'min';
export type DragHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const resizeHandles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const satisfies DragHandle[];

export interface ClipRects {
  maxRect: Rect,
  /** Missing means min = max. */
  minRect?: Rect | undefined,
}

export const aspectPresets = [
  { label: '9:16', value: 9 / 16 },
  { label: '3:4', value: 3 / 4 },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
] as const;

// only used for display, see formatAspect
const knownAspects = [
  ...aspectPresets,
  { label: '4:5', value: 4 / 5 },
  { label: '2:3', value: 2 / 3 },
  { label: '5:4', value: 5 / 4 },
  { label: '3:2', value: 3 / 2 },
  { label: '21:9', value: 21 / 9 },
];

const floorEven = (v: number) => 2 * Math.floor(v / 2) + 0;
const roundEven = (v: number) => 2 * Math.round(v / 2) + 0;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const normalizeRotation = (rotation: number | undefined) => (((rotation ?? 0) % 360) + 360) % 360;

/** Whether a rotation (degrees, any sign) swaps width and height. */
export const isQuarterTurn = (rotation: number | undefined) => normalizeRotation(rotation) % 180 === 90;

/**
 * Where the image is drawn inside a video element of `container` size with `object-fit: contain` (centered).
 * `videoSize` is the oriented size.
 *
 * `cssRotation` covers the compat player (MediaSourcePlayer), which decodes without autorotate and rotates the whole
 * element with a CSS transform: the raw (unrotated) frame is fitted to the container first and then turned, so for
 * 90/270° the scale is `min(cw / vh, ch / vw)` instead of `min(cw / vw, ch / vh)` (and the image may overflow).
 */
export function getVideoContentBox(container: Size, videoSize: Size, cssRotation?: number | undefined): Box | undefined {
  if (container.width <= 0 || container.height <= 0 || videoSize.width <= 0 || videoSize.height <= 0) return undefined;
  const scale = isQuarterTurn(cssRotation)
    ? Math.min(container.width / videoSize.height, container.height / videoSize.width)
    : Math.min(container.width / videoSize.width, container.height / videoSize.height);
  const width = videoSize.width * scale;
  const height = videoSize.height * scale;
  return { x: (container.width - width) / 2, y: (container.height - height) / 2, width, height };
}

/** Screen point → source point (not rounded, may fall outside the frame). */
export function toSourceCoords(point: Point, box: Box, videoSize: Size): Point {
  return {
    x: ((point.x - box.x) * videoSize.width) / box.width,
    y: ((point.y - box.y) * videoSize.height) / box.height,
  };
}

/** Source rect → screen box. */
export function toScreenCoords(rect: Rect, box: Box, videoSize: Size): Box {
  const sx = box.width / videoSize.width;
  const sy = box.height / videoSize.height;
  return { x: box.x + rect.x * sx, y: box.y + rect.y * sy, width: rect.width * sx, height: rect.height * sy };
}

/** The whole frame snapped to even edges: every rect we edit lives inside it. */
export const getFrameRect = (videoSize: Size): Rect => normalizeRectEven({ x: 0, y: 0, width: videoSize.width, height: videoSize.height }, 'shrink');

/** Keep min inside max: pushed first, cropped only if it doesn't fit (min stays ≥ MIN_RECT_SIZE because max is). */
function fitMin(maxRect: Rect, minRect: Rect | undefined): ClipRects {
  return { maxRect, minRect: minRect == null ? undefined : clampRect(minRect, maxRect) };
}

function moveRect(rect: Rect, dx: number, dy: number, bounds: Rect): Rect {
  return clampRect({ ...rect, x: rect.x + roundEven(dx), y: rect.y + roundEven(dy) }, bounds);
}

const handleDirection = (handle: DragHandle) => ({
  sx: handle.includes('e') ? 1 : (handle.includes('w') ? -1 : 0),
  sy: handle.includes('s') ? 1 : (handle.includes('n') ? -1 : 0),
});

function resizeFree(rect: Rect, handle: DragHandle, dx: number, dy: number, bounds: Rect, minSize: number): Rect {
  const { sx, sy } = handleDirection(handle);
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;
  if (sx < 0) left = clamp(roundEven(left + dx), bounds.x, right - minSize);
  if (sx > 0) right = clamp(roundEven(right + dx), left + minSize, bounds.x + bounds.width);
  if (sy < 0) top = clamp(roundEven(top + dy), bounds.y, bottom - minSize);
  if (sy > 0) bottom = clamp(roundEven(bottom + dy), top + minSize, bounds.y + bounds.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Resize keeping `aspect` (±1 px because of even rounding). Corners keep the opposite corner fixed and follow the axis
 * that moved the most; edges keep the opposite edge fixed and grow the other axis around the center.
 */
function resizeLocked(rect: Rect, handle: DragHandle, dx: number, dy: number, bounds: Rect, minSize: number, aspect: number): Rect {
  const { sx, sy } = handleDirection(handle);
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const boundsRight = bounds.x + bounds.width;
  const boundsBottom = bounds.y + bounds.height;

  // room available from the fixed side (or the whole bounds when centered, we shift it inside afterwards)
  let availW = bounds.width;
  if (sx > 0) availW = boundsRight - rect.x;
  else if (sx < 0) availW = right - bounds.x;
  let availH = bounds.height;
  if (sy > 0) availH = boundsBottom - rect.y;
  else if (sy < 0) availH = bottom - bounds.y;

  const proposedW = rect.width + sx * dx;
  const proposedH = rect.height + sy * dy;
  const widthDriven = sy === 0 || (sx !== 0 && Math.abs(proposedW - rect.width) / rect.width >= Math.abs(proposedH - rect.height) / rect.height);
  const wanted = widthDriven ? proposedW : proposedH * aspect;

  const minW = Math.max(minSize, minSize * aspect);
  const maxW = Math.min(availW, availH * aspect);
  const width = clamp(floorEven(clamp(wanted, minW, maxW)), minSize, floorEven(availW));
  const height = clamp(roundEven(width / aspect), minSize, floorEven(availH));

  const placeAxis = (s: number, start: number, end: number, size: number, bStart: number, bEnd: number) => {
    if (s > 0) return start;
    if (s < 0) return end - size;
    return clamp(roundEven((start + end - size) / 2), bStart, bEnd - size);
  };
  return {
    x: placeAxis(sx, rect.x, right, width, bounds.x, boundsRight),
    y: placeAxis(sy, rect.y, bottom, height, bounds.y, boundsBottom),
    width,
    height,
  };
}

/**
 * Apply a drag of (dx, dy) source pixels, measured from the start of the drag, to `start` rects.
 *
 * - Result edges are always even, `min ⊆ max ⊆ frame`, sizes ≥ MIN_RECT_SIZE.
 * - `aspect` (width / height) locks the max rect's proportion while resizing it.
 * - Moving or shrinking max pushes min along, and crops it when it no longer fits. Moving max alone doesn't move min.
 * - Editing a missing min is a no-op.
 */
export function applyRectDrag({ start, target, handle, dx, dy, videoSize, aspect }: {
  start: ClipRects,
  target: RectTarget,
  handle: DragHandle,
  dx: number,
  dy: number,
  videoSize: Size,
  aspect?: number | undefined,
}): ClipRects {
  const frame = getFrameRect(videoSize);
  if (target === 'max') {
    const max = normalizeRectEven(clampRect(start.maxRect, frame), 'shrink');
    let maxRect: Rect;
    if (handle === 'move') maxRect = moveRect(max, dx, dy, frame);
    else if (aspect != null) maxRect = resizeLocked(max, handle, dx, dy, frame, MIN_RECT_SIZE, aspect);
    else maxRect = resizeFree(max, handle, dx, dy, frame, MIN_RECT_SIZE);
    return fitMin(maxRect, start.minRect);
  }

  if (start.minRect == null) return start;
  const bounds = normalizeRectEven(start.maxRect, 'shrink');
  const min = normalizeRectEven(clampRect(start.minRect, bounds), 'grow');
  const minRect = handle === 'move' ? moveRect(min, dx, dy, bounds) : resizeFree(min, handle, dx, dy, bounds, MIN_RECT_SIZE);
  return { maxRect: start.maxRect, minRect: clampRect(minRect, bounds) };
}

/** The whole frame as max; min is kept (it's already inside the frame). */
export function fillFrame(rects: ClipRects, videoSize: Size): ClipRects {
  return fitMin(getFrameRect(videoSize), rects.minRect);
}

/**
 * Give max the proportion `aspect`: keeps its height (shrinking if it doesn't fit the frame), centered on the old max
 * but shifted to keep min inside when possible.
 */
export function applyAspect(rects: ClipRects, aspect: number, videoSize: Size): ClipRects {
  const frame = getFrameRect(videoSize);
  const { maxRect, minRect } = rects;
  let height = floorEven(Math.min(maxRect.height, frame.height));
  let width = roundEven(height * aspect);
  if (width > frame.width) {
    width = frame.width;
    height = Math.min(frame.height, roundEven(width / aspect));
  }
  width = Math.max(MIN_RECT_SIZE, width);
  height = Math.max(MIN_RECT_SIZE, height);

  const place = (center: number, size: number, minStart: number | undefined, minSize: number | undefined, frameSize: number) => {
    let pos = roundEven(center - size / 2);
    // if possible, keep min inside: pos ≤ minStart and pos + size ≥ minStart + minSize
    if (minStart != null && minSize != null && minSize <= size) pos = clamp(pos, minStart + minSize - size, minStart);
    return clamp(pos, 0, frameSize - size);
  };
  const newMax: Rect = {
    x: place(maxRect.x + maxRect.width / 2, width, minRect?.x, minRect?.width, frame.width),
    y: place(maxRect.y + maxRect.height / 2, height, minRect?.y, minRect?.height, frame.height),
    width,
    height,
  };
  return fitMin(newMax, minRect);
}

/** A default min for a clip that has none: half of max, centered. */
export function createDefaultMin(maxRect: Rect): Rect {
  const width = Math.max(MIN_RECT_SIZE, floorEven(maxRect.width / 2));
  const height = Math.max(MIN_RECT_SIZE, floorEven(maxRect.height / 2));
  return clampRect({
    x: roundEven(maxRect.x + (maxRect.width - width) / 2),
    y: roundEven(maxRect.y + (maxRect.height - height) / 2),
    width,
    height,
  }, maxRect);
}

/** "16:9" for common ratios (within 1%), otherwise "1.85:1" / "0.56:1". */
export function formatAspect(width: number, height: number) {
  if (width <= 0 || height <= 0) return '-';
  const aspect = width / height;
  const known = knownAspects.find(({ value }) => Math.abs(aspect / value - 1) < 0.01);
  if (known) return known.label;
  return `${aspect.toFixed(2)}:1`;
}

/** Display rotation of an ffprobe stream: old `rotate` tag or the display matrix side data (newer ffmpeg). */
export function getStreamRotation(stream: { tags?: { rotate?: string | undefined } | undefined, side_data_list?: { rotation?: number | undefined }[] | undefined }) {
  const tag = stream.tags?.rotate;
  if (tag != null && tag !== '') return parseInt(tag, 10);
  return stream.side_data_list?.find((sd) => sd.rotation != null)?.rotation ?? 0;
}

/** Oriented (displayed) size of a stream of `width`×`height` coded pixels with `rotation`. */
export const getOrientedSize = ({ width, height }: Size, rotation: number | undefined): Size => (
  isQuarterTurn(rotation) ? { width: height, height: width } : { width, height }
);
