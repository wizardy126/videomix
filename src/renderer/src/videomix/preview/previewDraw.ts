import { getCellRect, getExtendedCropForAspect } from '../geometry';
import { getPlanAxis } from '../planner/types';
import { getGlobalFadeDuration } from '../render/buildAudioGraph';
import { getColumnsAtFrame, getFillSpansAtFrame, getKeyframeIndexAtFrame } from '../render/renderTimeline';
import type { ColumnGeometry, PlacementFrames, RenderTimeline } from '../render/renderTimeline';
import type { MixClip, MixSettings, Rect } from '../types';
import { getPreviewFrameIndex } from './previewSchedule';

// Draw list of one frame of the live preview (A1, T32): what previewCanvas.ts paints on the canvas, computed with the
// render's own geometry (renderTimeline: smoothstep re-layouts, columns growing from / shrinking to 0, fill spans;
// geometry.getExtendedCropForAspect: crops, pillarbox/letterbox, E7 extensions), so the layout matches the render. Approximations, on purpose:
// - every transition type is drawn as a crossfade (opacity), including the fade of a last clip into the fill;
// - blurred fills are a blurred cover of the nearest column showing a clip at that frame (the render uses a column that
//   plays during the whole chunk) and are only blurred approximately by the canvas;
// - the re-layout geometry is evaluated at the real time (between frames), which only makes the animation smoother.
// Pure: rects are in output px (floats), source rects in oriented source px (Chromium autorotates like ffmpeg).

/** Fills narrower than this are a plain colour, as in the render (buildVideoGraph's MIN_BLUR_FILL_WIDTH). */
const MIN_BLUR_FILL_WIDTH = 16;

export type PreviewDrawOp =
  | { kind: 'color', rect: Rect, color: string, alpha: number }
  /** The `src` rect of a clip's video (the element of `key`) drawn into `dest`. */
  | { kind: 'video', key: string, clipId: string, src: Rect, dest: Rect, alpha: number }
  /** Blurred cover of a clip's video: `src` (already of `dest`'s aspect) scaled up to `dest` and blurred. */
  | { kind: 'blur', key: string, clipId: string, src: Rect, dest: Rect, alpha: number };

export interface PreviewFrameDraw {
  ops: PreviewDrawOp[],
  /** Opacity of the black layer of the global fade in/out, drawn over everything (overlays included, like the render). */
  fadeAlpha: number,
}

export type PreviewDrawClip = Pick<MixClip, 'id' | 'maxRect' | 'minRect'>;
export type PreviewDrawSettings = Pick<MixSettings, 'gap' | 'fill' | 'transition' | 'fadeInOut'>;

/** Per plan: the timeline and its placements by column, so a frame only looks at its own columns. */
export interface PreviewDrawModel {
  tl: RenderTimeline,
  clips: ReadonlyMap<string, PreviewDrawClip>,
  settings: PreviewDrawSettings,
  byColumn: Map<number, PlacementFrames[]>,
}

export function createPreviewDrawModel(tl: RenderTimeline, clips: readonly PreviewDrawClip[], settings: PreviewDrawSettings): PreviewDrawModel {
  const byColumn = new Map<number, PlacementFrames[]>();
  for (const p of tl.placements) byColumn.set(p.placement.column, [...(byColumn.get(p.placement.column) ?? []), p]);
  for (const list of byColumn.values()) list.sort((a, b) => a.f0 - b.f0);
  return { tl, clips: new Map(clips.map((c) => [c.id, c])), settings, byColumn };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The part of a `src` → `dest` drawing that falls inside `bounds`: `dest` cut to the bounds and `src` cut in the same
 * proportion (a canvas drawImage with a clip rect, without the clip). Undefined if nothing is left.
 */
export function clipDrawToBounds(src: Rect, dest: Rect, bounds: Rect): { src: Rect, dest: Rect } | undefined {
  const x0 = Math.max(dest.x, bounds.x);
  const y0 = Math.max(dest.y, bounds.y);
  const x1 = Math.min(dest.x + dest.width, bounds.x + bounds.width);
  const y1 = Math.min(dest.y + dest.height, bounds.y + bounds.height);
  if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6 || dest.width <= 0 || dest.height <= 0) return undefined;
  const sx = src.width / dest.width;
  const sy = src.height / dest.height;
  return {
    src: { x: src.x + (x0 - dest.x) * sx, y: src.y + (y0 - dest.y) * sy, width: (x1 - x0) * sx, height: (y1 - y0) * sy },
    dest: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
  };
}

