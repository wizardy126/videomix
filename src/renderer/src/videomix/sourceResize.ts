import { clampRect } from './geometry';
import type { Size } from './overlayMath';
import { getCodedSize, isSquareSar } from './sampleAspect';
import { rotateSize } from './clipRotation';
import type { MixClip, MixClipRotation, MixSource, Rect } from './types';
import { MIN_RECT_SIZE } from './types';

// B2 (v3): the size of a source changes (relinked to another file, or the file was replaced): the rects of its clips
// are scaled with it, so they keep showing the same part of the picture.

/** Two sizes whose aspect ratios differ less than this (relative) have "the same proportion". */
const ASPECT_TOLERANCE = 0.01;

export interface SourceFrameChange {
  from: Size,
  to: Size,
  /** The proportion changed too: the rects keep their own proportion and are fitted into the new frame. */
  aspectChanged: boolean,
}

/** A5 (T44): the change between two frame sizes (undefined if they're equal), as {@link getSourceFrameChange} gives it. */
export function getFrameChange(from: Size, to: Size): SourceFrameChange | undefined {
  if (from.width === to.width && from.height === to.height) return undefined;
  const aspectChanged = Math.abs((to.width / to.height) / (from.width / from.height) - 1) > ASPECT_TOLERANCE;
  return { from, to, aspectChanged };
}

/**
 * How the frame of `source` changes with the new cached meta `next`, or undefined if the clip rects stay as they are:
 * - the size doesn't change, or isn't known on either side (the first probe of a source never scales anything);
 * - the "change" is the B1 upgrade of a source cached before v3 (coded size without SAR): the stored size is the
 *   coded size of the new display size, and its rects were already drawn in display pixels (the editor used
 *   `videoWidth`), so they become valid as they are.
 */
export function getSourceFrameChange(
  source: Pick<MixSource, 'width' | 'height' | 'sar'>,
  next: Partial<Pick<MixSource, 'width' | 'height' | 'sar'>>,
): SourceFrameChange | undefined {
  if (source.width == null || source.height == null || next.width == null || next.height == null) return undefined;
  const from = { width: source.width, height: source.height };
  const to = { width: next.width, height: next.height };
  if (from.width === to.width && from.height === to.height) return undefined;
  if (isSquareSar(source.sar) && !isSquareSar(next.sar)) {
    const coded = getCodedSize(to, next.sar);
    if (coded.width === from.width && coded.height === from.height) return undefined;
  }
  return getFrameChange(from, to);
}


/** E9 (T38d): the change of a clip's turned frame, whose rects live in it (a quarter turn swaps the axes). */
export const rotateFrameChange = (change: SourceFrameChange, rotation: MixClipRotation): SourceFrameChange => (
  rotation === 0 ? change : { ...change, from: rotateSize(change.from, rotation), to: rotateSize(change.to, rotation) }
);

const roundEven = (v: number) => 2 * Math.round(v / 2) + 0;
const floorEven = (v: number) => 2 * Math.floor(v / 2) + 0;

/**
 * The rect scaled by `s` around its centre mapped from `change.from` to `change.to` (each axis by its own factor),
 * with even edges, at least MIN_RECT_SIZE (unless `bounds` is smaller) and inside `bounds` (even edges too).
 */
function scaleRect(rect: Rect, change: SourceFrameChange, s: number, bounds: Rect): Rect {
  const cx = ((rect.x + rect.width / 2) * change.to.width) / change.from.width;
  const cy = ((rect.y + rect.height / 2) * change.to.height) / change.from.height;
  const fit = (length: number, limit: number) => Math.min(Math.max(roundEven(length * s), MIN_RECT_SIZE), limit);
  const width = fit(rect.width, bounds.width);
  const height = fit(rect.height, bounds.height);
  // bounds have even edges, so clamping keeps them even
  return clampRect({ x: roundEven(cx - width / 2), y: roundEven(cy - height / 2), width, height }, bounds);
}

/**
 * The max/min rects of a clip for the new frame. Same proportion: scaled with the frame. Different proportion: scaled
 * uniformly by the smaller factor (so a crop keeps its aspect ratio, e.g. a 9:16 crop stays 9:16) around its mapped
 * centre and fitted into the frame. Edges even, min ⊆ max.
 */
export function rescaleClipRects({ maxRect, minRect }: Pick<MixClip, 'maxRect' | 'minRect'>, change: SourceFrameChange): Pick<MixClip, 'maxRect' | 'minRect'> {
  const sx = change.to.width / change.from.width;
  const sy = change.to.height / change.from.height;
  const s = change.aspectChanged ? Math.min(sx, sy) : Math.sqrt(sx * sy);
  const frame = { x: 0, y: 0, width: floorEven(change.to.width), height: floorEven(change.to.height) };
  const max = scaleRect(maxRect, change, s, frame);
  return { maxRect: max, minRect: minRect != null ? scaleRect(minRect, change, s, max) : undefined };
}
