import invariant from 'tiny-invariant';

import { distributeWidths, getAxisLengths, getMainAspectRange, getWidthRange, normalizeClipRects, transposeRect } from '../geometry';
import type { AspectRange, LayoutAxis } from '../geometry';
import { getBaseOrder } from './random';
import { getColumnFit, getPlanWarnings } from './planWarnings';
import { validatePlan } from './validatePlan';
import { getDefaultAxis } from './types';
import type { ColumnPlacement, LayoutKeyframe, MixPlan, PlanMixInput, PlannerClip } from './types';

// Montage planner (04-diseno §3): an event simulation over "a column's clip ends" events. Each event is resolved by
// scoring the options (direct substitution, in-place with fill, or a re-layout of the row) and taking the cheapest.
// Everything works along the main axis (T29): for rows the clips are transposed (aspect a → 1/a, rects x↔y) and the
// frame's main length is its height, so "columns", "widths" and "left/right" below read "rows", "heights" and
// "top/bottom". The algorithm itself doesn't know the difference.

// Score weights: an option's cost is the sum of these terms, lower is better. Rough scale: 1 point ≈ moving a clip
// one position away from its list index.
/**
 * Per fraction of the frame width left as fill, per second it is expected to last (1 % of the width during 5 s
 * costs 3, about one re-layout). Pillarbox/letterbox bars count by their area.
 */
const FILL_WEIGHT = 60;
/**
 * How long the row fill of an option is assumed to last. It can change at the next event, so it's counted until the
 * first kept clip ends, capped at this. Using the incoming clips' ends would favour short clips just to end the fill.
 */
const ROW_FILL_SECONDS = 5;
/** Extra per clip forced into letterbox (top/bottom fill), the last resort in 04-diseno §2.3. */
const LETTERBOX_WEIGHT = 10;
/** Per re-layout (animated change of the row). */
const RELAYOUT_WEIGHT = 3;
/** Per position a clip starts away from its index in the base list. */
const ORDER_WEIGHT = 1;
/**
 * Balanced columns vs full screen (01-requisitos §4.3, decided after T10): cropping up to this fraction of a clip's max
 * rect is cheap, beyond it is expensive. With {@link COLUMN_COUNT_WEIGHT} this makes 2–3 columns win (flexible
 * horizontals narrowed towards their min) unless that loses more than ~40 % of a clip's max, and then a full-screen
 * clip wins. E.g. at 16:9: a 16:9 clip next to a 9:16 one keeps 1312 px (68 % of its max, 2 columns); two 16:9 clips
 * side by side keep 50 % each (full screen instead).
 */
const MAX_CROP_LOSS = 0.4;
/** Per column, times the fraction of its max rect that is cropped away (showing less than the user marked), up to {@link MAX_CROP_LOSS}. */
const PREF_WEIGHT = 4;
/** Per column, times the cropped fraction beyond {@link MAX_CROP_LOSS}. */
const EXCESS_CROP_WEIGHT = 40;
/** Per column, per unit of scale factor above x2. */
const UPSCALE_WEIGHT = 5;
/**
 * Per column outside the usual 2–3. Above what cropping two clips to {@link MAX_CROP_LOSS} costs (2 × 0.4 ×
 * {@link PREF_WEIGHT} = 3.2), so a lone clip only wins when more columns would crop beyond it.
 */
const COLUMN_COUNT_WEIGHT = 4;

/**
 * Fill before direct substitution (01-requisitos §4.3, decided after T10): when the row has structural fill, a
 * re-layout that leaves at most this fraction of it (or ≤ 1 px) beats a clip that fits the freed column exactly.
 * Re-layouts that don't reduce the fill that clearly aren't worth the animation.
 */
const CLEAR_FILL_REDUCTION = 0.5;

/**
 * Pruning: at most this many candidate subsets per event. The candidate list (clips in the reorder window, in base
 * order) is cut so that Σ C(candidates, m) over the subset sizes stays below it. The earliest clips are kept, so
 * the clips the window forces are always candidates.
 */
const SUBSET_BUDGET = 1000;

const EPS = 1e-9;

interface Clip {
  id: string,
  duration: number,
  range: AspectRange,
  widths: { min: number, max: number, preferred: number },
  /** Index in the base list (list order, or shuffled in random mode). */
  base: number,
  /** Normalized rect sizes, for the upscale estimate. */
  size?: { maxWidth: number, maxHeight: number, minHeight: number } | undefined,
}

