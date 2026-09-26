import type { ColumnPlacement, MixPlan, PlanWarning } from './planner/types';

// Pure layout helpers for the mix timeline view (T15, components/MixPlanView.tsx): which lane a column sits in (G3, T53:
// columns that don't coincide in time share one), the gaps in a lane's timeline that show as fill, time↔percent mapping
// for the time axis and hit testing. No React, so they can be unit tested directly.

interface TimeSpan { from: number, to: number }

const EPS = 1e-6;

function mergeSpans(spans: TimeSpan[]): TimeSpan[] {
  const sorted = [...spans].sort((a, b) => a.from - b.from);
  const merged: TimeSpan[] = [];
  sorted.forEach((span) => {
    const last = merged.at(-1);
    if (last != null && span.from <= last.to + EPS) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  });
  return merged;
}

/**
 * Time spans where `column` is part of the layout (growing, stable or shrinking), merged. A column is present from
 * a keyframe on until the next one that drops it (04-diseno §3.1: it stays in the layout, as fill, once its clips run out).
 */
export function getColumnExistenceSpans(plan: Pick<MixPlan, 'layouts' | 'duration'>, column: number): TimeSpan[] {
  const spans: TimeSpan[] = [];
  plan.layouts.forEach((layout, i) => {
    if (!layout.columns.some((c) => c.column === column)) return;
    const to = plan.layouts[i + 1]?.time ?? plan.duration;
    if (to > layout.time) spans.push({ from: layout.time, to });
  });
  return mergeSpans(spans);
}

/** Time spans where `column` exists but has no clip playing: the fill lanes of the plan preview. */
export function getColumnFillSpans(plan: Pick<MixPlan, 'layouts' | 'duration' | 'placements'>, column: number): TimeSpan[] {
  const placed = plan.placements
    .filter((p) => p.column === column)
    .map((p): TimeSpan => ({ from: p.startTime, to: p.endTime }))
    .sort((a, b) => a.from - b.from);

  const gaps: TimeSpan[] = [];
  getColumnExistenceSpans(plan, column).forEach((span) => {
    let cursor = span.from;
    placed.filter((p) => p.to > span.from && p.from < span.to).forEach((p) => {
      if (p.from > cursor + EPS) gaps.push({ from: cursor, to: Math.min(p.from, span.to) });
      cursor = Math.max(cursor, p.to);
    });
    if (cursor < span.to - EPS) gaps.push({ from: cursor, to: span.to });
  });
  return gaps;
}

/** Time span a column occupies in the view: while it's in the layout, and until its last clip ends (a removed column shrinks while its last clip plays). */
function getColumnSpan(plan: Pick<MixPlan, 'layouts' | 'duration' | 'placements'>, column: number): TimeSpan | undefined {
  const spans = [
    ...getColumnExistenceSpans(plan, column),
    ...plan.placements.filter((p) => p.column === column).map((p): TimeSpan => ({ from: p.startTime, to: p.endTime })),
  ];
  if (spans.length === 0) return undefined;
  return { from: Math.min(...spans.map((s) => s.from)), to: Math.max(...spans.map((s) => s.to)) };
}

/**
 * G3 (T53): the lanes of the Mix view, top to bottom, each with the column ids it shows. The planner gives a new id to
 * every column it opens later, so a lane per id gave a lane per re-layout. Columns that don't coincide in time share a
 * lane, so there are as many lanes as columns at once (greedy interval colouring in start order, which is optimal).
 * Among the free lanes a new column takes one between the lanes of its neighbours at its first keyframe, so that at
 * each instant the top lane is, as far as possible, the leftmost column (topmost row); a new lane is inserted there.
 */
