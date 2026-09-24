import { isQuarterTurn } from './overlayMath';
import type { Size } from './overlayMath';
import type { MixSource, Rect } from './types';

// B1 (v3): sources with non-square pixels (sample aspect ratio ≠ 1, "anamorphic"). Everything in the project (source
// size, clip rects, editor, live preview) is in *display* pixels, the ones of Chromium's videoWidth/videoHeight and of
// canvas drawImage on a <video> (verified in Electron, T35). ffmpeg filters work on the *coded* pixels of the frame it
// delivers after autorotate, so rects are converted here, only in the `crop` (the scale to the cell that follows it
// ends with setsar=1 and fixes the proportion).
//
// Chromium's rule (media/base/video_aspect_ratio.cc) grows one dimension, never shrinks: SAR > 1 widens the frame,
// SAR < 1 makes it taller. E.g. 1280×720 at 679:640 → 1358×720; 720×480 at 8:9 → 720×540.
//
// Rotation: ffmpeg's autorotate (transpose) inverts the SAR of a frame turned a quarter (1280×720 at 87:82, rotated
// 90° → 720×1280 at 82:87), and Chromium rotates the display size. So the SAR is stored for the *oriented* frame
// (`MixSource.sar`), and then the same rule applies to the oriented coded size.

export type SampleAspectRatio = NonNullable<MixSource['sar']>;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** `"num:den"` from ffprobe's `sample_aspect_ratio`, reduced. Undefined if missing, unknown (`0:1`, `N/A`) or invalid. */
export function parseSampleAspectRatio(value: string | undefined): SampleAspectRatio | undefined {
  const match = value != null ? /^(\d+)[:/](\d+)$/.exec(value.trim()) : null;
  if (match == null) return undefined;
  const num = Number(match[1]);
  const den = Number(match[2]);
  if (!(num > 0 && den > 0)) return undefined;
  const d = gcd(num, den);
  return { num: num / d, den: den / d };
}

export const isSquareSar = (sar: SampleAspectRatio | undefined): sar is undefined => sar == null || sar.num === sar.den;

/** Undefined for square pixels (how `MixSource.sar` stores them). */
export const normalizeSar = (sar: SampleAspectRatio | undefined) => (isSquareSar(sar) ? undefined : sar);

export const isSameSar = (a: SampleAspectRatio | undefined, b: SampleAspectRatio | undefined) => (
  isSquareSar(a) ? isSquareSar(b) : !isSquareSar(b) && a.num * b.den === b.num * a.den
);

/** SAR of the frame ffmpeg delivers after autorotating a stream with this SAR and `rotation`. */
export const getOrientedSar = (sar: SampleAspectRatio | undefined, rotation: number | undefined) => (
  sar != null && isQuarterTurn(rotation) ? { num: sar.den, den: sar.num } : sar
);

/** Display size (Chromium's `videoWidth`/`videoHeight`) of an oriented coded size with the oriented `sar`. */
export function getDisplaySize(coded: Size, sar: SampleAspectRatio | undefined): Size {
  if (isSquareSar(sar)) return coded;
  return sar.num > sar.den
    ? { width: Math.round((coded.width * sar.num) / sar.den), height: coded.height }
    : { width: coded.width, height: Math.round((coded.height * sar.den) / sar.num) };
}

/** Inverse of {@link getDisplaySize}: the oriented coded size of a display size. */
export function getCodedSize(display: Size, sar: SampleAspectRatio | undefined): Size {
  if (isSquareSar(sar)) return display;
  return sar.num > sar.den
    ? { width: Math.round((display.width * sar.den) / sar.num), height: display.height }
    : { width: display.width, height: Math.round((display.height * sar.num) / sar.den) };
}

const roundEven = (v: number) => 2 * Math.round(v / 2) + 0;
const floorEven = (v: number) => 2 * Math.floor(v / 2 + 1e-6) + 0;

/**
 * A rect in display pixels as coded pixels of the (autorotated) frame, for ffmpeg's `crop`: the stretched axis is
 * divided by the SAR, with the edges rounded to even pixels (yuv420p). With `frame` (the display size of the source),
 * the result is kept inside the coded frame. Unchanged for square pixels.
 */
export function toCodedRect(rect: Rect, sar: SampleAspectRatio | undefined, frame?: Size | undefined): Rect {
  if (isSquareSar(sar)) return rect;
  const coded = frame != null ? getCodedSize(frame, sar) : undefined;
  const convert = (start: number, length: number, factor: number, limit: number | undefined) => {
    const end = Math.max(2, Math.min(roundEven((start + length) / factor), limit != null ? floorEven(limit) : Infinity));
    const s = Math.min(roundEven(start / factor), end - 2);
    return [s, end - s] as const;
  };
  if (sar.num > sar.den) {
    const [x, width] = convert(rect.x, rect.width, sar.num / sar.den, coded?.width);
    return { ...rect, x, width };
  }
  const [y, height] = convert(rect.y, rect.height, sar.den / sar.num, coded?.height);
  return { ...rect, y, height };
}
