import invariant from 'tiny-invariant';

import { getCropForAspect } from '../geometry';
import { getPlanAxis, getPlanAxisLengths } from '../planner/types';
import type { MixClip, MixSettings, Rect } from '../types';
import type { RenderChunk } from './renderChunks';
import { getColumnsAtFrame, getFillSpansAtFrame, getPlacementsInRange } from './renderTimeline';
import type { ColumnGeometry, PlacementFrames, RenderTimeline } from './renderTimeline';
import { formatNumber, toFfmpegColor } from './ffmpegArgs';
import { buildOverlayFilters } from './overlayFilters';
import type { VideoGraphOverlays } from './overlayFilters';

// Filter graph of one render chunk (ADR-001 "Grafo de un bloque"). Columns are composed left to right with overlay
// on a canvas of the gap colour; a column whose width changes inside the chunk uses the "column layer" technique
// (fixed crop of the union of the per-frame crops → scale eval=frame → overlay at per-frame offsets on a fixed-size
// base), anchored left: its visible window is [0, w(t)) and the next element to its right hides the rest.
// Along the plan's main axis (T29): for rows the same holds with y/height, i.e. layers span the whole output width, are
// anchored at the top and composed top to bottom, and the gap bars are horizontal.

export { formatNumber, toFfmpegColor } from './ffmpegArgs';

export type VideoGraphSettings = Pick<MixSettings, 'fps' | 'gap' | 'transition' | 'fadeInOut' | 'fill'>;

export type RenderClip = Pick<MixClip, 'id' | 'sourceId' | 'start' | 'maxRect' | 'minRect'>;

export interface VideoGraph {
  /** Per input: its input options followed by `-i <path>`, in input index order. */
  inputs: string[][],
  /** To be written to a file and passed with `-/filter_complex <file>` (never inline: argv limits). */
  filterComplex: string,
  /** Output pad of the graph, map it with `-map [<outLabel>]`. */
  outLabel: string,
  /** Exact number of frames the chunk produces (use `-frames:v`). */
  frames: number,
}

/** Seconds the input is opened before the seek point (ADR-001: ffmpeg's accurate seek drops the frame on screen). */
const SEEK_PREROLL = 0.1;
/** Fills narrower than this use a plain colour: a blurred cover of a few px wide is pointless and fragile. */
const MIN_BLUR_FILL_WIDTH = 16;

const roundEven = (v: number) => 2 * Math.round(v / 2) + 0;
const ceilEven = (v: number) => 2 * Math.ceil(v / 2 - 1e-6) + 0;
const floorEven = (v: number) => 2 * Math.floor(v / 2 + 1e-6) + 0;

/**
 * Piecewise-constant expression of the frame values `values[m]` (frame m shown at t = m / fps), written as a flat sum
 * of steps `v0+Δ1*gte(t,T1)+…` with `T = (m − 0.5) / fps`. Never nested `if()`: ffmpeg's parser fails beyond ~98
 * nesting levels, while the flat sum was tested with 2000 terms. A constant is written as a plain number.
 */
export function stepExpr(values: number[], fps: number) {
  invariant(values.length > 0, 'stepExpr: no values');
  const terms = [String(values[0]!)];
  for (let m = 1; m < values.length; m += 1) {
    const d = values[m]! - values[m - 1]!;
    if (d !== 0) terms.push(`${d > 0 ? '+' : ''}${d}*gte(t,${formatNumber((m - 0.5) / fps)})`);
  }
  return terms.length > 1 ? `'${terms.join('')}'` : terms[0]!;
}

/** Blurred "cover" of the input at `w`×`h`: blur at 1/8 resolution (2.5× cheaper than a full-size gblur, ADR-001 §4). */
export function blurCover(w: number, h: number) {
  const sw = Math.max(2, roundEven(w / 8));
  const sh = Math.max(2, roundEven(h / 8));
  // boxblur rejects radii above half the (chroma) plane size
  const radius = Math.min(6, Math.floor(Math.min(sw, sh) / 4));
  const blur = radius > 0 ? `,boxblur=luma_radius=${radius}:luma_power=2` : '';
  return `scale=${sw}:${sh}:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=${sw}:${sh}${blur},scale=${w}:${h}:flags=bilinear,setsar=1`;
}

const cropFilter = (r: Rect) => `crop=${r.width}:${r.height}:${r.x}:${r.y}`;

