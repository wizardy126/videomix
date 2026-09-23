/* eslint-disable no-continue, no-mixed-operators, no-plusplus, no-shadow, no-use-before-define, object-property-newline, quotes, unicorn/consistent-existence-index-check, unicorn/no-array-push-push, unicorn/no-process-exit, unicorn/no-zero-fractions, unicorn/prefer-string-raw */
// Throwaway T09 prototype, excluded from lint on purpose (task-doc T09 allows it); it still type-checks.
// T09 spike (ADR-001): prototype of the VideoMix render graph. NOT production code (that is T11/T12/T13).
//
// It takes a hand-written MixPlan-like structure (same shape as 04-diseno §3.1) and generates ffmpeg commands:
// - "chunked": the video is cut into blocks at instants without active transitions (and always at the start/end of
//   every animated re-layout), each block is rendered with its own filter graph, blocks are joined with the concat
//   demuxer (-c copy) and muxed with an audio track rendered in a separate pass.
// - "full": one single filter_complex for the whole video (video + audio).
//
// Usage (from the repo root): node script/videomix/spike/renderSpike.ts <scenario> [options]
// Scenarios: sources | static | sync | relayout | fill | example | blur-bench | mask-bench | argv-bench
// | perf [preset] [chunked|full|both] [concurrency]  (NULL_OUT=1 with "full": decode + filters only)
// Outputs go to test-media/spike-out/ (git-ignored). See docs/videomix/decisiones/ADR-001-render.md.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const ffDir = join('ffmpeg', `${os.platform()}-${os.arch()}`, 'lib');
const ffmpegPath = process.env['FFMPEG_PATH'] ?? join(ffDir, 'ffmpeg');
const ffprobePath = process.env['FFPROBE_PATH'] ?? join(ffDir, 'ffprobe');
const ffEnv = { ...process.env, LD_LIBRARY_PATH: ffDir };
const outDir = join('test-media', 'spike-out');
const srcDir = join(outDir, 'src');

// ---------------------------------------------------------------------------------------------------------------
// Model (subset of 04-diseno §1 / §3.1)

interface Rect { x: number, y: number, width: number, height: number }
interface Source { path: string, width: number, height: number, hasAudio: boolean }
interface Clip { id: string, source: Source, start: number, end: number, maxRect: Rect, minRect?: Rect | undefined, muted?: boolean }
interface ColumnPlacement { clipId: string, column: number, startTime: number, endTime: number }
interface LayoutColumn { column: number, x: number, width: number }
interface Fill { x: number, width: number }
interface LayoutKeyframe { time: number, transitionDuration: number, columns: LayoutColumn[], fills: Fill[] }
interface MixPlan { width: number, height: number, duration: number, placements: ColumnPlacement[], layouts: LayoutKeyframe[] }
interface Settings {
  fps: number,
  gap: { width: number, color: string },
  transition: { type: string, duration: number },
  fadeInOut: boolean,
  fill: 'blur' | 'color',
  fillColor: string,
  crf: number,
  preset: string,
  music?: { path: string, volumeDb: number, loop: boolean } | undefined,
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry: minimal copy of getCropForAspect (src/renderer/src/videomix/geometry.ts). Node can't import that module
// directly (extensionless imports), T11 must use the real one. `even: false` gives the real-valued crop we use for
// the per-frame animation math (smoother than rounding each frame).

type Fit = 'fill' | 'pillarbox' | 'letterbox';
const roundEven = (v: number) => 2 * Math.round(v / 2);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function getCrop(maxRect: Rect, minRect: Rect | undefined, aspect: number, even = true): { crop: Rect, fit: Fit } {
  const max = maxRect;
  const min = minRect ?? maxRect;
  const r = (v: number) => (even ? roundEven(v) : v);
  const range = { min: min.width / max.height, max: max.width / min.height, preferred: max.width / max.height };
  let fit: Fit = 'fill';
  let width: number;
  let height: number;
  if (aspect >= range.max) {
    if (aspect > range.max * 1.01) fit = 'pillarbox';
    width = max.width;
    height = min.height;
  } else if (aspect <= range.min) {
    if (aspect < range.min * 0.99) fit = 'letterbox';
    width = min.width;
    height = max.height;
  } else if (aspect <= range.preferred) {
    height = max.height;
    width = clamp(r(aspect * height), min.width, max.width);
  } else {
    width = max.width;
    height = clamp(r(width / aspect), min.height, max.height);
  }
  const place = (minStart: number, minSize: number, maxStart: number, maxSize: number, size: number) => (
    clamp(r(minStart + (minSize - size) / 2), maxStart, maxStart + maxSize - size)
  );
  return {
    crop: { x: place(min.x, min.width, max.x, max.width, width), y: place(min.y, min.height, max.y, max.height, height), width, height },
    fit,
  };
}

const smoothstep = (p: number) => p * p * (3 - 2 * p);
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

// ---------------------------------------------------------------------------------------------------------------
// Layout at a given time

interface ColGeom { x: number, width: number }

function keyframeIndexAt(plan: MixPlan, t: number) {
  let k = 0;
  for (let i = 0; i < plan.layouts.length; i += 1) if (plan.layouts[i]!.time <= t + 1e-9) k = i;
  return k;
}

// x where a column that is missing from `layout` collapses to (width 0): just left of its right neighbour
function collapseX(layout: LayoutKeyframe, other: LayoutKeyframe, column: number, plan: MixPlan, gap: number) {
  const order = [...other.columns].sort((a, b) => a.x - b.x);
  const idx = order.findIndex((c) => c.column === column);
  for (const c of order.slice(idx + 1)) {
    const found = layout.columns.find((lc) => lc.column === c.column);
    if (found) return found.x - gap;
  }
  return plan.width;
}

function columnsAt(plan: MixPlan, gap: number, t: number): Map<number, ColGeom> {
  const k = keyframeIndexAt(plan, t);
  const kf = plan.layouts[k]!;
  const res = new Map<number, ColGeom>();
  if (k > 0 && kf.transitionDuration > 0 && t < kf.time + kf.transitionDuration) {
    const prev = plan.layouts[k - 1]!;
    const p = smoothstep((t - kf.time) / kf.transitionDuration);
    const ids = new Set([...prev.columns, ...kf.columns].map((c) => c.column));
    for (const id of ids) {
      const a = prev.columns.find((c) => c.column === id) ?? { x: collapseX(prev, kf, id, plan, gap), width: 0 };
      const b = kf.columns.find((c) => c.column === id) ?? { x: collapseX(kf, prev, id, plan, gap), width: 0 };
      res.set(id, { x: lerp(a.x, b.x, p), width: lerp(a.width, b.width, p) });
    }
    return res;
  }
  for (const c of kf.columns) res.set(c.column, { x: c.x, width: c.width });
  // A column whose clip still plays but that is no longer in the layout (end of video: it becomes fill) keeps its
  // previous geometry until the clip ends; the fill fades in on top of it.
  if (k > 0) for (const c of plan.layouts[k - 1]!.columns) if (!res.has(c.column)) res.set(c.column, { x: c.x, width: c.width });
  return res;
}

function fillsAt(plan: MixPlan, D: number, t: number): (Fill & { alpha: number })[] {
  const k = keyframeIndexAt(plan, t);
  const res = plan.layouts[k]!.fills.map((f) => ({ ...f, alpha: 1 }));
  const next = plan.layouts[k + 1];
  // instant keyframe (end of video): new fills fade in during the D seconds before it
  if (next && next.transitionDuration === 0 && t >= next.time - D) {
    for (const f of next.fills) {
      if (!res.some((r) => r.x === f.x && r.width === f.width)) res.push({ ...f, alpha: clamp((t - (next.time - D)) / D, 0, 1) });
    }
  }
  return res;
}

// ---------------------------------------------------------------------------------------------------------------
// Chunking

interface Interval { start: number, end: number, anim: boolean }

function getChunks(plan: MixPlan, settings: Settings, maxChunkSec: number): [number, number][] {
  const { fps } = settings;
  const D = settings.transition.duration;
  const busy: Interval[] = [];
  for (const p of plan.placements) if (p.startTime > 0) busy.push({ start: p.startTime, end: p.startTime + D, anim: false });
  for (const kf of plan.layouts.slice(1)) {
    if (kf.transitionDuration > 0) busy.push({ start: kf.time, end: kf.time + kf.transitionDuration, anim: true });
    else busy.push({ start: kf.time - D, end: kf.time, anim: false });
  }
  busy.sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const b of busy) {
    const last = merged.at(-1);
    if (last && b.start <= last.end + 1e-6) {
      last.end = Math.max(last.end, b.end);
      last.anim ||= b.anim;
    } else merged.push({ ...b });
  }
  const totalFrames = Math.round(plan.duration * fps);
  const toFrame = (t: number) => Math.round(t * fps);
  const cuts = new Set<number>([0, totalFrames]);
  // mandatory cuts: around animated components, so that stable blocks have constant column widths (exact xfades)
  for (const m of merged) if (m.anim) { cuts.add(toFrame(m.start)); cuts.add(toFrame(m.end)); }
  // optional cuts in long stable spans, at frames outside any busy interval
  const isFree = (f: number) => merged.every((m) => f <= toFrame(m.start) || f >= toFrame(m.end));
  const sorted = [...cuts].sort((a, b) => a - b);
  const maxFrames = Math.round(maxChunkSec * fps);
  for (let i = 0; i < sorted.length - 1; i += 1) {
    let from = sorted[i]!;
    const to = sorted[i + 1]!;
    while (to - from > maxFrames) {
      let f = from + maxFrames;
      while (f > from && !isFree(f)) f -= 1;
      if (f === from) break;
      cuts.add(f);
      from = f;
    }
  }
  const all = [...cuts].sort((a, b) => a - b);
  return all.slice(0, -1).map((f, i) => [f, all[i + 1]!]);
}

