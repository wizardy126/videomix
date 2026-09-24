import { z } from 'zod';

import { mixEncoderSchema, defaultMixEncoder } from '../../../common/videomix/encoder';
import { countdownOverlayStyleSchema, overlayFileSchema, progressBarOverlayStyleSchema, textOverlayStyleSchema } from '../../../common/videomix/overlayStyles';

// Shared with main since T24 (style presets), re-exported for the existing imports
export { OVERLAY_COLOR_REGEX, overlayFileSchema, progressBarDirections } from '../../../common/videomix/overlayStyles';
export type { OverlayFile } from '../../../common/videomix/overlayStyles';
export { mixEncoderCodecs, mixEncoderHardware } from '../../../common/videomix/encoder';
export type { MixEncoderSettings, MixEncoderCodec, MixEncoderHardware, HardwareEncoderCandidate, ResolvedEncoder } from '../../../common/videomix/encoder';

/** Rectangle in source display pixels (after applying rotation metadata and the sample aspect ratio, B1). Integer values. */
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
  /** Display size (B1, v3): oriented and with the sample aspect ratio applied, like Chromium's `videoWidth`/`videoHeight`. */
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: z.number().nonnegative().optional(),
  /**
   * B1 (v3): sample aspect ratio of the *oriented* frame (as ffmpeg delivers it after autorotate: a quarter turn
   * inverts it), see sampleAspect.ts. Missing = square pixels. Needed to convert rects to coded pixels for ffmpeg.
   */
  sar: z.object({ num: z.number().int().positive(), den: z.number().int().positive() }).optional(),
});

export type MixSource = z.infer<typeof mixSourceSchema>;

export const mixClipLinkTypes = ['break', 'force'] as const;

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
  /** A4 (v3): the clip starts at this time of the final video (s); the planner arranges the rest around it (T30). */
  pinTime: z.number().optional(),
  /** A4 (v3): the clips sharing a group id start together (T30). A group needs at least 2 clips. */
  groupId: z.string().min(1).optional(),
  /**
   * E2 (v4): manual exception over the automatic link with the *previous* clip of its source (by `start`), see
   * `getClipChains`. `'break'` never links to it; `'force'` always does, even with `settings.links.maxGap: 0` or
   * over an overlap (which are otherwise never auto-linked).
   * Ignored for a pinned or grouped clip (never auto-linked) or for the first eligible clip of its source.
   */
  link: z.enum(mixClipLinkTypes).optional(),
  /**
   * E7 (v4, T38b): when a layout would leave fill, the clip may show material beyond its max rect along the main axis
   * (up to the source frame), as a last resort. Missing = true (on by default); only `false` is stored.
   */
  extendBeyondMax: z.boolean().optional(),
});

export type MixClip = z.infer<typeof mixClipSchema>;

export type MixClipLink = MixClip['link'];

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

export const mixOutputAspects = ['16:9', '9:16', '1:1'] as const;

/** Short side of the output (px). */
export const mixOutputResolutions = ['720', '1080', '2160'] as const;

/** Output frame (B5): `resolution` is the short side, see `getOutputSize`. */
export const mixOutputSchema = z.object({
  aspect: z.enum(mixOutputAspects),
  resolution: z.enum(mixOutputResolutions),
});

export type MixOutput = z.infer<typeof mixOutputSchema>;
export type MixOutputAspect = MixOutput['aspect'];
export type MixOutputResolution = MixOutput['resolution'];

/** Exact output sizes (01-requisitos §10 B5). */
export const mixOutputSizes: Record<MixOutputAspect, Record<MixOutputResolution, { width: number, height: number }>> = {
  '16:9': { 720: { width: 1280, height: 720 }, 1080: { width: 1920, height: 1080 }, 2160: { width: 3840, height: 2160 } },
  '9:16': { 720: { width: 720, height: 1280 }, 1080: { width: 1080, height: 1920 }, 2160: { width: 2160, height: 3840 } },
  '1:1': { 720: { width: 720, height: 720 }, 1080: { width: 1080, height: 1080 }, 2160: { width: 2160, height: 2160 } },
};