interface Column {
  id: number,
  /** Last clip scheduled in the column. */
  clip: Clip,
  /** End time of `clip`. */
  end: number,
  /** False once the column has no more clips (end of the video): it just waits to become fill. */
  active: boolean,
}

/** A column of a candidate row, left to right. */
interface RowItem {
  column: number | undefined,
  clip: Clip,
  /** End time of `clip`. */
  end: number,
  /** Merged event: the column's current clip, still playing briefly at the new width. */
  outgoing?: Column | undefined,
}

interface Assignment {
  /** Existing column id, or undefined for a new column. */
  column: number | undefined,
  clip: Clip,
  start: number,
  transitionIn: number,
}

interface Option {
  cost: number,
  assignments: Assignment[],
  /** Present for a re-layout. */
  relayout?: {
    time: number,
    duration: number,
    row: RowItem[],
    widths: number[],
    fill: number,
    removed: number | undefined,
    /** Group columns left without a clip (no clips remaining): they become fill when they end. */
    closed: number[],
  } | undefined,
}

const floorEven = (v: number) => 2 * Math.floor(v / 2);

function combinations(n: number, k: number): number {
  let result = 1;
  for (let i = 0; i < k; i += 1) result = (result * (n - i)) / (i + 1);
  return result;
}

/** All k-subsets of [0, n) in lexicographic order. */
function* subsets(n: number, k: number): Generator<number[]> {
  if (k > n || k < 0) return;
  const idx = Array.from({ length: k }, (_v, i) => i);
  while (true) {
    yield [...idx];
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i -= 1;
    if (i < 0) return;
    idx[i]! += 1;
    for (let j = i + 1; j < k; j += 1) idx[j] = idx[j - 1]! + 1;
  }
}

/** The clip in main-axis units: `height` is the cross length of the frame; rows transpose the clip. */
function toClip(clip: PlannerClip, base: number, height: number, axis: LayoutAxis): Clip {
  invariant(clip.duration > 0 && Number.isFinite(clip.duration), `Invalid duration for clip ${clip.id}`);
  const range = getMainAspectRange(clip.aspectRange, axis);
  let size: Clip['size'];
  if (clip.rects != null) {
    const { max, min } = normalizeClipRects(clip.rects.maxRect, clip.rects.minRect);
    const [tMax, tMin] = axis === 'columns' ? [max, min] : [transposeRect(max), transposeRect(min)];
    size = { maxWidth: tMax.width, maxHeight: tMax.height, minHeight: tMin.height };
  }
  return { id: clip.id, duration: clip.duration, range, widths: getWidthRange(range, height), base, size };
}

/**
 * Whole-plan score (lower is better), with the same weights as the per-event decisions, so plans along different axes
 * can be compared (T29, square output). All terms are dimensionless (fractions of the frame, crop losses, scale
 * factors), so a rows plan and a columns plan of the same clips are measured alike:
 * - `fill`: structural row fill, fraction of the frame × seconds;
 * - `clips`: per clip, the time-weighted crop loss, upscale and column count terms of the columns it sits in, plus its
 *   pillarbox/letterbox area × seconds (and {@link LETTERBOX_WEIGHT} once if it is letterboxed);
 * - `relayouts`: per layout change;
 * - `order`: positions away from the base list.
 */
export interface PlanScore {
  total: number,
  fill: number,
  clips: number,
  relayouts: number,
  order: number,
}