// ---------------------------------------------------------------------------------------------------------------
// Graph building

const fmt = (v: number) => String(Math.round(v * 10_000) / 10_000);

// Piecewise-constant expression over local time t, from per-frame samples (frame m shown at t = m / fps).
// Flat sum of steps (v0 + Δ1·gte(t,T1) + …): ffmpeg's expression parser rejects nesting deeper than ~98 levels, so a
// nested if() chain breaks on long chunks (measured: 90 levels ok, 99 fail); the flat sum was tested with 2000 terms.
function stepExpr(values: number[], fps: number) {
  const terms: string[] = [String(values[0]!)];
  for (let m = 1; m < values.length; m += 1) {
    const d = values[m]! - values[m - 1]!;
    if (d !== 0) terms.push(`${d > 0 ? '+' : ''}${d}*gte(t,${fmt((m - 0.5) / fps)})`);
  }
  return terms.length > 1 ? `'${terms.join('')}'` : terms[0]!;
}

// Blurred "cover" of the input (used for pillarbox/letterbox and for end fills). Cheap: blur at 1/8 resolution.
function blurCover(w: number, h: number) {
  const sw = Math.max(2, roundEven(w / 8));
  const sh = Math.max(2, roundEven(h / 8));
  return `scale=${sw}:${sh}:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=${sw}:${sh},boxblur=luma_radius=6:luma_power=2,scale=${w}:${h}:flags=bilinear,setsar=1`;
}

interface BuildResult { inputs: string[][], filter: string[], videoOut: string, audioOut?: string | undefined, frames: number }

