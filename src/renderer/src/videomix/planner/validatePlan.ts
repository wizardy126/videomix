import { getBaseOrder } from './random';
import type { ColumnPlacement, MixPlan, PlanMixInput } from './types';

const TOL = 1e-6;

/**
 * Check every invariant of 04-diseno §3.2 (plus layout consistency). Returns the problems found, empty if the plan is
 * valid. Used by the tests and, in development, after each planMix.
 */
// eslint-disable-next-line import/prefer-default-export
export function validatePlan(plan: MixPlan, { clips, settings }: PlanMixInput): string[] {
  const issues: string[] = [];
  const fail = (message: string) => issues.push(message);
  const { width: W, maxColumns, gap, reorderWindow: N, transitionDuration: D } = settings;
  const { placements, layouts } = plan;
  const durations = new Map(clips.map((clip) => [clip.id, clip.duration]));

  // 1. every clip exactly once, whole
  const seen = new Set<string>();
  placements.forEach((p) => {
    const duration = durations.get(p.clipId);
    if (duration == null) fail(`Unknown clip ${p.clipId}`);
    else if (Math.abs(p.endTime - p.startTime - duration) > TOL) fail(`Clip ${p.clipId} is not played whole`);
    if (seen.has(p.clipId)) fail(`Clip ${p.clipId} placed twice`);
    seen.add(p.clipId);
    if (p.startTime < -TOL) fail(`Clip ${p.clipId} starts before 0`);
  });
  clips.forEach((clip) => { if (!seen.has(clip.id)) fail(`Clip ${clip.id} missing`); });
  const maxEnd = Math.max(0, ...placements.map((p) => p.endTime));
  const maxStart = Math.max(0, ...placements.map((p) => p.startTime));
  if (Math.abs(plan.duration - maxEnd) > TOL) fail(`Duration ${plan.duration} != last end ${maxEnd}`);

  // layouts: 2. max columns, 3. the row adds up to W
  const first = layouts[0];
  if (first == null) fail('No layouts');
  else if (first.time !== 0 || first.transitionDuration !== 0) fail('First layout must be at t=0 without animation');
  layouts.forEach((layout, i) => {
    const at = `Layout ${i} (t=${layout.time})`;
    const prev = layouts[i - 1];
    if (prev != null && layout.time < prev.time + prev.transitionDuration - TOL) fail(`${at} starts during the previous animation`);
    if (layout.transitionDuration < 0 || layout.transitionDuration > D + TOL) fail(`${at} invalid animation duration`);
    if (layout.columns.length > maxColumns) fail(`${at} has more than ${maxColumns} columns`);
    if (prev != null) {
      const union = new Set([...prev.columns, ...layout.columns].map((c) => c.column));
      if (union.size > maxColumns) fail(`${at} animates more than ${maxColumns} columns at once`);
    }
    if (new Set(layout.columns.map((c) => c.column)).size !== layout.columns.length) fail(`${at} repeats a column`);

    const items = [
      ...layout.columns.map((c) => ({ kind: 'column', x: c.x, width: c.width })),
      ...layout.fills.map((f) => ({ kind: 'fill', x: f.x, width: f.width })),
    ].sort((a, b) => a.x - b.x);
    let x = 0;
    let prevKind: string | undefined;
    items.forEach((item) => {
      if (!Number.isInteger(item.x) || !Number.isInteger(item.width) || item.width <= 0) fail(`${at} invalid ${item.kind} ${item.x}+${item.width}`);
      const expected = x + (prevKind === 'column' && item.kind === 'column' ? gap : 0);
      if (item.x !== expected) fail(`${at} ${item.kind} at ${item.x}, expected ${expected}`);
      x = item.x + item.width;
      prevKind = item.kind;
    });
    if (x !== W) fail(`${at} covers ${x} px instead of ${W}`);

    // 7. no re-layout once all clips have started
    if (layout.time > maxStart + TOL) fail(`${at} re-layout after the last clip started`);
  });

  // columns: 4. substitution with crossfade, 6. initial columns at t=0, 7. ended columns become fill
  const byColumn = new Map<number, ColumnPlacement[]>();
  placements.forEach((p) => byColumn.set(p.column, [...(byColumn.get(p.column) ?? []), p]));
  const columnIds = new Set([...byColumn.keys(), ...layouts.flatMap((l) => l.columns.map((c) => c.column))]);
  columnIds.forEach((column) => {
    const at = `Column ${column}`;
    const list = [...(byColumn.get(column) ?? [])].sort((a, b) => a.startTime - b.startTime);
    const present = layouts.flatMap((l, i) => (l.columns.some((c) => c.column === column) ? [i] : []));
    const firstIndex = present[0];
    const lastIndex = present.at(-1);
    const firstPlacement = list[0];
    const lastPlacement = list.at(-1);
    if (firstPlacement == null || lastPlacement == null) { fail(`${at} has no clips`); return; }
    if (firstIndex == null || lastIndex == null) { fail(`${at} is in no layout`); return; }
    if (lastIndex - firstIndex + 1 !== present.length) fail(`${at} disappears and comes back`);

    const appear = layouts[firstIndex]!.time;
    if (Math.abs(firstPlacement.startTime - appear) > TOL) fail(`${at} first clip starts at ${firstPlacement.startTime}, column appears at ${appear}`);
    if (firstPlacement.transitionIn !== 0) fail(`${at} first clip has a transition`);

    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1]!;
      const next = list[i]!;
      const tr = next.transitionIn;
      const maxTr = Math.min(D, (prev.endTime - prev.startTime) / 2, (next.endTime - next.startTime) / 2);
      if (tr < 0 || tr > maxTr + TOL) fail(`${at} invalid transition ${tr} into ${next.clipId}`);
      if (Math.abs(next.startTime - (prev.endTime - tr)) > TOL) fail(`${at} ${next.clipId} doesn't start ${tr}s before ${prev.clipId} ends`);
    }

    const removal = layouts[lastIndex + 1];
    if (removal != null) {
      const removedAt = removal.time + removal.transitionDuration;
      if (Math.abs(lastPlacement.endTime - removedAt) > TOL) fail(`${at} removed at ${removedAt} but its last clip ends at ${lastPlacement.endTime}`);
    } else if (maxStart > lastPlacement.endTime + TOL) {
      fail(`${at} left empty at ${lastPlacement.endTime} while clips are still pending`);
    }
  });

  // 5. order within the reorder window (ties in start time are sorted by base index, the most favourable)
  const baseIndex = new Map(getBaseOrder(clips, settings.order).map((clip, i) => [clip.id, i]));
  const sorted = [...placements].sort((a, b) => a.startTime - b.startTime);
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && sorted[j]!.startTime - sorted[j - 1]!.startTime <= TOL) j += 1;
    const tied = sorted.slice(i, j).sort((a, b) => (baseIndex.get(a.clipId) ?? 0) - (baseIndex.get(b.clipId) ?? 0));
    tied.forEach((p, k) => {
      const base = baseIndex.get(p.clipId);
      if (base != null && Math.abs(i + k - base) > N) fail(`Clip ${p.clipId} at position ${i + k}, list index ${base} (window ${N})`);
    });
    i = j;
  }

  return issues;
}
