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

/**
 * Initial `volumeDb` when a music file is picked (T12b): the music is normalized like the clips (buildAudioGraph), so
 * 0 dB would be as loud as them; this gives a background level instead.
 */
export const DEFAULT_MUSIC_VOLUME_DB = -12;

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
 * Cached loudnorm analysis (first pass, EBU R128) of a clip's first audio stream, see src/main/videomix/loudness.ts.
 * Clips without audio (or pure silence) are cached as `{ hasAudio: false }`.
 */
/**
 * File duration (s), only present for a whole-file measurement (T12b music, T21 sound overlays: `start`/`end`
 * omitted): `resolveOverlayTimes` needs a sound overlay's duration. Additive, so cached entries measured before T21
 * (or a clip's ranged measurement) simply lack it.
 */
const loudnessDurationSchema = { duration: z.number().nonnegative().optional() };

export const loudnessMeasurementSchema = z.discriminatedUnion('hasAudio', [
  z.object({
    hasAudio: z.literal(true),
    /** Integrated loudness (LUFS). */
    inputI: z.number(),
    /** True peak (dBTP). */
    inputTp: z.number(),
    inputLra: z.number(),
    inputThresh: z.number(),
    /** Of the audio stream, to fix unusual channel layouts when mixing (getFixChannelLayoutFilter). */
    channels: z.number().int().positive().optional(),
    channelLayout: z.string().optional(),
    ...loudnessDurationSchema,
  }),
  z.object({
    hasAudio: z.literal(false),
    /**
     * T21b: a whole-file measurement (music, sound overlay) that failed outright, as opposed to a confirmed silent
     * (`-inf`) result. `buildAudioGraph` plays the sound at its manual gain, unnormalized, and the UI warns instead
     * of silencing it without saying why.
     */
    unmeasured: z.literal(true).optional(),
    ...loudnessDurationSchema,
  }),
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

/** Where an overlay starts (01-requisitos §9.2). `edge` + `offset` (s, may be negative) relative to a clip or another overlay. */
export const overlayAnchorSchema = z.discriminatedUnion('kind', [
  /** Time in the final video (s). */
  z.object({ kind: z.literal('absolute'), time: z.number().nonnegative() }),
  /** Uses the clip's `ColumnPlacement.startTime` / `endTime`, so it follows the clip when the planner moves it. */
  z.object({ kind: z.literal('clip'), clipId: z.string().min(1), edge: z.enum(['start', 'end']), offset: z.number() }),
  z.object({ kind: z.literal('element'), elementId: z.string().min(1), edge: z.enum(['start', 'end']), offset: z.number() }),
]);

export type OverlayAnchor = z.infer<typeof overlayAnchorSchema>;

/**
 * Box in fractions (0..1) of the output frame (x/width of its width, y/height of its height), so it works at any resolution.
 * The range is checked by validateMixProject (not the schema), so a project with a bad box still opens and can be fixed.
 */
export const overlayBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export type OverlayBox = z.infer<typeof overlayBoxSchema>;

/**
 * Lengths that aren't part of a box (text border/shadow, bar border) are in "reference px": px of a 1080 px high output,
 * scaled by `outputHeight / OVERLAY_REFERENCE_HEIGHT` when rendering (see `overlayPxToOutput`).
 */
export const OVERLAY_REFERENCE_HEIGHT = 1080;

/** `#rrggbb` or `#rrggbbaa` (alpha, e.g. `#00000000` = transparent). */
export const OVERLAY_COLOR_REGEX = /^#[\da-f]{6}([\da-f]{2})?$/i;

const overlayColorSchema = z.string().regex(OVERLAY_COLOR_REGEX);

/** A user file stored like the sources: `path` relative to the .vmx when saved (absolute in memory), `absolutePath` as fallback. */
export const overlayFileSchema = z.object({ path: z.string(), absolutePath: z.string() });

export type OverlayFile = z.infer<typeof overlayFileSchema>;

const overlayBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  anchor: overlayAnchorSchema,
});