/** Largest centred part of `src` with the aspect of `dest`: what a "cover" scaling shows (the render's blurCover). */
export function getCoverSource(src: Rect, dest: Pick<Rect, 'width' | 'height'>): Rect {
  const aspect = dest.width / Math.max(1e-6, dest.height);
  if (src.width / src.height > aspect) {
    const width = src.height * aspect;
    return { x: src.x + (src.width - width) / 2, y: src.y, width, height: src.height };
  }
  const height = src.width / aspect;
  return { x: src.x, y: src.y + (src.height - height) / 2, width: src.width, height };
}

/**
 * How a clip fills its cell, as the render's column layer does (buildVideoGraph.buildClipLayer): the crop for the cell's
 * aspect scaled to the cell; out of the clip's aspect range, scaled to fill one axis and centred on a background (the
 * clip's blurred cover, or the fill colour). A column growing from / shrinking to 0 keeps filling the cross axis and is
 * cut by its window instead of letterboxing.
 */
export function getClipCellDraw({ clip, cell, rows, collapsing, extendedMaxRect }: {
  clip: Pick<MixClip, 'maxRect' | 'minRect'>,
  cell: Rect,
  rows: boolean,
  collapsing: boolean,
  /** E7 (T38b): the placement's `extendedMaxRect`, where the crop may grow beyond the max (as in the render). */
  extendedMaxRect?: Rect | undefined,
}) {
  const w = Math.max(2, cell.width);
  const h = Math.max(2, cell.height);
  const { crop, fit } = getExtendedCropForAspect(clip.maxRect, clip.minRect, extendedMaxRect, w / h);
  if (fit === 'fill') return { crop, draw: { src: crop, dest: cell }, background: false };
  // the window is longer along the main axis than the clip allows (columns: pillarbox; rows: letterbox)
  const mainTooLong = fit === (rows ? 'letterbox' : 'pillarbox');
  const fillCross = mainTooLong || collapsing;
  const s = fillCross === rows ? w / crop.width : h / crop.height;
  const dest = { x: cell.x + (w - crop.width * s) / 2, y: cell.y + (h - crop.height * s) / 2, width: crop.width * s, height: crop.height * s };
  return { crop, draw: clipDrawToBounds(crop, dest, cell), background: mainTooLong || !collapsing };
}

/** Columns that appear or disappear in the re-layout under way at frame `f` (they collapse to width 0). */
function getCollapsingColumns(tl: RenderTimeline, f: number) {
  const k = getKeyframeIndexAtFrame(tl, f);
  const current = tl.keyframes[k]!;
  const previous = tl.keyframes[k - 1];
  const res = new Set<number>();
  if (previous == null || f >= current.f1) return res;
  const a = new Set(previous.keyframe.columns.map((c) => c.column));
  const b = new Set(current.keyframe.columns.map((c) => c.column));
  for (const id of a) if (!b.has(id)) res.add(id);
  for (const id of b) if (!a.has(id)) res.add(id);
  return res;
}

/** Opacity of the black layer of the global fade at `time` (render: linear ramps over the first/last D seconds). */
export function getGlobalFadeAlpha(settings: Pick<MixSettings, 'fadeInOut' | 'transition'>, time: number, duration: number) {
  const d = Math.min(getGlobalFadeDuration(settings), duration);
  if (d <= 0) return 0;
  return clamp01(Math.max(1 - time / d, 1 - (duration - time) / d));
}

/**
 * What to draw at `time` (s), bottom to top: the gap colour, then every column (its clip, or two during a crossfade, the
 * incoming one on top with a growing opacity; a column whose clip has ended shows fill), then the fill areas.
 */
