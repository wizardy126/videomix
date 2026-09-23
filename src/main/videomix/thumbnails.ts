import { runFfmpeg } from '../ffmpeg.js';
import { getFfmpegJpegQuality } from '../ffmpegUtil.js';

// Clip thumbnails (A2, T31): one JPEG frame per clip, cropped to its max rect and scaled down, for ClipList's rows
// and the Mix view's blocks. The renderer (thumbnails.ts, hooks/useClipThumbnails.ts) owns the cache key and the
// queue; this just runs ffmpeg for one thumbnail.

/** Thumbnails are scaled to this height; `scale=-2:…` keeps the aspect and rounds the width to even (mjpeg needs it). */
export const THUMBNAIL_HEIGHT = 160;

export interface ThumbnailCrop {
  x: number,
  y: number,
  width: number,
  height: number,
}

/**
 * Captures the frame at `timestamp` of `filePath`, cropped to `crop` and scaled to {@link THUMBNAIL_HEIGHT} tall, as a
 * JPEG at `outPath`.
 *
 * `crop` is in oriented (displayed) source pixels, like `MixClip.maxRect` (geometry.ts): no `-noautorotate` here, so
 * ffmpeg auto-applies the stream's rotation before the crop filter, the same as `captureFrameToFile`
 * (verified against test-media/v-rotated-9s.mp4).
 */
export async function captureThumbnail({ filePath, timestamp, crop, outPath, quality = 0.6 }: {
  filePath: string,
  timestamp: number,
  crop: ThumbnailCrop,
  outPath: string,
  quality?: number | undefined,
}) {
  const args = [
    '-ss', String(timestamp),
    '-i', filePath,
    '-frames:v', '1',
    '-vf', `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=-2:${THUMBNAIL_HEIGHT}`,
    '-q:v', String(getFfmpegJpegQuality(quality)),
    '-y', outPath,
  ];
  await runFfmpeg(args);
}
