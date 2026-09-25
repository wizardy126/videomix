import { clampTransform, getKeyframeTransformAt } from './clipKeyframes';
import { ASPECT_TOLERANCE, getCropForAspect, getExtendedCropForAspect, normalizeRectEven, rectContains } from './geometry';
import type { CellCrop } from './geometry';
import type { Size } from './overlayMath';
import type { MixClip, Rect } from './types';

// A9 (T48): the crop of an animated clip (keyframes of its framing, clipKeyframes.ts) for a cell, at a source time. Used
// by the render (per frame, buildVideoGraph) and the live preview (previewDraw), so both show the same framing.
//
// The animation moves and scales the max and the min together (same proportion), so the crop for a cell is the crop of
// the base rects (the static one: getExtendedCropForAspect, with the tolerance of T44b and E7) moved and scaled by the
// same transform. It is real-valued (sub-pixel): rounding every frame to even source px would make slow pans and zooms
// judder (ADR-003). Without keyframes it is exactly the static crop, so nothing changes for clips that aren't animated.
//
// E7 (T38b): an extension beyond the max is taken along the same axis and in the same proportion (`extra · scale`),
// centred on the animated max and kept inside the frame like `extendMaxRect`, and the crop is shifted inside it like
// `getExtendedCropForAspect` does. If the frame leaves no room for the whole extension, the crop is cut there: it's
// then shorter along that axis (a stretch within the tolerance, or else pillarbox/letterbox for that frame).

const floorEven = (v: number) => 2 * Math.floor(v / 2 + 1e-6) + 0;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export type AnimatedCropClip = Pick<MixClip, 'maxRect' | 'minRect'> & Partial<Pick<MixClip, 'keyframes'>>;

/**
 * Crop of `clip` for a cell of `aspect` (width / height) at `time` (source seconds), following its keyframes. `frame`:
 * the clip's (turned) frame, `getClipFrame` (unknown = not clamped). `extendedMaxRect`: the placement's E7 extension.
 * Real-valued; without keyframes, exactly `getExtendedCropForAspect` of the base rects.
 */
export function getAnimatedCellCrop({ clip, aspect, time, frame, extendedMaxRect }: {
  clip: AnimatedCropClip,
  aspect: number,
  time: number,
  frame?: Size | undefined,
  extendedMaxRect?: Rect | undefined,
}): CellCrop {
  const base = getExtendedCropForAspect(clip.maxRect, clip.minRect, extendedMaxRect, aspect);
  const transform = getKeyframeTransformAt(clip.keyframes, time);
  if (transform == null) return base;
  // the even frame the pipeline crops in (getRectsForTransform)
  const bounds = frame != null ? { width: floorEven(frame.width), height: floorEven(frame.height) } : undefined;
  const { centerX, centerY, scale } = clampTransform(clip.maxRect, transform, bounds);
  const { maxRect } = clip;
  const map = (r: Rect): Rect => ({
    x: centerX + (r.x - maxRect.x - maxRect.width / 2) * scale,
    y: centerY + (r.y - maxRect.y - maxRect.height / 2) * scale,
    width: r.width * scale,
    height: r.height * scale,
  });
  const max = normalizeRectEven(maxRect, 'shrink');
  // inside the max: moved with it, so inside the (clamped) animated max, inside the frame
  if (rectContains(max, base.crop)) return { ...base, crop: map(base.crop) };

  // E7: the crop takes part of the extension, along its axis (the transpose for a vertical one)
  const horizontal = base.crop.width > max.width;
  const along = (r: Rect) => (horizontal ? { start: r.x, length: r.width } : { start: r.y, length: r.height });
  const extended = extendedMaxRect != null ? along(normalizeRectEven(extendedMaxRect, 'shrink')) : along(base.crop);
  const animatedMax = along(map(max));
  const limit = bounds != null ? (horizontal ? bounds.width : bounds.height) : Infinity;
  // extendMaxRect: centred on the max, shifted at the frame edges, at most the frame
  const extendedLength = Math.min(animatedMax.length + (extended.length - along(max).length) * scale, limit);
  const extendedStart = clamp(
    animatedMax.start - (extendedLength - animatedMax.length) / 2,
    Math.max(0, animatedMax.start + animatedMax.length - extendedLength),
    Math.min(animatedMax.start, limit - extendedLength),
  );
  // getExtendedCropForAspect: centred on the crop at the range limit, shifted inside the extended max
  const rangeLimit = along(map(getCropForAspect(clip.maxRect, clip.minRect, aspect).crop));
  const wanted = along(map(base.crop)).length;
  const length = Math.min(wanted, extendedLength);
  const start = clamp(rangeLimit.start + (rangeLimit.length - length) / 2, extendedStart, extendedStart + extendedLength - length);
  const across = map(base.crop);
  const crop = horizontal ? { ...across, x: start, width: length } : { ...across, y: start, height: length };
  if (length >= wanted - 1e-6) return { ...base, crop };
  // the frame leaves no room for the whole extension here
  const cropAspect = crop.width / crop.height;
  const withinTolerance = Math.abs(cropAspect / aspect - 1) <= ASPECT_TOLERANCE;
  if (withinTolerance) return { crop, fit: 'fill', strategy: 'stretch' };
  return { crop, fit: horizontal ? 'pillarbox' : 'letterbox', strategy: 'none' };
}
