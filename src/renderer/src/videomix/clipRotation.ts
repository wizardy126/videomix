import invariant from 'tiny-invariant';

import { clampRect } from './geometry';
import { isQuarterTurn } from './overlayMath';
import type { ClipRects, Size } from './overlayMath';
import { mixClipRotations } from './types';
import type { MixClip, MixClipRotation, MixSource, Rect } from './types';

// E9 (T38d): a clip's picture can be turned clockwise by 90, 180 or 270°, on top of the source's rotation metadata.
// The clip's rects live in the *turned* frame: the display frame of the source (metadata rotation and SAR applied,
// 04-diseno §1.1) turned by `MixClip.rotation`. So everything that only looks at the rects (aspect ranges, orientation,
// the planner) works unchanged, and whatever reads the picture (render, thumbnails, live preview, editor) turns it:
// the rect is taken back to the unturned display frame (`unrotateRect`), cropped there, and the crop is turned.

const floorEven = (v: number) => 2 * Math.floor(v / 2) + 0;
const roundEven = (v: number) => 2 * Math.round(v / 2) + 0;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const isClipRotation = (value: number): value is MixClipRotation => (mixClipRotations as readonly number[]).includes(value);

/** The clip's turn (missing = 0). */
export const getClipRotation = (clip: Pick<MixClip, 'rotation'>): MixClipRotation => clip.rotation ?? 0;

/** `rotation + delta` (any multiple of 90, either sign), as a turn in [0, 360). */
export function addRotation(rotation: MixClipRotation, delta: number): MixClipRotation {
  const value = (((rotation + delta) % 360) + 360) % 360;
  invariant(isClipRotation(value), `Invalid rotation ${rotation} + ${delta}`);
  return value;
}

/** Size of a frame of `size` turned by `rotation`. */
export const rotateSize = (size: Size, rotation: MixClipRotation): Size => (isQuarterTurn(rotation) ? { width: size.height, height: size.width } : size);

/**
 * `rect` of a frame of `frame` size, in the coordinates of that frame turned clockwise by `rotation` (a turned image
 * of `rotateSize(frame, rotation)`). Exact: integer rects stay integer and inside the turned frame.
 */
export function rotateRect(rect: Rect, frame: Size, rotation: MixClipRotation): Rect {
  if (rotation === 90) return { x: frame.height - rect.y - rect.height, y: rect.x, width: rect.height, height: rect.width };
  if (rotation === 180) return { x: frame.width - rect.x - rect.width, y: frame.height - rect.y - rect.height, width: rect.width, height: rect.height };
  if (rotation === 270) return { x: rect.y, y: frame.width - rect.x - rect.width, width: rect.height, height: rect.width };
  return rect;
}

/** Inverse of {@link rotateRect}: a rect of the turned frame back in the coordinates of `frame` (the unturned size). */
export const unrotateRect = (rect: Rect, frame: Size, rotation: MixClipRotation): Rect => (
  rotateRect(rect, rotateSize(frame, rotation), addRotation(0, -rotation))
);

/** Even edges inside the (even) frame, keeping the size when possible: only moves anything if the frame is odd. */
function snapRectEven(rect: Rect, frame: Size): Rect {
  const fit = (start: number, length: number, limit: number) => {
    const size = Math.min(floorEven(length), floorEven(limit));
    return [clamp(roundEven(start), 0, floorEven(limit) - size), size] as const;
  };
  const [x, width] = fit(rect.x, rect.width, frame.width);
  const [y, height] = fit(rect.y, rect.height, frame.height);
  return { x, y, width, height };
}

/**
 * The max/min rects of a clip turned with the picture when its rotation changes `from` → `to`, so they keep framing
 * the same content (E9). `sourceFrame` is the display size of the source (unturned). With an even frame the result is
 * exact (a round trip gives back the same rects) and keeps even edges; an odd frame snaps them to even (±1 px).
 */
export function rotateClipRects({ maxRect, minRect }: ClipRects, sourceFrame: Size, from: MixClipRotation, to: MixClipRotation): ClipRects {
  const frame = rotateSize(sourceFrame, from);
  const turn = addRotation(to, -from);
  if (turn === 0) return { maxRect, minRect };
  const turned = rotateSize(frame, turn);
  const max = snapRectEven(rotateRect(maxRect, frame, turn), turned);
  return { maxRect: max, minRect: minRect != null ? clampRect(snapRectEven(rotateRect(minRect, frame, turn), turned), max) : undefined };
}

/** Display size of a source (B1), if known. */
export const getSourceFrame = (source: Pick<MixSource, 'width' | 'height'> | undefined): Size | undefined => (
  source?.width != null && source.height != null ? { width: source.width, height: source.height } : undefined
);

/** The frame the clip's rects live in (E9): its source's display frame turned by the clip's rotation. */
export function getClipFrame(clip: Pick<MixClip, 'rotation'>, source: Pick<MixSource, 'width' | 'height'> | undefined): Size | undefined {
  const frame = getSourceFrame(source);
  return frame != null ? rotateSize(frame, getClipRotation(clip)) : undefined;
}

/**
 * ffmpeg filter that turns a (cropped) picture clockwise by `rotation`, to append after the crop; '' for none.
 * transpose also inverts the SAR of a non-square picture, which the explicit scale + setsar=1 after it ignore.
 */
export function getRotationFilter(rotation: MixClipRotation) {
  if (rotation === 90) return 'transpose=clock';
  if (rotation === 270) return 'transpose=cclock';
  if (rotation === 180) return 'hflip,vflip';
  return '';
}

/**
 * A rect of the clip's (turned) frame as the rect of the unturned display frame to crop, snapped to even edges for
 * yuv420p (only an odd frame moves it, ±1 px). `sourceFrame`: the source's display size (needed to turn).
 */
export function getUnrotatedCrop(rect: Rect, sourceFrame: Size | undefined, rotation: MixClipRotation): Rect {
  if (rotation === 0) return rect;
  invariant(sourceFrame != null, 'The size of a turned clip\'s source is needed');
  return snapRectEven(unrotateRect(rect, sourceFrame, rotation), sourceFrame);
}
