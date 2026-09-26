import type { MixOutputAspect, MixOverlay } from '../types';
import { getOutputSize } from '../types';
import type { ResolvedOverlayTimes } from '../overlays/resolveOverlayTimes';
import { getPreviewOverlayOps } from '../preview/previewOverlays';
import type { PreviewOverlayOp } from '../preview/previewOverlays';
import { drawPreviewFrame } from '../preview/previewCanvas';
import { adaptBlockDefToAspect } from './blockOperations';
import { getBlockDefDuration, getBlockDefTimes, getNormalizedMembers } from './expandBlocks';
import { getBlockDefVariables, getVariableDefaults, substituteTextVariables } from './blockVariables';
import type { VmxBlockTemplate } from './vmxBlockFile';

// Picture of a block template (H2 import preview, H3 library thumbnail, T58): its central frame drawn by the live
// preview's overlay drawing (previewOverlays.ts + previewCanvas.ts) over a neutral background. No ffmpeg: it's instant,
// needs no video, and shows what the live preview shows (the render differs only in font rasterization).

const PREVIEW_FPS = 30;
const BACKGROUND = '#3a3a3a';

/**
 * Pure part: the overlay ops of `template` at the middle of its duration (its "central frame"), in output px of `aspect`
 * (the template's own by default; another one adapts the boxes, H7), with the texts' variables substituted.
 */
export function getTemplatePreviewOps(template: Pick<VmxBlockTemplate, 'members' | 'aspect'>, { variables, aspect = template.aspect, time }: {
  variables?: Readonly<Record<string, string>> | undefined,
  aspect?: MixOutputAspect | undefined,
  /** Seconds from the block's start (default: the middle). */
  time?: number | undefined,
} = {}): { ops: PreviewOverlayOp[], width: number, height: number, time: number } {
  let def = { id: 'preview', name: '', color: 0, members: template.members };
  if (aspect !== template.aspect) def = adaptBlockDefToAspect(def, template.aspect, aspect);
  const defaults = getVariableDefaults(getBlockDefVariables(def));
  const overlays = getNormalizedMembers(def).map((m): MixOverlay => (m.type === 'text' ? { ...m, text: substituteTextVariables(m.text, variables, defaults) } : m));
  const resolved: ResolvedOverlayTimes = new Map([...getBlockDefTimes(def)].map(([id, t]) => [id, { start: t.start, end: t.end, rawStart: t.start, rawEnd: t.end, warnings: t.warnings }]));
  const { width, height } = getOutputSize({ aspect, resolution: '720' });
  const at = time ?? getBlockDefDuration(def) / 2;
  return { ops: getPreviewOverlayOps({ overlays, resolved, time: at, fps: PREVIEW_FPS, width, height }), width, height, time: at };
}

// Loaded fonts, by file path (FontFace families are global to the document)
const fontFamilies = new Map<string, Promise<string>>();

function loadFont(path: string, getFileUrl: (filePath: string) => string) {
  let family = fontFamilies.get(path);
  if (family == null) {
    const name = `videomix-block-font-${fontFamilies.size}`;
    family = new FontFace(name, `url("${getFileUrl(path)}")`).load().then((face) => {
      document.fonts.add(face);
      return `"${name}", sans-serif`;
    }, (err) => {
      console.warn('Cannot load font for the block preview', path, err);
      return 'sans-serif';
    });
    fontFamilies.set(path, family);
  }
  return family;
}

async function loadImage(path: string, getFileUrl: (filePath: string) => string) {
  const image = new Image();
  image.src = getFileUrl(path);
  try {
    await image.decode();
    return image;
  } catch (err) {
    console.warn('Cannot load image for the block preview', path, err);
    return undefined;
  }
}

/**
 * Draws the central frame of `template` (see {@link getTemplatePreviewOps}) and returns it as a PNG data URL, `width`
 * px wide. Missing images are left out; missing fonts fall back to the default one.
 */
export async function renderTemplatePreview(template: Pick<VmxBlockTemplate, 'members' | 'aspect'>, { width: canvasWidth, variables, aspect, getFileUrl, defaultFontPath }: {
  width: number,
  variables?: Readonly<Record<string, string>> | undefined,
  aspect?: MixOutputAspect | undefined,
  getFileUrl: (path: string) => string,
  defaultFontPath: string | undefined,
}): Promise<string> {
  const { ops, width, height } = getTemplatePreviewOps(template, { variables, aspect });

  const imagePaths = [...new Set(ops.flatMap((op) => (op.kind === 'image' ? [op.path] : [])))];
  const fontPaths = new Set<string>();
  if (defaultFontPath != null) fontPaths.add(defaultFontPath);
  template.members.forEach((m) => { if ((m.type === 'text' || m.type === 'countdown') && m.font != null) fontPaths.add(m.font.path); });
  const [images, families] = await Promise.all([
    Promise.all(imagePaths.map(async (p) => [p, await loadImage(p, getFileUrl)] as const)),
    Promise.all([...fontPaths].map(async (p) => [p, await loadFont(p, getFileUrl)] as const)),
  ]);
  const imagesByPath = new Map(images);
  const familiesByPath = new Map(families);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(canvasWidth);
  canvas.height = Math.max(1, Math.round((canvasWidth * height) / width));
  const ctx = canvas.getContext('2d');
  if (ctx == null) return '';
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawPreviewFrame({
    ctx,
    frame: { ops: [], fadeAlpha: 0 },
    overlays: ops,
    outputWidth: width,
    resources: {
      getVideo: () => undefined,
      getPlaceholder: () => undefined,
      getImage: (p) => imagesByPath.get(p),
      getFontFamily: (p) => familiesByPath.get(p ?? defaultFontPath ?? '') ?? 'sans-serif',
      fillColor: BACKGROUND,
    },
    blurScratch: undefined,
  });
  return canvas.toDataURL('image/png');
}
