import { normalizeClipRects, rectContains } from '../geometry';
import { getDefaultAxis, getPlanAxis, getPlanAxisLengths } from './types';
import type { ColumnPlacement, MixPlan, PlanMixInput } from './types';
import { getEffectiveGroups, getEffectivePins, getPlanLinks, getPlanUnits } from './units';

const TOL = 1e-6;

type Layout = MixPlan['layouts'][number];

/**
 * Geometry of `column` at the `layout` end of an animation between `layout` and `other` (ADR-001): its own, or width 0
 * just left of its right neighbour when it is missing from `layout` (x of the first column after it in `other` that
 * is also in `layout`, minus the gap; W + gap if there is none). Without a neighbour it sits past the right edge with
 * its gap, so its gap enters/leaves the frame with it instead of popping up next to a right fill (T16).
 * Everything along the main axis: `width` is the frame's main length (its height for rows, see `getPlanAxisLengths`).
 */
export function getAnimatedColumn(layout: Layout, other: Layout, column: number, width: number, gap: number) {
  const own = layout.columns.find((c) => c.column === column);
  if (own != null) return { x: own.x, width: own.width };
  const after = other.columns.slice(other.columns.findIndex((c) => c.column === column) + 1);
  for (const c of after) {
    const neighbour = layout.columns.find((lc) => lc.column === c.column);
    if (neighbour != null) return { x: neighbour.x - gap, width: 0 };
  }
  return { x: width + gap, width: 0 };
}

/**
 * Check every invariant of 04-diseno §3.2 (plus layout consistency, pins and groups, chains, the sequence and a
 * truncated plan). Returns the problems found, empty if the plan is valid. Used by the tests and, in development, after
 * each planMix.
 *
 * A plan with a `truncated` warning (E4, `truncatePlan`) is checked as the cut of a valid plan: nothing goes past the
 * cut, the clips that would start after it are the ones the warning lists, and the others are whole or end at the cut.
 */