function buildVideoGraph({ plan, clips, settings, f0, f1, forceGeneric = false, withAudio = false }: {
  plan: MixPlan, clips: Map<string, Clip>, settings: Settings, f0: number, f1: number, forceGeneric?: boolean, withAudio?: boolean,
}): BuildResult {
  const { fps, gap } = settings;
  const D = settings.transition.duration;
  const W = plan.width;
  const H = plan.height;
  const nFrames = f1 - f0;
  const chunkDur = nFrames / fps;
  const inputs: string[][] = [];
  const filter: string[] = [];
  let labelN = 0;
  const label = (p: string) => `${p}${labelN++}`;

  const frameTimes = Array.from({ length: nFrames }, (_v, n) => (f0 + n) / fps);
  const geoms = frameTimes.map((t) => columnsAt(plan, gap.width, t));
  // columns that disappear inside the chunk (full-graph mode) keep their last known geometry
  for (let n = 1; n < geoms.length; n += 1) for (const [col, g] of geoms[n - 1]!) if (!geoms[n]!.has(col)) geoms[n]!.set(col, { x: g.x + g.width, width: 0 });

  // placements overlapping the chunk, per column
  const byColumn = new Map<number, ColumnPlacement[]>();
  for (const p of plan.placements) {
    if (Math.round(p.endTime * fps) <= f0 || Math.round(p.startTime * fps) >= f1) continue;
    byColumn.set(p.column, [...(byColumn.get(p.column) ?? []), p].sort((a, b) => a.startTime - b.startTime));
  }

  // column order (left→right) at the start of the chunk; stacking order for the left-anchored layers
  const columnIds = [...byColumn.keys()].sort((a, b) => geoms[0]!.get(a)!.x - geoms[0]!.get(b)!.x);

  const placementInput = new Map<ColumnPlacement, number>();
  const columnOut = new Map<number, string>();
  const columnGeneric = new Map<number, boolean>();
  const columnLayerW = new Map<number, number>();

  for (const col of columnIds) {
    const widths = geoms.map((g) => g.get(col)?.width ?? 0);
    const generic = forceGeneric || widths.some((w) => Math.abs(w - widths[0]!) > 1e-6);
    columnGeneric.set(col, generic);
    const layerW = generic ? roundEven(Math.max(...widths) + 1) : widths[0]!;
    columnLayerW.set(col, layerW);

    const clipLabels: { label: string, startLocal: number }[] = [];
    for (const p of byColumn.get(col)!) {
      const clip = clips.get(p.clipId)!;
      const pf0 = Math.max(Math.round(p.startTime * fps), f0);
      const pf1 = Math.min(Math.round(p.endTime * fps), f1);
      const nf = pf1 - pf0;
      const seek = clip.start + Math.max(0, pf0 / fps - p.startTime);
      const inputIndex = inputs.length;
      placementInput.set(p, inputIndex);
      // Seek a bit earlier (preroll) and shift back: with -ss, ffmpeg drops the frame that is still on screen at the
      // seek point (its pts is before it), so the first output frame of a block would show the next source frame.
      const preroll = Math.min(0.1, seek);
      inputs.push(['-ss', fmt(seek - preroll), '-t', fmt(nf / fps + 0.5 + preroll), '-i', clip.source.path]);
      const out = label('c');
      // common head: timestamps from 0, common fps, exact frame count (tpad protects against short sources)
      const head = `[${inputIndex}:v]setpts=PTS-${fmt(preroll)}/TB,fps=${fps}:start_time=0,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${nf},setpts=PTS-STARTPTS`;
      if (!generic) {
        const w = widths[0]!;
        const { crop, fit } = getCrop(clip.maxRect, clip.minRect, w / H);
        const cropF = `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`;
        if (fit === 'fill') {
          filter.push(`${head},${cropF},scale=${w}:${H}:flags=bicubic,setsar=1[${out}]`);
        } else {
          const [fg, bg, a, b] = [label('fg'), label('bg'), label('s'), label('s')];
          const size = fit === 'pillarbox'
            ? { w: roundEven(crop.width * H / crop.height), h: H }
            : { w, h: roundEven(crop.height * w / crop.width) };
          filter.push(`${head},${cropF},split[${a}][${b}]`);
          filter.push(`[${a}]scale=${size.w}:${size.h}:flags=bicubic,setsar=1[${fg}]`);
          filter.push(settings.fill === 'blur' ? `[${b}]${blurCover(w, H)}[${bg}]` : `[${b}]nullsink;color=c=${settings.fillColor}:s=${w}x${H}:r=${fps}:d=${fmt(nf / fps)}[${bg}]`);
          filter.push(`[${bg}][${fg}]overlay=x=${(w - size.w) / 2}:y=${(H - size.h) / 2}[${out}]`);
        }
      } else {
        // Generic (animated) path: crop the union of all per-frame crops once, scale it per frame (scale eval=frame
        // outputs variable-size frames) and place it with overlay onto a fixed-size base of the column's max width.
        // The result is left-anchored: the visible window of the column is [0, w(t)) of this layer.
        const per = Array.from({ length: nf }, (_v, m) => {
          const w = Math.max(2, geoms[pf0 - f0 + m]!.get(col)!.width);
          const { crop, fit } = getCrop(clip.maxRect, clip.minRect, w / H, false);
          const s = H / crop.height; // always fill the height while animating (pillarbox: centered, blurred sides)
          return { w, crop, fit, s };
        });
        const ux0 = Math.max(clip.maxRect.x, 2 * Math.floor(Math.min(...per.map((q) => q.crop.x)) / 2));
        const uy0 = Math.max(clip.maxRect.y, 2 * Math.floor(Math.min(...per.map((q) => q.crop.y)) / 2));
        const ux1 = Math.min(clip.maxRect.x + clip.maxRect.width, 2 * Math.ceil(Math.max(...per.map((q) => q.crop.x + q.crop.width)) / 2));
        const uy1 = Math.min(clip.maxRect.y + clip.maxRect.height, 2 * Math.ceil(Math.max(...per.map((q) => q.crop.y + q.crop.height)) / 2));
        const U = { x: ux0, y: uy0, width: ux1 - ux0, height: uy1 - uy0 };
        const sw = per.map((q) => roundEven(U.width * q.s));
        const sh = per.map((q) => roundEven(U.height * q.s));
        const ox = per.map((q) => Math.round((q.w - q.crop.width * q.s) / 2 - (q.crop.x - U.x) * q.s));
        const oy = per.map((q) => Math.round((H - q.crop.height * q.s) / 2 - (q.crop.y - U.y) * q.s));
        const needsBg = per.some((q) => q.fit !== 'fill' || q.w < 4);
        const [sc, base] = [label('sc'), label('base')];
        const cropF = `crop=${U.width}:${U.height}:${U.x}:${U.y}`;
        const scaleF = `scale=w=${stepExpr(sw, fps)}:h=${stepExpr(sh, fps)}:eval=frame:flags=bicubic,setsar=1`;
        if (needsBg && settings.fill === 'blur') {
          const [a, b] = [label('s'), label('s')];
          filter.push(`${head},${cropF},split[${a}][${b}]`);
          filter.push(`[${b}]${blurCover(layerW, H)}[${base}]`);
          filter.push(`[${a}]${scaleF}[${sc}]`);
        } else {
          filter.push(`${head},${cropF},${scaleF}[${sc}]`);
          filter.push(`color=c=${needsBg ? settings.fillColor : 'black'}:s=${layerW}x${H}:r=${fps}:d=${fmt(nf / fps)}[${base}]`);
        }
        filter.push(`[${base}][${sc}]overlay=x=${stepExpr(ox, fps)}:y=${stepExpr(oy, fps)}:eval=frame:shortest=1[${out}]`);
      }
      clipLabels.push({ label: out, startLocal: (pf0 - f0) / fps });
    }

    // xfade chain inside the column (all layers of a column have the same size)
    let cur = clipLabels[0]!.label;
    const colStart = clipLabels[0]!.startLocal;
    for (const next of clipLabels.slice(1)) {
      const o = label('x');
      filter.push(`[${cur}][${next.label}]xfade=transition=${settings.transition.type}:duration=${D}:offset=${fmt(next.startLocal - colStart)}[${o}]`);
      cur = o;
    }
    if (colStart > 0) {
      const o = label('d');
      filter.push(`[${cur}]setpts=PTS+${fmt(colStart)}/TB[${o}]`);
      cur = o;
    }
    columnOut.set(col, cur);
  }

  // fills present in this chunk (static geometry), each with the adjacent column as blur source
  const fillSet = new Map<string, Fill>();
  frameTimes.forEach((t) => fillsAt(plan, D, t).forEach((f) => fillSet.set(`${f.x}:${f.width}`, f)));
  const fills = [...fillSet.values()].map((f) => {
    const lastGeom = geoms.at(-1)!;
    let best = columnIds[0]!;
    let bestDist = Infinity;
    for (const col of columnIds) {
      const g = lastGeom.get(col);
      if (!g || g.width <= 0) continue;
      const dist = Math.min(Math.abs(g.x - (f.x + f.width)), Math.abs(f.x - (g.x + g.width)));
      if (dist < bestDist) { bestDist = dist; best = col; }
    }
    const alphas = frameTimes.map((t) => fillsAt(plan, D, t).find((ff) => ff.x === f.x && ff.width === f.width)?.alpha ?? 0);
    return { fill: f, source: best, alphas };
  });
  const fillSourceCount = new Map<number, number>();
  for (const f of fills) fillSourceCount.set(f.source, (fillSourceCount.get(f.source) ?? 0) + 1);
  const fillSourceLabels = new Map<number, string[]>();
  for (const [col, count] of fillSourceCount) {
    const main = label('m');
    const extra = Array.from({ length: count }, () => label('fs'));
    filter.push(`[${columnOut.get(col)}]split=${count + 1}[${main}]${extra.map((e) => `[${e}]`).join('')}`);
    columnOut.set(col, main);
    fillSourceLabels.set(col, extra);
  }

  // canvas: background = gap colour; columns left→right (left-anchored layers: each one hides the excess of the
  // previous one); then gap bars (only needed when layers are wider than their window) and fills on top
  let cv = label('cv');
  filter.push(`color=c=${gap.color}:s=${W}x${H}:r=${fps}:d=${fmt(chunkDur)},format=yuv420p[${cv}]`);
  const anyGeneric = [...columnGeneric.values()].some(Boolean);
  for (const col of columnIds) {
    const xs = geoms.map((g) => roundEven(g.get(col)?.x ?? 0));
    const o = label('cv');
    filter.push(`[${cv}][${columnOut.get(col)}]overlay=x=${stepExpr(xs, fps)}:y=0:eval=${columnGeneric.get(col) ? 'frame' : 'init'}:eof_action=pass[${o}]`);
    cv = o;
  }
  if (anyGeneric && gap.width > 0) {
    for (let i = 0; i < columnIds.length - 1; i += 1) {
      const col = columnIds[i]!;
      const xs = geoms.map((g) => { const c = g.get(col)!; return roundEven(c.x + c.width); });
      const [bar, o] = [label('gap'), label('cv')];
      filter.push(`color=c=${gap.color}:s=${gap.width}x${H}:r=${fps}:d=${fmt(chunkDur)}[${bar}]`);
      filter.push(`[${cv}][${bar}]overlay=x=${stepExpr(xs, fps)}:y=0:eval=frame[${o}]`);
      cv = o;
    }
  }
  for (const f of fills) {
    const src = fillSourceLabels.get(f.source)!.shift()!;
    const [fl, o] = [label('fill'), label('cv')];
    const fadeStart = f.alphas.findIndex((a) => a > 0);
    const fullAt = f.alphas.findIndex((a) => a >= 1);
    const needsFade = fadeStart >= 0 && fullAt > fadeStart;
    const src2 = settings.fill === 'blur'
      ? `[${src}]${blurCover(f.fill.width, H)}`
      : `[${src}]nullsink;color=c=${settings.fillColor}:s=${f.fill.width}x${H}:r=${fps}:d=${fmt(chunkDur)}`;
    const fade = needsFade ? `,format=yuva420p,fade=t=in:st=${fmt(Math.max(0, fadeStart - 1) / fps)}:d=${fmt((fullAt - fadeStart + 1) / fps)}:alpha=1` : '';
    filter.push(`${src2}${fade}[${fl}]`);
    filter.push(`[${cv}][${fl}]overlay=x=${f.fill.x}:y=0:eof_action=repeat${fadeStart > 0 && !needsFade ? `:enable='gte(t,${fmt(fadeStart / fps)})'` : ''}[${o}]`);
    cv = o;
  }

  const total = Math.round(plan.duration * fps);
  const post: string[] = [];
  if (settings.fadeInOut && f0 === 0) post.push(`fade=t=in:st=0:d=${D}`);
  if (settings.fadeInOut && f1 === total) post.push(`fade=t=out:st=${fmt(chunkDur - D)}:d=${D}`);
  post.push('format=yuv420p');
  filter.push(`[${cv}]${post.join(',')}[vout]`);

  let audioOut: string | undefined;
  if (withAudio) {
    // full-graph mode: audio from the same inputs (only valid when f0 = 0 and f1 = end)
    const audio = buildAudioFilter({ plan, clips, settings, inputIndexOf: (i) => placementInput.get(plan.placements[i]!)!, inputsForAudio: inputs });
    filter.push(...audio.filter);
    audioOut = audio.out;
  }
  return { inputs, filter, videoOut: 'vout', audioOut, frames: nFrames };
}

