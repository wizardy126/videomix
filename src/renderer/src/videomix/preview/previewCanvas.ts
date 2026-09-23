import type { Rect } from '../types';
import type { PreviewFrameDraw } from './previewDraw';
import type { PreviewOverlayOp } from './previewOverlays';

// Paints a live preview frame (A1, T32) on a 2D canvas: the draw list of previewDraw.ts and the overlays of
// previewOverlays.ts, in output px scaled to the canvas. Needs a DOM canvas but nothing of Electron or React, so it
// can be checked in a plain browser.
// - Videos: drawImage with the source crop (exact crop and scale, done by the GPU with an accelerated canvas).
// - Blurred fills: the source drawn at 1/BLUR_DOWNSCALE size into a scratch canvas with a small CSS blur, then scaled
//   up with bilinear smoothing: close to the render's boxblur at 1/8 size, and cheap.
// - Texts: canvas text with the overlay's font file (loaded as a FontFace by the engine), vertically centred by the
//   font's ascent + descent like the render's `y_align=font`; the border is a stroke of twice the drawtext width.

export interface PreviewCanvasResources {
  /** The element of a video key, only when it has a frame to draw. */
  getVideo: (key: string) => CanvasImageSource | undefined,
  /** A clip whose source can't be played here: drawn as its colour and name. */
  getPlaceholder: (clipId: string) => { color: string, label: string } | undefined,
  /** A loaded image overlay. */
  getImage: (path: string) => CanvasImageSource | undefined,
  /** CSS font family of an overlay font file (undefined: the bundled default). */
  getFontFamily: (fontPath: string | undefined) => string,
  /** Shown where a blurred fill has no frame yet. */
  fillColor: string,
}

/** A reusable scratch canvas for the blurred fills. */
export interface BlurScratch {
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
}

const BLUR_DOWNSCALE = 12;
const BLUR_MARGIN = 3;
const BLUR_RADIUS = 1.5;
const alignFactors = { left: 0, center: 0.5, right: 1 } as const;

export function createBlurScratch(): BlurScratch | undefined {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : document.createElement('canvas');
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  return ctx != null ? { canvas, ctx } : undefined;
}

function drawBlur(ctx: CanvasRenderingContext2D, scratch: BlurScratch | undefined, source: CanvasImageSource, src: Rect, dest: Rect, scale: number) {
  if (scratch == null) {
    ctx.drawImage(source, src.x, src.y, src.width, src.height, dest.x, dest.y, dest.width, dest.height);
    return;
  }
  const w = Math.max(2, Math.round((dest.width * scale) / BLUR_DOWNSCALE));
  const h = Math.max(2, Math.round((dest.height * scale) / BLUR_DOWNSCALE));
  const fullW = w + 2 * BLUR_MARGIN;
  const fullH = h + 2 * BLUR_MARGIN;
  if (scratch.canvas.width < fullW || scratch.canvas.height < fullH) {
    // eslint-disable-next-line no-param-reassign
    scratch.canvas.width = Math.max(scratch.canvas.width, fullW);
    // eslint-disable-next-line no-param-reassign
    scratch.canvas.height = Math.max(scratch.canvas.height, fullH);
  }
  const s = scratch.ctx;
  s.filter = `blur(${BLUR_RADIUS}px)`;
  // the blur darkens the edges (it samples transparent pixels outside): draw with a margin and keep the inside
  s.drawImage(source, src.x, src.y, src.width, src.height, 0, 0, fullW, fullH);
  s.filter = 'none';
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(scratch.canvas, BLUR_MARGIN, BLUR_MARGIN, w, h, dest.x, dest.y, dest.width, dest.height);
}

