import { getAspectRange, getAxisLengths, getExtensionRoom, getWidthRange, normalizeClipRects, normalizeRectEven, transposeRect } from './geometry';
import type { LayoutAxis } from './geometry';
import type { Size } from './overlayMath';
import { getClipFrame } from './clipRotation';
import { canExtendBeyondMax } from './planner/plannerInput';
import { getDefaultAxis } from './planner/types';
import { getOutputSize } from './types';
import type { MixClip, MixSettings, MixSource, Rect } from './types';

// F1/F2 (v4, T44): in which fractions of the output's main axis a clip fits (1/3, 1/2, 2/3, full), the magnet that
// snaps a dragged edge to a fraction's exact proportion, and "Fit to" a fraction. See 04-diseno §10.1.
//
// Everything works like the planner: the cell length of a fraction comes from the same usable length (the gaps taken
// out, even-floored) that `distributeWidths` shares among n columns, and a clip fits a cell when its even width bounds
// (`getWidthRange` of its main-axis aspect range, on the even-normalized rects) contain the cell length. Rows (9:16,
// or 1:1 in rows) are the transpose of columns: lengths are heights and the clip's rects are transposed.

export const fitFractions = ['1/3', '1/2', '2/3', 'full'] as const;

export type FitFraction = typeof fitFractions[number];

/** The fractions the magnet and the "Fit to" buttons offer (F2): not `full`. */
export const snapFractions: readonly FitFraction[] = ['1/3', '1/2', '2/3'];

/** `k` cells out of a row of `n` equal cells. */
const fractionParts: Record<FitFraction, { k: number, n: number }> = {
  '1/3': { k: 1, n: 3 },
  '1/2': { k: 1, n: 2 },
  '2/3': { k: 2, n: 3 },
  full: { k: 1, n: 1 },
};

/** The output as the fractions see it. */
export interface FitLayout {
  /** Output size (px). */
  width: number,
  height: number,
  /** Separation between columns/rows (px), `settings.gap.width`. */
  gap: number,
  axis: LayoutAxis,
}

// guards against float noise when comparing a fractional cell length with even bounds
const EPS = 1e-6;

const floorEven = (v: number) => 2 * Math.floor(v / 2 + EPS) + 0;
const ceilEven = (v: number) => 2 * Math.ceil(v / 2 - EPS) + 0;
const roundEven = (v: number) => 2 * Math.round(v / 2) + 0;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Main axes whose fractions make sense for an output: columns in landscape, rows in portrait, both for a square output
 * (the planner tries both and keeps the better plan, B5: the UI may show the axis of the current plan, `MixPlan.axis`).
 */
export function getFitAxes(output: Size): LayoutAxis[] {
  const axis = getDefaultAxis(output);
  return axis != null ? [axis] : ['columns', 'rows'];
}

/** The layout of a project's output. `axis` defaults to the output's axis (columns for a square output). */
export function getFitLayout(settings: Pick<MixSettings, 'output' | 'gap'>, axis?: LayoutAxis | undefined): FitLayout {
  const size = getOutputSize(settings.output);
  return { ...size, gap: settings.gap.width, axis: axis ?? getDefaultAxis(size) ?? 'columns' };
}

/**
 * Length of a fraction's cell along the main axis (output px, may be fractional): `k·Tₙ/n + (k − 1)·gap`, with
 * `Tₙ = floorEven(main − (n − 1)·gap)` the usable length `distributeWidths` shares among n columns. E.g. 2/3 is two
 * thirds plus a gap. 1/n is exactly the share of each of n equal clips.
 */
export function getFractionLength(fraction: FitFraction, { width, height, gap, axis }: FitLayout) {
  const { k, n } = fractionParts[fraction];
  const { main } = getAxisLengths(axis, { width, height });
  const usable = floorEven(main - (n - 1) * gap);
  return (k * usable) / n + (k - 1) * gap;
}

/** Aspect ratio (width / height, in output px) of a fraction's cell. */
export function getFractionCellAspect(fraction: FitFraction, layout: FitLayout) {
  const length = getFractionLength(fraction, layout);
  const { cross } = getAxisLengths(layout.axis, layout);
  return layout.axis === 'columns' ? length / cross : cross / length;
}