// ---------------------------------------------------------------------------------------------------------------
// Audio (04-diseno §5.2, minimal): per clip gain + afade + adelay, amix normalize=0, compensation for the number of
// simultaneous sources, optional looped music, limiter and global fades. Rendered as a separate pass when chunking.

function buildAudioFilter({ plan, clips, settings, inputIndexOf, inputsForAudio }: {
  plan: MixPlan, clips: Map<string, Clip>, settings: Settings,
  inputIndexOf: (placementIdx: number) => number,
  inputsForAudio: string[][],
}) {
  const D = settings.transition.duration;
  const filter: string[] = [];
  const labels: string[] = [];
  const audible: ColumnPlacement[] = [];
  plan.placements.forEach((p, i) => {
    const clip = clips.get(p.clipId)!;
    if (!clip.source.hasAudio || clip.muted) return;
    const dur = p.endTime - p.startTime;
    const l = `a${i}`;
    const fadeIn = p.startTime > 0 ? `afade=t=in:d=${D},` : '';
    const fadeOut = p.endTime < plan.duration ? `afade=t=out:st=${fmt(dur - D)}:d=${D},` : '';
    filter.push(`[${inputIndexOf(i)}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${fmt(dur)},volume=0dB,${fadeIn}${fadeOut}adelay=${Math.round(p.startTime * 1000)}:all=1[${l}]`);
    labels.push(`[${l}]`);
    audible.push(p);
  });
  // compensation: -10·log10(n) dB, n = number of audible clips; linear ramps of D seconds at each change
  const events = [...new Set(audible.flatMap((p) => [p.startTime, p.endTime]))].sort((a, b) => a - b);
  const nAt = (t: number) => audible.filter((p) => p.startTime <= t && t < p.endTime).length;
  const gainAt = (t: number) => { const n = nAt(t); return n > 1 ? 10 ** (-Math.log10(n) / 2) : 1; }; // amplitude = 1/sqrt(n)
  let expr = fmt(gainAt(plan.duration - 1e-3));
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const t = events[i]!;
    const before = gainAt(t - 1e-3);
    const after = gainAt(t + D / 2);
    expr = `if(lt(t,${fmt(t)}),${fmt(before)},if(lt(t,${fmt(t + D)}),${fmt(before)}+(${fmt(after - before)})*(t-${fmt(t)})/${D},${expr}))`;
  }
  filter.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,volume='${expr}':eval=frame[clipsmix]`);
  let mix = 'clipsmix';
  if (settings.music) {
    const idx = inputsForAudio.length;
    inputsForAudio.push([...(settings.music.loop ? ['-stream_loop', '-1'] : []), '-i', settings.music.path]);
    const fadeLen = Math.max(2, D);
    filter.push(`[${idx}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${fmt(plan.duration)},volume=${settings.music.volumeDb}dB,afade=t=out:st=${fmt(plan.duration - fadeLen)}:d=${fadeLen}[music]`);
    filter.push(`[clipsmix][music]amix=inputs=2:normalize=0:duration=first[withmusic]`);
    mix = 'withmusic';
  }
  const fades = settings.fadeInOut ? `,afade=t=in:d=${D},afade=t=out:st=${fmt(plan.duration - D)}:d=${D}` : '';
  filter.push(`[${mix}]atrim=duration=${fmt(plan.duration)},alimiter=limit=0.95:level=disabled${fades}[aout]`);
  return { filter, out: 'aout' };
}

// ---------------------------------------------------------------------------------------------------------------
// Running

interface Measure { exitCode: number, wallSec: number, cpuSec: number, maxRssMb: number }

function runFfmpeg(args: string[], { log = false } = {}): Measure {
  const res = spawnSync('python3', [join('script', 'videomix', 'spike', 'measure.py'), ffmpegPath, '-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], { env: ffEnv, encoding: 'utf8', maxBuffer: 1e8 });
  const m = /MEASURE (.*)/.exec(res.stderr);
  if (!m || res.status !== 0) {
    console.error(res.stderr.slice(-4000));
    throw new Error(`ffmpeg failed (${res.status})`);
  }
  if (log) console.log(res.stderr.replace(/MEASURE .*\n?/, ''));
  return JSON.parse(m[1]!) as Measure;
}

function runFfmpegAsync(args: string[]): Promise<Measure> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [join('script', 'videomix', 'spike', 'measure.py'), ffmpegPath, '-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], { env: ffEnv });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => {
      const m = /MEASURE (.*)/.exec(stderr);
      if (!m || code !== 0) { console.error(stderr.slice(-4000)); reject(new Error(`ffmpeg failed (${code})`)); return; }
      resolve(JSON.parse(m[1]!) as Measure);
    });
  });
}

function ffprobe(args: string[]) {
  return spawnSync(ffprobePath, ['-v', 'error', ...args], { env: ffEnv, encoding: 'utf8', maxBuffer: 1e8 }).stdout;
}

// Writes the graph to a file and passes it with -/filter_complex (ffmpeg ≥ 7; avoids OS argv limits, e.g. 32767
// chars on Windows). Returns the argv that ffmpeg receives.
function graphArgs(res: BuildResult, name: string) {
  const graphPath = join(outDir, `${name}.graph.txt`);
  writeFileSync(graphPath, res.filter.join(';\n'));
  return { graphPath, args: [...res.inputs.flat(), '-/filter_complex', graphPath] };
}

function encodeArgs(settings: Settings) {
  return ['-c:v', 'libx264', '-preset', settings.preset, '-crf', String(settings.crf), '-pix_fmt', 'yuv420p', '-r', String(settings.fps)];
}

async function renderChunked(name: string, plan: MixPlan, clips: Map<string, Clip>, settings: Settings, { maxChunkSec = 15, concurrency = 1 } = {}) {
  const dir = join(outDir, `${name}-chunks`);
  mkdirSync(dir, { recursive: true });
  const chunks = getChunks(plan, settings, maxChunkSec);
  const totalFrames = Math.round(plan.duration * settings.fps);
  console.log(`${name}: ${chunks.length} chunks, concurrency ${concurrency}`, chunks.map(([a, b]) => `${fmt(a / settings.fps)}–${fmt(b / settings.fps)}`).join(' '));
  const stats: (Measure & { chunk: string, frames: number, graphChars: number, inputs: number })[] = [];
  const list = chunks.map((_c, i) => `file 'chunk-${String(i).padStart(3, '0')}.mp4'`);
  let doneFrames = 0;
  const started = performance.now();
  const renderOne = async (i: number) => {
    const [f0, f1] = chunks[i]!;
    const res = buildVideoGraph({ plan, clips, settings, f0, f1 });
    const file = join(dir, `chunk-${String(i).padStart(3, '0')}.mp4`);
    const { args } = graphArgs(res, `${name}-chunk-${i}`);
    const m = await runFfmpegAsync([...args, '-map', `[${res.videoOut}]`, '-frames:v', String(res.frames), ...encodeArgs(settings), '-an', file]);
    doneFrames += res.frames;
    // progress = frames of finished chunks (+ frame= of the running ones, from -progress) / total frames
    stats.push({ ...m, chunk: `${fmt(f0 / settings.fps)}-${fmt(f1 / settings.fps)}`, frames: res.frames, graphChars: res.filter.join(';').length, inputs: res.inputs.length });
    console.log(`  chunk ${i} ${fmt(f0 / settings.fps)}–${fmt(f1 / settings.fps)} s: ${m.wallSec}s wall, ${m.maxRssMb} MB, ${res.inputs.length} inputs, progress ${Math.round(100 * doneFrames / totalFrames)}%`);
  };
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < chunks.length) {
      const i = next;
      next += 1;
      // eslint-disable-next-line no-await-in-loop
      await renderOne(i);
    }
  }));
  const chunksWall = (performance.now() - started) / 1000;
  writeFileSync(join(dir, 'list.txt'), `${list.join('\n')}\n`);

  // audio: one pass over the whole duration (-vn as input option: video is not decoded)
  const aInputs: string[][] = plan.placements.map((p) => {
    const clip = clips.get(p.clipId)!;
    return ['-vn', '-ss', fmt(clip.start), '-t', fmt(p.endTime - p.startTime + 0.1), '-i', clip.source.path];
  });
  const audio = buildAudioFilter({ plan, clips, settings, inputIndexOf: (i) => i, inputsForAudio: aInputs });
  const audioPath = join(dir, 'audio.m4a');
  writeFileSync(join(outDir, `${name}-audio.graph.txt`), audio.filter.join(';\n'));
  const am = runFfmpeg([...aInputs.flat(), '-/filter_complex', join(outDir, `${name}-audio.graph.txt`), '-map', `[${audio.out}]`, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', audioPath]);
  console.log(`  audio pass: ${am.wallSec}s wall, ${am.maxRssMb} MB`);

  const out = join(outDir, `${name}.mp4`);
  const mm = runFfmpeg(['-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-i', audioPath, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', '+faststart', out]);
  console.log(`  concat+mux: ${mm.wallSec}s wall`);
  const wall = chunksWall + am.wallSec + mm.wallSec;
  const cpu = stats.reduce((a, s) => a + s.cpuSec, 0) + am.cpuSec + mm.cpuSec;
  const maxRss = Math.max(...stats.map((s) => s.maxRssMb), am.maxRssMb); // per process; × concurrency when parallel
  console.log(`${name} TOTAL chunked: ${fmt(wall)} s wall, ${fmt(cpu)} s cpu, peak ${maxRss} MB, max graph ${Math.max(...stats.map((s) => s.graphChars))} chars, max inputs ${Math.max(...stats.map((s) => s.inputs))}`);
  return { out, wall, cpu, maxRss, stats };
}

function renderFull(name: string, plan: MixPlan, clips: Map<string, Clip>, settings: Settings) {
  const total = Math.round(plan.duration * settings.fps);
  const res = buildVideoGraph({ plan, clips, settings, f0: 0, f1: total, withAudio: true });
  const { args } = graphArgs(res, `${name}-full`);
  const out = join(outDir, `${name}.mp4`);
  // NULL_OUT=1: decode + filters only (no encoding), to separate the cost of the graph from x264
  const output = process.env['NULL_OUT'] === '1' ? ['-f', 'null', '-'] : [...encodeArgs(settings), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out];
  const m = runFfmpeg([...args, '-map', `[${res.videoOut}]`, '-map', `[${res.audioOut}]`, '-frames:v', String(total), ...output]);
  if (process.env['NULL_OUT'] === '1') { console.log(`${name} full graph, filters only: ${m.wallSec} s wall, ${m.cpuSec} s cpu, peak ${m.maxRssMb} MB`); process.exit(0); }
  const chars = res.filter.join(';').length;
  const argvChars = [...res.inputs.flat(), '-filter_complex', res.filter.join(';')].join(' ').length;
  console.log(`${name} TOTAL full graph: ${m.wallSec} s wall, ${m.cpuSec} s cpu, peak ${m.maxRssMb} MB, graph ${chars} chars (argv inline would be ${argvChars}), ${res.inputs.length} inputs`);
  return { out, ...m, chars };
}

// ---------------------------------------------------------------------------------------------------------------
// Frame extraction and checks

function extractFrames(video: string, times: number[], prefix: string, scaleWidth = 960) {
  for (const t of times) {
    const png = join(outDir, `${prefix}-${fmt(t)}.png`);
    runFfmpeg(['-ss', fmt(t), '-i', video, '-frames:v', '1', '-vf', `scale=${scaleWidth}:-2`, png]);
  }
}

function probeSummary(video: string) {
  return ffprobe(['-count_frames', '-show_entries', 'stream=codec_type,nb_read_frames,duration,r_frame_rate,width,height', '-of', 'compact', video]).trim();
}

// ---------------------------------------------------------------------------------------------------------------
// Test sources and clips

const full = (w: number, h: number): Rect => ({ x: 0, y: 0, width: w, height: h });
const centered = (w: number, h: number, mw: number, mh: number): Rect => ({ x: roundEven((w - mw) / 2), y: roundEven((h - mh) / 2), width: mw, height: mh });

const tm = (f: string) => join('test-media', f);
const S = {
  h1080: { path: tm('h-1080p-10s.mp4'), width: 1920, height: 1080, hasAudio: true },
  h720p25: { path: tm('h-720p-25fps-8s.mp4'), width: 1280, height: 720, hasAudio: true },
  v1080: { path: tm('v-1080x1920-12s.mp4'), width: 1080, height: 1920, hasAudio: true },
  rotated: { path: tm('v-rotated-9s.mp4'), width: 1080, height: 1920, hasAudio: true },
  sq: { path: tm('sq-1080-6s.mp4'), width: 1080, height: 1080, hasAudio: false },
  // long sources generated by the "sources" scenario (with temporal noise so x264 has realistic work)
  longA: { path: join(srcDir, 'long-h1080p30-60s.mp4'), width: 1920, height: 1080, hasAudio: true },
  longB: { path: join(srcDir, 'long-h720p25-60s.mp4'), width: 1280, height: 720, hasAudio: true },
  longC: { path: join(srcDir, 'long-v1080x1920-60s.mp4'), width: 1080, height: 1920, hasAudio: true },
  sync25: { path: join(srcDir, 'sync-25fps-12s.mp4'), width: 640, height: 360, hasAudio: true },
} satisfies Record<string, Source>;

// horizontal: croppable down to a centered min of aspect 0.444 (480x1080 at 1080p); vertical: 1080x1500 min
function clip(id: string, source: Source, start: number, end: number, kind: 'h' | 'v' | 'rigid' = 'h'): Clip {
  const { width: w, height: h } = source;
  let minRect: Rect | undefined;
  if (kind === 'h') minRect = centered(w, h, roundEven(h * 0.4445), h);
  if (kind === 'v') minRect = centered(w, h, w, roundEven(w / 0.72));
  return { id, source, start, end, maxRect: full(w, h), minRect };
}

function generateSources() {
  mkdirSync(srcDir, { recursive: true });
  const dt = (size: number) => `drawtext=text='%{pts\\:hms}':fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.5:x=(w-tw)/2:y=(h-th)/2`;
  const gen = (file: string, args: string[]) => {
    if (existsSync(file)) return;
    console.log(`generating ${file}`);
    runFfmpeg([...args, file]);
  };
  gen(S.longA.path, ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=60', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60',
    '-vf', `noise=alls=12:allf=t,${dt(96)}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
  gen(S.longB.path, ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=60', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=60',
    '-vf', `noise=alls=12:allf=t,${dt(64)}`, '-af', 'volume=-12dB', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
  gen(S.longC.path, ['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=60', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:duration=60',
    '-vf', `noise=alls=12:allf=t,${dt(96)}`, '-af', 'volume=-24dB', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
  // A/V sync probe: white flash (1 frame at 25 fps) and 1 kHz beep of 40 ms at every whole second
  gen(S.sync25.path, ['-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=25:d=12',
    '-f', 'lavfi', '-i', 'aevalsrc=if(lt(mod(t\\,1)\\,0.04)\\,0.8*sin(2*PI*1000*t)\\,0):s=48000:d=12',
    '-vf', `drawbox=color=white:t=fill:enable='lt(mod(t,1),0.039)',${dt(48)}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
}

const baseSettings: Settings = {
  fps: 30,
  gap: { width: 8, color: '0x303030' },
  transition: { type: 'fade', duration: 0.5 },
  fadeInOut: true,
  fill: 'blur',
  fillColor: 'black',
  crf: 20,
  preset: 'medium',
};

const clipMap = (list: Clip[]) => new Map(list.map((c) => [c.id, c]));

// 3 columns at 1080p with gap 8: 636 + 632 + 636 + 2·8 = 1920
const L3cols: LayoutColumn[] = [{ column: 0, x: 0, width: 636 }, { column: 1, x: 644, width: 632 }, { column: 2, x: 1284, width: 636 }];

// ---------------------------------------------------------------------------------------------------------------
// Scenarios

function scenarioStatic() {
  // 1. Static columns: overlay on a canvas vs xstack/hstack. Same 3 crops, gap 8, 6 s.
  const W = 1920; const H = 1080;
  const crops = [
    { src: S.h1080, c: getCrop(full(1920, 1080), centered(1920, 1080, 480, 1080), 636 / H).crop, w: 636 },
    { src: S.v1080, c: getCrop(full(1080, 1920), centered(1080, 1920, 1080, 1500), 632 / H).crop, w: 632 },
    { src: S.sq, c: getCrop(full(1080, 1080), centered(1080, 1080, 480, 1080), 636 / H).crop, w: 636 },
  ];
  const inputs = crops.flatMap((c) => ['-t', '6', '-i', c.src.path]);
  const chains = crops.map((c, i) => `[${i}:v]fps=30,crop=${c.c.width}:${c.c.height}:${c.c.x}:${c.c.y},scale=${c.w}:${H},setsar=1[c${i}]`);
  const overlay = [...chains, `color=c=0x303030:s=${W}x${H}:r=30:d=6[bg]`,
    '[bg][c0]overlay=x=0:y=0[o0]', '[o0][c1]overlay=x=644:y=0[o1]', '[o1][c2]overlay=x=1284:y=0:shortest=1,format=yuv420p[v]'].join(';');
  const xstack = [...chains, `[c0][c1][c2]xstack=inputs=3:layout=0_0|644_0|1284_0:fill=0x303030,format=yuv420p[v]`].join(';');
  const hstack = [...chains.slice(0, 2).map((c) => c.replace(/\[c(\d)\]$/, ',pad=iw+8:ih:0:0:0x303030[c$1]')), chains[2]!, '[c0][c1][c2]hstack=inputs=3,format=yuv420p[v]'].join(';');
  const results: Record<string, unknown> = {};
  for (const [name, graph] of Object.entries({ overlay, xstack, hstack })) {
    for (let rep = 0; rep < 2; rep += 1) {
      const nul = runFfmpeg([...inputs, '-filter_complex', graph, '-map', '[v]', '-f', 'null', '-']);
      const enc = runFfmpeg([...inputs, '-filter_complex', graph, '-map', '[v]', ...encodeArgs(baseSettings), join(outDir, `static-${name}.mp4`)]);
      results[`${name}#${rep}`] = { filtersOnlyWall: nul.wallSec, filtersOnlyCpu: nul.cpuSec, encodeWall: enc.wallSec, encodeCpu: enc.cpuSec, rss: enc.maxRssMb };
    }
    extractFrames(join(outDir, `static-${name}.mp4`), [3], `static-${name}`);
  }
  console.table(results);
}

async function scenarioSync() {
  // 2. xfade in one column while the other keeps playing; 25 fps + 30 fps sources to a common 30 fps; A/V sync probe.
  generateSources();
  const clips = clipMap([
    clip('a', S.h720p25, 0, 8), clip('b', S.sync25, 0, 10, 'rigid'), clip('c', S.v1080, 0, 12, 'v'),
  ]);
  clips.get('a')!.muted = true; clips.get('c')!.muted = true;
  // sync probe clip: rigid 16:9, letterboxed in column 0 (1136 px wide); flashes are measured at x 50–350, y 250–400
  const plan: MixPlan = {
    width: 1920, height: 1080, duration: 12,
    placements: [
      { clipId: 'a', column: 0, startTime: 0, endTime: 8 },
      { clipId: 'b', column: 0, startTime: 7.5, endTime: 12 },
      { clipId: 'c', column: 1, startTime: 0, endTime: 12 },
    ],
    layouts: [{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 1136 }, { column: 1, x: 1144, width: 776 }], fills: [] }],
  };
  // b lasts 4.5 s in the plan (7.5–12)
  clips.get('b')!.end = 4.5;
  const settings = { ...baseSettings, fadeInOut: false };
  const r1 = await renderChunked('sync-chunked', plan, clips, settings, { maxChunkSec: 3 });
  const r2 = renderFull('sync-full', plan, clips, settings);
  for (const out of [r1.out, r2.out]) {
    console.log(out, '\n', probeSummary(out));
    // flash detection in column 0 (luma average of the pillarboxed probe), beep detection with silencedetect
    const flashes = ffprobe(['-f', 'lavfi', '-i', `movie=${out},crop=300:150:50:250,signalstats`, '-show_entries', 'frame=pts_time:frame_tags=lavfi.signalstats.YAVG', '-of', 'csv=p=0'])
      .trim().split('\n').map((l) => l.split(',').map(Number)).filter(([, y]) => (y ?? 0) > 150).map(([t]) => t);
    const sil = spawnSync(ffmpegPath, ['-hide_banner', '-i', out, '-af', 'silencedetect=n=-40dB:d=0.1', '-f', 'null', '-'], { env: ffEnv, encoding: 'utf8' }).stderr;
    const beeps = [...sil.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
    console.log('  flashes (s):', flashes.join(' '));
    console.log('  beeps   (s):', beeps.join(' '));
  }
  extractFrames(r1.out, [7.4, 7.75, 8.1], 'sync');
}

function relayoutPlan(): { plan: MixPlan, clips: Map<string, Clip> } {
  // 3 columns; at 2.75 s column 2 changes clip (xfade) and the whole row re-layouts over 0.5 s:
  // c0 636→520 (horizontal, crop narrows), c1 632→776 (vertical: width-limited → zoom), c2 636→608.
  const clips = clipMap([
    clip('g', S.h1080, 0, 6), clip('v', S.v1080, 0, 6, 'v'), clip('f', S.h720p25, 0, 3.25), clip('s', S.sq, 0, 3.25),
  ]);
  const plan: MixPlan = {
    width: 1920, height: 1080, duration: 6,
    placements: [
      { clipId: 'g', column: 0, startTime: 0, endTime: 6 },
      { clipId: 'v', column: 1, startTime: 0, endTime: 6 },
      { clipId: 'f', column: 2, startTime: 0, endTime: 3.25 },
      { clipId: 's', column: 2, startTime: 2.75, endTime: 6 },
    ],
    layouts: [
      { time: 0, transitionDuration: 0, columns: L3cols, fills: [] },
      { time: 2.75, transitionDuration: 0.5, columns: [{ column: 0, x: 0, width: 520 }, { column: 1, x: 528, width: 776 }, { column: 2, x: 1312, width: 608 }], fills: [] },
    ],
  };
  return { plan, clips };
}

// Alternative (c) of 04-diseno §4.1: every frame of the animation is its own static composition (static crop/scale
// computed with the geometry for that frame), concatenated. Only the fade transition is supported (overlay alpha).
function buildPerFrameAnimChunk(plan: MixPlan, clips: Map<string, Clip>, settings: Settings, f0: number, f1: number) {
  const { fps, gap } = settings;
  const H = plan.height;
  const D = settings.transition.duration;
  const inputs: string[][] = [];
  const filter: string[] = [];
  const active = plan.placements.filter((p) => Math.round(p.endTime * fps) > f0 && Math.round(p.startTime * fps) < f1);
  const branches = new Map<string, string[]>();
  active.forEach((p, i) => {
    const c = clips.get(p.clipId)!;
    const pf0 = Math.max(Math.round(p.startTime * fps), f0);
    const pf1 = Math.min(Math.round(p.endTime * fps), f1);
    inputs.push(['-ss', fmt(c.start + Math.max(0, pf0 / fps - p.startTime)), '-t', fmt((pf1 - pf0) / fps + 0.5), '-i', c.source.path]);
    const labels = Array.from({ length: pf1 - pf0 }, (_v, m) => `p${i}f${pf0 - f0 + m}`);
    filter.push(`[${i}:v]fps=${fps}:start_time=0,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${pf1 - pf0},split=${labels.length}${labels.map((l) => `[${l}]`).join('')}`);
    branches.set(p.clipId, labels);
  });
  const frameLabels: string[] = [];
  for (let n = 0; n < f1 - f0; n += 1) {
    const t = (f0 + n) / fps;
    const geom = columnsAt(plan, gap.width, t);
    let cv = `cv${n}`;
    filter.push(`color=c=${gap.color}:s=${plan.width}x${H}:r=${fps},trim=end_frame=1[${cv}]`);
    const ordered = [...new Set(active.map((p) => p.column))].sort((a, b) => geom.get(a)!.x - geom.get(b)!.x);
    for (const col of ordered) {
      const g = geom.get(col)!;
      const w = Math.max(2, roundEven(g.width));
      const here = active.filter((p) => p.column === col && Math.round(p.startTime * fps) <= f0 + n && f0 + n < Math.round(p.endTime * fps));
      const layers = here.map((p) => {
        const c = clips.get(p.clipId)!;
        const { crop } = getCrop(c.maxRect, c.minRect, w / H);
        const src = branches.get(p.clipId)!.find((l) => l.endsWith(`f${n}`))!;
        const o = `${src}l`;
        filter.push(`[${src}]trim=start_frame=${n - (Math.max(Math.round(p.startTime * fps), f0) - f0)},setpts=PTS-STARTPTS,trim=end_frame=1,crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${w}:${H},setsar=1[${o}]`);
        return { o, p };
      });
      let layer = layers[0]!.o;
      if (layers.length > 1) {
        const p = Math.min(1, (t - layers[1]!.p.startTime) / D);
        filter.push(`[${layers[1]!.o}]format=yuva420p,colorchannelmixer=aa=${fmt(p)}[${layer}a]`, `[${layer}][${layer}a]overlay[${layer}b]`);
        layer = `${layer}b`;
      }
      const o = `cv${n}c${col}`;
      filter.push(`[${cv}][${layer}]overlay=x=${roundEven(g.x)}:y=0[${o}]`);
      cv = o;
    }
    frameLabels.push(cv);
  }
  filter.push(`${frameLabels.map((l) => `[${l}]`).join('')}concat=n=${frameLabels.length}:v=1:a=0,setpts=N/${fps}/TB,format=yuv420p[vout]`);
  return { inputs, filter, videoOut: 'vout', frames: f1 - f0 } satisfies BuildResult;
}

function scenarioRelayout() {
  // 3. Animated re-layout. Methods: generic layer (scale eval=frame + overlay) vs per-frame static compositions.
  const { plan, clips } = relayoutPlan();
  const settings = { ...baseSettings, gap: { width: 8, color: 'white' }, fadeInOut: false };
  const fps = 30;
  const f0 = Math.round(2.75 * fps); const f1 = Math.round(3.25 * fps);
  const table: Record<string, unknown> = {};

  // A: full clip rendered with the generic path in one graph (6 s)
  const all = buildVideoGraph({ plan, clips, settings, f0: 0, f1: 6 * fps });
  const a = graphArgs(all, 'relayout-layers');
  const ma = runFfmpeg([...a.args, '-map', '[vout]', '-frames:v', String(all.frames), ...encodeArgs(settings), join(outDir, 'relayout-layers.mp4')]);
  table['layers (whole 6 s, 1 graph)'] = { wall: ma.wallSec, cpu: ma.cpuSec, rss: ma.maxRssMb, graphChars: all.filter.join(';').length };

  // B: only the animation chunk (0.5 s) with both methods, filters only (-f null) and encoded
  const chunkL = buildVideoGraph({ plan, clips, settings, f0, f1 });
  const chunkP = buildPerFrameAnimChunk(plan, clips, settings, f0, f1);
  for (const [name, res] of Object.entries({ layers: chunkL, perframe: chunkP })) {
    const g = graphArgs(res, `relayout-anim-${name}`);
    const nul = runFfmpeg([...g.args, '-map', '[vout]', '-frames:v', String(res.frames), '-f', 'null', '-']);
    const enc = runFfmpeg([...g.args, '-map', '[vout]', '-frames:v', String(res.frames), ...encodeArgs(settings), join(outDir, `relayout-anim-${name}.mp4`)]);
    table[`anim chunk 0.5 s: ${name}`] = { nullWall: nul.wallSec, wall: enc.wallSec, cpu: enc.cpuSec, rss: enc.maxRssMb, graphChars: res.filter.join(';').length };
    extractFrames(join(outDir, `relayout-anim-${name}.mp4`), [0, 0.1, 0.25, 0.4, 0.466], `relayout-${name}`);
  }
  // chunk rendered separately and whole-graph must be identical in geometry: extract from the whole render too
  extractFrames(join(outDir, 'relayout-layers.mp4'), [2.5, 2.85, 3.0, 3.15, 3.5], 'relayout-whole');
  console.table(table);
}

async function scenarioFill() {
  // 4. Blurred fill: pillarbox (rigid 16:9 clip in a narrow column, rigid 9:16 in a wide one) and an end fill.
  const clips = clipMap([clip('h', S.h1080, 0, 4, 'rigid'), clip('v', S.v1080, 0, 4, 'rigid'), clip('g', S.h1080, 2, 6)]);
  const plan: MixPlan = {
    width: 1920, height: 1080, duration: 4,
    placements: [
      { clipId: 'h', column: 0, startTime: 0, endTime: 4 },
      { clipId: 'v', column: 1, startTime: 0, endTime: 4 },
      { clipId: 'g', column: 2, startTime: 0, endTime: 2.5 },
    ],
    layouts: [
      { time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 600 }, { column: 1, x: 608, width: 800 }, { column: 2, x: 1416, width: 504 }], fills: [] },
      { time: 2.5, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 600 }, { column: 1, x: 608, width: 800 }], fills: [{ x: 1416, width: 504 }] },
    ],
  };
  const settings = { ...baseSettings, fadeInOut: false };
  const r = await renderChunked('fill', plan, clips, settings);
  extractFrames(r.out, [1, 2.25, 3], 'fill');
}