/** A column or a fill area, composed left to right. Per chunk frame: offset and visible length along the main axis. */
interface Element {
  kind: 'column' | 'fill',
  /** Stacking order among elements with the same x: left fill below, right fill on top. */
  tie: number,
  xs: number[],
  ws: number[],
  varying: boolean,
  /** Width of the layer stream (≥ every visible width). */
  layerWidth: number,
  column?: number | undefined,
  label?: string | undefined,
}

interface Segment { label: string, start: number, end: number }

/**
 * Filter graph for the frames [chunk.f0, chunk.f1) of the plan.
 * `sourcePaths` maps `sourceId` → media path. Clip rects are in oriented source pixels (ffmpeg autorotates).
 */
export function buildVideoGraph({ timeline: tl, clips, sourcePaths, settings, chunk, overlays }: {
  timeline: RenderTimeline,
  clips: RenderClip[],
  sourcePaths: Record<string, string>,
  settings: VideoGraphSettings,
  chunk: Pick<RenderChunk, 'f0' | 'f1'>,
  /** Images, countdowns and progress bars drawn over the composition (T20). */
  overlays?: VideoGraphOverlays | undefined,
}): VideoGraph {
  const { plan } = tl;
  const { fps } = settings;
  const W = plan.width;
  const H = plan.height;
  const rows = getPlanAxis(plan) === 'rows';
  // main length (what the layouts span) and cross length (what every column/row spans)
  const { main: M, cross: C } = getPlanAxisLengths(plan);
  /** Output size of a layer `length` px long along the main axis. */
  const layerSize = (length: number) => (rows ? { w: C, h: length } : { w: length, h: C });
  const { f0, f1 } = chunk;
  const N = f1 - f0;
  invariant(N > 0, 'Empty chunk');
  const fillColor = toFfmpegColor(settings.fill.color);
  const gapColor = toFfmpegColor(settings.gap.color);
  const transitionType = settings.transition.type;
  const sec = (frames: number) => formatNumber(frames / fps);
  // sources with a duration of one frame more than needed, cut exactly with trim
  const colorSource = (color: string, w: number, h: number, frames: number) => `color=c=${color}:s=${w}x${h}:r=${fps}:d=${sec(frames + 1)},trim=end_frame=${frames}`;
  /** Plain colour layer `length` px long along the main axis. */
  const colorLayer = (color: string, length: number, frames: number) => {
    const { w, h } = layerSize(length);
    return colorSource(color, w, h, frames);
  };

  const clipById = new Map(clips.map((c) => [c.id, c]));
  const inputs: string[][] = [];
  const filters: string[] = [];
  let labelCounter = 0;
  const newLabel = (prefix: string) => {
    const l = `${prefix}${labelCounter}`;
    labelCounter += 1;
    return l;
  };

  // Per-frame geometry of every layout column and fill area. One absent at some frames of the chunk (a column removed
  // at the end of a re-layout merged with a later xfade, a fill that opens during a re-layout) has width 0 there.
  const followAcrossFrames = (frames: Map<string | number, ColumnGeometry>[]) => {
    const res = new Map<string | number, ColumnGeometry[]>();
    const keys = [...new Set(frames.flatMap((g) => [...g.keys()]))];
    for (const key of keys) {
      const list = frames.map((g) => g.get(key));
      const firstKnown = list.find((g) => g != null)!;
      let last: ColumnGeometry = { x: firstKnown.x, width: 0 };
      res.set(key, list.map((g) => {
        if (g != null) {
          last = g;
          return g;
        }
        return { x: last.x + last.width, width: 0 };
      }));
    }
    return res;
  };
  const frameGeoms = Array.from({ length: N }, (_v, n) => getColumnsAtFrame(tl, f0 + n));
  const columnGeom = followAcrossFrames(frameGeoms) as Map<number, ColumnGeometry[]>;
  const fillGeom = followAcrossFrames(frameGeoms.map((g) => getFillSpansAtFrame(tl, g))) as Map<string, ColumnGeometry[]>;

  // columns that grow from / shrink to width 0 in a re-layout overlapping the chunk
  const collapsingColumns = new Set<number>();
  tl.keyframes.forEach(({ keyframe, f0: kf0, f1: kf1 }, k) => {
    const prev = tl.keyframes[k - 1]?.keyframe;
    if (prev == null || kf0 >= f1 || kf1 < f0) return;
    const has = (layout: typeof keyframe, id: number) => layout.columns.some((c) => c.column === id);
    for (const c of [...prev.columns, ...keyframe.columns]) {
      if (!has(prev, c.column) || !has(keyframe, c.column)) collapsingColumns.add(c.column);
    }
  });

  const placementsByColumn = new Map<number, PlacementFrames[]>();
  for (const p of getPlacementsInRange(tl, f0, f1)) {
    placementsByColumn.set(p.placement.column, [...(placementsByColumn.get(p.placement.column) ?? []), p].sort((a, b) => a.f0 - b.f0));
    if (!columnGeom.has(p.placement.column)) {
      // not in the layout (shouldn't happen with a valid plan): render it with width 0 so nothing is lost silently
      columnGeom.set(p.placement.column, frameGeoms.map(() => ({ x: M, width: 0 })));
    }
  }

  const makeElement = (kind: Element['kind'], tie: number, geoms: ColumnGeometry[], column?: number): Element => {
    const ws = geoms.map((g) => g.width);
    const xs = geoms.map((g) => g.x);
    const varying = ws.some((w) => Math.abs(w - ws[0]!) > 1e-6);
    return { kind, tie, xs, ws, varying, layerWidth: varying ? Math.max(2, ceilEven(Math.max(...ws))) : Math.round(ws[0]!), column };
  };

  const elements: Element[] = [];
  for (const [id, geoms] of columnGeom) {
    // a layout column without clips in this chunk (its clip ended, end of the video) is shown as fill
    elements.push(makeElement(placementsByColumn.has(id) ? 'column' : 'fill', 0, geoms, id));
  }
  // fills are left-anchored like columns (the next element hides their excess), except the right edge one: it is drawn
  // over the last column, whose layer may extend past its window
  for (const [key, geoms] of fillGeom) elements.push(makeElement('fill', key === 'R' ? 1 : -1, geoms));
  elements.sort((a, b) => a.xs[0]! - b.xs[0]! || a.tie - b.tie || (a.column ?? 0) - (b.column ?? 0));

  // Sources of blurred fills: a column that plays during the whole chunk (so it never becomes fill itself here),
  // the nearest one to the fill. With 'color' fill mode, or if there is none, the fill is a plain colour.
  const isFullSpan = (column: number) => {
    const list = placementsByColumn.get(column);
    if (list == null) return false;
    return list[0]!.f0 <= f0 && list.at(-1)!.f1 >= f1 && Math.min(...columnGeom.get(column)!.map((g) => g.width)) >= MIN_BLUR_FILL_WIDTH;
  };
  const sourceColumns = elements.filter((e) => e.kind === 'column' && isFullSpan(e.column!));
  const pickSource = (x: number, width: number) => {
    if (settings.fill.mode !== 'blur' || width < MIN_BLUR_FILL_WIDTH) return undefined;
    let best: Element | undefined;
    let bestDist = Infinity;
    for (const e of sourceColumns) {
      const dist = Math.max(0, e.xs[0]! - (x + width), x - (e.xs[0]! + e.ws[0]!));
      if (dist < bestDist) {
        best = e;
        bestDist = dist;
      }
    }
    return best;
  };
  const sourceRequests = new Map<Element, string[]>();
  const requestSource = (source: Element) => {
    const label = newLabel('fsrc');
    sourceRequests.set(source, [...(sourceRequests.get(source) ?? []), label]);
    return label;
  };

  /** Fill layer `length` px long for local frames [start, end): blurred cover of `source`, or plain colour. */
  const buildFillLayer = (length: number, start: number, end: number, source: Element | undefined) => {
    const out = newLabel('fill');
    if (source == null) {
      filters.push(`${colorLayer(fillColor, length, end - start)}[${out}]`);
      return out;
    }
    const src = requestSource(source);
    const trim = start > 0 || end < N ? `trim=start_frame=${start}:end_frame=${end},setpts=PTS-STARTPTS,` : '';
    // a varying-width source column carries hidden excess to the right of its window: keep only the always-visible part
    const visible = floorEven(Math.min(...source.ws));
    const crop = source.varying ? `crop=${rows ? `${C}:${visible}` : `${visible}:${C}`}:0:0,` : '';
    const { w, h } = layerSize(length);
    filters.push(`[${src}]${trim}${crop}${blurCover(w, h)}[${out}]`);
    return out;
  };

  /** Layer of one clip for its frames in the chunk; `ws` are the column widths during those frames. */
  const buildClipLayer = (p: PlacementFrames, element: Element) => {
    const clip = clipById.get(p.placement.clipId);
    invariant(clip != null, `Unknown clip ${p.placement.clipId}`);
    const path = sourcePaths[clip.sourceId];
    invariant(path != null, `Unknown source ${clip.sourceId}`);
    const pf0 = Math.max(p.f0, f0);
    const pf1 = Math.min(p.f1, f1);
    const nf = pf1 - pf0;
    const seek = clip.start + (pf0 - p.f0) / fps;
    const preroll = Math.min(SEEK_PREROLL, seek);
    const inputIndex = inputs.length;
    inputs.push(['-ss', formatNumber(seek - preroll), '-t', formatNumber(nf / fps + 0.5 + preroll), '-i', path]);
    // fps directly on the input (a setpts=PTS-STARTPTS before it shifts the clip by up to a source frame), clone-pad
    // against sources a few frames short, exact frame count.
    const shift = preroll > 0 ? `setpts=PTS-${formatNumber(preroll)}/TB,` : '';
    const head = `[${inputIndex}:v]${shift}fps=${fps}:start_time=0,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${nf},setpts=PTS-STARTPTS`;
    const out = newLabel('clip');

    if (!element.varying) {
      // the cell in output px (a column: layerWidth × H; a row: W × layerWidth)
      const { w, h } = layerSize(element.layerWidth);
      const { crop, fit } = getCropForAspect(clip.maxRect, clip.minRect, w / h);
      if (fit === 'fill') {
        filters.push(`${head},${cropFilter(crop)},scale=${w}:${h}:flags=bicubic,setsar=1[${out}]`);
        return { label: out, start: pf0 - f0, end: pf1 - f0 };
      }
      // pillarbox: full height, centred; letterbox: full width, centred. Background: the clip's own blurred cover.
      const fw = fit === 'pillarbox' ? Math.min(w, roundEven((crop.width * h) / crop.height)) : w;
      const fh = fit === 'pillarbox' ? h : Math.min(h, roundEven((crop.height * w) / crop.width));
      const [fg, bg] = [newLabel('fg'), newLabel('bg')];
      if (settings.fill.mode === 'blur') {
        const [a, b] = [newLabel('s'), newLabel('s')];
        filters.push(`${head},${cropFilter(crop)},split[${a}][${b}]`, `[${a}]scale=${fw}:${fh}:flags=bicubic,setsar=1[${fg}]`, `[${b}]${blurCover(w, h)}[${bg}]`);
      } else {
        filters.push(`${head},${cropFilter(crop)},scale=${fw}:${fh}:flags=bicubic,setsar=1[${fg}]`, `${colorSource(fillColor, w, h, nf)}[${bg}]`);
      }
      filters.push(`[${bg}][${fg}]overlay=x=${(w - fw) / 2}:y=${(h - fh) / 2}:shortest=1[${out}]`);
      return { label: out, start: pf0 - f0, end: pf1 - f0 };
    }

    // Column layer: per frame, the crop C(t) for the window width w(t) and its scale; crop the union U once, scale it
    // per frame (scale eval=frame emits variable-size frames, which overlay accepts) and place it so that C(t) lands
    // on the window [0, w(t)).
    const ws = element.ws.slice(pf0 - f0, pf1 - f0);
    // a column appearing/disappearing (width → 0) keeps its full height, cropped by the window, instead of letterboxing
    // (a row, its full width)
    const collapsing = collapsingColumns.has(p.placement.column);
    const per = ws.map((w0) => {
      const { w, h } = layerSize(Math.max(2, w0));
      const { crop, fit } = getCropForAspect(clip.maxRect, clip.minRect, w / h);
      if (fit === 'fill') return { crop, sx: w / crop.width, sy: h / crop.height, ox: 0, oy: 0, covers: true };
      // the window is longer along the main axis than the clip allows (columns: pillarbox; rows: letterbox)
      const mainTooLong = fit === (rows ? 'letterbox' : 'pillarbox');
      // fill the cross axis, centred along the main axis (a collapsing one overflows its window, which crops it), or
      // else fill the main axis, centred across
      const fillCross = mainTooLong || collapsing;
      // the cross axis is the width for rows, the main axis is the width for columns
      const s = fillCross === rows ? w / crop.width : h / crop.height;
      return { crop, sx: s, sy: s, ox: (w - crop.width * s) / 2, oy: (h - crop.height * s) / 2, covers: !mainTooLong && collapsing };
    });
    const ux0 = Math.min(...per.map((q) => q.crop.x));
    const uy0 = Math.min(...per.map((q) => q.crop.y));
    const U: Rect = {
      x: ux0,
      y: uy0,
      width: Math.max(...per.map((q) => q.crop.x + q.crop.width)) - ux0,
      height: Math.max(...per.map((q) => q.crop.y + q.crop.height)) - uy0,
    };
    const sw = per.map((q) => Math.max(2, ceilEven(U.width * q.sx)));
    const sh = per.map((q) => Math.max(2, ceilEven(U.height * q.sy)));
    const ox = per.map((q) => roundEven(q.ox - (q.crop.x - U.x) * q.sx));
    const oy = per.map((q) => roundEven(q.oy - (q.crop.y - U.y) * q.sy));
    const needsBg = per.some((q) => !q.covers);
    const [sc, base] = [newLabel('sc'), newLabel('base')];
    const scale = `scale=w=${stepExpr(sw, fps)}:h=${stepExpr(sh, fps)}:eval=frame:flags=bicubic,setsar=1`;
    if (needsBg && settings.fill.mode === 'blur') {
      const [a, b] = [newLabel('s'), newLabel('s')];
      const layer = layerSize(element.layerWidth);
      filters.push(`${head},${cropFilter(U)},split[${a}][${b}]`, `[${b}]${blurCover(layer.w, layer.h)}[${base}]`, `[${a}]${scale}[${sc}]`);
    } else {
      filters.push(`${head},${cropFilter(U)},${scale}[${sc}]`, `${colorLayer(needsBg ? fillColor : 'black', element.layerWidth, nf)}[${base}]`);
    }
    filters.push(`[${base}][${sc}]overlay=x=${stepExpr(ox, fps)}:y=${stepExpr(oy, fps)}:eval=frame:shortest=1[${out}]`);
    return { label: out, start: pf0 - f0, end: pf1 - f0 };
  };

  // Chain the segments of a column: xfade where they overlap (clip replacement, or a clip fading into fill at the end
  // of the video), concat where they just touch. All layers of a column have the same size, as xfade requires.
  const chainSegments = (segments: Segment[]) => {
    let cur = segments[0]!.label;
    const colStart = segments[0]!.start;
    let curEnd = segments[0]!.end;
    for (const next of segments.slice(1)) {
      const out = newLabel('x');
      const overlap = curEnd - next.start;
      invariant(overlap >= 0, 'Gap between clips of a column');
      filters.push(overlap > 0
        ? `[${cur}][${next.label}]xfade=transition=${transitionType}:duration=${sec(overlap)}:offset=${sec(next.start - colStart)}[${out}]`
        : `[${cur}][${next.label}]concat=n=2:v=1:a=0[${out}]`);
      cur = out;
      curEnd = next.end;
    }
    if (colStart > 0) {
      // not expected with a valid plan (columns start with their chunk): pad with frames the next layer hides anyway
      const out = newLabel('d');
      filters.push(`[${cur}]tpad=start=${colStart}:color=black[${out}]`);
      cur = out;
    }
    return cur;
  };

  // columns: their clips, and the fill they fade into when their last clip ends at the end of the video
  for (const e of elements.filter((el) => el.kind === 'column')) {
    const segments: Segment[] = placementsByColumn.get(e.column!)!.map((p) => buildClipLayer(p, e));
    const lastPlacement = placementsByColumn.get(e.column!)!.at(-1)!;
    if (lastPlacement.endsInFill && lastPlacement.f1 < f1) {
      const start = Math.max(0, lastPlacement.f1 - lastPlacement.fadeOutFrames - f0);
      const last = segments.at(-1)!;
      const source = pickSource(e.xs.at(-1)!, e.ws.at(-1)!);
      segments.push({ label: buildFillLayer(e.layerWidth, start, N, source), start: Math.min(start, last.end), end: N });
    }
    e.label = chainSegments(segments);
  }

  // fill areas: row edges and columns whose clips have all ended
  for (const e of elements.filter((el) => el.kind === 'fill')) {
    e.label = buildFillLayer(Math.max(1, e.layerWidth), 0, N, pickSource(e.xs[0]!, e.layerWidth));
  }

  // split the columns used as blur sources
  for (const [source, labels] of sourceRequests) {
    const main = newLabel('m');
    filters.push(`[${source.label}]split=${labels.length + 1}[${main}]${labels.map((l) => `[${l}]`).join('')}`);
    source.label = main;
  }

  // canvas in the gap colour; elements left to right (each one hides the excess of the previous layer)
  let cv = newLabel('cv');
  filters.push(`${colorSource(gapColor, W, H, N)},format=yuv420p[${cv}]`);
  /** Overlay at per-frame offsets along the main axis. */
  const overlayAt = (label: string, xs: number[], extra: string) => {
    const out = newLabel('cv');
    const offset = stepExpr(xs, fps);
    const position = rows ? `x=0:y=${offset}` : `x=${offset}:y=0`;
    filters.push(`[${cv}][${label}]overlay=${position}${offset.startsWith("'") ? ':eval=frame' : ''}${extra}[${out}]`);
    cv = out;
  };
  const anyVarying = elements.some((e) => e.varying);
  const position = (e: Element) => (e.varying || e.xs.some((x) => Math.abs(x - e.xs[0]!) > 1e-6) ? e.xs.map((x) => roundEven(x)) : e.xs.map((x) => Math.round(x)));
  for (const e of elements) {
    invariant(e.label != null);
    overlayAt(e.label, position(e), e.kind === 'column' ? ':eof_action=pass' : '');
  }

  // Gap bars: while layers are wider than their window they cover the gaps, so the gaps are redrawn on top between
  // every two neighbouring layout columns: at the right edge of the left one, or just left of the right one when a fill
  // opens between them (getFillSpansAtFrame). A column past W takes its bar out of the frame with it.
  if (anyVarying && settings.gap.width > 0) {
    const layoutColumns = elements.filter((e) => e.column != null);
    for (const [i, e] of layoutColumns.slice(0, -1).entries()) {
      const next = layoutColumns[i + 1];
      invariant(next != null);
      const bar = newLabel('gap');
      filters.push(`${colorLayer(gapColor, settings.gap.width, N)}[${bar}]`);
      overlayAt(bar, e.xs.map((x, n) => roundEven(Math.max(x + e.ws[n]!, next.xs[n]! - settings.gap.width))), '');
    }
  }

  // Overlays over the composed frame and under the global fade, which also fades them (T20)
  if (overlays != null) {
    const res = buildOverlayFilters(overlays, { width: W, height: H, fps, f0, f1, firstInput: inputs.length, newLabel }, cv);
    inputs.push(...res.inputs);
    filters.push(...res.filters);
    cv = res.cv;
  }

  // Global fade from/to black: a black layer whose alpha ramps over the first/last D seconds of the video. Built in
  // frames (fade start_frame/nb_frames, trim) so a fade split across chunks stays exact.
  const fadeFrames = Math.min(Math.round(settings.transition.duration * fps), tl.totalFrames);
  if (settings.fadeInOut && fadeFrames > 0) {
    const fadeLayer = (type: 'in' | 'out', rampStart: number, from: number, to: number) => {
      if (to <= from) return;
      const g0 = Math.min(from, rampStart);
      const out = newLabel('fade');
      filters.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${sec(to - g0 + 1)},format=yuva420p,fade=t=${type}:start_frame=${rampStart - g0}:nb_frames=${fadeFrames}:alpha=1,trim=start_frame=${from - g0}:end_frame=${to - g0},setpts=PTS-STARTPTS[${out}]`);
      const cvOut = newLabel('cv');
      // starts at the chunk start, so it only needs to be timed at its end
      filters.push(`[${cv}][${out}]overlay=x=0:y=0:eof_action=pass[${cvOut}]`);
      cv = cvOut;
    };
    // fade in: alpha 1 → 0 over [0, fadeFrames); fade out: alpha 0 → 1 over [total − fadeFrames, total)
    fadeLayer('out', 0, f0, Math.min(f1, fadeFrames));
    const outStart = tl.totalFrames - fadeFrames;
    if (f1 > outStart) fadeLayer('in', outStart, f0, f1);
  }

  filters.push(`[${cv}]format=yuv420p[vout]`);
  return { inputs, filterComplex: filters.join(';\n'), outLabel: 'vout', frames: N };
}