export function validatePlan(plan: MixPlan, input: PlanMixInput): string[] {
  const issues: string[] = [];
  const fail = (message: string) => issues.push(message);
  const { settings } = input;
  // E2/E5 (T38): chains and sequence as the planner reads them (sequence clips lose their pins and groups)
  const links = getPlanLinks(input.clips, input);
  const { clips } = links;
  const { maxColumns, gap, reorderWindow: N, transitionDuration: D } = settings;
  const { placements, layouts } = plan;
  // layouts are along the main axis (T29): W is the frame's width for columns, its height for rows
  const { main: W } = getPlanAxisLengths(plan);

  // B5: the output shape decides the axis (portrait: never side by side); a square output may take either
  if (plan.width !== settings.width || plan.height !== settings.height) fail(`Plan size ${plan.width}x${plan.height} != output ${settings.width}x${settings.height}`);
  const expectedAxis = settings.axis ?? getDefaultAxis(settings);
  if (expectedAxis != null && getPlanAxis(plan) !== expectedAxis) fail(`Plan axis ${getPlanAxis(plan)}, expected ${expectedAxis}`);
  const durations = new Map(clips.map((clip) => [clip.id, clip.duration]));
  /** End of a placement if it isn't cut (E4): its start plus the clip's duration. */
  const fullEnd = (p: ColumnPlacement) => p.startTime + (durations.get(p.clipId) ?? p.endTime - p.startTime);

  // E4 (T38): a truncated plan stops at the cut
  const truncated = plan.warnings.find((w) => w.type === 'truncated');
  const limit = truncated?.time ?? Infinity;
  const lost = new Set(truncated?.clipIds ?? []);
  if (truncated != null) {
    if (!(truncated.seconds > 0)) fail(`Truncated plan loses ${truncated.seconds}s`);
    if (Math.abs(plan.duration - limit) > TOL) fail(`Truncated plan lasts ${plan.duration}s, not its limit ${limit}s`);
    if (settings.maxDuration != null && limit > settings.maxDuration + TOL) fail(`Truncated at ${limit}s, after the maximum duration ${settings.maxDuration}s`);
    placements.forEach((p) => {
      if (p.endTime > limit + TOL || p.startTime >= limit - TOL) fail(`Clip ${p.clipId} (${p.startTime}-${p.endTime}) goes past the limit ${limit}`);
    });
    layouts.forEach((layout, i) => { if (layout.time >= limit - TOL && i > 0) fail(`Layout ${i} (t=${layout.time}) after the limit ${limit}`); });
    const cut = placements.filter((p) => fullEnd(p) > limit + TOL).map((p) => p.clipId);
    if (cut.toSorted().join(',') !== truncated.cutClipIds.toSorted().join(',')) fail(`Truncated plan: cut clips ${truncated.cutClipIds.join(',')}, expected ${cut.join(',')}`);
  }

  // 1. every clip exactly once, whole (E4: or cut at the limit, or lost after it)
  const seen = new Set<string>();
  placements.forEach((p) => {
    const duration = durations.get(p.clipId);
    if (duration == null) fail(`Unknown clip ${p.clipId}`);
    else if (Math.abs(p.endTime - Math.min(p.startTime + duration, limit)) > TOL) fail(`Clip ${p.clipId} is not played whole`);
    if (seen.has(p.clipId)) fail(`Clip ${p.clipId} placed twice`);
    if (lost.has(p.clipId)) fail(`Clip ${p.clipId} is placed but warned as lost`);
    seen.add(p.clipId);
    if (p.startTime < -TOL) fail(`Clip ${p.clipId} starts before 0`);
  });
  clips.forEach((clip) => { if (!seen.has(clip.id) && !lost.has(clip.id)) fail(`Clip ${clip.id} missing`); });
  lost.forEach((id) => { if (!durations.has(id)) fail(`Unknown lost clip ${id}`); });
  const maxEnd = Math.max(0, ...placements.map((p) => p.endTime));
  const maxStart = Math.max(0, ...placements.map((p) => p.startTime));
  if (Math.abs(plan.duration - maxEnd) > TOL) fail(`Duration ${plan.duration} != last end ${maxEnd}`);

  // E2/E5: the clips after the first of a chain or of the sequence aren't picks; clips are pending while one of the
  // others (units) hasn't started
  const chains = [...links.chains, ...(links.sequence.length > 0 ? [links.sequence] : [])];
  const continuations = new Set(chains.flatMap((chain) => chain.slice(1).map((clip) => clip.id)));
  const maxUnitStart = Math.max(0, ...placements.filter((p) => !continuations.has(p.clipId)).map((p) => p.startTime));

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

    // 7. no re-layout once all clips have started (E4: in a cut plan, the lost clips would start later)
    if (layout.time > maxStart + TOL && truncated == null) fail(`${at} re-layout after the last clip started`);

    // ADR-001: during an animation the columns keep their left-to-right order, and a column that appears or
    // disappears does it at width 0 just left of its right neighbour (its x minus the gap; W + gap if it has none)
    if (prev != null) {
      const prevOrder = prev.columns.map((c) => c.column).filter((id) => layout.columns.some((c) => c.column === id));
      const nextOrder = layout.columns.map((c) => c.column).filter((id) => prev.columns.some((c) => c.column === id));
      if (prevOrder.join(',') !== nextOrder.join(',')) fail(`${at} changes the column order (${prevOrder.join(',')} → ${nextOrder.join(',')})`);

      const ends = [...new Set([...prev.columns, ...layout.columns].map((c) => c.column))].map((id) => ({
        id,
        from: getAnimatedColumn(prev, layout, id, W, gap),
        to: getAnimatedColumn(layout, prev, id, W, gap),
      }));
      // positions are blends of the two ends, so being on the same side at both ends means no overlap in between
      const after = (a: { x: number }, b: { x: number, width: number }) => a.x + TOL >= b.x + b.width;
      ends.forEach((a, k) => ends.slice(k + 1).forEach((b) => {
        if (!(after(a.from, b.from) && after(a.to, b.to)) && !(after(b.from, a.from) && after(b.to, a.to))) {
          fail(`${at} columns ${a.id} and ${b.id} overlap during the animation`);
        }
      }));
    }
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
      const maxTr = Math.min(D, (fullEnd(prev) - prev.startTime) / 2, (fullEnd(next) - next.startTime) / 2);
      if (tr < 0 || tr > maxTr + TOL) fail(`${at} invalid transition ${tr} into ${next.clipId}`);
      if (Math.abs(next.startTime - (fullEnd(prev) - tr)) > TOL) fail(`${at} ${next.clipId} doesn't start ${tr}s before ${prev.clipId} ends`);
    }

    const removal = layouts[lastIndex + 1];
    if (removal != null) {
      const removedAt = Math.min(removal.time + removal.transitionDuration, limit);
      if (Math.abs(lastPlacement.endTime - removedAt) > TOL) fail(`${at} removed at ${removedAt} but its last clip ends at ${lastPlacement.endTime}`);
    } else if (maxUnitStart > lastPlacement.endTime + TOL) {
      fail(`${at} left empty at ${lastPlacement.endTime} while clips are still pending`);
    }

    // end of the video: the last clip fades out to the fill (unless its column is removed or the video ends with it)
    list.forEach((p) => {
      const out = p.transitionOut ?? 0;
      const fades = p === lastPlacement && removal == null && p.endTime < maxEnd - TOL;
      const expected = fades ? Math.min(D, (p.endTime - p.startTime) / 2) : 0;
      if (Math.abs(out - expected) > TOL) fail(`${at} ${p.clipId} fades out for ${out}s instead of ${expected}s`);
    });
  });

  // E2/E5 (T38): a chain plays in one column, its clips one right after the other (nothing in between), with a cut
  // or the global transition; the sequence also starts at 0, so it is on screen until it runs out. After a cut (E4) a
  // chain may lose its last clips, never a clip in the middle.
  const linkCut = (settings.linkTransition ?? 'cut') === 'cut';
  const placementOf = new Map(placements.map((p) => [p.clipId, p]));
  chains.forEach((chain) => {
    const name = chain === links.sequence ? 'Sequence' : `Chain ${chain.map((clip) => clip.id).join('+')}`;
    const placed = chain.flatMap((clip) => (placementOf.has(clip.id) ? [placementOf.get(clip.id)!] : []));
    if (chain.slice(0, placed.length).some((clip, i) => clip.id !== placed[i]!.clipId)) fail(`${name} loses a clip before its end`);
    const [head] = placed;
    if (head == null) return;
    if (chain === links.sequence && Math.abs(head.startTime) > TOL) fail(`${name} starts at ${head.startTime}, not at 0`);
    const column = (byColumn.get(head.column) ?? []).toSorted((a, b) => a.startTime - b.startTime);
    const index = column.indexOf(head);
    placed.forEach((p, i) => {
      if (i === 0) return;
      const prev = placed[i - 1]!;
      if (p.column !== head.column) fail(`${name}: ${p.clipId} is in column ${p.column}, not ${head.column}`);
      else if (column[index + i] !== p) fail(`${name}: ${p.clipId} doesn't follow ${prev.clipId} in its column`);
      const expected = linkCut ? 0 : Math.min(D, chain[i - 1]!.duration / 2, chain[i]!.duration / 2);
      if (Math.abs(p.transitionIn - expected) > TOL) fail(`${name}: transition ${p.transitionIn} into ${p.clipId}, expected ${expected}`);
    });
  });

  // E7 (T38b): an extended max rect only for a clip that allows it, only along the main axis, containing the max and
  // inside the source frame (even edges)
  const clipById = new Map(clips.map((clip) => [clip.id, clip]));
  const horizontal = getPlanAxis(plan) === 'columns';
  placements.forEach((p) => {
    const ext = p.extendedMaxRect;
    if (ext == null) return;
    const clip = clipById.get(p.clipId);
    if (clip?.extendBeyondMax == null || clip.rects == null) {
      fail(`Clip ${p.clipId} is extended without extendBeyondMax`);
      return;
    }
    const { max } = normalizeClipRects(clip.rects.maxRect, clip.rects.minRect);
    const { frame } = clip.extendBeyondMax;
    const at = `Clip ${p.clipId} extended to ${ext.x},${ext.y} ${ext.width}x${ext.height}`;
    if ([ext.x, ext.y, ext.width, ext.height].some((v) => !Number.isInteger(v) || v % 2 !== 0)) fail(`${at}: odd or non-integer edges`);
    if (!rectContains(ext, max)) fail(`${at}: doesn't contain its max`);
    if (!rectContains({ x: 0, y: 0, width: frame.width, height: frame.height }, ext)) fail(`${at}: outside its source frame ${frame.width}x${frame.height}`);
    const crossSame = horizontal ? ext.y === max.y && ext.height === max.height : ext.x === max.x && ext.width === max.width;
    const longer = horizontal ? ext.width > max.width : ext.height > max.height;
    if (!crossSame || !longer) fail(`${at}: not extended along the main axis only`);
  });
  const extendedWarnings = plan.warnings.filter((w) => w.type === 'extended');
  extendedWarnings.forEach((w) => {
    const p = placementOf.get(w.clipId);
    if (p?.extendedMaxRect == null) fail(`Clip ${w.clipId} has an extended warning but no extension`);
    else if (w.time < p.startTime - TOL || w.endTime > p.endTime + TOL || w.endTime <= w.time) fail(`Clip ${w.clipId}: extended warning out of its time range`);
  });

  // 5. order within the reorder window (ties in start time are sorted by base index, the most favourable). A4 (T30):
  // pinned clips are outside the order; the window applies to the single clips among themselves, and a group (one
  // position among the ordered units, where its first clip was) may wait for room but never starts more than N early.
  const { ordered } = getPlanUnits(clips, settings, links);
  const startOf = new Map(placements.map((p) => [p.clipId, p.startTime]));
  const positions = <T, >(items: T[], start: (item: T) => number | undefined, base: (item: T) => number) => {
    const sorted = items.flatMap((item) => {
      const t = start(item);
      return t != null ? [{ item, t }] : [];
    }).sort((a, b) => a.t - b.t);
    const result: { item: T, position: number }[] = [];
    for (let i = 0; i < sorted.length;) {
      let j = i + 1;
      while (j < sorted.length && sorted[j]!.t - sorted[j - 1]!.t <= TOL) j += 1;
      sorted.slice(i, j).sort((a, b) => base(a.item) - base(b.item)).forEach(({ item }, k) => result.push({ item, position: i + k }));
      i = j;
    }
    return result;
  };
  positions(ordered.filter((u) => u.singleBase >= 0), (u) => startOf.get(u.clips[0]!.id), (u) => u.singleBase).forEach(({ item, position }) => {
    if (Math.abs(position - item.singleBase) > N) fail(`Clip ${item.clips[0]!.id} at position ${position}, list index ${item.singleBase} (window ${N})`);
  });
  const unitStart = (u: (typeof ordered)[number]) => {
    const starts = u.clips.flatMap((clip) => (startOf.has(clip.id) ? [startOf.get(clip.id)!] : []));
    return starts.length > 0 ? Math.min(...starts) : undefined;
  };
  positions(ordered, unitStart, (u) => u.unitBase).forEach(({ item, position }) => {
    if (item.singleBase < 0 && position < item.unitBase - N) fail(`Group ${item.groupId} at position ${position}, before its window (list position ${item.unitBase}, window ${N})`);
  });

  // A4: pinned clips start at their pin time and groups start together, unless the plan warns (and says when)
  const shifted = new Map(plan.warnings.flatMap((w) => (w.type === 'pin-shifted' ? [[w.clipId, w] as const] : [])));
  const pins = getEffectivePins(clips);
  pins.forEach((pinTime, clipId) => {
    const start = startOf.get(clipId);
    const warning = shifted.get(clipId);
    if (start == null) return;
    if (warning == null && Math.abs(start - pinTime) > TOL) fail(`Clip ${clipId} pinned at ${pinTime} starts at ${start} without warning`);
    if (warning != null && (Math.abs(warning.time - start) > TOL || Math.abs(warning.pinTime - pinTime) > TOL || Math.abs(start - pinTime) <= TOL)) fail(`Clip ${clipId}: wrong pin-shifted warning`);
  });
  shifted.forEach((_w, clipId) => { if (!pins.has(clipId)) fail(`Clip ${clipId} is not pinned but has a pin-shifted warning`); });
  const split = new Map(plan.warnings.flatMap((w) => (w.type === 'group-split' ? [[w.groupId, w] as const] : [])));
  const groups = getEffectiveGroups(clips);
  groups.forEach((members, groupId) => {
    const starts = members.flatMap((clip) => (startOf.has(clip.id) ? [startOf.get(clip.id)!] : []));
    const together = starts.length === 0 || Math.max(...starts) - Math.min(...starts) <= TOL;
    const warning = split.get(groupId);
    if (!together && warning == null) fail(`Group ${groupId} doesn't start together without warning`);
    // E4: a group cut by the limit may keep its warning (it was split in the whole plan)
    const cut = members.some((clip) => lost.has(clip.id));
    if (warning != null && ((together && !cut) || warning.clipIds.join(',') !== members.map((clip) => clip.id).join(','))) fail(`Group ${groupId}: wrong group-split warning`);
  });
  split.forEach((_w, groupId) => { if (!groups.has(groupId)) fail(`Group ${groupId} doesn't exist but has a group-split warning`); });

  return issues;
}
