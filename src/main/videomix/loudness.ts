import { getFixChannelLayoutFilter, formatFfmpegNumber } from '../../common/util.js';
import { runFfmpeg, runFfprobe } from '../ffmpeg.js';
import { LOOP_MEASURE_DURATION, parseFfprobeAudioStream, parseFfprobeDuration, parseLoudnormOutput, shouldLoopForMeasurement, toLoudnessAnalysis } from './loudnessParse.js';
import type { LoudnessAnalysis } from './loudnessParse.js';

export type { LoudnessAnalysis } from './loudnessParse.js';

/** First audio stream (channels/layout, for getFixChannelLayoutFilter) and the file's duration (T21), in one ffprobe call. */
async function probeAudioInfo(filePath: string) {
  const { stdout } = await runFfprobe([
    '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'format=duration:stream=index,channels,channel_layout', '-of', 'json', '-i', filePath,
  ]);
  const text = new TextDecoder().decode(stdout);
  return { stream: parseFfprobeAudioStream(text), duration: parseFfprobeDuration(text) };
}

/**
 * First `loudnorm` pass (EBU R128 analysis) over `[start, end)` of the first audio stream of a file (04-diseno §5.1).
 * Clips without an audio stream, or silent, return `{ hasAudio: false }`.
 *
 * `start`/`end` are optional (T12b): omit both to measure the whole file, used for the music track and sound
 * overlays (T21). A whole-file measurement shorter than `LOOP_MEASURE_DURATION` loops the input first (T21b, see
 * `shouldLoopForMeasurement`), so very short sound effects (countdown beeps) measure a finite value instead of
 * `loudnorm`'s `-inf` for inputs under ~0.4 s. A file that's still silent once looped is confirmed silence
 * (`{ hasAudio: false }`, no `unmeasured`): the loop doesn't manufacture signal that isn't there.
 *
 * No `dual_mono`: the mix upmixes mono to stereo with swresample's default matrix (-3 dB per channel), which keeps the
 * loudness of the single-channel measurement (checked with script/videomix/audioDemo.ts).
 */
export async function measureLoudness({ filePath, start, end, abortSignal }: {
  filePath: string,
  start?: number | undefined,
  end?: number | undefined,
  abortSignal?: AbortSignal | undefined,
}): Promise<LoudnessAnalysis> {
  const { stream, duration } = await probeAudioInfo(filePath);
  const isWholeFile = start == null && end == null;
  // Whole-file measurement (T12b music, T21 sound overlays): the file's duration is also the played duration.
  const wholeFileDuration = isWholeFile ? duration : undefined;
  if (stream == null) return { hasAudio: false, ...(wholeFileDuration != null && { duration: wholeFileDuration }) };

  const loop = shouldLoopForMeasurement({ isWholeFile, duration });
  const filters = [
    getFixChannelLayoutFilter(stream),
    'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
  ].filter((filter) => filter != null);

  const args = [
    '-hide_banner', '-nostats',
    ...(loop ? ['-stream_loop', '-1'] : []),
    ...(start != null && end != null ? ['-ss', formatFfmpegNumber(start), '-t', formatFfmpegNumber(end - start)] : []),
    '-i', filePath,
    '-map', '0:a:0',
    // Output-side -t (after -map): trims the (infinitely) looped input, unlike the input-side -ss/-t above.
    ...(loop ? ['-t', formatFfmpegNumber(LOOP_MEASURE_DURATION)] : []),
    '-af', filters.join(','),
    '-f', 'null', '-',
  ];
  try {
    const { stderr } = await runFfmpeg(args, abortSignal != null ? { cancelSignal: abortSignal } : undefined);
    const values = parseLoudnormOutput(new TextDecoder().decode(stderr));
    if (values == null) throw new Error(`Failed to parse loudnorm output for ${filePath}`);
    const analysis = toLoudnessAnalysis(values, stream);
    return wholeFileDuration != null ? { ...analysis, duration: wholeFileDuration } : analysis;
  } catch (err) {
    // T21b: a whole-file measurement that fails outright (as opposed to a parseable but silent -inf result, already
    // handled above) shouldn't take down the whole render for one bad sound effect. Flag it as unmeasured instead:
    // buildAudioGraph then plays it at its manual gain, unnormalized, and the UI warns rather than silencing it
    // without saying why. A ranged (per-clip) measurement still re-throws: that failure mode is unrelated to this
    // task and out of its scope. Cancellation also re-throws, so it still aborts the render as expected.
    if (!isWholeFile || abortSignal?.aborted) throw err;
    return { hasAudio: false, unmeasured: true, ...(wholeFileDuration != null && { duration: wholeFileDuration }) };
  }
}