export function getPreviewDrawList(model: PreviewDrawModel, time: number): PreviewFrameDraw {
  const { tl, clips, settings, byColumn } = model;
  const { plan } = tl;
  const { fps } = tl.settings;
  const axis = getPlanAxis(plan);
  const rows = axis === 'rows';
  const f = time * fps;
  const frame = getPreviewFrameIndex(time, fps);
  const columns = getColumnsAtFrame(tl, f);
  const collapsing = getCollapsingColumns(tl, f);
  const cellOf = (g: ColumnGeometry) => getCellRect(axis, { offset: g.x, length: g.width }, plan);

  const ops: PreviewDrawOp[] = [{ kind: 'color', rect: { x: 0, y: 0, width: plan.width, height: plan.height }, color: settings.gap.color, alpha: 1 }];

  // What each column shows at this frame (crossfades: outgoing first)
  const shown = [...columns.entries()]
    .filter(([, g]) => g.width > 1e-3)
    .sort(([, a], [, b]) => a.x - b.x)
    .map(([column, geom]) => ({ column, geom, cell: cellOf(geom), active: (byColumn.get(column) ?? []).filter((p) => p.f0 <= frame && frame < p.f1) }));

  // Blurred fills take the nearest column showing a clip (its visible crop), like the render's pickSource
  const sources = shown.flatMap(({ geom, cell, active, column }) => {
    const top = active.at(-1);
    const clip = top != null ? clips.get(top.placement.clipId) : undefined;
    if (top == null || clip == null || geom.width < MIN_BLUR_FILL_WIDTH) return [];
    return [{ column, geom, key: `p${top.index}`, clipId: clip.id, crop: getClipCellDraw({ clip, cell, rows, collapsing: collapsing.has(column), extendedMaxRect: top.placement.extendedMaxRect }).crop }];
  });
  /** Fill of `rect` (at `geom` along the main axis); a column's own fill never takes its (ending) clip as source. */
  const fillOp = (rect: Rect, geom: ColumnGeometry, ownColumn?: number): PreviewDrawOp => {
    if (settings.fill.mode === 'blur' && geom.width >= MIN_BLUR_FILL_WIDTH) {
      let best: (typeof sources)[number] | undefined;
      let bestDist = Infinity;
      for (const s of sources.filter((source) => source.column !== ownColumn)) {
        const dist = Math.max(0, s.geom.x - (geom.x + geom.width), geom.x - (s.geom.x + s.geom.width));
        if (dist < bestDist) {
          best = s;
          bestDist = dist;
        }
      }
      if (best != null) return { kind: 'blur', key: best.key, clipId: best.clipId, src: getCoverSource(best.crop, rect), dest: rect, alpha: 1 };
    }
    return { kind: 'color', rect, color: settings.fill.color, alpha: 1 };
  };

  shown.forEach(({ column, geom, cell, active }) => {
    if (active.length === 0) {
      // a layout column whose clips have all ended (end of the video) is shown as fill
      ops.push(fillOp(cell, geom, column));
      return;
    }
    active.forEach((p) => {
      const clip = clips.get(p.placement.clipId);
      if (clip == null) return;
      let alpha = 1;
      // crossfade in: the incoming clip goes from transparent to opaque while the previous one is still there
      if (p.previous != null && p.previous.f1 > p.f0) alpha = clamp01((f - p.f0) / (p.previous.f1 - p.f0));
      if (p.endsInFill && p.fadeOutFrames > 0 && f >= p.f1 - p.fadeOutFrames) {
        // the last clip of a column fades into the fill
        ops.push(fillOp(cell, geom, column));
        alpha *= clamp01((p.f1 - f) / p.fadeOutFrames);
      }
      const key = `p${p.index}`;
      const { crop, draw, background } = getClipCellDraw({ clip, cell, rows, collapsing: collapsing.has(column), extendedMaxRect: p.placement.extendedMaxRect });
      if (background) {
        ops.push(settings.fill.mode === 'blur' && geom.width >= MIN_BLUR_FILL_WIDTH
          ? { kind: 'blur', key, clipId: clip.id, src: getCoverSource(crop, cell), dest: cell, alpha }
          : { kind: 'color', rect: cell, color: settings.fill.color, alpha });
      }
      if (draw != null) ops.push({ kind: 'video', key, clipId: clip.id, src: draw.src, dest: draw.dest, alpha });
    });
  });

  for (const span of getFillSpansAtFrame(tl, columns).values()) ops.push(fillOp(cellOf(span), span));

  return { ops, fadeAlpha: getGlobalFadeAlpha(settings, time, tl.totalFrames / fps) };
}
