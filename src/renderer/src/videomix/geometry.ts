import invariant from 'tiny-invariant';

import type { Rect } from './types';

// Pure geometry for crops and column widths (04-diseno §2). Rects are in oriented source pixels,
// widths in output pixels. Everything we hand to ffmpeg is even, because yuv420p requires it.

export type Orientation = 'horizontal' | 'vertical';

/** Range of crop aspect ratios (width / height) a clip can take while containing min and staying inside max. */
export interface AspectRange {
  min: number,
  max: number,
  /** Aspect of the whole max rect: shows everything the user allowed. Always within [min, max]. */
  preferred: number,
}

export type CropFit = 'fill' | 'pillarbox' | 'letterbox';

/**
 * Relative aspect mismatch that we absorb by stretching instead of pillarbox/letterbox.
 * Even-pixel rounding can't hit an aspect exactly, and a 1% stretch is invisible, while a 1-2 px fill sliver is not.
 */
export const ASPECT_TOLERANCE = 0.01;

// guards against float noise like 607.9999999 when converting to pixel bounds
const EPSILON = 1e-6;

// `+ 0` turns -0 into 0 (Math.ceil(-1e-6) is -0)
const floorEven = (v: number) => 2 * Math.floor(v / 2 + EPSILON) + 0;
const ceilEven = (v: number) => 2 * Math.ceil(v / 2 - EPSILON) + 0;
const roundEven = (v: number) => 2 * Math.round(v / 2) + 0;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const rectAspect = (rect: Rect) => rect.width / rect.height;

/** Orientation of a clip, from its max rect: w/h > 1 is horizontal. */
export const getOrientation = (maxRect: Rect): Orientation => (rectAspect(maxRect) > 1 ? 'horizontal' : 'vertical');

/** Whether `inner` lies completely inside `outer` (edges may touch). */
export function rectContains(outer: Rect, inner: Rect) {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

/** Fit `rect` inside `bounds`: shrinks it to at most the bounds' size, then moves it inside (keeps size when possible). */
export function clampRect(rect: Rect, bounds: Rect): Rect {
  const width = clamp(rect.width, 0, bounds.width);
  const height = clamp(rect.height, 0, bounds.height);
  return {
    x: clamp(rect.x, bounds.x, bounds.x + bounds.width - width),
    y: clamp(rect.y, bounds.y, bounds.y + bounds.height - height),
    width,
    height,
  };
}

function intersectRect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}

/**
 * Snap all edges to even pixels.
 * `shrink` moves edges inwards (result ⊆ rect), for max rects; `grow` moves them outwards (result ⊇ rect), for min rects.
 */
