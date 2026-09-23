import type { OverlayBox, TextOverlay } from '../types';

// Layout and entry animation of the text overlays (B1, T26), shared by the render graph (render/overlayFilters.ts) and
// the mini frame view, so both place and reveal the text the same way. Pure.
//
// Vertical layout: `n` line cells of `fontSize` height with `lineSpacing · fontSize` between them form a block, centered
// vertically in the box (the UI keeps the box fitted to it). Each line is centered in its cell.

/** Lines of a text overlay (`\n`; tabs as spaces, as drawtext would draw a missing glyph for them). */
export const splitTextLines = (text: string) => text.replaceAll('\r', '').replaceAll('\t', '    ').split('\n');

/** Height of `lineCount` lines of `fontSize` (same unit) with `lineSpacing` (fraction of the size) between them. */
export const getTextBlockHeight = (fontSize: number, lineCount: number, lineSpacing: number) => fontSize * (lineCount + (Math.max(1, lineCount) - 1) * lineSpacing);

/** Font size whose lines fill `boxHeight` (fractions of the frame height). */
export function getTextFontSizeForBox(text: string, lineSpacing: number, boxHeight: number) {
  const lines = splitTextLines(text).length;
  return boxHeight / (lines + (lines - 1) * lineSpacing);
}

/**
 * Font size of a text overlay, as a fraction of the output height: its `fontSize` or, if missing (v3 projects saved
 * before T26), the size whose lines fill the box height (one line is as high as the box, like the countdown).
 */
export function getTextOverlayFontSize({ text, box, lineSpacing, fontSize }: Pick<TextOverlay, 'text' | 'box' | 'lineSpacing' | 'fontSize'>) {
  return fontSize ?? getTextFontSizeForBox(text, lineSpacing, box.height);
}

/**
 * The box fitted to the lines at `fontSize`: same x and width, the block's height, same top unless that would leave the
 * frame (then moved up; a block taller than the frame gets the whole height and overflows it).
 */
export function fitTextBox(box: OverlayBox, { text, fontSize, lineSpacing }: { text: string, fontSize: number, lineSpacing: number }): OverlayBox {
  const height = Math.min(1, getTextBlockHeight(fontSize, splitTextLines(text).length, lineSpacing));
  const y = Math.max(0, Math.min(box.y, 1 - height));
  return { ...box, y, height };
}

/**
 * Patch for changing the text, size or line spacing of a text overlay: the changes, an explicit `fontSize` and the box
 * fitted to the new lines, so adding a line grows the box instead of shrinking the text.
 */
export function getTextOverlayLayoutPatch(overlay: Pick<TextOverlay, 'text' | 'box' | 'lineSpacing' | 'fontSize'>, changes: { text?: string, fontSize?: number, lineSpacing?: number }) {
  const text = changes.text ?? overlay.text;
  const lineSpacing = changes.lineSpacing ?? overlay.lineSpacing;
  const fontSize = changes.fontSize ?? getTextOverlayFontSize(overlay);
  return { ...changes, fontSize, box: fitTextBox(overlay.box, { text, fontSize, lineSpacing }) };
}