function scenarioBlurBench() {
  // cost of the blur for a 1920x1080 fill layer: full-res gblur vs boxblur vs downscale+boxblur+upscale
  const variants = {
    gblurFull: 'scale=1920:1080,gblur=sigma=40',
    boxblurFull: 'scale=1920:1080,boxblur=luma_radius=40:luma_power=2',
    downscaled: blurCover(1920, 1080),
  };
  const table: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(variants)) {
    const m = runFfmpeg(['-i', S.h1080.path, '-t', '10', '-vf', f, '-f', 'null', '-']);
    table[name] = { wallFor300Frames: m.wallSec, cpu: m.cpuSec, fps: Math.round(300 / m.wallSec) };
    runFfmpeg(['-ss', '3', '-i', S.h1080.path, '-frames:v', '1', '-vf', `${f},scale=640:-2`, join(outDir, `blur-${name}.png`)]);
  }
  console.table(table);
}

function scenarioMaskBench() {
  // alternative (a) with an alpha mask per frame (geq): cost of masking one 960x1080 layer per frame
  const table: Record<string, unknown> = {};
  const m1 = runFfmpeg(['-i', S.h1080.path, '-t', '5', '-vf', 'crop=960:1080,format=yuva420p,geq=lum=\'lum(X,Y)\':cb=\'cb(X,Y)\':cr=\'cr(X,Y)\':a=\'if(lt(X,480+400*sin(T)),255,0)\'', '-f', 'null', '-']);
  table['geq alpha mask 960x1080'] = { wallFor150Frames: m1.wallSec, fps: Math.round(150 / m1.wallSec) };
  const m2 = runFfmpeg(['-i', S.h1080.path, '-t', '5', '-filter_complex', '[0:v]crop=960:1080,scale=w=\'trunc((400+400*abs(sin(t)))/2)*2\':h=1080:eval=frame[s];color=black:s=960x1080:r=30:d=5[b];[b][s]overlay=x=\'100*sin(t)\':eval=frame:shortest=1', '-f', 'null', '-']);
  table['scale eval=frame + overlay 960x1080'] = { wallFor150Frames: m2.wallSec, fps: Math.round(150 / m2.wallSec) };
  const m3 = runFfmpeg(['-i', S.h1080.path, '-t', '5', '-filter_complex', '[0:v]crop=960:1080,scale=w=800:h=1080[s];color=black:s=960x1080:r=30:d=5[b];[b][s]overlay=x=\'100*sin(t)\':eval=frame:shortest=1', '-f', 'null', '-']);
  table['static scale + overlay 960x1080'] = { wallFor150Frames: m3.wallSec, fps: Math.round(150 / m3.wallSec) };
  console.table(table);
}