export const getOutputSize = ({ aspect, resolution }: MixOutput) => mixOutputSizes[aspect][resolution];

export const mixFpsValues = [24, 25, 30, 50, 60] as const;

export const mixPresets = ['ultrafast', 'veryfast', 'fast', 'medium', 'slow'] as const;

/** A track of the music playlist (C2). `path`/`absolutePath` like the sources. Normalized to −16 LUFS, plus `volumeDb`. */
export const mixMusicTrackSchema = z.object({
  id: z.string().min(1),
  path: z.string(),
  absolutePath: z.string(),
  volumeDb: z.number(),
});

export type MixMusicTrack = z.infer<typeof mixMusicTrackSchema>;

/** Music (C1, C2): the tracks play in order with a crossfade; the whole list repeats if `loop`. */
export const mixMusicPlaylistSchema = z.object({
  /** Play order. Empty = no music. */
  tracks: mixMusicTrackSchema.array(),
  /** Seconds. */
  crossfade: z.number().nonnegative(),
  loop: z.boolean(),
  /** The music goes down by `amountDb` (≤ 0) while the clips are heard (T27). */
  ducking: z.object({ enabled: z.boolean(), amountDb: z.number() }),
});

export type MixMusicPlaylist = z.infer<typeof mixMusicPlaylistSchema>;

export const defaultMusicPlaylist: MixMusicPlaylist = {
  tracks: [],
  crossfade: 2,
  loop: true,
  ducking: { enabled: false, amountDb: -10 },
};

/**
 * Initial `volumeDb` when a music file is picked (T12b): the music is normalized like the clips (buildAudioGraph), so
 * 0 dB would be as loud as them; this gives a background level instead.
 */
export const DEFAULT_MUSIC_VOLUME_DB = -12;

export const mixLinksTransitionTypes = ['cut', 'global'] as const;

/**
 * E2 (v4): automatic links between clips of the same source, see `getClipChains`. `maxGap` (s) is the largest gap
 * between the end of a clip and the start of the next of the same source that still links them; `0` disables
 * automatic linking entirely (only `MixClip.link: 'force'` still links). Clips that actually overlap are never
 * auto-linked (E6 creates such pairs on purpose, to frame the same footage differently), regardless of `maxGap`. A
 * chain shares one slot (column or row), with a hard cut by default or the project's global transition.
 */
export const mixLinksSchema = z.object({
  maxGap: z.number().nonnegative(),
  transition: z.enum(mixLinksTransitionTypes),
});

export type MixLinksSettings = z.infer<typeof mixLinksSchema>;

export const defaultLinksSettings: MixLinksSettings = { maxGap: 10, transition: 'cut' };

/** E5 (v4): the always-visible sequence, one per project. Order is playback order. */
export const mixAlwaysVisibleSchema = z.object({
  clipIds: z.string().min(1).array(),
});

export type MixAlwaysVisible = z.infer<typeof mixAlwaysVisibleSchema>;

export const defaultAlwaysVisible: MixAlwaysVisible = { clipIds: [] };

export const mixSettingsSchema = z.object({
  output: mixOutputSchema,
  encoder: mixEncoderSchema,
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
  /** E2 (v4): automatic clip links. */
  links: mixLinksSchema,
  /** E4 (v4): seconds. Undefined = no limit. The video is cut there with the global fade-out (video and audio). */
  maxDuration: z.number().optional(),
  /** E5 (v4). */
  alwaysVisible: mixAlwaysVisibleSchema,
  /** How to fill space that no clip can cover. */
  fill: z.object({ mode: z.enum(['blur', 'color']), color: hexColorSchema }),
  musicPlaylist: mixMusicPlaylistSchema,
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

// Versions 1 and 2 are only read through the migrations of project.ts (they upgrade the raw JSON), so there's no
// schema for them: `mixProjectSchema` is the current version.

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
  // align, decimals, leadingZeros, color, font?, border, shadow?, fadeOut (shared with the style presets)
  ...countdownOverlayStyleSchema.shape,
});