/** PNG (with alpha) scaled to `box`. */
export const imageOverlaySchema = overlayBaseSchema.extend({
  type: z.literal('image'),
  ...overlayFileSchema.shape,
  /** Seconds. */
  duration: z.number(),
  box: overlayBoxSchema,
  /** Seconds, 0 = none. */
  fadeIn: z.number().nonnegative(),
  fadeOut: z.number().nonnegative(),
});

export type ImageOverlay = z.infer<typeof imageOverlaySchema>;

/**
 * Counts down from `duration` to 0 while visible, then disappears. Text format: `SS` below 60 s, `MM:SS` from 60 s on,
 * with `decimals`, rounded up to that precision (T20).
 */
export const countdownOverlaySchema = overlayBaseSchema.extend({
  type: z.literal('countdown'),
  duration: z.number(),
  /** `box.height` is the font size; the text is vertically centered in the box and aligned horizontally with `align`. */
  box: overlayBoxSchema,
  align: z.enum(['left', 'center', 'right']),
  decimals: z.literal([0, 1, 2, 3]),
  /** `05` instead of `5` (and `01:05` instead of `1:05`). */
  leadingZeros: z.boolean(),
  color: overlayColorSchema,
  /** TTF/OTF file; if missing, the bundled font. */
  font: overlayFileSchema.optional(),
  /** Reference px (see OVERLAY_REFERENCE_HEIGHT), 0 = none. */
  border: z.object({ width: z.number().nonnegative(), color: overlayColorSchema }),
  /** Offset in reference px. Missing = no shadow. */
  shadow: z.object({ x: z.number(), y: z.number(), color: overlayColorSchema }).optional(),
  /** Seconds before reaching 0, 0 = none. */
  fadeOut: z.number().nonnegative(),
});

export type CountdownOverlay = z.infer<typeof countdownOverlaySchema>;

export const progressBarDirections = ['ltr', 'rtl', 'btt', 'ttb'] as const;

export const progressBarOverlaySchema = overlayBaseSchema.extend({
  type: z.literal('progressBar'),
  /** Ignored (like `anchor`) while linked to a countdown. */
  duration: z.number(),
  /** Takes the start and duration of this countdown. */
  linkedCountdownId: z.string().min(1).optional(),
  box: overlayBoxSchema,
  fillColor: overlayColorSchema,
  /** `#00000000` = no background. */
  backgroundColor: overlayColorSchema,
  /** Reference px, drawn inside the box. 0 = none. */
  border: z.object({ width: z.number().nonnegative(), color: overlayColorSchema }),
  /** Direction in which the fill grows. */
  direction: z.enum(progressBarDirections),
  /** `fill`: 0 → 100 % during its duration; `empty`: 100 → 0 %. */
  mode: z.enum(['fill', 'empty']),
});

export type ProgressBarOverlay = z.infer<typeof progressBarOverlaySchema>;

/** Plays the whole file (its duration comes from outside, see resolveOverlayTimes). Normalized to −16 LUFS + `gainDb` (T21). */
export const soundOverlaySchema = overlayBaseSchema.extend({
  type: z.literal('sound'),
  ...overlayFileSchema.shape,
  gainDb: z.number(),
});

export type SoundOverlay = z.infer<typeof soundOverlaySchema>;

export const mixOverlaySchema = z.discriminatedUnion('type', [imageOverlaySchema, countdownOverlaySchema, progressBarOverlaySchema, soundOverlaySchema]);

export type MixOverlay = z.infer<typeof mixOverlaySchema>;

export type MixOverlayType = MixOverlay['type'];

export const mixProjectV2Schema = mixProjectV1Schema.extend({
  version: z.literal(2),
  /** Array order is the layer order: the last one is drawn on top. */
  overlays: mixOverlaySchema.array(),
});

export const mixProjectSchema = mixProjectV2Schema;

export type MixProject = z.infer<typeof mixProjectSchema>;

export const MIX_PROJECT_VERSION = 2;

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
    version: MIX_PROJECT_VERSION,
    sources: [],
    clips: [],
    settings: structuredClone(defaultMixSettings),
    overlays: [],
  };
}