function perfPlan(): { plan: MixPlan, clips: Map<string, Clip> } {
  // ~2 min, 15 clips, 1080p30, gap 8, 6 animated re-layouts (one removes a column), end fill.
  const clips = clipMap([
    clip('1', S.longA, 0, 20), clip('2', S.longC, 0, 14, 'v'), clip('3', S.longB, 0, 25), clip('4', S.rotated, 0, 9, 'v'),
    clip('5', S.longA, 25, 47), clip('6', S.h720p25, 0, 8), clip('7', S.longC, 20, 40, 'v'), clip('8', S.sq, 0, 6),
    clip('10', S.h1080, 0, 10), clip('11', S.longB, 30, 50), clip('12', S.longA, 35, 56.5), clip('13', S.longC, 38, 58, 'v'),
    clip('14', S.longB, 10, 38.5), clip('15', S.longA, 5, 40), clip('16', S.v1080, 0, 12, 'v'),
  ]);
  const P = (clipId: string, column: number, startTime: number) => {
    const c = clips.get(clipId)!;
    return { clipId, column, startTime, endTime: startTime + c.end - c.start };
  };
  const L = (time: number, cols: [number, number, number][], fills: Fill[] = [], transitionDuration = 0.5): LayoutKeyframe => (
    { time, transitionDuration, columns: cols.map(([column, x, width]) => ({ column, x, width })), fills }
  );
  const plan: MixPlan = {
    width: 1920, height: 1080, duration: 118,
    placements: [
      P('1', 0, 0), P('2', 1, 0), P('3', 2, 0), P('4', 1, 13.5), P('5', 0, 19.5), P('6', 1, 22), P('7', 2, 24.5), P('8', 1, 29.5),
      P('10', 0, 41), P('11', 2, 44), P('12', 0, 50.5), P('13', 2, 63.5), P('14', 0, 71.5), P('15', 2, 83),
    ],
    layouts: [
      { time: 0, transitionDuration: 0, columns: L3cols, fills: [] },
      L(19.5, [[0, 0, 560], [1, 568, 760], [2, 1336, 584]]),
      L(24.5, [[0, 0, 700], [1, 708, 600], [2, 1316, 604]]),
      L(35, [[0, 0, 1136], [2, 1144, 776]]),
      L(44, [[0, 0, 960], [2, 968, 952]]),
      L(63.5, [[0, 0, 1136], [2, 1144, 776]]),
      L(83, [[0, 0, 956], [2, 964, 956]]),
    ],
  };
  // clip 16 (vertical, 12 s) replaces clip 14 in column 0 at 99.5 with a re-layout; at 111.5 it ends → fill
  plan.placements.push(P('16', 0, 99.5));
  plan.layouts.push(L(99.5, [[0, 0, 776], [2, 784, 1136]]));
  plan.layouts.push(L(111.5, [[2, 784, 1136]], [{ x: 0, width: 776 }], 0));
  plan.placements.sort((a, b) => a.startTime - b.startTime);
  return { plan, clips };
}