export type CountdownOverlay = z.infer<typeof countdownOverlaySchema>;

export const progressBarOverlaySchema = overlayBaseSchema.extend({
  type: z.literal('progressBar'),
  /** Ignored (like `anchor`) while linked to a countdown. */
  duration: z.number(),
  /** Takes the start and duration of this countdown. */
  linkedCountdownId: z.string().min(1).optional(),
  box: overlayBoxSchema,
  // fillColor, backgroundColor, border, direction, mode (shared with the style presets)
  ...progressBarOverlayStyleSchema.shape,
});

export type ProgressBarOverlay = z.infer<typeof progressBarOverlaySchema>;

/** Plays the whole file (its duration comes from outside, see resolveOverlayTimes). Normalized to −16 LUFS + `gainDb` (T21). */
export const soundOverlaySchema = overlayBaseSchema.extend({
  type: z.literal('sound'),
  ...overlayFileSchema.shape,
  gainDb: z.number(),
});

export type SoundOverlay = z.infer<typeof soundOverlaySchema>;

/**
 * Free text (B1, v3): several lines (`\n`) aligned with `align` in the box, which sets the font size (see
 * textOverlayStyleSchema), with border, shadow, fades and an entry animation. Rendered by T26.
 */
export const textOverlaySchema = overlayBaseSchema.extend({
  type: z.literal('text'),
  text: z.string(),
  duration: z.number(),
  box: overlayBoxSchema,
  // align, color, font?, border, shadow?, lineSpacing, fadeIn, fadeOut, entry (shared with the style presets)
  ...textOverlayStyleSchema.shape,
});

export type TextOverlay = z.infer<typeof textOverlaySchema>;

export const mixOverlaySchema = z.discriminatedUnion('type', [imageOverlaySchema, countdownOverlaySchema, progressBarOverlaySchema, soundOverlaySchema, textOverlaySchema]);

export type MixOverlay = z.infer<typeof mixOverlaySchema>;

export type MixOverlayType = MixOverlay['type'];

/**
 * v4 (T36). v1 → v2 (T19): overlays; v2 → v3 (T24): output, encoder, music playlist, text overlays, pinned and
 * grouped clips; v3 → v4: automatic clip links, `MixClip.link`, `settings.maxDuration`, `settings.alwaysVisible`.
 */
export const mixProjectSchema = z.object({
  version: z.literal(4),
  sources: mixSourceSchema.array(),
  /** Array order is the list order. */
  clips: mixClipSchema.array(),
  settings: mixSettingsSchema,
  /** Keyed by the cache key described in 04-diseno §5.1. */
  loudnessCache: z.record(z.string(), loudnessMeasurementSchema).optional(),
  /** Array order is the layer order: the last one is drawn on top. */
  overlays: mixOverlaySchema.array(),
});

export type MixProject = z.infer<typeof mixProjectSchema>;

export const MIX_PROJECT_VERSION = 4;

export const defaultMixSettings: MixSettings = {
  output: { aspect: '16:9', resolution: '1080' },
  encoder: defaultMixEncoder,
  fps: 30,
  crf: 20,
  preset: 'medium',
  maxColumns: 3,
  gap: { width: 0, color: '#000000' },
  reorderWindow: 3,
  order: { mode: 'list', seed: 0 },
  transition: { type: 'fade', duration: 0.5 },
  fadeInOut: true,
  links: defaultLinksSettings,
  alwaysVisible: defaultAlwaysVisible,
  fill: { mode: 'blur', color: '#000000' },
  musicPlaylist: defaultMusicPlaylist,
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
