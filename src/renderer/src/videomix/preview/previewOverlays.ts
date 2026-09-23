import { overlayPxToOutput } from '../overlays/factories';
import { getCountdownTextAt, getOverlayFrames, getOverlayPixelBox, getProgressBarFraction } from '../overlays/overlayFrames';
import type { OverlayFrames } from '../overlays/overlayFrames';
import type { ResolvedOverlayTimes } from '../overlays/resolveOverlayTimes';
import { getSlideOffset, getTextEntryFrames, getTextLineCenters, getTextOpacity, getTextOverlayFontSize, getTypewriterCount, splitGraphemes, splitTextLines } from '../overlays/textLayout';
import { lengthPx } from '../render/overlayFilters';
import type { CountdownOverlay, MixOverlay, ProgressBarOverlay, Rect, TextOverlay } from '../types';
import { getPreviewFrameIndex } from './previewSchedule';

// Visual overlays of one live preview frame (A1, T32), with the render's per-frame values (overlays/overlayFrames.ts,
// overlays/textLayout.ts, the same frame rounding and px boxes as render/overlayFilters.ts). Text is only laid out here
// (lines, vertical centres, alignment); the canvas measures the widths with the real font (previewCanvas.ts). Pure.

export interface PreviewTextLine {
  /** What is visible now (a typewriter shows a prefix). */
  text: string,
  /** The whole line: it sets the horizontal alignment, so a typewriter prefix is already where it ends up. */
  full: string,
  /** Vertical centre of the line cell, output px. */
  cy: number,
}

export interface PreviewTextStyle {
  /** The overlay's font file; undefined: the bundled default font. */
  fontPath: string | undefined,
  /** Output px. */
  fontSize: number,
  color: string,
  /** Outline width (drawtext `borderw`), output px; 0 = none. */
  borderWidth: number,
  borderColor: string,
  shadow: { dx: number, dy: number, color: string } | undefined,
}

export type PreviewOverlayOp =
  | { kind: 'image', id: string, path: string, rect: Rect, alpha: number }
  | { kind: 'text', id: string, style: PreviewTextStyle, box: Rect, align: TextOverlay['align'], lines: PreviewTextLine[], dx: number, dy: number, alpha: number }
  | { kind: 'bar', id: string, box: Rect, backgroundColor: string, fill: Rect | undefined, fillColor: string, border: number, borderColor: string };

function textStyle(overlay: CountdownOverlay | TextOverlay, fontSize: number, height: number): PreviewTextStyle {
  return {
    fontPath: overlay.font?.absolutePath,
    fontSize,
    color: overlay.color,
    borderWidth: lengthPx(overlay.border.width, height),
    borderColor: overlay.border.color,
    shadow: overlay.shadow != null
      ? { dx: Math.round(overlayPxToOutput(overlay.shadow.x, height)), dy: Math.round(overlayPxToOutput(overlay.shadow.y, height)), color: overlay.shadow.color }
      : undefined,
  };
}

/** The filled part of a progress bar's inner rect (render: `round(length · fraction)` px from the growing side). */
export function getProgressBarFillRect(overlay: Pick<ProgressBarOverlay, 'direction' | 'mode'>, inner: Rect, frames: Pick<OverlayFrames, 'rawStart' | 'rawEnd'>, frame: number): Rect | undefined {
  const horizontal = overlay.direction === 'ltr' || overlay.direction === 'rtl';
  const length = Math.round((horizontal ? inner.width : inner.height) * getProgressBarFraction(overlay.mode, frames, frame));
  if (length <= 0 || inner.width <= 0 || inner.height <= 0) return undefined;
  switch (overlay.direction) {
    case 'ltr': { return { ...inner, width: length }; }
    case 'rtl': { return { ...inner, x: inner.x + inner.width - length, width: length }; }
    case 'ttb': { return { ...inner, height: length }; }
    default: { return { ...inner, y: inner.y + inner.height - length, height: length }; }
  }
}

/** Visual overlays shown at `time` (s), bottom to top (the layer order of `overlays`), in output px. */
export function getPreviewOverlayOps({ overlays, resolved, time, fps, width: W, height: H }: {
  overlays: readonly MixOverlay[],
  resolved: ResolvedOverlayTimes,
  time: number,
  fps: number,
  width: number,
  height: number,
}): PreviewOverlayOp[] {
  const frame = getPreviewFrameIndex(time, fps);
  const ops: PreviewOverlayOp[] = [];
  overlays.forEach((overlay) => {
    const times = resolved.get(overlay.id);
    if (overlay.type === 'sound' || times == null) return;
    const frames = getOverlayFrames(times, fps);
    if (frame < frames.start || frame >= frames.end) return;
    const box = getOverlayPixelBox(overlay.box, W, H);
    const since = frame - frames.rawStart;
    const total = frames.rawEnd - frames.rawStart;

    switch (overlay.type) {
      case 'image': {
        // same linear alpha fades as the text (the render's `fade … alpha=1` from the raw start)
        ops.push({ kind: 'image', id: overlay.id, path: overlay.absolutePath, rect: box, alpha: getTextOpacity(overlay, since, total, fps) });
        break;
      }
      case 'countdown': {
        const text = getCountdownTextAt(overlay, frames, frame, fps);
        if (text == null) break;
        const alpha = overlay.fadeOut > 0 ? Math.min(1, (frames.rawEnd - frame) / (overlay.fadeOut * fps)) : 1;
        ops.push({
          kind: 'text',
          id: overlay.id,
          style: textStyle(overlay, Math.max(1, Math.round(overlay.box.height * H)), H),
          box,
          align: overlay.align,
          lines: [{ text, full: text, cy: box.y + box.height / 2 }],
          dx: 0,
          dy: 0,
          alpha,
        });
        break;
      }
      case 'text': {
        // trailing spaces don't count for the alignment (as in the render)
        const lines = splitTextLines(overlay.text).map((line) => splitGraphemes(line.trimEnd()));
        const size = Math.max(1, Math.round(getTextOverlayFontSize(overlay) * H));
        const centers = getTextLineCenters({ lineCount: lines.length, fontSize: size, lineSpacing: overlay.lineSpacing, boxTop: box.y, boxHeight: box.height });
        const count = lines.reduce((acc, l) => acc + l.length, 0);
        const shown = overlay.entry.kind === 'typewriter' ? getTypewriterCount(since, count, getTextEntryFrames(overlay.entry, fps)) : count;
        let before = 0;
        const previewLines = lines.flatMap((chars, i) => {
          const visible = chars.slice(0, Math.max(0, shown - before)).join('');
          before += chars.length;
          return visible.trim() !== '' ? [{ text: visible, full: chars.join(''), cy: centers[i]! }] : [];
        });
        const { dx, dy } = getSlideOffset(overlay, since, fps);
        ops.push({ kind: 'text', id: overlay.id, style: textStyle(overlay, size, H), box, align: overlay.align, lines: previewLines, dx: dx * W, dy: dy * H, alpha: getTextOpacity(overlay, since, total, fps) });
        break;
      }
      case 'progressBar': {
        const border = Math.min(lengthPx(overlay.border.width, H), Math.floor(Math.min(box.width, box.height) / 2));
        const inner = { x: box.x + border, y: box.y + border, width: box.width - 2 * border, height: box.height - 2 * border };
        ops.push({ kind: 'bar', id: overlay.id, box, backgroundColor: overlay.backgroundColor, fill: getProgressBarFillRect(overlay, inner, frames, frame), fillColor: overlay.fillColor, border, borderColor: overlay.border.color });
        break;
      }
      default:
    }
  });
  return ops;
}