export function normalizeRectEven(rect: Rect, mode: 'shrink' | 'grow' = 'shrink'): Rect {
  const left = mode === 'shrink' ? ceilEven(rect.x) : floorEven(rect.x);
  const top = mode === 'shrink' ? ceilEven(rect.y) : floorEven(rect.y);
  const right = mode === 'shrink' ? floorEven(rect.x + rect.width) : ceilEven(rect.x + rect.width);
  const bottom = mode === 'shrink' ? floorEven(rect.y + rect.height) : ceilEven(rect.y + rect.height);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * The even-pixel max/min rects that all crop math works on: max shrunk to even edges, min grown to even edges and
 * kept inside max. Missing min means min = max. When the source rects are already even (the normal case), they are
 * returned unchanged; otherwise min may lose up to 1 px where it touches an odd edge of max.
 */
export function normalizeClipRects(maxRect: Rect, minRect: Rect | undefined) {
  const max = normalizeRectEven(maxRect, 'shrink');
  invariant(max.width >= 2 && max.height >= 2, 'Max rect too small');
  const min = minRect == null ? max : intersectRect(normalizeRectEven(clampRect(minRect, maxRect), 'grow'), max);
  invariant(min.width >= 2 && min.height >= 2, 'Min rect too small');
  return { max, min };
}

/** Aspect ratios a crop can have with `min ⊆ crop ⊆ max` (on the even-normalized rects): [min.w / max.h, max.w / min.h]. */
export function getAspectRange(maxRect: Rect, minRect?: Rect | undefined): AspectRange {
  const { max, min } = normalizeClipRects(maxRect, minRect);
  return {
    min: min.width / max.height,
    max: max.width / min.height,
    preferred: max.width / max.height,
  };
}

/**
 * Crop of a clip for a cell of aspect `aspect` (cell width / height).
 *
 * - Inside the aspect range: the largest crop with that aspect (±1 px), centered on min and shifted just enough to
 *   stay inside max. `fit` is `fill`.
 * - Wider than the range (`> max`): crop at the max aspect; the caller scales it to the cell height and fills the
 *   sides (`pillarbox`). Narrower (`< min`): crop at the min aspect, scaled to the cell width (`letterbox`).
 * - Within {@link ASPECT_TOLERANCE} outside the range it's still `fill` (the crop at the range limit is stretched).
 *
 * The crop always has even x/y/width/height, contains the normalized min and lies inside max.
 */
export function getCropForAspect(maxRect: Rect, minRect: Rect | undefined, aspect: number): { crop: Rect, fit: CropFit } {
  invariant(aspect > 0 && Number.isFinite(aspect), 'Invalid aspect');
  const { max, min } = normalizeClipRects(maxRect, minRect);
  const range = { min: min.width / max.height, max: max.width / min.height, preferred: max.width / max.height };

  let fit: CropFit = 'fill';
  let width: number;
  let height: number;
  if (aspect >= range.max) {
    // widest possible crop, computed directly to stay exact
    if (aspect > range.max * (1 + ASPECT_TOLERANCE)) fit = 'pillarbox';
    width = max.width;
    height = min.height;
  } else if (aspect <= range.min) {
    if (aspect < range.min * (1 - ASPECT_TOLERANCE)) fit = 'letterbox';
    width = min.width;
    height = max.height;
  } else if (aspect <= range.preferred) {
    // height-limited: use the full max height. The bounds are even, so rounding a value inside them stays inside.
    height = max.height;
    width = clamp(roundEven(aspect * height), min.width, max.width);
  } else {
    // width-limited
    width = max.width;
    height = clamp(roundEven(width / aspect), min.height, max.height);
  }

  // Center on min, then shift into max. Both intervals have even ends, so the result stays even and contains min.
  const place = (minStart: number, minSize: number, maxStart: number, maxSize: number, size: number) => (
    clamp(roundEven(minStart + (minSize - size) / 2), maxStart, maxStart + maxSize - size)
  );

  return {
    crop: {
      x: place(min.x, min.width, max.x, max.width, width),
      y: place(min.y, min.height, max.y, max.height, height),
      width,
      height,
    },
    fit,
  };
}

/**
 * Uniform scale factor to fit `crop` into a cell (contain). Equals `cellHeight / crop.height` for fill and pillarbox,
 * `cellWidth / crop.width` for letterbox. Above 2 the UI warns about upscaling.
 */
export function getScaleFactor(crop: Rect, cellWidth: number, cellHeight: number) {
  return Math.min(cellWidth / crop.width, cellHeight / crop.height);
}

/**
 * Main axis of the montage (B5, 04-diseno §9): `columns` side by side (full height, landscape output) or `rows`
 * stacked (full width, portrait output). The planner and the render work in "main axis" units: a column/row has an
 * offset and a length along the main axis and always spans the whole cross axis. For rows everything is the transpose
 * of the columns case: aspect ratios become 1 / a ({@link transposeAspectRange}) and rects swap x/y and width/height
 * ({@link transposeRect}), so the column algorithms work unchanged on transposed input.
 */
export type LayoutAxis = 'columns' | 'rows';

/** Swap x/y and width/height. */
export const transposeRect = ({ x, y, width, height }: Rect): Rect => ({ x: y, y: x, width: height, height: width });

/** Aspect range of the transposed clip: a → 1 / a (the interval flips). */
export const transposeAspectRange = (range: AspectRange): AspectRange => ({ min: 1 / range.max, max: 1 / range.min, preferred: 1 / range.preferred });

/** Aspect range in main-axis units (main length / cross length): as is for columns, transposed for rows. */
export const getMainAspectRange = (range: AspectRange, axis: LayoutAxis) => (axis === 'columns' ? range : transposeAspectRange(range));

/** Frame lengths along the main axis and across it. */
export const getAxisLengths = (axis: LayoutAxis, { width, height }: { width: number, height: number }) => (
  axis === 'columns' ? { main: width, cross: height } : { main: height, cross: width }
);

/**
 * Output rect of a column (`columns`) or row (`rows`) given by its main-axis `offset` and `length`: it spans the whole
 * cross axis.
 */
export const getCellRect = (axis: LayoutAxis, { offset, length }: { offset: number, length: number }, frame: { width: number, height: number }): Rect => (
  axis === 'columns'
    ? { x: offset, y: 0, width: length, height: frame.height }
    : { x: 0, y: offset, width: frame.width, height: length }
);

/**
 * Column width bounds in output pixels for a clip at output height `height`: even integers with
 * `min/height ≥ range.min` and `max/height ≤ range.max`, and the preferred width (real, clamped into them).
 * If the range is too narrow to contain an even width, both bounds become the even width closest to preferred
 * (the crop absorbs the mismatch, see {@link ASPECT_TOLERANCE}).
 */
export function getWidthRange(range: AspectRange, height: number) {
  let min = Math.max(2, ceilEven(range.min * height));
  let max = floorEven(range.max * height);
  if (min > max) {
    min = Math.max(2, roundEven(range.preferred * height));
    max = min;
  }
  return { min, max, preferred: clamp(range.preferred * height, min, max) };
}

/**
 * Share the row width among `clips` (left to right), separated by `gap` px.
 *
 * - Feasible (Σ min widths ≤ usable width ≤ Σ max widths): starts at each preferred width and spreads the difference
 *   proportionally to each clip's margin towards its max (or min). This saturates all clips at the same time, so no
 *   iteration is needed. `fill` is 0, or 1 if the usable width is odd (odd gap; validateMixProject warns about it).
 * - Σ max widths below the usable width: every clip takes its max width and the rest is returned as `fill`; where to
 *   put it is up to the planner.
 * - Σ min widths above the usable width: infeasible, returns `undefined`.
 *
 * Widths are even and within {@link getWidthRange}; invariant: `Σ widths + (n − 1)·gap + fill = width`.
 */
export function distributeWidths({ clips, width, height, gap }: {
  clips: AspectRange[],
  width: number,
  height: number,
  gap: number,
}): { widths: number[], fill: number } | undefined {
  const n = clips.length;
  if (n === 0) return { widths: [], fill: width };

  const usable = width - (n - 1) * gap;
  const bounds = clips.map((range) => getWidthRange(range, height));
  const sumMin = bounds.reduce((acc, b) => acc + b.min, 0);
  const sumMax = bounds.reduce((acc, b) => acc + b.max, 0);

  const target = floorEven(usable);
  if (sumMin > target) return undefined;
  if (sumMax <= target) {
    const widths = bounds.map((b) => b.max);
    return { widths, fill: usable - sumMax };
  }

  // Proportional spread in real numbers, then even rounding. Work in units of 2 px so it's plain integer rounding.
  const sumPreferred = bounds.reduce((acc, b) => acc + b.preferred, 0);
  const diff = target - sumPreferred;
  const margins = bounds.map((b) => (diff >= 0 ? b.max - b.preferred : b.preferred - b.min));
  const sumMargins = margins.reduce((acc, m) => acc + m, 0);
  const t = sumMargins > 0 ? diff / sumMargins : 0;
  const ideal = bounds.map((b, i) => (b.preferred + t * margins[i]!) / 2);

  const units = bounds.map((b, i) => clamp(Math.floor(ideal[i]!), b.min / 2, b.max / 2));
  let remaining = target / 2 - units.reduce((acc, u) => acc + u, 0);

  // Largest remainder: hand out (or take back) single units where rounding hurt the most, respecting the bounds.
  // Stable sort keeps the result deterministic on ties (lower index first).
  const order = ideal.map((_v, i) => i);
  while (remaining !== 0) {
    const step = remaining > 0 ? 1 : -1;
    const candidates = order
      .filter((i) => (step > 0 ? units[i]! < bounds[i]!.max / 2 : units[i]! > bounds[i]!.min / 2))
      .sort((a, b) => step * ((ideal[b]! - units[b]!) - (ideal[a]! - units[a]!)));
    invariant(candidates.length > 0, 'distributeWidths: no room to round');
    for (const i of candidates.slice(0, Math.abs(remaining))) {
      units[i]! += step;
      remaining -= step;
    }
  }

  return { widths: units.map((u) => u * 2), fill: usable - target };
}
