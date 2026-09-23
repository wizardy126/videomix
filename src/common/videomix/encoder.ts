import { z } from 'zod';

/** Output video codec (D2, T25). */
export const mixEncoderCodecs = ['h264', 'h265'] as const;

/**
 * Encoder family (D2, T25): `auto` picks the first working hardware encoder of the codec and falls back to software
 * (libx264/libx265); `none` always uses software. Until T25 the render always uses libx264.
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
