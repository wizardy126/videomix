import { runFfmpeg } from '../ffmpeg.js';
import { getFfmpegJpegQuality } from '../ffmpegUtil.js';
import { getThumbnailArgs } from './thumbnailArgs.js';
import type { ThumbnailCrop } from './thumbnailArgs.js';

// Clip thumbnails (A2, T31): one JPEG frame per clip, cropped to its max rect and scaled down, for ClipList's rows
// and the Mix view's blocks. The renderer (thumbnails.ts, hooks/useClipThumbnails.ts) owns the cache key and the
// queue; this just runs ffmpeg for one thumbnail.

export { THUMBNAIL_HEIGHT } from './thumbnailArgs.js';
export type { ThumbnailCrop } from './thumbnailArgs.js';

/**
 * Captures the frame at `timestamp` of `filePath`, cropped to `crop` and scaled to `THUMBNAIL_HEIGHT` tall, as a
 * JPEG at `outPath`. See {@link getThumbnailArgs} for `crop`, `aspect` (non-square pixels, B1) and `rotation` (E9).
 */
export async function captureThumbnail({ filePath, timestamp, crop, aspect, rotation, outPath, quality = 0.6 }: {
  filePath: string,
  timestamp: number,
  crop: ThumbnailCrop,
  aspect?: number | undefined,
  rotation?: string | undefined,
  outPath: string,
  quality?: number | undefined,
}) {
  await runFfmpeg(getThumbnailArgs({ filePath, timestamp, crop, aspect, rotation, outPath, qscale: getFfmpegJpegQuality(quality) }));
}