/** {@link planMix} along a given main axis, with the plan's score. */
export function planMixAxis({ clips: inputClips, settings }: PlanMixInput, axis: LayoutAxis): { plan: MixPlan, score: PlanScore } {
  const { maxColumns, gap, reorderWindow: N, transitionDuration: D } = settings;
  const { main: W, cross: H } = getAxisLengths(axis, settings);
  invariant(maxColumns >= 1 && Number.isInteger(maxColumns), 'maxColumns must be a positive integer');
  invariant(N >= 0 && D >= 0 && W > 0 && H > 0 && gap >= 0, 'Invalid planner settings');
  const output = { width: settings.width, height: settings.height, axis };

  const remaining = getBaseOrder(inputClips, settings.order).map((clip, i) => toClip(clip, i, H, axis));
  const allClips = new Map(remaining.map((clip) => [clip.id, clip]));
  const placements: ColumnPlacement[] = [];
  const layouts: LayoutKeyframe[] = [];

  if (remaining.length === 0) {
    layouts.push({ time: 0, transitionDuration: 0, columns: [], fills: [{ x: 0, width: W }] });
    return { plan: { ...output, duration: 0, placements, layouts, warnings: [] }, score: { total: 0, fill: 0, clips: 0, relayouts: 0, order: 0 } };
  }

  const columns = new Map<number, Column>();
  /** Visual order of the column ids, left to right. */
  const order: number[] = [];
  const widthOf = new Map<number, number>();
  let rowFill = 0;
  let nextColumnId = 0;
  const newColumnId = () => {
    nextColumnId += 1;
    return nextColumnId - 1;
  };
  /** Next position in the playback order. */
  let position = 0;
  /** Start of the last picked clip: picks never start before it, so pick order = start order. */
  let lastStart = 0;
  /** End of the last layout animation: a new one can't start before. */
  let animationEnd = 0;

  // --- helpers ---

  const fillCost = (fill: number, seconds: number) => FILL_WEIGHT * (fill / W) * Math.max(0, seconds);

  /** Fill a clip leaves in a column of `width` px (pillarbox/letterbox) during `seconds`, without the letterbox extra. */
  function misfitFillCost(clip: Clip, width: number, seconds: number) {
    const fit = getColumnFit(clip.range, width, H);
    if (fit === 'pillarbox') return fillCost(width - clip.widths.max, seconds);
    // area-equivalent width of the top/bottom bars
    if (fit === 'letterbox') return fillCost(width * (1 - width / clip.widths.min), seconds);
    return 0;
  }

  /** Cost of the fill a clip leaves in a column of `width` px (pillarbox/letterbox) during `seconds`. */
  const misfitCost = (clip: Clip, width: number, seconds: number) => (
    misfitFillCost(clip, width, seconds) + (getColumnFit(clip.range, width, H) === 'letterbox' ? LETTERBOX_WEIGHT : 0)
  );

  /** Cropping and upscale cost of a clip in a column of `width` px (per column, not per second). */
  function columnCost(clip: Clip, width: number) {
    const { range } = clip;
    const aspect = Math.min(range.max, Math.max(range.min, width / H));
    const loss = 1 - Math.min(aspect / range.preferred, range.preferred / aspect);
    let cost = PREF_WEIGHT * Math.min(loss, MAX_CROP_LOSS) + EXCESS_CROP_WEIGHT * Math.max(0, loss - MAX_CROP_LOSS);
    if (clip.size != null) {
      // crop height as in getCropForAspect (fill/pillarbox); overestimates letterbox, which is penalized anyway
      const { maxWidth, maxHeight, minHeight } = clip.size;
      const cropHeight = Math.max(minHeight, Math.min(maxHeight, maxWidth / aspect));
      cost += UPSCALE_WEIGHT * Math.max(0, H / cropHeight - 2);
    }
    return cost;
  }

  const columnCountCost = (n: number) => COLUMN_COUNT_WEIGHT * (n < 2 ? 2 - n : Math.max(0, n - 3));

  /**
   * Cost of a row of clips at the given widths, each shown for about `seconds`: misfits, cropping, upscale and
   * column count. The row fill is added apart.
   */
  function rowCost(items: { clip: Clip, width: number, seconds: number }[]) {
    let cost = columnCountCost(items.length);
    items.forEach(({ clip, width, seconds }) => {
      cost += misfitCost(clip, width, seconds) + columnCost(clip, width);
    });
    return cost;
  }

  /**
   * Order cost of picking `picks` (in base order) at the next positions, or undefined if it breaks the reorder
   * window, either for a pick or for the clips left behind (the earliest one must still fit in its window).
   */
  function getOrderCost(picks: Clip[]) {
    let cost = 0;
    for (const [i, clip] of picks.entries()) {
      const delta = Math.abs(position + i - clip.base);
      if (delta > N) return undefined;
      cost += delta;
    }
    const leftBehind = remaining.find((clip) => !picks.includes(clip));
    if (leftBehind != null && position + picks.length > leftBehind.base + N) return undefined;
    return cost * ORDER_WEIGHT;
  }

  /** Remaining clips a pick at `position + maxPicks - 1` could still take, in base order. */
  const getWindow = (maxPicks: number) => remaining.filter((clip) => clip.base <= position + N + maxPicks - 1);

  /** Cut the window so the subset enumeration stays within {@link SUBSET_BUDGET}. */
  function pruneCandidates(window: Clip[], sizes: number[]) {
    let n = window.length;
    const count = (c: number) => sizes.reduce((acc, m) => acc + combinations(c, m), 0);
    while (n > 1 && count(n) > SUBSET_BUDGET) n -= 1;
    return window.slice(0, n);
  }

  function distribute(row: Clip[]) {
    const result = distributeWidths({ clips: row.map((c) => c.range), width: W, height: H, gap });
    if (result != null) return result;
    // A lone clip that is too wide even at its min rect: letterbox it over the full width (last resort).
    if (row.length === 1) return { widths: [floorEven(W)], fill: W - floorEven(W) };
    return undefined;
  }

  function buildLayout(time: number, transitionDuration: number, ids: number[], widths: number[], fill: number): LayoutKeyframe {
    if (ids.length === 0) return { time, transitionDuration, columns: [], fills: [{ x: 0, width: W }] };
    const left = floorEven(fill / 2);
    const fills: LayoutKeyframe['fills'] = [];
    if (left > 0) fills.push({ x: 0, width: left });
    let x = left;
    const cols = ids.map((column, i) => {
      const col = { column, x, width: widths[i]! };
      x += widths[i]! + gap;
      return col;
    });
    const right = x - gap;
    if (right < W) fills.push({ x: right, width: W - right });
    return { time, transitionDuration, columns: cols, fills };
  }

  function setRow(ids: number[], widths: number[], fill: number) {
    order.splice(0, order.length, ...ids);
    widthOf.clear();
    ids.forEach((id, i) => widthOf.set(id, widths[i]!));
    rowFill = fill;
  }

  function pick(clips: Clip[]) {
    clips.forEach((clip) => remaining.splice(remaining.indexOf(clip), 1));
    position += clips.length;
  }

  function place(column: number, clip: Clip, start: number, transitionIn: number) {
    placements.push({ clipId: clip.id, column, startTime: start, endTime: start + clip.duration, transitionIn });
    columns.set(column, { id: column, clip, end: start + clip.duration, active: true });
    lastStart = Math.max(lastStart, start);
  }

  /** Crossfade length from `outgoing` (ending at `end`) into `incoming`, never starting before `notBefore`. */
  const getTransition = (outgoing: Clip, incoming: Clip | undefined, end: number, notBefore: number) => Math.max(0, Math.min(
    D,
    outgoing.duration / 2,
    incoming != null ? incoming.duration / 2 : Infinity,
    end - notBefore,
  ));

  // --- initial row: all columns start at t = 0 ---

  {
    const window = getWindow(maxColumns);
    const sizes = Array.from({ length: maxColumns }, (_v, i) => i + 1);
    const candidates = pruneCandidates(window, sizes);
    let best: { cost: number, clips: Clip[], widths: number[], fill: number } | undefined;
    for (const m of sizes) {
      for (const idx of subsets(candidates.length, m)) {
        const clips = idx.map((i) => candidates[i]!);
        const orderCost = getOrderCost(clips);
        const dist = orderCost != null ? distribute(clips) : undefined;
        if (orderCost != null && dist != null) {
          const cost = orderCost + fillCost(dist.fill, ROW_FILL_SECONDS)
            + rowCost(clips.map((clip, i) => ({ clip, width: dist.widths[i]!, seconds: clip.duration })));
          if (best == null || cost < best.cost - EPS) best = { cost, clips, widths: dist.widths, fill: dist.fill };
        }
      }
    }
    invariant(best != null, 'No initial row');
    const ids = best.clips.map((clip) => {
      const id = newColumnId();
      place(id, clip, 0, 0);
      return id;
    });
    pick(best.clips);
    setRow(ids, best.widths, best.fill);
    layouts.push(buildLayout(0, 0, ids, best.widths, best.fill));
  }

  // --- events: the column whose clip ends first gets the next clip(s) ---

  function resolveEvent(trigger: Column): Option {
    const { end: e1, clip: a1 } = trigger;
    const w1 = widthOf.get(trigger.id)!;
    const rowFillSeconds = (ids: number[]) => Math.min(ROW_FILL_SECONDS, ...ids.map((id) => columns.get(id)!.end - e1));

    // 1. Direct substitution: the first clip in order that fits the freed width. No layout change. It wins outright
    // unless the row has structural fill: then a re-layout that clearly reduces it goes first (see CLEAR_FILL_REDUCTION).
    const singleWindow = getWindow(1);
    let direct: Option | undefined;
    for (const clip of singleWindow) {
      if (getColumnFit(clip.range, w1, H) === 'fill' && getOrderCost([clip]) != null) {
        const transitionIn = getTransition(a1, clip, e1, lastStart);
        direct = { cost: 0, assignments: [{ column: trigger.id, clip, start: e1 - transitionIn, transitionIn }] };
        break;
      }
    }
    if (direct != null && rowFill <= 1) return direct;
    /** With a direct substitution at hand, only re-layouts that clearly reduce the fill are considered. */
    const maxRelayoutFill = direct != null ? Math.max(1, rowFill * CLEAR_FILL_REDUCTION) : Infinity;

    let best: Option | undefined;
    const consider = (option: Option) => {
      if (best == null || option.cost < best.cost - EPS) best = option;
    };

    // 2a. In place with fill (pillarbox/letterbox), no layout change.
    if (direct == null) {
      singleWindow.forEach((clip) => {
        const orderCost = getOrderCost([clip]);
        if (orderCost == null) return;
        const transitionIn = getTransition(a1, clip, e1, lastStart);
        const start = e1 - transitionIn;
        const items = order.map((id) => {
          const col = columns.get(id)!;
          return id === trigger.id
            ? { clip, width: w1, seconds: clip.duration }
            : { clip: col.clip, width: widthOf.get(id)!, seconds: col.end - e1 };
        });
        consider({
          cost: orderCost + fillCost(rowFill, rowFillSeconds(order.filter((id) => id !== trigger.id))) + rowCost(items),
          assignments: [{ column: trigger.id, clip, start, transitionIn }],
        });
      });
    }

    // 2b. Re-layout. Columns whose clip ends before this animation would finish plus a transition are decided now
    // too (merged event), so animations never overlap.
    const active = order.map((id) => columns.get(id)!).filter((col) => col.active);
    const group = active
      .filter((col) => col === trigger || col.end <= e1 + EPS || col.end < e1 + D - EPS)
      .sort((a, b) => (a === trigger || b === trigger ? Number(b === trigger) - Number(a === trigger) : a.end - b.end));
    const kept = order.filter((id) => !group.some((col) => col.id === id));
    const g = group.length;
    const R = remaining.length;
    const maxPicks = Math.min(R, maxColumns - kept.length);

    // family 'replace': the trigger column gets a clip (+ new columns after it); 'remove': it disappears
    const sizes = new Set<number>();
    for (let m = 1; m <= maxPicks; m += 1) if (m >= g || m === R) sizes.add(m);
    const removeSizes = new Set<number>();
    if (kept.length + g - 1 >= 1) {
      if (g - 1 <= R) removeSizes.add(g - 1);
      else removeSizes.add(R);
    }
    const candidates = pruneCandidates(getWindow(Math.max(maxPicks, g - 1, 1)), [...new Set([...sizes, ...removeSizes])]);

    const evaluate = (family: 'replace' | 'remove', picks: Clip[]) => {
      const orderCost = getOrderCost(picks);
      if (orderCost == null) return;

      // Slots in start order: trigger, new columns (both at the animation start), then the other group columns.
      const assignments: Assignment[] = [];
      let time: number;
      let duration: number;
      let prev: number;
      let rest: Clip[];
      if (family === 'replace') {
        const [first, ...others] = picks;
        invariant(first != null);
        duration = getTransition(a1, first, e1, Math.max(lastStart, animationEnd));
        if (e1 < animationEnd || (D > 0 && duration <= EPS)) return;
        time = e1 - duration;
        assignments.push({ column: trigger.id, clip: first, start: time, transitionIn: duration });
        const newCount = Math.max(0, picks.length - g);
        others.slice(0, newCount).forEach((clip) => assignments.push({ column: undefined, clip, start: time, transitionIn: 0 }));
        rest = others.slice(newCount);
        prev = time;
      } else {
        duration = getTransition(a1, undefined, e1, Math.max(lastStart, animationEnd));
        if (e1 < animationEnd || (D > 0 && duration <= EPS)) return;
        time = e1 - duration;
        rest = picks;
        prev = Math.max(lastStart, time);
      }
      const others = group.slice(1);
      others.forEach((col, i) => {
        const clip = rest[i];
        if (clip == null) return;
        const transitionIn = getTransition(col.clip, clip, col.end, prev);
        const start = col.end - transitionIn;
        assignments.push({ column: col.id, clip, start, transitionIn });
        prev = start;
      });
      const closed = others.slice(rest.length).map((col) => col.id);

      // Nothing may end before the last start, so later picks keep starting in order.
      const maxStart = Math.max(...assignments.map((a) => a.start), lastStart);
      const ends = [
        ...assignments.map((a) => a.start + a.clip.duration),
        ...active.filter((col) => col !== trigger && !assignments.some((a) => a.column === col.id)).map((col) => col.end),
      ];
      if (ends.some((end) => end < maxStart - EPS)) return;

      const assigned = new Map(assignments.filter((a) => a.column != null).map((a) => [a.column!, a]));
      const newClips = assignments.filter((a) => a.column == null);
      const row: RowItem[] = [];
      order.forEach((id) => {
        const col = columns.get(id)!;
        if (id === trigger.id) {
          if (family === 'replace') {
            const a = assigned.get(id)!;
            row.push({ column: id, clip: a.clip, end: a.start + a.clip.duration });
            newClips.forEach((n) => row.push({ column: undefined, clip: n.clip, end: n.start + n.clip.duration }));
          }
          return;
        }
        const a = assigned.get(id);
        row.push(a != null
          ? { column: id, clip: a.clip, end: a.start + a.clip.duration, outgoing: col }
          : { column: id, clip: col.clip, end: col.end });
      });

      const dist = distribute(row.map((item) => item.clip));
      if (dist == null) return;
      if (dist.fill > maxRelayoutFill || (direct != null && row.some((item, i) => getColumnFit(item.clip.range, dist.widths[i]!, H) !== 'fill'))) return;

      const unchanged = family === 'replace' && newClips.length === 0 && dist.fill === rowFill
        && row.every((item, i) => widthOf.get(item.column!) === dist.widths[i]);
      let cost = orderCost + fillCost(dist.fill, rowFillSeconds(kept))
        + (unchanged ? 0 : RELAYOUT_WEIGHT)
        + rowCost(row.map((item, i) => ({ clip: item.clip, width: dist.widths[i]!, seconds: Math.min(item.clip.duration, item.end - e1) })));
      row.forEach((item, i) => {
        if (item.outgoing != null) cost += misfitCost(item.outgoing.clip, dist.widths[i]!, item.outgoing.end - e1);
      });

      consider({
        cost,
        assignments,
        relayout: { time, duration, row, widths: dist.widths, fill: dist.fill, removed: family === 'remove' ? trigger.id : undefined, closed },
      });
    };

    for (const m of [...sizes].sort((a, b) => a - b)) {
      for (const idx of subsets(candidates.length, m)) evaluate('replace', idx.map((i) => candidates[i]!));
    }
    for (const m of removeSizes) {
      for (const idx of subsets(candidates.length, m)) evaluate('remove', idx.map((i) => candidates[i]!));
    }

    if (best == null && direct != null) return direct;
    invariant(best != null, 'No option for event');
    return best;
  }

  while (remaining.length > 0) {
    let trigger: Column | undefined;
    for (const id of order) {
      const col = columns.get(id)!;
      if (col.active && (trigger == null || col.end < trigger.end - EPS)) trigger = col;
    }
    invariant(trigger != null, 'No active column while clips remain');

    const option = resolveEvent(trigger);
    const newIds: number[] = [];
    option.assignments.forEach(({ column, clip, start, transitionIn }) => {
      let id = column;
      if (id == null) {
        id = newColumnId();
        newIds.push(id);
      }
      place(id, clip, start, transitionIn);
    });
    pick(option.assignments.map((a) => a.clip));

    const { relayout } = option;
    if (relayout != null) {
      relayout.closed.forEach((id) => { columns.get(id)!.active = false; });
      if (relayout.removed != null) columns.delete(relayout.removed);
      let nextNew = 0;
      const ids = relayout.row.map((item) => {
        if (item.column != null) return item.column;
        const id = newIds[nextNew]!;
        nextNew += 1;
        return id;
      });
      // a merged event may keep every width: then there's nothing to animate
      const changed = newIds.length > 0 || relayout.removed != null || relayout.fill !== rowFill
        || ids.some((id, i) => widthOf.get(id) !== relayout.widths[i]);
      if (changed) {
        setRow(ids, relayout.widths, relayout.fill);
        layouts.push(buildLayout(relayout.time, relayout.duration, ids, relayout.widths, relayout.fill));
        animationEnd = relayout.time + relayout.duration;
      }
    }
  }

  // Remaining columns just run out: their areas become fill, no re-layout (01-requisitos §4.3).

  const duration = Math.max(...placements.map((p) => p.endTime));

  // End of the video: a clip without successor whose column stays in the layout fades out to the fill.
  const lastLayout = layouts.at(-1)!;
  placements.forEach((placement, i) => {
    const { column, startTime, endTime } = placement;
    if (endTime >= duration - EPS || placements.slice(i + 1).some((p) => p.column === column)) return;
    if (!lastLayout.columns.some((c) => c.column === column)) return; // removed by a re-layout: it shrinks to 0
    // as a crossfade: at most half the clip, so it never overlaps the clip's own crossfade in
    const transitionOut = Math.min(D, (endTime - startTime) / 2);
    if (transitionOut > 0) placements[i] = { ...placement, transitionOut };
  });
  const planWithoutWarnings: MixPlan = { ...output, duration, placements, layouts, warnings: [] };
  const plan: MixPlan = { ...planWithoutWarnings, warnings: getPlanWarnings(planWithoutWarnings, inputClips, D) };

  // --- whole-plan score (see PlanScore) ---

  const score: PlanScore = { total: 0, fill: 0, clips: 0, relayouts: RELAYOUT_WEIGHT * (layouts.length - 1), order: 0 };
  const segmentEnd = (i: number) => Math.min(layouts[i + 1]?.time ?? duration, duration);
  layouts.forEach((layout, i) => {
    const fill = layout.fills.reduce((acc, f) => acc + f.width, 0);
    if (layout.columns.length > 0) score.fill += fillCost(fill, segmentEnd(i) - layout.time);
  });
  placements.forEach((placement, pickIndex) => {
    const clip = allClips.get(placement.clipId)!;
    score.order += ORDER_WEIGHT * Math.abs(pickIndex - clip.base);
    const seconds = placement.endTime - placement.startTime;
    let letterboxed = false;
    layouts.forEach((layout, i) => {
      // a layout counts from its start (the target widths, also during its animation)
      const shown = Math.min(segmentEnd(i), placement.endTime) - Math.max(layout.time, placement.startTime);
      const col = layout.columns.find((c) => c.column === placement.column);
      if (shown <= EPS || col == null) return;
      score.clips += (shown / seconds) * (columnCost(clip, col.width) + columnCountCost(layout.columns.length))
        + misfitFillCost(clip, col.width, shown);
      letterboxed ||= getColumnFit(clip.range, col.width, H) === 'letterbox';
    });
    if (letterboxed) score.clips += LETTERBOX_WEIGHT;
  });
  score.total = score.fill + score.clips + score.relayouts + score.order;

  return { plan, score };
}

/**
 * Plan the montage: which clip plays in which column (or row) and when, and how they are laid out over time.
 * Pure and deterministic. See 04-diseno §3 for the rules and invariants (checked by {@link validatePlan}).
 *
 * The main axis is `settings.axis`, or else follows the output (B5, {@link getDefaultAxis}): columns in landscape,
 * rows in portrait. A square output is planned both ways and the plan with the lower {@link PlanScore} total wins
 * (ties: columns), once for the whole project.
 */
export function planMix(input: PlanMixInput): MixPlan {
  const axis = input.settings.axis ?? getDefaultAxis(input.settings);
  let plan: MixPlan;
  if (axis != null) {
    ({ plan } = planMixAxis(input, axis));
  } else {
    const columns = planMixAxis(input, 'columns');
    const rows = planMixAxis(input, 'rows');
    ({ plan } = rows.score.total < columns.score.total - EPS ? rows : columns);
  }

  if (import.meta.env.DEV) {
    const issues = validatePlan(plan, input);
    if (issues.length > 0) console.error('Invalid montage plan', issues);
  }
  return plan;
}
