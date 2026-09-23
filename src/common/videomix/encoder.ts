import { z } from 'zod';

/** Output video codec (D2, T25). */
export const mixEncoderCodecs = ['h264', 'h265'] as const;

/**
 * Encoder family (D2, T25): `auto` picks the first working hardware encoder of the codec and falls back to software
 * (libx264/libx265); `none` always uses software.
 */
export const mixEncoderHardware = ['auto', 'none', 'nvenc', 'qsv', 'videotoolbox', 'vaapi'] as const;

export const mixEncoderSchema = z.object({
  codec: z.enum(mixEncoderCodecs),
  hardware: z.enum(mixEncoderHardware),
});

export type MixEncoderSettings = z.infer<typeof mixEncoderSchema>;
export type MixEncoderCodec = MixEncoderSettings['codec'];
export type MixEncoderHardware = MixEncoderSettings['hardware'];

export const defaultMixEncoder: MixEncoderSettings = { codec: 'h264', hardware: 'auto' };

/** A `hardware` value once resolved to something concrete to actually encode with (never `auto`). */
export type ResolvedEncoderHardware = Exclude<MixEncoderHardware, 'auto'>;

export interface ResolvedEncoder {
  codec: MixEncoderCodec,
  hardware: ResolvedEncoderHardware,
}

/** One hardware encoder ffmpeg may have compiled in (T25). `id` is its `-c:v` name. */
export interface HardwareEncoderCandidate {
  id: string,
  codec: MixEncoderCodec,
  hardware: Exclude<ResolvedEncoderHardware, 'none'>,
}

/**
 * The 8 hardware encoders detected by main's `detectEncoders` (T25 spec): NVENC, QSV and VideoToolbox each have an
 * H.264 and an H.265 (`hevc_*`) encoder; VAAPI too. Software (`libx264`/`libx265`) is always available and isn't here.
 */
export const hardwareEncoderCandidates: HardwareEncoderCandidate[] = [
  { id: 'h264_nvenc', codec: 'h264', hardware: 'nvenc' },
  { id: 'hevc_nvenc', codec: 'h265', hardware: 'nvenc' },
  { id: 'h264_qsv', codec: 'h264', hardware: 'qsv' },
  { id: 'hevc_qsv', codec: 'h265', hardware: 'qsv' },
  { id: 'h264_videotoolbox', codec: 'h264', hardware: 'videotoolbox' },
  { id: 'hevc_videotoolbox', codec: 'h265', hardware: 'videotoolbox' },
  { id: 'h264_vaapi', codec: 'h264', hardware: 'vaapi' },
  { id: 'hevc_vaapi', codec: 'h265', hardware: 'vaapi' },
];

/** ffmpeg `-c:v` name for a resolved encoder: the hardware candidate's id, or libx264/libx265 for `'none'`. */
export function getEncoderName({ codec, hardware }: ResolvedEncoder): string {
  if (hardware === 'none') return codec === 'h264' ? 'libx264' : 'libx265';
  const candidate = hardwareEncoderCandidates.find((c) => c.codec === codec && c.hardware === hardware);
  if (candidate == null) throw new Error(`No hardware encoder candidate for ${codec}/${hardware}`);
  return candidate.id;
}

/** Priority order for `hardware: 'auto'` (T25 spec lists the candidates in this order). */
export const AUTO_HARDWARE_PRIORITY: Exclude<ResolvedEncoderHardware, 'none'>[] = ['nvenc', 'qsv', 'videotoolbox', 'vaapi'];

/**
 * Resolves `encoder.hardware` to something concrete to actually encode with, given the hardware encoders that work
 * on this machine (main's `detectEncoders`, T25): `auto` uses the first available of the codec in
 * {@link AUTO_HARDWARE_PRIORITY} and falls back to `'none'` (software) if none are; a specific choice that isn't
 * available (stale project settings, e.g. made on another machine) also falls back to `'none'` instead of failing.
 */
export function resolveEncoderHardware({ encoder, available }: {
  encoder: MixEncoderSettings,
  available: Pick<HardwareEncoderCandidate, 'codec' | 'hardware'>[],
}): ResolvedEncoderHardware {
  if (encoder.hardware === 'none') return 'none';
  const isAvailable = (hardware: Exclude<ResolvedEncoderHardware, 'none'>) => available.some((a) => a.codec === encoder.codec && a.hardware === hardware);
  if (encoder.hardware === 'auto') return AUTO_HARDWARE_PRIORITY.find((hardware) => isAvailable(hardware)) ?? 'none';
  return isAvailable(encoder.hardware) ? encoder.hardware : 'none';
}
