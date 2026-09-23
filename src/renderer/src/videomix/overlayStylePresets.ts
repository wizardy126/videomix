import { z } from 'zod';

import { overlayStyleKeys, overlayStylePresetSchema } from '../../../common/videomix/overlayStyles';
import type { OverlayStylePreset, OverlayStylePresetType } from '../../../common/videomix/overlayStyles';
import type { MixOverlay, TextOverlay } from './types';
import type { MixOverlayPatch } from './projectReducer';
import { getTextOverlayFontSize, getTextOverlayLayoutPatch } from './overlays/textLayout';

// Global style presets of the text, countdown and progress bar overlays (B2, T26): stored by main in the app config
// (`overlayStylePresets`), exported/imported as JSON files. A preset only has style fields (overlayStyles.ts): no times,
// anchor, box or text. Pure.

export type StyledOverlay = Extract<MixOverlay, { type: OverlayStylePresetType }>;

export const isStyledOverlay = (overlay: MixOverlay): overlay is StyledOverlay => overlay.type === 'text' || overlay.type === 'countdown' || overlay.type === 'progressBar';

/** The valid presets of a stored/imported list (an invalid entry, e.g. from a newer version, is dropped, not fatal). */
export function sanitizeStylePresets(value: unknown): OverlayStylePreset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = overlayStylePresetSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

const pick = (overlay: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.flatMap((key) => (overlay[key] !== undefined ? [[key, overlay[key]]] : [])));

/**
 * A new preset with the style of `overlay`. The font is stored by its absolute path (presets are global, not relative
 * to a project), and a text's size is made explicit.
 */
export function createStylePreset(overlay: StyledOverlay, { id, name }: { id: string, name: string }): OverlayStylePreset {
  const style: Record<string, unknown> = pick(overlay, overlayStyleKeys[overlay.type]);
  if ('font' in overlay && overlay.font != null) style['font'] = { path: overlay.font.absolutePath, absolutePath: overlay.font.absolutePath };
  if (overlay.type === 'text') style['fontSize'] = getTextOverlayFontSize(overlay);
  return overlayStylePresetSchema.parse({ id, name, type: overlay.type, style });
}

/**
 * Patch that gives `overlay` the style of `preset` (of the same type): every style field, including removing a font
 * or shadow the preset doesn't have. A text keeps its box fitted to its lines with the preset's size and spacing.
 */
export function getStylePresetPatch(overlay: StyledOverlay, preset: OverlayStylePreset): MixOverlayPatch | undefined {
  if (preset.type !== overlay.type) return undefined;
  const patch: Record<string, unknown> = Object.fromEntries(overlayStyleKeys[preset.type].map((key) => [key, undefined]));
  Object.assign(patch, structuredClone(preset.style));
  if (overlay.type === 'text') {
    const style = patch as Partial<TextOverlay>;
    // no size in the preset (only possible if written by hand): keep the text's own
    Object.assign(patch, getTextOverlayLayoutPatch(overlay, { fontSize: style.fontSize ?? getTextOverlayFontSize(overlay), lineSpacing: style.lineSpacing ?? overlay.lineSpacing }));
  }
  return patch as MixOverlayPatch;
}

const PRESETS_FILE_FORMAT = 'videomix-overlay-styles';

const presetsFileSchema = z.object({ format: z.literal(PRESETS_FILE_FORMAT), version: z.literal(1), presets: z.unknown() });

/** Contents of an exported presets file. */
export const serializeStylePresets = (presets: readonly OverlayStylePreset[]) => `${JSON.stringify({ format: PRESETS_FILE_FORMAT, version: 1, presets }, null, 2)}\n`;

/**
 * Presets of an exported file, to add to `existing`: invalid entries are skipped and ids that already exist get a new
 * one (`newId`), so importing the same file twice gives copies instead of replacing. Throws if it's not a presets file.
 */
export function parseStylePresetsFile(text: string, existing: readonly OverlayStylePreset[], newId: () => string) {
  const file = presetsFileSchema.parse(JSON.parse(text));
  const ids = new Set(existing.map((p) => p.id));
  const presets = sanitizeStylePresets(file.presets).map((preset) => {
    const id = ids.has(preset.id) ? newId() : preset.id;
    ids.add(id);
    return { ...preset, id };
  });
  return { presets, skipped: Array.isArray(file.presets) ? file.presets.length - presets.length : 0 };
}
