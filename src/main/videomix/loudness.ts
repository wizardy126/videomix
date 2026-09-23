import { getFixChannelLayoutFilter, formatFfmpegNumber } from '../../common/util.js';
import { runFfmpeg, runFfprobe } from '../ffmpeg.js';
import { parseFfprobeAudioStream, parseLoudnormOutput, toLoudnessAnalysis } from './loudnessParse.js';
import type { LoudnessAnalysis } from './loudnessParse.js';

export type { LoudnessAnalysis } from './loudnessParse.js';

async function probeFirstAudioStream(filePath: string) {
  const { stdout } = await runFfprobe([
    '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index,channels,channel_layout', '-of', 'json', '-i', filePath,
  ]);
  return parseFfprobeAudioStream(new TextDecoder().decode(stdout));
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
  const stream = await probeFirstAudioStream(filePath);
  if (stream == null) return { hasAudio: false };

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
  return toLoudnessAnalysis(values, stream);
}
