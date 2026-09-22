import { z } from 'zod';

/** Rectangle in oriented source pixels (after applying rotation metadata). Integer values. */
export const rectSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
});

export type Rect = z.infer<typeof rectSchema>;

/** Smallest allowed width/height of a clip rectangle (source pixels). */
export const MIN_RECT_SIZE = 16;

const hexColorSchema = z.string().regex(/^#[\da-f]{6}$/i);

export const mixSourceSchema = z.object({
  id: z.string().min(1),
  /** Relative to the .vmx file (or absolute if the project is not saved yet). */
  path: z.string(),
  /** Fallback if the relative path doesn't exist. */
  absolutePath: z.string(),
  name: z.string(),
  // informative cache, refreshed when opening the project
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: z.number().nonnegative().optional(),
});

export type MixSource = z.infer<typeof mixSourceSchema>;

export const mixClipSchema = z.object({
  /** Also used as segId in the timeline. */
  id: z.string().min(1),
  sourceId: z.string().min(1),
  name: z.string(),
  /** Index into the segment color palette (like segColorIndex). */
  color: z.number().int().nonnegative(),
  /** Seconds in the source. */
  start: z.number(),
  end: z.number(),
  maxRect: rectSchema,
  /** If missing, min = max (can't crop any further). */
  minRect: rectSchema.optional(),
  muted: z.boolean(),
  /** Extra manual gain on top of loudness normalization. */
  gainDb: z.number(),
});

export type MixClip = z.infer<typeof mixClipSchema>;

/** Subset of ffmpeg `xfade` transitions offered in the UI. */
export const transitionTypes = [
  'fade', 'dissolve', 'fadeblack',
  'wipeleft', 'wiperight', 'wipeup', 'wipedown',
  'slideleft', 'slideright', 'slideup', 'slidedown',
  'smoothleft', 'smoothright', 'smoothup', 'smoothdown',
  'circleopen',
] as const;

export const transitionTypeSchema = z.enum(transitionTypes);

export type TransitionType = z.infer<typeof transitionTypeSchema>;

export const mixResolutions = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '2160p': { width: 3840, height: 2160 },
} as const;

export const mixResolutionSchema = z.enum(['720p', '1080p', '2160p']);

export type MixResolution = z.infer<typeof mixResolutionSchema>;

export const mixFpsValues = [24, 25, 30, 50, 60] as const;

export const mixPresets = ['ultrafast', 'veryfast', 'fast', 'medium', 'slow'] as const;

export const mixMusicSchema = z.object({
  path: z.string(),
  absolutePath: z.string(),
  volumeDb: z.number(),
  loop: z.boolean(),
});

export type MixMusic = z.infer<typeof mixMusicSchema>;

export const mixSettingsSchema = z.object({
  resolution: mixResolutionSchema,
  fps: z.literal(mixFpsValues),
  crf: z.number().int().min(0).max(51),
  preset: z.enum(mixPresets),
  maxColumns: z.number().int().min(1),
  /** Separation between columns. `width` should be even (yuv420p), see validateMixProject. */
  gap: z.object({ width: z.number().int().nonnegative(), color: hexColorSchema }),
  /** A clip may move at most this many positions from its list index. */
  reorderWindow: z.number().int().nonnegative(),
  order: z.object({ mode: z.enum(['list', 'random']), seed: z.number().int() }),
  /** Global transition; `duration` in seconds. */
  transition: z.object({ type: transitionTypeSchema, duration: z.number().nonnegative() }),
  /** Fade from/to black at the start/end of the video (video and audio). */
  fadeInOut: z.boolean(),
  /** How to fill space that no clip can cover. */
  fill: z.object({ mode: z.enum(['blur', 'color']), color: hexColorSchema }),
  music: mixMusicSchema.optional(),
});

export type MixSettings = z.infer<typeof mixSettingsSchema>;

/**
 * Cached loudnorm analysis of a clip (placeholder, T12 completes it).
 * Clips without audio (or pure silence) are cached as `{ hasAudio: false }`.
 */
export const loudnessMeasurementSchema = z.discriminatedUnion('hasAudio', [
  z.object({
    hasAudio: z.literal(true),
    inputI: z.number(),
    inputTp: z.number(),
    inputLra: z.number(),
    inputThresh: z.number(),
  }),
  z.object({ hasAudio: z.literal(false) }),
]);

export type LoudnessMeasurement = z.infer<typeof loudnessMeasurementSchema>;

export const mixProjectV1Schema = z.object({
  version: z.literal(1),
  sources: mixSourceSchema.array(),
  /** Array order is the list order. */
  clips: mixClipSchema.array(),
  settings: mixSettingsSchema,
  /** Keyed by the cache key described in 04-diseno §5.1. */
  loudnessCache: z.record(z.string(), loudnessMeasurementSchema).optional(),
});

export type MixProject = z.infer<typeof mixProjectV1Schema>;

export const MIX_PROJECT_VERSION = 1;

export const defaultMixSettings: MixSettings = {
  resolution: '1080p',
  fps: 30,
  crf: 20,
  preset: 'medium',
  maxColumns: 3,
  gap: { width: 0, color: '#000000' },
  reorderWindow: 3,
  order: { mode: 'list', seed: 0 },
  transition: { type: 'fade', duration: 0.5 },
  fadeInOut: true,
  fill: { mode: 'blur', color: '#000000' },
};

export function createEmptyMixProject(): MixProject {
  return {
    version: 1,
    sources: [],
    clips: [],
    settings: structuredClone(defaultMixSettings),
  };
}
