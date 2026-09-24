// ffmpeg arguments of a clip thumbnail (T31), apart from thumbnails.ts so they can be tested without Electron (B1, T35).

/** Thumbnails are scaled to this height; `scale=-2:…` keeps the aspect and rounds the width to even (mjpeg needs it). */
export const THUMBNAIL_HEIGHT = 160;

export interface ThumbnailCrop {
  x: number,
  y: number,
  width: number,
  height: number,
}

/**
 * `crop` is in the pixels of the frame ffmpeg delivers: no `-noautorotate` here, so ffmpeg auto-applies the stream's
 * rotation before the crop filter, the same as `captureFrameToFile` (verified against test-media/v-rotated-9s.mp4).
 * For square pixels that's the display pixels of `MixClip.maxRect`. A source with non-square pixels (B1) passes the
 * rect in coded pixels (the renderer's `getThumbnailCrop`) and `aspect`, the display aspect ratio of the crop: the
 * thumbnail is then scaled to it with square pixels (`scale=-2` would keep the coded proportion, with a JPEG SAR that
 * <img> ignores).
 */
export function getThumbnailArgs({ filePath, timestamp, crop, aspect, rotation, outPath, qscale }: {
  filePath: string,
  timestamp: number,
  crop: ThumbnailCrop,
  aspect?: number | undefined,
  /**
   * E9 (T38d): ffmpeg filter that turns the cropped picture (the renderer's `getRotationFilter`), for a turned clip:
   * `crop` is then in the unturned frame and `aspect` (if any) is the turned one.
   */
  rotation?: string | undefined,
  outPath: string,
  /** `-q:v` of the mjpeg encoder. */
  qscale: number,
}) {
  const scale = aspect != null ? `scale=${Math.max(2, 2 * Math.round((THUMBNAIL_HEIGHT * aspect) / 2))}:${THUMBNAIL_HEIGHT},setsar=1` : `scale=-2:${THUMBNAIL_HEIGHT}`;
  return [
    '-ss', String(timestamp),
    '-i', filePath,
    '-frames:v', '1',
    '-vf', `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},${rotation ? `${rotation},` : ''}${scale}`,
    '-q:v', String(qscale),
    '-y', outPath,
  ];
}