export function getMixLanes(plan: Pick<MixPlan, 'layouts' | 'duration' | 'placements'>): number[][] {
  // First keyframe (and x) of each column; columns that start together are taken left to right
  const first = new Map<number, { layout: MixPlan['layouts'][number], x: number }>();
  plan.layouts.forEach((layout) => layout.columns.forEach((c) => {
    if (!first.has(c.column)) first.set(c.column, { layout, x: c.x });
  }));
  const columns = [...new Set([...first.keys(), ...plan.placements.map((p) => p.column)])].flatMap((column) => {
    const span = getColumnSpan(plan, column);
    return span != null ? [{ column, span, x: first.get(column)?.x ?? Infinity }] : [];
  }).sort((a, b) => a.span.from - b.span.from || a.x - b.x || a.column - b.column);

  // Lanes in their visual order, each with its columns and the end of its last one
  const lanes: { columns: number[], to: number }[] = [];
  const laneOfColumn = new Map<number, { columns: number[], to: number }>();

  columns.forEach(({ column, span, x }) => {
    const laneIndexOf = (other: number) => {
      const lane = laneOfColumn.get(other);
      return lane != null ? lanes.indexOf(lane) : -1;
    };
    // Neighbours: the columns beside it in its first keyframe that already have a lane
    const neighbours = first.get(column)?.layout.columns.filter((c) => c.column !== column && laneOfColumn.has(c.column)) ?? [];
    const above = Math.max(-1, ...neighbours.filter((c) => c.x < x).map((c) => laneIndexOf(c.column)));
    const below = Math.min(lanes.length, ...neighbours.filter((c) => c.x > x).map((c) => laneIndexOf(c.column)));

    const free = lanes.map((lane, i) => ({ lane, i })).filter(({ lane }) => lane.to <= span.from + EPS);
    // distance to the range between its neighbours (0 inside it); the topmost lane on a tie
    const distance = (i: number) => (i <= above ? above + 1 - i : (i >= below ? i - below + 1 : 0));
    const best = free.sort((a, b) => distance(a.i) - distance(b.i) || a.i - b.i)[0];

    let lane: { columns: number[], to: number };
    if (best != null) {
      ({ lane } = best);
    } else {
      // every lane is busy: a new one, right above the neighbour below (the columns being removed by this re-layout
      // aren't in its keyframe: the new one goes below them)
      lane = { columns: [], to: 0 };
      lanes.splice(Math.max(above + 1, below), 0, lane);
    }
    lane.columns.push(column);
    lane.to = Math.max(lane.to, span.to);
    laneOfColumn.set(column, lane);
  });

  return lanes.map((lane) => lane.columns);
}

/** Percent (0–100) of `time` along `[0, duration]`, clamped. */
export function timeToPercent(time: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.min(100, Math.max(0, (time / duration) * 100));
}

/** The plan's warnings that concern `placement`'s clip, restricted to its time range for the time-anchored ones. */
export function getPlacementWarnings(plan: Pick<MixPlan, 'warnings'>, placement: Pick<ColumnPlacement, 'clipId' | 'startTime' | 'endTime'>): PlanWarning[] {
  return plan.warnings.filter((w) => {
    if (w.type === 'fill') return false;
    if (w.type === 'group-split') return w.clipIds.includes(placement.clipId);
    // E4 (T38): a clip cut at the maximum duration
    if (w.type === 'truncated') return w.cutClipIds.includes(placement.clipId);
    if (w.clipId !== placement.clipId) return false;
    // E7 (T38b): extended warnings have a time range within their placement
    if (w.type === 'pillarbox' || w.type === 'letterbox' || w.type === 'extended') return w.time >= placement.startTime - EPS && w.time < placement.endTime + EPS;
    return true;
  });
}

/** Placement of a column of `lanes[laneIndex]` active at `time`, if any (hit testing a click on the lanes area). */
export function getPlacementAt(plan: Pick<MixPlan, 'placements'>, lanes: number[][], laneIndex: number, time: number): ColumnPlacement | undefined {
  const columns = lanes[laneIndex];
  if (columns == null) return undefined;
  return plan.placements.find((p) => columns.includes(p.column) && time >= p.startTime && time < p.endTime);
}
