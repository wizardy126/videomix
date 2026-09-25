import type { CropDetectRect } from '../../../common/videomix/cropDetect';
import { getSourceFrame, rotateRect, rotateSize } from './clipRotation';
import { clampRect, normalizeRectEven } from './geometry';
import type { ClipRects, Size } from './overlayMath';
import { getCodedSize, isSquareSar } from './sampleAspect';
import type { SampleAspectRatio } from './sampleAspect';
import { MIN_RECT_SIZE } from './types';
import type { BlackBarsDetection, MixClipRotation, MixSource, Rect } from './types';

// A7 (v4, T44): black bars. main runs `cropdetect` (T47) and parses it (`parseCropDetectOutput`, common); here the result
// becomes display pixels (B1) and the max rect of new clips (or of the "Remove black bars" button). See 04-diseno §10.5.

export { parseCropDetectOutput } from '../../../common/videomix/cropDetect';
export type { CropDetectRect } from '../../../common/videomix/cropDetect';

/**
 * Bars thinner than this (display px) are ignored: the max keeps reaching that edge of the frame. `cropdetect` (with its
 * default `limit`) can take a dark edge row or column, or an encoder's padding line, for a bar.
 */
export const BLACK_BARS_MIN_SIZE = 4;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * The picture rect `cropdetect` found (in the coded pixels of the frame it analyzed) in display pixels of the source
 * (B1): the stretched axis multiplied by the SAR (`MixSource.sar`, of the oriented frame), rounded outwards (never
 * cutting picture) and kept inside `displayFrame` (the source's display size). `turn`: clockwise turn from the analyzed
 * frame to the oriented one; 0 (default) when ffmpeg autorotated before `cropdetect`, which is its default.
 */
export function cropDetectToDisplayRect({ rect, sar, displayFrame, turn = 0 }: {
  rect: CropDetectRect,
  sar: SampleAspectRatio | undefined,
  displayFrame: Size,
  turn?: MixClipRotation | undefined,
}): Rect {
  let oriented: Rect = rect;
  if (turn !== 0) {
    // the analyzed (unturned) coded frame
    const codedOriented = getCodedSize(displayFrame, sar);
    oriented = rotateRect(rect, rotateSize(codedOriented, turn), turn);
  }
  const scale = (start: number, length: number, factor: number) => {
    const from = Math.floor(start * factor);
    return [from, Math.ceil((start + length) * factor) - from] as const;
  };
  let display = oriented;
  if (!isSquareSar(sar)) {
    if (sar.num > sar.den) {
      const [x, width] = scale(oriented.x, oriented.width, sar.num / sar.den);
      display = { ...oriented, x, width };
    } else {
      const [y, height] = scale(oriented.y, oriented.height, sar.den / sar.num);
      display = { ...oriented, y, height };
    }
  }
  const left = clamp(display.x, 0, displayFrame.width);
  const top = clamp(display.y, 0, displayFrame.height);
  return {
    x: left,
    y: top,
    width: clamp(display.x + display.width, left, displayFrame.width) - left,
    height: clamp(display.y + display.height, top, displayFrame.height) - top,
  };
}

/** A detection to cache for a source (`MixSource.blackBars`); `rect` undefined (no picture found) is stored as the whole frame. */
export function createBlackBarsDetection({ rect, frame, file }: { rect: Rect | undefined, frame: Size, file: { size: number, mtimeMs: number } }): BlackBarsDetection {
  return {
    rect: rect ?? { x: 0, y: 0, width: frame.width, height: frame.height },
    frame: { width: frame.width, height: frame.height },
    file: { size: file.size, mtimeMs: file.mtimeMs },
  };
}

/**
 * Whether the cached detection still applies: same display size as the source's cached one and same file identity
 * (`fs.stat` of the source file). Without `file` only the size is checked (e.g. when creating a clip, synchronously).
 */
export function isBlackBarsDetectionValid(detection: BlackBarsDetection | undefined, source: Pick<MixSource, 'width' | 'height'>, file?: { size: number, mtimeMs: number } | undefined): detection is BlackBarsDetection {
  if (detection == null || source.width == null || source.height == null) return false;
  if (detection.frame.width !== source.width || detection.frame.height !== source.height) return false;
  return file == null || (file.size === detection.file.size && file.mtimeMs === detection.file.mtimeMs);
}

/**
 * The picture rect of a detection with the bars thinner than `minSize` ignored (that edge reaches the frame), even
 * edges inside it (shrunk), in display px of the source. Undefined if there are no bars (the whole frame), or if what's
 * left is smaller than MIN_RECT_SIZE (probably a wrong detection).
 */
export function getPictureRect(rect: Rect, frame: Size, minSize = BLACK_BARS_MIN_SIZE): Rect | undefined {
  const bar = (size: number) => (size >= minSize ? size : 0);
  const left = bar(clamp(rect.x, 0, frame.width));
  const top = bar(clamp(rect.y, 0, frame.height));
  const right = frame.width - bar(clamp(frame.width - rect.x - rect.width, 0, frame.width));
  const bottom = frame.height - bar(clamp(frame.height - rect.y - rect.height, 0, frame.height));
  if (left === 0 && top === 0 && right === frame.width && bottom === frame.height) return undefined;
  const picture = normalizeRectEven({ x: left, y: top, width: right - left, height: bottom - top }, 'shrink');
  if (picture.width < MIN_RECT_SIZE || picture.height < MIN_RECT_SIZE) return undefined;
  return picture;
}

/** Whether a detection found bars (at least {@link BLACK_BARS_MIN_SIZE} px on some side). */
export const hasBlackBars = (detection: Pick<BlackBarsDetection, 'rect' | 'frame'>) => getPictureRect(detection.rect, detection.frame) != null;

/**
 * Max rect of a new clip of `source` (A7 (3)): the whole (turned) frame, or, with `autoCropBlackBars` and a detection
 * valid for the source's size, its picture rect (`getPictureRect`), turned with the clip (`rotation`, E9; 0 for a new
 * clip). Undefined if the source size isn't known (the caller keeps creating the clip as before).
 */
export function getNewClipMaxRect({ source, autoCropBlackBars, rotation = 0 }: {
  source: Pick<MixSource, 'width' | 'height' | 'blackBars'>,
  autoCropBlackBars: boolean,
  rotation?: MixClipRotation | undefined,
}): Rect | undefined {
  const frame = getSourceFrame(source);
  if (frame == null) return undefined;
  const turned = rotateSize(frame, rotation);
  const whole = { x: 0, y: 0, width: turned.width, height: turned.height };
  if (!autoCropBlackBars || !isBlackBarsDetectionValid(source.blackBars, source)) return whole;
  const picture = getPictureRect(source.blackBars.rect, frame);
  return picture != null ? rotateRect(picture, frame, rotation) : whole;
}

/**
 * "Remove black bars" (A7 (1)) on a clip: its max cut to `picture` (the picture rect in the clip's frame: detected on
 * the clip's range, `getPictureRect` of it in display px, turned with the clip with `rotateRect`) — never grown, even
 * edges — and its min cut to stay inside (or, if that
 * leaves it smaller than MIN_RECT_SIZE, moved inside). Undefined if nothing changes (no bars inside the max) or the
 * max would be smaller than MIN_RECT_SIZE.
 */
export function removeBlackBarsFromRects({ maxRect, minRect }: ClipRects, picture: Rect): ClipRects | undefined {
  const intersect = (a: Rect, b: Rect) => {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
  };
  const cutMax = intersect(maxRect, picture);
  if (cutMax.x === maxRect.x && cutMax.y === maxRect.y && cutMax.width === maxRect.width && cutMax.height === maxRect.height) return undefined;
  const max = normalizeRectEven(cutMax, 'shrink');
  if (max.width < MIN_RECT_SIZE || max.height < MIN_RECT_SIZE) return undefined;
  if (minRect == null) return { maxRect: max };
  const cut = intersect(minRect, max);
  const min = cut.width >= MIN_RECT_SIZE && cut.height >= MIN_RECT_SIZE ? cut : clampRect(minRect, max);
  return { maxRect: max, minRect: min };
}