export type FractionFitStatus = 'fits' | 'extends' | 'no';

export interface FractionFit {
  fraction: FitFraction,
  /** Cell length along the main axis (output px), {@link getFractionLength}. */
  length: number,
  /**
   * - `fits`: the clip fills the cell between its min and max (what `distributeWidths` needs for n equal clips);
   * - `extends`: only by showing material beyond its max (E7 on and the source has it, as `extendPlan` would);
   * - `no`: it doesn't, see `missing`/`excess`.
   */
  status: FractionFitStatus,
  /** `no` because the max is too short along the main axis: source px (even) its max must grow along it. */
  missing?: number | undefined,
  /** `no` because the min (or a max without min) is too long along the main axis: source px (even) it must shrink. */
  excess?: number | undefined,
}

/** The clip's rects in main-axis space: transposed for rows, so "width" is always the main axis. */
function toMainSpace(axis: LayoutAxis, rect: Rect): Rect;
function toMainSpace(axis: LayoutAxis, rect: Rect | undefined): Rect | undefined;
function toMainSpace(axis: LayoutAxis, rect: Rect | undefined) {
  if (rect == null) return undefined;
  return axis === 'columns' ? rect : transposeRect(rect);
}

const toMainSize = (axis: LayoutAxis, { width, height }: Size): Size => (axis === 'columns' ? { width, height } : { width: height, height: width });

/** The output size in main-axis space (transposed for rows), to reuse the columns computations there. */
const mainSpaceSize = (axis: LayoutAxis, size: Size): Size => toMainSize(axis, { width: size.width, height: size.height });

/** Even width bounds (output px) of main-space rects in a cell `cross` px across, as the planner computes them. */
const getMainBounds = (max: Rect, min: Rect | undefined, cross: number) => getWidthRange(getAspectRange(max, min), cross);

/**
 * Smallest even `n ≥ 2` for which `ok(n)` holds, starting the search near `estimate` (analytic, maybe off by the even
 * rounding of the bounds). `ok` must be monotonic.
 */
function findSmallestEven(estimate: number, ok: (n: number) => boolean) {
  // the estimate is off by a few px at most: the limit only guards against an endless loop
  const limit = Math.max(2, ceilEven(estimate)) + 1000;
  let n = Math.max(2, ceilEven(estimate) - 2);
  while (n > 2 && ok(n - 2)) n -= 2;
  while (!ok(n) && n < limit) n += 2;
  return n;
}

/**
 * F1: in which fractions the clip fits. Its rects are the ones of its (turned, E9) frame; `frame` is that frame's size
 * (`getClipFrame`), needed for `extends` (material beyond the max); `extendBeyondMax` is the clip's E7 flag.
 * Missing/excess amounts are in (display) source px, even, and minimal: with the max grown (or the min shrunk) by that
 * much along the main axis, the fit condition holds (the rounding of `getWidthRange` included). A clip without min
 * (min = max) grows or shrinks as a whole.
 */
export function getFractionFits({ maxRect, minRect, frame, extendBeyondMax = false, layout, fractions = fitFractions }: {
  maxRect: Rect,
  minRect?: Rect | undefined,
  frame?: Size | undefined,
  extendBeyondMax?: boolean | undefined,
  layout: FitLayout,
  fractions?: readonly FitFraction[] | undefined,
}): FractionFit[] {
  const { axis } = layout;
  const { cross } = getAxisLengths(axis, layout);
  const { max: normMax, min: normMin } = normalizeClipRects(maxRect, minRect);
  const max = toMainSpace(axis, normMax);
  const min = toMainSpace(axis, normMin);
  const rigid = minRect == null;
  const bounds = getMainBounds(max, rigid ? undefined : min, cross);
  const room = extendBeyondMax && frame != null ? getExtensionRoom(maxRect, frame, axis === 'columns' ? 'horizontal' : 'vertical') : 0;
  // longest cell the clip fills with all the material of its frame (extendPlan's `maxLength`)
  const extendedLength = floorEven(((max.width + room) * cross) / min.height);

  return fractions.map((fraction) => {
    const length = getFractionLength(fraction, layout);
    if (length >= bounds.min - EPS && length <= bounds.max + EPS) return { fraction, length, status: 'fits' };
    if (length > bounds.max) {
      if (room > 0 && length <= extendedLength + EPS) return { fraction, length, status: 'extends' };
      // the max must grow along the main axis (and the min with it when there's none)
      const grown = (n: number) => {
        const m = { ...max, width: max.width + n };
        return getMainBounds(m, rigid ? undefined : min, cross).max >= length - EPS;
      };
      return { fraction, length, status: 'no', missing: findSmallestEven((length * min.height) / cross - max.width, grown) };
    }
    // the min (or the whole max without min) must shrink along the main axis
    const shrunk = (n: number) => {
      if (rigid) {
        if (max.width - n < 2) return true;
        return getMainBounds({ ...max, width: max.width - n }, undefined, cross).min <= length + EPS;
      }
      if (min.width - n < 2) return true;
      return getMainBounds(max, { ...min, width: min.width - n }, cross).min <= length + EPS;
    };
    const estimate = (rigid ? max.width : min.width) - (length * max.height) / cross;
    return { fraction, length, status: 'no', excess: findSmallestEven(estimate, shrunk) };
  });
}

