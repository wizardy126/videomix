/**
 * Result of the first `loudnorm` pass over a clip (EBU R128). Mirrors `LoudnessMeasurement` in
 * src/renderer/src/videomix/types.ts (main can't import the renderer types).
 */
export type LoudnessAnalysis = ({
  hasAudio: true,
  /** Integrated loudness (LUFS). */
  inputI: number,
  /** True peak (dBTP). */
  inputTp: number,
  /** Loudness range (LU). */
  inputLra: number,
  inputThresh: number,
  /** Of the analyzed audio stream, for getFixChannelLayoutFilter when mixing. */
  channels?: number | undefined,
  channelLayout?: string | undefined,
} | {
  hasAudio: false,
  /**
   * T21b: a whole-file measurement (music, sound overlay) that failed outright (not just a parseable `-inf`, which
   * is confirmed silence, see `SILENCE_LOUDNESS`) instead of taking down the whole render: `buildAudioGraph` plays
   * the sound at its manual gain, unnormalized, and the UI warns instead of silencing it without saying why. Never
   * set for a clip's ranged measurement (that still throws, out of this task's scope) or for a real "no audio
   * stream" file.
   */
  unmeasured?: true | undefined,
}) & {
  /**
   * File duration (s), only set for a whole-file measurement (T12b music, T21 sound overlays: `start`/`end` omitted):
   * `resolveOverlayTimes` needs a sound overlay's duration. Absent on a clip's (ranged) measurement, and on cached
   * entries measured before T21.
   */
  duration?: number | undefined,
};

/**
 * Integrated loudness at or below this is treated as silence. -70 LUFS is the EBU R128 absolute gate: loudnorm reports
 * `-inf` (or values around the gate) when no block is above it.
 */
export const SILENCE_LOUDNESS = -70;

/**
 * T21b: below this (s), a whole-file measurement (music, T12b; sound overlays, T21) loops the input to this length
 * before running `loudnorm` on it. `loudnorm`'s EBU R128 windowing needs more than the ~0.4 s absolute-gate block to
 * report a finite value, so a short effect (e.g. a 0.15 s countdown beep) otherwise always measures as `-inf` and is
 * then silenced as if it had no audio at all. Looping repeats the same signal, so its integrated loudness equals the
 * original's: checked empirically (see the T21b task notes) with 0.15 s/0.3 s/2 s tones of the same level, looped to
 * this length, which all measured within 1.5 LU (in fact identical, being the same synthetic tone).
 */
export const LOOP_MEASURE_DURATION = 3;

/** Whether a whole-file measurement should loop the input first (T21b): only when its duration is known and short. */
export function shouldLoopForMeasurement({ isWholeFile, duration }: { isWholeFile: boolean, duration: number | undefined }) {
  return isWholeFile && duration != null && duration < LOOP_MEASURE_DURATION;
}

function parseLoudnormNumber(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const str = String(value).trim();
  if (str === '-inf') return -Infinity;
  if (str === 'inf' || str === '+inf') return Infinity;
  const num = Number(str);
  return str !== '' && !Number.isNaN(num) ? num : undefined;
}

/**
 * Extracts the JSON block that `loudnorm=print_format=json` prints to stderr at the end:
 * `[Parsed_loudnorm_0 @ 0x…] \n{\n\t"input_i" : "-18.76",\n …}`. The values are strings (`"-inf"` for silence).
 */
export function parseLoudnormOutput(stderr: string) {
  const tagIndex = stderr.lastIndexOf('[Parsed_loudnorm_');
  if (tagIndex === -1) return undefined;
  const jsonStart = stderr.indexOf('{', tagIndex);
  const jsonEnd = stderr.indexOf('}', jsonStart);
  if (jsonStart === -1 || jsonEnd === -1) return undefined;

  let json: unknown;
  try {
    json = JSON.parse(stderr.slice(jsonStart, jsonEnd + 1));
  } catch {
    return undefined;
  }
  if (json == null || typeof json !== 'object') return undefined;
  const obj = json as Record<string, unknown>;

  const inputI = parseLoudnormNumber(obj['input_i']);
  const inputTp = parseLoudnormNumber(obj['input_tp']);
  const inputLra = parseLoudnormNumber(obj['input_lra']);
  const inputThresh = parseLoudnormNumber(obj['input_thresh']);
  if (inputI == null || inputTp == null || inputLra == null || inputThresh == null) return undefined;
  return { inputI, inputTp, inputLra, inputThresh };
}

/**
 * Turns the parsed loudnorm values into a cacheable measurement. Silence (`input_i = -inf`, or at the absolute gate)
 * counts as no audio (04-diseno §5.1). Non-finite values can't be stored in the JSON5 project either.
 */
export function toLoudnessAnalysis(
  values: NonNullable<ReturnType<typeof parseLoudnormOutput>>,
  { channels, channelLayout }: { channels?: number | undefined, channelLayout?: string | undefined } = {},
): LoudnessAnalysis {
  const { inputI, inputTp, inputLra, inputThresh } = values;
  if (!Number.isFinite(inputI) || inputI <= SILENCE_LOUDNESS || !Number.isFinite(inputTp)) return { hasAudio: false };
  return {
    hasAudio: true,
    inputI,
    inputTp,
    inputLra: Number.isFinite(inputLra) ? inputLra : 0,
    inputThresh: Number.isFinite(inputThresh) ? inputThresh : SILENCE_LOUDNESS,
    ...(channels != null && { channels }),
    ...(channelLayout != null && { channelLayout }),
  };
}

/** Picks channels/layout of the first audio stream from `ffprobe -select_streams a:0 -show_entries stream=… -of json`. */
export function parseFfprobeAudioStream(stdout: string) {
  const json: unknown = JSON.parse(stdout);
  const streams = json != null && typeof json === 'object' ? (json as { streams?: unknown }).streams : undefined;
  if (!Array.isArray(streams) || streams.length === 0) return undefined;
  const stream = streams[0] as { channels?: unknown, channel_layout?: unknown };
  return {
    channels: typeof stream.channels === 'number' ? stream.channels : undefined,
    channelLayout: typeof stream.channel_layout === 'string' ? stream.channel_layout : undefined,
  };
}

/**
 * Duration (s) from `ffprobe -show_entries format=duration -of json`, run alongside {@link parseFfprobeAudioStream}
 * (same JSON, `format` doesn't depend on `-select_streams`): T21, so sound overlays know their length even without
 * measuring their loudness again.
 */
export function parseFfprobeDuration(stdout: string) {
  const json: unknown = JSON.parse(stdout);
  const format = json != null && typeof json === 'object' ? (json as { format?: unknown }).format : undefined;
  const duration = format != null && typeof format === 'object' ? (format as { duration?: unknown }).duration : undefined;
  const num = typeof duration === 'string' || typeof duration === 'number' ? Number(duration) : NaN;
  return Number.isFinite(num) && num >= 0 ? num : undefined;
}