async function scenarioPerf() {
  generateSources();
  const { plan, clips } = perfPlan();
  const preset = process.argv[3] ?? 'medium';
  const settings = { ...baseSettings, preset, music: { path: tm('music-20s.m4a'), volumeDb: -6, loop: true } };
  console.log(`perf: ${plan.placements.length} clips, ${plan.duration} s, ${os.cpus().length} cpus, preset ${preset}`);
  const mode = process.argv[4] ?? 'both';
  if (mode !== 'full') {
    const concurrency = Number(process.argv[5] ?? 1);
    const c = await renderChunked(`perf-${preset}-chunked${concurrency > 1 ? `-p${concurrency}` : ''}`, plan, clips, settings, { concurrency });
    console.log(probeSummary(c.out));
    extractFrames(c.out, [0.1, 10, 19.75, 35.25, 36, 99.75, 111.25, 115], `perf-${preset}-chunked`);
  }
  if (mode !== 'chunked') {
    const f = renderFull(`perf-${preset}-full`, plan, clips, settings);
    console.log(probeSummary(f.out));
    extractFrames(f.out, [19.75, 35.25], `perf-${preset}-full`);
  }
}

function scenarioArgv() {
  // Command length: the full graph inline in argv vs -/filter_complex file
  const { plan, clips } = perfPlan();
  const res = buildVideoGraph({ plan, clips, settings: baseSettings, f0: 0, f1: plan.duration * 30, withAudio: true });
  const inline = [...res.inputs.flat(), '-filter_complex', res.filter.join(';')];
  console.log(`inline argv length: ${inline.join(' ').length} chars (Windows CreateProcess limit: 32767)`);
}