function fillRect(ctx: CanvasRenderingContext2D, rect: Rect, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, dest: Rect, { color, label }: { color: string, label: string }, scale: number) {
  fillRect(ctx, dest, color);
  const size = Math.max(10 / scale, Math.min(dest.height / 12, dest.width / 10));
  ctx.save();
  ctx.beginPath();
  ctx.rect(dest.x, dest.y, dest.width, dest.height);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `600 ${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, dest.x + dest.width / 2, dest.y + dest.height / 2);
  ctx.restore();
}

function drawTextOverlay(ctx: CanvasRenderingContext2D, op: Extract<PreviewOverlayOp, { kind: 'text' }>, family: string) {
  const { style, box, lines, dx, dy } = op;
  ctx.font = `${style.fontSize}px ${family}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  for (const line of lines) {
    const metrics = ctx.measureText(line.full);
    // older engines lack the font box metrics: approximate them from the size
    const ascent = metrics.fontBoundingBoxAscent ?? style.fontSize * 0.8;
    const descent = metrics.fontBoundingBoxDescent ?? style.fontSize * 0.2;
    const x = box.x + (box.width - metrics.width) * alignFactors[op.align] + dx;
    const y = line.cy - (ascent + descent) / 2 + ascent + dy;
    const paint = (px: number, py: number, color: string, borderColor: string | undefined) => {
      if (style.borderWidth > 0 && borderColor != null) {
        ctx.lineWidth = 2 * style.borderWidth;
        ctx.strokeStyle = borderColor;
        ctx.strokeText(line.text, px, py);
      }
      ctx.fillStyle = color;
      ctx.fillText(line.text, px, py);
    };
    if (style.shadow != null) paint(x + style.shadow.dx, y + style.shadow.dy, style.shadow.color, style.shadow.color);
    paint(x, y, style.color, style.borderColor);
  }
}

function drawOverlay(ctx: CanvasRenderingContext2D, op: PreviewOverlayOp, resources: PreviewCanvasResources) {
  switch (op.kind) {
    case 'image': {
      const image = resources.getImage(op.path);
      if (image == null || op.alpha <= 0) return;
      ctx.globalAlpha = op.alpha;
      ctx.drawImage(image, op.rect.x, op.rect.y, op.rect.width, op.rect.height);
      break;
    }
    case 'text': {
      if (op.alpha <= 0) return;
      ctx.globalAlpha = op.alpha;
      drawTextOverlay(ctx, op, resources.getFontFamily(op.style.fontPath));
      break;
    }
    case 'bar': {
      ctx.globalAlpha = 1;
      fillRect(ctx, op.box, op.backgroundColor);
      if (op.fill != null) fillRect(ctx, op.fill, op.fillColor);
      const { x, y, width, height } = op.box;
      const b = op.border;
      if (b > 0) {
        // drawbox with `t`: four bands inside the box
        fillRect(ctx, { x, y, width, height: b }, op.borderColor);
        fillRect(ctx, { x, y: y + height - b, width, height: b }, op.borderColor);
        fillRect(ctx, { x, y: y + b, width: b, height: height - 2 * b }, op.borderColor);
        fillRect(ctx, { x: x + width - b, y: y + b, width: b, height: height - 2 * b }, op.borderColor);
      }
      break;
    }
    default:
  }
}

/**
 * Paints a frame: `frame.ops`, then the overlays, then the global fade. `outputWidth` is the plan's width (output px);
 * the canvas may be smaller (it's sized to the player area), everything is scaled to it.
 */
export function drawPreviewFrame({ ctx, frame, overlays, outputWidth, resources, blurScratch }: {
  ctx: CanvasRenderingContext2D,
  frame: PreviewFrameDraw,
  overlays: readonly PreviewOverlayOp[],
  outputWidth: number,
  resources: PreviewCanvasResources,
  blurScratch: BlurScratch | undefined,
}) {
  const scale = ctx.canvas.width / outputWidth;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  frame.ops.forEach((op) => {
    if (op.alpha <= 0) return;
    ctx.globalAlpha = op.alpha;
    if (op.kind === 'color') {
      fillRect(ctx, op.rect, op.color);
      return;
    }
    const video = resources.getVideo(op.key);
    const placeholder = video == null ? resources.getPlaceholder(op.clipId) : undefined;
    if (op.kind === 'video') {
      ctx.imageSmoothingQuality = 'medium';
      if (video != null) ctx.drawImage(video, op.src.x, op.src.y, op.src.width, op.src.height, op.dest.x, op.dest.y, op.dest.width, op.dest.height);
      else if (placeholder != null) drawPlaceholder(ctx, op.dest, placeholder, scale);
    } else if (video != null) {
      drawBlur(ctx, blurScratch, video, op.src, op.dest, scale);
    } else {
      fillRect(ctx, op.dest, placeholder != null ? placeholder.color : resources.fillColor);
    }
  });
  for (const op of overlays) drawOverlay(ctx, op, resources);
  if (frame.fadeAlpha > 0) {
    ctx.globalAlpha = frame.fadeAlpha;
    fillRect(ctx, { x: 0, y: 0, width: outputWidth, height: ctx.canvas.height / scale }, '#000000');
  }
  ctx.restore();
}
