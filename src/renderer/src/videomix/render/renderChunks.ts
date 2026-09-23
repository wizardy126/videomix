import type { RenderTimeline } from './renderTimeline';

/** Longest stable chunk (ADR-001): long enough to amortize the per-process cost, short enough to parallelize. */
export const MAX_CHUNK_SECONDS = 15;

/** A block of output frames [f0, f1) rendered by its own ffmpeg process. */
export interface RenderChunk {
  index: number,
  f0: number,
  f1: number,
  /** Contains a width/position change (re-layout): the columns whose width varies use the "column layer" path. */
  animated: boolean,
}

interface Interval { start: number, end: number, anim: boolean }

/**
 * Frame intervals that must not be cut (ADR-001 "Partición en bloques"):
 * - the xfade of every clip that replaces another one;
 * - the fade into fill of every clip that ends at the end of the video;
 * - every layout change (animated or instant), flagged `anim`.
 */
export function getBusyIntervals(tl: RenderTimeline): Interval[] {
  const busy: Interval[] = [];
  for (const p of tl.placements) {
    if (p.previous != null && p.previous.f1 > p.f0) busy.push({ start: p.f0, end: p.previous.f1, anim: false });
    if (p.fadeOutFrames > 0) busy.push({ start: p.f1 - p.fadeOutFrames, end: p.f1, anim: false });
  }
  for (const kf of tl.keyframes.slice(1)) busy.push({ start: kf.f0, end: kf.f1, anim: true });
  busy.sort((a, b) => a.start - b.start);

  const merged: Interval[] = [];
  for (const b of busy) {
    const last = merged.at(-1);
    if (last != null && b.start <= last.end) {
      last.end = Math.max(last.end, b.end);
      last.anim ||= b.anim;
    } else {
      merged.push({ ...b });
    }
  }
  return merged;
}

/**
 * Split the video into chunks. Mandatory cuts at the start and end of every busy interval that contains a layout
 * change, so stable chunks have constant column widths (exact xfades, cheap static path). Stable spans longer than
 * `maxChunkSeconds` are split at the last free frame (outside any busy interval) within the limit.
 * The chunks cover [0, totalFrames) exactly.
 */
export function getRenderChunks(tl: RenderTimeline, { maxChunkSeconds = MAX_CHUNK_SECONDS }: { maxChunkSeconds?: number } = {}): RenderChunk[] {
  const { totalFrames } = tl;
  if (totalFrames <= 0) return [];
  const busy = getBusyIntervals(tl);
  const cuts = new Set<number>([0, totalFrames]);
  for (const b of busy) {
    if (b.anim) {
      cuts.add(Math.min(Math.max(b.start, 0), totalFrames));
      cuts.add(Math.min(Math.max(b.end, 0), totalFrames));
    }
  }

  const isFree = (f: number) => busy.every((b) => f <= b.start || f >= b.end);
  const maxFrames = Math.max(1, Math.round(maxChunkSeconds * tl.settings.fps));
  const sorted = [...cuts].sort((a, b) => a - b);
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
  return all.slice(0, -1).map((f0, index) => {
    const f1 = all[index + 1]!;
    return { index, f0, f1, animated: busy.some((b) => b.anim && b.start < f1 && b.end > f0) };
  });
}
