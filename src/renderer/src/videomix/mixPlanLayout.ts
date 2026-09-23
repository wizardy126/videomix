import type { ColumnPlacement, MixPlan, PlanWarning } from './planner/types';

// Pure layout helpers for the mix timeline view (T15, components/MixPlanView.tsx): which lane a column sits in, the
// gaps in a lane's timeline that show as fill, time↔percent mapping for the time axis and hit testing. No React, so
// they can be unit tested directly.

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

/** Column ids in top-to-bottom lane order: by the `x` of their first appearance in the plan's layouts. */
export function getLaneColumns(plan: Pick<MixPlan, 'layouts'>): number[] {
  const firstX = new Map<number, number>();
  plan.layouts.forEach((layout) => {
    layout.columns.forEach((c) => {
      if (!firstX.has(c.column)) firstX.set(c.column, c.x);
    });
  });
  return [...firstX.entries()].sort(([, ax], [, bx]) => ax - bx).map(([id]) => id);
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
    if (w.clipId !== placement.clipId) return false;
    if (w.type === 'pillarbox' || w.type === 'letterbox') return w.time >= placement.startTime - EPS && w.time < placement.endTime + EPS;
    return true;
  });
}

/** Placement of `laneColumns[laneIndex]` active at `time`, if any (hit testing a click on the lanes area). */
export function getPlacementAt(plan: Pick<MixPlan, 'placements'>, laneColumns: number[], laneIndex: number, time: number): ColumnPlacement | undefined {
  const column = laneColumns[laneIndex];
  if (column == null) return undefined;
  return plan.placements.find((p) => p.column === column && time >= p.startTime && time < p.endTime);
}