/** {@link getFractionFits} for a project clip (its frame from its source, E9 turn included, and its E7 flag). */
export function getClipFractionFits({ clip, source, settings, axis, fractions }: {
  clip: Pick<MixClip, 'maxRect' | 'minRect' | 'rotation' | 'extendBeyondMax'>,
  source: Pick<MixSource, 'width' | 'height'> | undefined,
  settings: Pick<MixSettings, 'output' | 'gap'>,
  /** Default: the output's axis (columns for a square output), see {@link getFitAxes}. */
  axis?: LayoutAxis | undefined,
  fractions?: readonly FitFraction[] | undefined,
}) {
  return getFractionFits({
    maxRect: clip.maxRect,
    minRect: clip.minRect,
    frame: getClipFrame(clip, source),
    extendBeyondMax: canExtendBeyondMax(clip),
    layout: getFitLayout(settings, axis),
    fractions,
  });
}

export type RectEdge = 'left' | 'right' | 'top' | 'bottom';

/**
 * F2 magnet: `rect` (the max or the min being dragged by `edge`, the opposite edge fixed) snapped to the exact
 * proportion of the closest fraction's cell (`getFractionCellAspect`), if its size along the dragged axis is within
 * `threshold` source px of it. Dragging `left`/`right` snaps the width to `height × aspect`; `top`/`bottom` the height
 * to `width / aspect`; the target is rounded to even px. Candidates that would leave `bounds` (the frame for the max,
 * the max for the min) are skipped. Undefined if none is close enough (then the drag goes on unsnapped).
 */
export function snapRectEdge({ rect, edge, threshold, layout, bounds, fractions = snapFractions }: {
  rect: Rect,
  edge: RectEdge,
  threshold: number,
  layout: FitLayout,
  bounds?: Rect | undefined,
  fractions?: readonly FitFraction[] | undefined,
}): { rect: Rect, fraction: FitFraction } | undefined {
  const horizontal = edge === 'left' || edge === 'right';
  let best: { rect: Rect, fraction: FitFraction, distance: number } | undefined;
  fractions.forEach((fraction) => {
    const aspect = getFractionCellAspect(fraction, layout);
    const size = roundEven(horizontal ? rect.height * aspect : rect.width / aspect);
    if (size < 2) return;
    const distance = Math.abs(size - (horizontal ? rect.width : rect.height));
    if (distance > threshold) return;
    let snapped: Rect;
    switch (edge) {
      case 'left': { snapped = { ...rect, x: rect.x + rect.width - size, width: size }; break; }
      case 'right': { snapped = { ...rect, width: size }; break; }
      case 'top': { snapped = { ...rect, y: rect.y + rect.height - size, height: size }; break; }
      default: { snapped = { ...rect, height: size }; }
    }
    const inside = bounds == null || (snapped.x >= bounds.x && snapped.y >= bounds.y
      && snapped.x + snapped.width <= bounds.x + bounds.width && snapped.y + snapped.height <= bounds.y + bounds.height);
    if (!inside) return;
    if (best == null || distance < best.distance) best = { rect: snapped, fraction, distance };
  });
  return best != null ? { rect: best.rect, fraction: best.fraction } : undefined;
}