/** Vertical centers of the lines, in the unit of `boxTop`/`boxHeight`/`fontSize` (px or fractions). */
export function getTextLineCenters({ lineCount, fontSize, lineSpacing, boxTop, boxHeight }: { lineCount: number, fontSize: number, lineSpacing: number, boxTop: number, boxHeight: number }) {
  const blockTop = boxTop + (boxHeight - getTextBlockHeight(fontSize, lineCount, lineSpacing)) / 2;
  return Array.from({ length: lineCount }, (_, i) => blockTop + i * fontSize * (1 + lineSpacing) + fontSize / 2);
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** User-perceived characters (an accented letter or an emoji is one step of the typewriter). */
export const splitGraphemes = (line: string) => [...segmenter.segment(line)].map((s) => s.segment);

/** Frames of the entry animation (≥ 1 when it has one). */
export const getTextEntryFrames = (entry: TextOverlay['entry'], fps: number) => Math.max(1, Math.round(entry.duration * fps));

/**
 * Typewriter: characters shown `frame` frames after the text's (raw) start, of `total`. They appear evenly during the
 * `entryFrames`, the last one on the last frame of the entry; the whole text from then on.
 */
export const getTypewriterCount = (frame: number, total: number, entryFrames: number) => (frame >= entryFrames ? total : Math.max(0, Math.floor(((frame + 1) * total) / entryFrames)));

/** First frame (after the text's start) showing at least `count` characters (inverse of {@link getTypewriterCount}). */
export const getTypewriterFirstFrame = (count: number, total: number, entryFrames: number) => (count <= 0 || total <= 0 ? 0 : Math.ceil((count * entryFrames) / total) - 1);

export interface TypewriterStage {
  /** Visible part of the line (never only whitespace). */
  text: string,
  /** Frames [start, end) after the text's start. `end` undefined: until the text's end (the whole line). */
  start: number,
  end: number | undefined,
}

/**
 * What the typewriter shows of each line and when: the growing prefixes of each line (consecutive prefixes that only
 * differ in trailing spaces are merged) and, last, the whole line. Lines without visible characters have no stages.
 */
export function getTypewriterStages(lines: readonly string[], entryFrames: number): TypewriterStage[][] {
  const graphemes = lines.map((line) => splitGraphemes(line));
  const total = graphemes.reduce((acc, g) => acc + g.length, 0);
  let before = 0;
  return graphemes.map((chars) => {
    const stages: TypewriterStage[] = [];
    for (let k = 1; k <= chars.length; k += 1) {
      const text = chars.slice(0, k).join('').trimEnd();
      const start = getTypewriterFirstFrame(before + k, total, entryFrames);
      const end = k === chars.length ? undefined : getTypewriterFirstFrame(before + k + 1, total, entryFrames);
      const last = stages.at(-1);
      // nothing visible yet, or characters appearing in the same frame
      if (text !== '' && (end == null || end > start)) {
        if (last != null && last.text === text) last.end = end;
        else stages.push({ text, start, end });
      }
    }
    // the whole line may equal the last prefix after trimming (trailing spaces): it has already been merged into it
    before += chars.length;
    return stages;
  });
}

/** Ease-out cubic: fast start, soft landing. `u` in 0..1 (clamped). Returns the remaining part of the way (1 → 0). */
export const getSlideRemaining = (u: number) => (1 - Math.min(1, Math.max(0, u))) ** 3;

/**
 * Offset (fractions of the frame) of a sliding text `frame` frames after its start, for the mini frame view: from just
 * outside the frame side it comes from (the box fully out) to 0. The render uses the same easing, with the text's real
 * width (render/overlayFilters.ts).
 */
export function getSlideOffset(overlay: Pick<TextOverlay, 'entry' | 'box'>, frame: number, fps: number) {
  const { entry, box } = overlay;
  if (entry.kind !== 'slide' || entry.from == null) return { dx: 0, dy: 0 };
  const remaining = getSlideRemaining(frame / getTextEntryFrames(entry, fps));
  switch (entry.from) {
    case 'left': { return { dx: -(box.x + box.width) * remaining + 0, dy: 0 }; }
    case 'right': { return { dx: (1 - box.x) * remaining, dy: 0 }; }
    case 'top': { return { dx: 0, dy: -(box.y + box.height) * remaining + 0 }; }
    case 'bottom': { return { dx: 0, dy: (1 - box.y) * remaining }; }
    default: { return { dx: 0, dy: 0 }; }
  }
}

/** Opacity of a text `frame` frames after its (raw) start, of `totalFrames`: linear fades in and out, like the render. */
export function getTextOpacity(overlay: Pick<TextOverlay, 'fadeIn' | 'fadeOut'>, frame: number, totalFrames: number, fps: number) {
  let alpha = 1;
  if (overlay.fadeIn > 0) alpha = Math.min(alpha, frame / (overlay.fadeIn * fps));
  if (overlay.fadeOut > 0) alpha = Math.min(alpha, (totalFrames - frame) / (overlay.fadeOut * fps));
  return Math.max(0, alpha);
}
