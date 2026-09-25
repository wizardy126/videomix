import { formatFfmpegNumber } from '../../common/util.js';
import { parseCropDetectOutput } from '../../common/videomix/cropDetect.js';
import type { CropDetectRect } from '../../common/videomix/cropDetect.js';
import { runFfmpeg } from '../ffmpeg.js';

export type { CropDetectRect } from '../../common/videomix/cropDetect.js';

// A7 (v4, T47): black bars detection. Runs ffmpeg's `cropdetect` over a few samples of `[start, end)` (the renderer,
// blackBars.ts, converts the result to display pixels and decides what to do with it: the source cache for new
// clips, or the "Remove black bars" button on an existing one). See 04-diseno §10.5 and T44's notes.

/** Frames decoded per sample: a few dozen, enough for `cropdetect` to see through a brief dark transient. */
const SAMPLE_FRAMES = 30;
/** At most this many samples spread across the range. */
const MAX_SAMPLES = 5;
/** Samples are at least this far apart (seconds), so a short clip isn't over-sampled. */
const MIN_SAMPLE_SPACING = 1;

/** Evenly spaced sample start times inside `[start, end)`. At least one, even for a zero-length range. */
function getSampleTimes(start: number, end: number): number[] {
  const span = Math.max(0, end - start);
  const count = Math.max(1, Math.min(MAX_SAMPLES, Math.floor(span / MIN_SAMPLE_SPACING) + 1));
  return Array.from({ length: count }, (_, i) => start + ((i + 0.5) * span) / count);
}

/**
 * Detects black bars over `[start, end)` of `filePath`'s first video stream: `cropdetect` on a few samples spread
 * across the range, each with its own input seek (fast: approximate, no full decode of what's skipped) and a
 * short run of frames, unioned by {@link parseCropDetectOutput}. Coded pixels of the oriented frame (ffmpeg's
 * default autorotate, so no explicit `turn` for the renderer's `cropDetectToDisplayRect`).
 *
 * Undefined if every sample came back fully black (or the range has no video at all): the renderer then treats it
 * as "no bars found" (the button) or caches the whole frame (the per-source detection).
 */
export async function detectBlackBars({ filePath, start, end, abortSignal }: {
  filePath: string,
  start: number,
  end: number,
  abortSignal?: AbortSignal | undefined,
}): Promise<CropDetectRect | undefined> {
  const outputs = await Promise.all(getSampleTimes(start, end).map(async (time) => {
    const { stderr } = await runFfmpeg([
      '-hide_banner', '-nostats',
      '-ss', formatFfmpegNumber(Math.max(0, time)),
      '-i', filePath,
      '-map', '0:v:0',
      '-frames:v', String(SAMPLE_FRAMES),
      '-vf', 'cropdetect',
      '-f', 'null', '-',
    ], abortSignal != null ? { cancelSignal: abortSignal } : undefined);
    return new TextDecoder().decode(stderr);
  }));
  return parseCropDetectOutput(outputs.join('\n'));
}
