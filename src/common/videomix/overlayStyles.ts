import { z } from 'zod';

// Style fields of the text, countdown and progress bar overlays (the whole overlay schemas are in the renderer's
// videomix/types.ts, built from these). Shared with main, which stores the global style presets (B2, T26).

/** `#rrggbb` or `#rrggbbaa` (alpha, e.g. `#00000000` = transparent). */
export const OVERLAY_COLOR_REGEX = /^#[\da-f]{6}([\da-f]{2})?$/i;

export const overlayColorSchema = z.string().regex(OVERLAY_COLOR_REGEX);

/** A user file stored like the sources: `path` relative to the .vmx when saved (absolute in memory), `absolutePath` as fallback. */
export const overlayFileSchema = z.object({ path: z.string(), absolutePath: z.string() });

export type OverlayFile = z.infer<typeof overlayFileSchema>;

/** Horizontal alignment of a text inside its box. */
export const overlayTextAlignSchema = z.enum(['left', 'center', 'right']);

export type OverlayTextAlign = z.infer<typeof overlayTextAlignSchema>;

/** Reference px (see OVERLAY_REFERENCE_HEIGHT), 0 = none. */
export const overlayBorderSchema = z.object({ width: z.number().nonnegative(), color: overlayColorSchema });

/** Offset in reference px. */
export const overlayShadowSchema = z.object({ x: z.number(), y: z.number(), color: overlayColorSchema });

export const textEntryKinds = ['none', 'slide', 'typewriter'] as const;
export const textEntrySides = ['left', 'right', 'top', 'bottom'] as const;

/**
 * Entry animation of a text (B1): `slide` moves it in from `from` (the side of the frame it comes from; required for
 * `slide`, kept for the others so switching kinds doesn't lose it), `typewriter` reveals it character by character.
 * `duration` in seconds, from the text's start.
 */
export const textEntrySchema = z.object({
  kind: z.enum(textEntryKinds),
  from: z.enum(textEntrySides).optional(),
  duration: z.number().nonnegative(),
});

export type TextEntry = z.infer<typeof textEntrySchema>;

/**
 * Style of a text overlay (everything but `text`, times, anchor and box).
 * `fontSize` (T26) is a fraction of the output frame height. The UI keeps the box fitted to the lines
 * (`box.height = n · size + (n − 1) · lineSpacing · size` for `n` lines, see overlays/textLayout.ts), so adding a line
 * grows the box instead of shrinking the text. Missing (v3 projects saved before T26): derived from the box that way.
 */
export const textOverlayStyleSchema = z.object({
  /** Fraction of the output height. Not limited here (like the boxes): validateMixProject checks it. */
  fontSize: z.number().optional(),
  align: overlayTextAlignSchema,
  color: overlayColorSchema,
  /** TTF/OTF file; if missing, the bundled font. */
  font: overlayFileSchema.optional(),
  border: overlayBorderSchema,
  /** Missing = no shadow. */
  shadow: overlayShadowSchema.optional(),
  /** Extra space between lines, as a fraction of the font size (0 = lines touching). */
  lineSpacing: z.number().nonnegative(),
  /** Seconds, 0 = none. */
  fadeIn: z.number().nonnegative(),
  fadeOut: z.number().nonnegative(),
  entry: textEntrySchema,
});

export type TextOverlayStyle = z.infer<typeof textOverlayStyleSchema>;

export const countdownOverlayStyleSchema = z.object({
  align: overlayTextAlignSchema,
  decimals: z.literal([0, 1, 2, 3]),
  /** `05` instead of `5` (and `01:05` instead of `1:05`). */
  leadingZeros: z.boolean(),
  color: overlayColorSchema,
  /** TTF/OTF file; if missing, the bundled font. */
  font: overlayFileSchema.optional(),
  border: overlayBorderSchema,
  /** Missing = no shadow. */
  shadow: overlayShadowSchema.optional(),
  /** Seconds before reaching 0, 0 = none. */
  fadeOut: z.number().nonnegative(),
});

export type CountdownOverlayStyle = z.infer<typeof countdownOverlayStyleSchema>;

export const progressBarDirections = ['ltr', 'rtl', 'btt', 'ttb'] as const;

export const progressBarOverlayStyleSchema = z.object({
  fillColor: overlayColorSchema,
  /** `#00000000` = no background. */
  backgroundColor: overlayColorSchema,
  /** Drawn inside the box. */
  border: overlayBorderSchema,
  /** Direction in which the fill grows. */
  direction: z.enum(progressBarDirections),
  /** `fill`: 0 → 100 % during its duration; `empty`: 100 → 0 %. */
  mode: z.enum(['fill', 'empty']),
});

export type ProgressBarOverlayStyle = z.infer<typeof progressBarOverlayStyleSchema>;

/**
 * A reusable style (B2): only style fields, no times, anchor, box or text. Global to the app (stored by main, T26),
 * so a `font` has the same absolute path in `path` and `absolutePath`.
 */
export const overlayStylePresetSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1), name: z.string(), type: z.literal('text'), style: textOverlayStyleSchema }),
  z.object({ id: z.string().min(1), name: z.string(), type: z.literal('countdown'), style: countdownOverlayStyleSchema }),
  z.object({ id: z.string().min(1), name: z.string(), type: z.literal('progressBar'), style: progressBarOverlayStyleSchema }),
]);

export type OverlayStylePreset = z.infer<typeof overlayStylePresetSchema>;

export type OverlayStylePresetType = OverlayStylePreset['type'];

/** Style field names by overlay type, e.g. to pick the style of an overlay when saving a preset. */
export const overlayStyleKeys = {
  text: textOverlayStyleSchema.keyof().options,
  countdown: countdownOverlayStyleSchema.keyof().options,
  progressBar: progressBarOverlayStyleSchema.keyof().options,
} satisfies Record<OverlayStylePresetType, readonly string[]>;