/** Why {@link fitMaxRectToFraction} can't fit: the min doesn't fit in any rect of that proportion inside the frame. */
export type FitToFractionFailure = 'min-too-large';

export type FitToFractionResult = { ok: true, maxRect: Rect } | { ok: false, reason: FitToFractionFailure };

/**
 * F2 "Fit to 1/3 / 1/2 / 2/3": a max rect with the exact proportion of the fraction's cell (up to the even rounding of
 * its main length), keeping the current max's length across the main axis when possible (else the closest one that
 * fits the frame and contains the min), centred on the min if the clip has one (else on the current max), and shifted
 * just enough to stay inside `frame` (the clip's turned frame, even-floored) and to contain the (even-normalized) min.
 * Even edges. With a min, the result always fits the fraction (`getFractionFits` → `fits`; near the limits the size is
 * nudged by 2 px for the even rounding, and if it still can't fit, e.g. squeezed against the frame, it fails with
 * `min-too-large`). Without a min (min = max, a rigid clip) it fits only if the cell's length is a whole even number of
 * output px (e.g. not 1/3 of 1280, 426.67 px): the planner itself can't lay out such a rigid clip without fill.
 */
export function fitMaxRectToFraction({ maxRect, minRect, frame, fraction, layout }: {
  maxRect: Rect,
  minRect?: Rect | undefined,
  frame: Size,
  fraction: FitFraction,
  layout: FitLayout,
}): FitToFractionResult {
  const { axis } = layout;
  const { cross } = getAxisLengths(axis, layout);
  // main-space aspect (main / cross) of the cell
  const aspect = getFractionLength(fraction, layout) / cross;
  const size = toMainSize(axis, frame);
  const frameWidth = floorEven(size.width);
  const frameHeight = floorEven(size.height);
  const max = toMainSpace(axis, maxRect);
  const min = minRect != null ? toMainSpace(axis, normalizeRectEven(minRect, 'grow')) : undefined;

  // cross length: the current one, within what contains the min and what fits the frame
  const lowest = ceilEven(min != null ? Math.max(min.height, min.width / aspect) : 2);
  const highest = floorEven(Math.min(frameHeight, frameWidth / aspect));
  if (lowest > highest) return { ok: false, reason: 'min-too-large' };
  let height = clamp(roundEven(max.height), lowest, highest);
  let width = clamp(roundEven(aspect * height), Math.max(2, min?.width ?? 2), frameWidth);
  if (min != null) {
    // near the limits of the aspect range the even rounding of the width bounds can miss the cell by a step: nudge
    // the height (min too wide) or the width (max too narrow) by 2 px until the clip fits
    const fitsNow = () => getFractionFits({
      maxRect: { x: 0, y: 0, width, height },
      minRect: { x: 0, y: 0, width: min.width, height: min.height },
      layout: { ...layout, axis: 'columns', ...mainSpaceSize(axis, layout) },
      fractions: [fraction],
    })[0]!;
    for (let i = 0; i < 8; i += 1) {
      const fit = fitsNow();
      if (fit.excess != null && height + 2 <= highest) {
        height += 2;
        width = clamp(roundEven(aspect * height), Math.max(2, min.width), frameWidth);
      } else if (fit.missing != null && width + 2 <= frameWidth) {
        width += 2;
      } else {
        break;
      }
    }
    // squeezed between the min and the frame edge, a rounding step away from fitting
    if (fitsNow().status !== 'fits') return { ok: false, reason: 'min-too-large' };
  }

  const center = min ?? max;
  const place = (start: number, length: number, frameLength: number, minStart: number | undefined, minLength: number | undefined) => {
    let lo = 0;
    let hi = frameLength - length;
    if (minStart != null && minLength != null) {
      lo = Math.max(lo, minStart + minLength - length);
      hi = Math.min(hi, minStart);
    }
    return clamp(roundEven(start - length / 2), lo, hi);
  };
  const rect = {
    x: place(center.x + center.width / 2, width, frameWidth, min?.x, min?.width),
    y: place(center.y + center.height / 2, height, frameHeight, min?.y, min?.height),
    width,
    height,
  };
  return { ok: true, maxRect: toMainSpace(axis, rect) };
}