async function scenarioExample() {
  // Small plan used for the annotated example of ADR-001 (script/videomix/spike/example-anim-chunk.sh):
  // 2 columns, at t=2 column 1 changes clip (fade) while the row re-layouts 632|1280 → 776|1136 over 0.5 s.
  const clips = clipMap([clip('v', S.v1080, 0, 4, 'v'), clip('g', S.h1080, 0, 2.5), clip('f', S.h720p25, 0, 2)]);
  const plan: MixPlan = {
    width: 1920, height: 1080, duration: 4,
    placements: [
      { clipId: 'v', column: 0, startTime: 0, endTime: 4 },
      { clipId: 'g', column: 1, startTime: 0, endTime: 2.5 },
      { clipId: 'f', column: 1, startTime: 2, endTime: 4 },
    ],
    layouts: [
      { time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 632 }, { column: 1, x: 640, width: 1280 }], fills: [] },
      { time: 2, transitionDuration: 0.5, columns: [{ column: 0, x: 0, width: 776 }, { column: 1, x: 784, width: 1136 }], fills: [] },
    ],
  };
  const settings = { ...baseSettings, fadeInOut: false };
  for (const [f0, f1] of getChunks(plan, settings, 15)) {
    const res = buildVideoGraph({ plan, clips, settings, f0, f1 });
    console.log(`# chunk ${f0 / 30}-${f1 / 30}`);
    console.log(res.inputs.map((i) => i.join(' ')).join(' \\\n'));
    console.log(res.filter.join(';\n'));
  }
  await renderChunked('example', plan, clips, settings);
  extractFrames(join(outDir, 'example.mp4'), [1, 2.25, 3], 'example');
}

mkdirSync(outDir, { recursive: true });
const scenarios: Record<string, () => void | Promise<void>> = {
  sources: generateSources, static: scenarioStatic, sync: scenarioSync, relayout: scenarioRelayout, fill: scenarioFill,
  perf: scenarioPerf, 'blur-bench': scenarioBlurBench, 'mask-bench': scenarioMaskBench, 'argv-bench': scenarioArgv, example: scenarioExample,
};
const scenario = scenarios[process.argv[2] ?? ''];
if (!scenario) throw new Error(`Usage: renderSpike.ts <${Object.keys(scenarios).join('|')}>`);
await scenario();
