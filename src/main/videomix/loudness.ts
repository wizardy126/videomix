import { getFixChannelLayoutFilter, formatFfmpegNumber } from '../../common/util.js';
import { runFfmpeg, runFfprobe } from '../ffmpeg.js';
import { parseFfprobeAudioStream, parseFfprobeDuration, parseLoudnormOutput, toLoudnessAnalysis } from './loudnessParse.js';
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
 * `start`/`end` are optional (T12b): omit both to measure the whole file, used for the music track.
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
  // Whole-file measurement (T12b music, T21 sound overlays): the file's duration is also the played duration.
  const wholeFileDuration = start == null && end == null ? duration : undefined;
  if (stream == null) return { hasAudio: false, ...(wholeFileDuration != null && { duration: wholeFileDuration }) };

  const filters = [
    getFixChannelLayoutFilter(stream),
    'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
  ].filter((filter) => filter != null);

  const args = [
    '-hide_banner', '-nostats',
    ...(start != null && end != null ? ['-ss', formatFfmpegNumber(start), '-t', formatFfmpegNumber(end - start)] : []),
    '-i', filePath,
    '-map', '0:a:0',
    '-af', filters.join(','),
    '-f', 'null', '-',
  ];
  const { stderr } = await runFfmpeg(args, abortSignal != null ? { cancelSignal: abortSignal } : undefined);
  const values = parseLoudnormOutput(new TextDecoder().decode(stderr));
  if (values == null) throw new Error(`Failed to parse loudnorm output for ${filePath}`);
  const analysis = toLoudnessAnalysis(values, stream);
  return wholeFileDuration != null ? { ...analysis, duration: wholeFileDuration } : analysis;
}
