import invariant from 'tiny-invariant';

import { distributeWidths, getAxisLengths, getMainAspectRange, getWidthRange, normalizeClipRects, transposeRect } from '../geometry';
import type { AspectRange, LayoutAxis } from '../geometry';
import { getColumnFit, getPlanWarnings } from './planWarnings';
import { getPlanUnits } from './units';
import { validatePlan } from './validatePlan';
import { getDefaultAxis } from './types';
import type { ColumnPlacement, LayoutKeyframe, MixPlan, PlanMixInput, PlannerClip } from './types';

// Montage planner (04-diseno §3): an event simulation over "a column's clip ends" events. Each event is resolved by
// scoring the options (direct substitution, in-place with fill, or a re-layout of the row) and taking the cheapest.
// Everything works along the main axis (T29): for rows the clips are transposed (aspect a → 1/a, rects x↔y) and the
// frame's main length is its height, so "columns", "widths" and "left/right" below read "rows", "heights" and
// "top/bottom". The algorithm itself doesn't know the difference.
//
// Pins and groups (A4, T30; 04-diseno §3.6). Clips start in units: a single clip, a group (together, at the list
// position of its first clip) or a pinned clip/group (outside the order, at its pin time). A pin's time is an event
// too: its clips come in as new columns. Before it, options are compared first by the room they leave for the pending
// pins (the reserve: `Option.violation`), so a column is freed (removed, or given a clip that ends in time) when the
// row would otherwise be full. A unit that can't wait (an overdue pin, a group at the end of its window) goes in at the
// next event, or that event's column is removed to make room; clips are never cut, so a pin may start late (warned).

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

/**
 * Clips that must start together (A4, T30, see `units.ts`): a single clip, a group (or a chunk of one) or a pinned
 * clip/group. `clips` shrinks as they are placed (only a split unit is placed in parts).
 */
interface Unit {
  // eslint-disable-next-line no-use-before-define -- Clip and Unit refer to each other
  clips: Clip[],
  unitBase: number,
  singleBase: number,
  groupId?: string | undefined,
  /** Effective pin time: the unit is outside the reorder window and starts then (or as soon as there is room). */
  pinTime?: number | undefined,
  /** Part of it is already placed (split): its position in the order is taken. */
  started: boolean,
}

const isSingle = (unit: Unit) => unit.singleBase >= 0;

interface Clip {
  id: string,
  duration: number,
  range: AspectRange,
  widths: { min: number, max: number, preferred: number },
  /** Normalized rect sizes, for the upscale estimate. */
  size?: { maxWidth: number, maxHeight: number, minHeight: number } | undefined,
  /** The unit the clip starts with (itself, its group or its pinned unit). */
  unit: Unit,
  /** Index among the ordered single clips (base list, or shuffled in random mode); -1 for grouped and pinned clips. */
  singleBase: number,
  /** Index of its unit among the ordered units; -1 for pinned clips. */
  unitBase: number,
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
  /**
   * How many more columns than `maxColumns` the pending pins would need at their times with this option (summed over
   * the pins). Options are compared by it first, then by cost: this is how a column gets freed before a pin.
   */
  violation: number,
  cost: number,
  assignments: Assignment[],
  /** Present for a re-layout. */
  relayout?: {
    time: number,
    duration: number,
    row: RowItem[],
    widths: number[],
    fill: number,
    /** Columns that go away (their clips end when the animation does). */
    removed: number[],
    /** Group columns left without a clip (no clips remaining): they become fill when they end. */
    closed: number[],
  } | undefined,
}

const isBetter = (a: Option, b: Option | undefined) => b == null || a.violation < b.violation || (a.violation === b.violation && a.cost < b.cost - EPS);

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

const range1 = (n: number) => Array.from({ length: Math.max(0, n) }, (_v, i) => i + 1);

/** The clip in main-axis units: `height` is the cross length of the frame; rows transpose the clip. */
function toClip(clip: PlannerClip, unit: Unit, height: number, axis: LayoutAxis): Clip {
  invariant(clip.duration > 0 && Number.isFinite(clip.duration), `Invalid duration for clip ${clip.id}`);
  const range = getMainAspectRange(clip.aspectRange, axis);
  let size: Clip['size'];
  if (clip.rects != null) {
    const { max, min } = normalizeClipRects(clip.rects.maxRect, clip.rects.minRect);
    const [tMax, tMin] = axis === 'columns' ? [max, min] : [transposeRect(max), transposeRect(min)];
    size = { maxWidth: tMax.width, maxHeight: tMax.height, minHeight: tMin.height };
  }
  const single = isSingle(unit) && unit.pinTime == null;
  return { id: clip.id, duration: clip.duration, range, widths: getWidthRange(range, height), size, unit, singleBase: single ? unit.singleBase : -1, unitBase: unit.pinTime == null ? unit.unitBase : -1 };
}

/**
 * Whole-plan score (lower is better), with the same weights as the per-event decisions, so plans along different axes
 * can be compared (T29, square output). All terms are dimensionless (fractions of the frame, crop losses, scale
 * factors), so a rows plan and a columns plan of the same clips are measured alike:
 * - `fill`: structural row fill, fraction of the frame × seconds;
 * - `clips`: per clip, the time-weighted crop loss, upscale and column count terms of the columns it sits in, plus its
 *   pillarbox/letterbox area × seconds (and {@link LETTERBOX_WEIGHT} once if it is letterboxed);
 * - `relayouts`: per layout change;
 * - `order`: positions away from the base list (single clips among themselves, groups among the ordered units).
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

  const placements: ColumnPlacement[] = [];
  const layouts: LayoutKeyframe[] = [];

  if (inputClips.length === 0) {
    layouts.push({ time: 0, transitionDuration: 0, columns: [], fills: [{ x: 0, width: W }] });
    return { plan: { ...output, duration: 0, placements, layouts, warnings: [] }, score: { total: 0, fill: 0, clips: 0, relayouts: 0, order: 0 } };
  }

  // Units (A4): ordered ones (singles and groups, in base order) and pinned ones (by pin time).
  const planUnits = getPlanUnits(inputClips, settings);
  const toUnit = (u: (typeof planUnits.ordered)[number]): Unit => {
    const unit: Unit = { clips: [], unitBase: u.unitBase, singleBase: u.singleBase, groupId: u.groupId, pinTime: u.pinTime, started: false };
    unit.clips = u.clips.map((clip) => toClip(clip, unit, H, axis));
    return unit;
  };
  /** Ordered units not placed yet, in base order. */
  const remaining = planUnits.ordered.map((u) => toUnit(u));
  /** Pinned units whose time hasn't come yet, by pin time. */
  const pins = planUnits.pinned.map((u) => toUnit(u));
  /** Pinned units whose time has come without room for them: they go in as soon as possible. */
  const overdue: Unit[] = [];
  const allClips = new Map([...remaining, ...pins].flatMap((unit) => unit.clips.map((clip) => [clip.id, clip] as const)));

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
  /** Next position among the ordered single clips (the reorder window). */
  let singlePosition = 0;
  /** Next position among the ordered units (singles and groups). */
  let unitPosition = 0;
  /** Start of the last picked clip: picks never start before it, so pick order = start order (pins aside). */
  let lastStart = 0;
  /** End of the last layout animation: a new one can't start before. */
  let animationEnd = 0;

  const remainingClipCount = () => remaining.reduce((acc, unit) => acc + unit.clips.length, 0);
  const hasPendingPins = () => pins.length > 0 || overdue.length > 0;

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
   * Order cost of starting `atOnce` (together, sorted by base) and then `later` (one after the other) at the next
   * positions, or undefined if it breaks the reorder window: a single clip more than N positions away from its index,
   * a group more than N positions early, or a single clip left behind that could no longer fit in its window.
   * A group may start late (it waits for room), which costs like being away from its position.
   */
  function getOrderCost(atOnce: Unit[], later: Unit[] = []) {
    let single = singlePosition;
    let unit = unitPosition;
    let cost = 0;
    for (const u of [...atOnce, ...later]) {
      if (u.pinTime == null && !u.started) {
        if (isSingle(u)) {
          const delta = Math.abs(single - u.singleBase);
          if (delta > N) return undefined;
          cost += delta;
          single += 1;
        } else {
          if (unit < u.unitBase - N) return undefined;
          cost += Math.abs(unit - u.unitBase);
        }
        unit += 1;
      }
    }
    const leftBehind = remaining.find((u) => isSingle(u) && !atOnce.includes(u) && !later.includes(u));
    if (leftBehind != null && single > leftBehind.singleBase + N) return undefined;
    return cost * ORDER_WEIGHT;
  }

  /** A chunk of a group larger than `maxColumns` waits until the previous chunk has started. */
  const isWaitingChunk = (unit: Unit) => unit.groupId != null
    && remaining.some((other) => other !== unit && other.groupId === unit.groupId && other.unitBase < unit.unitBase && !other.started);

  /** Remaining units a pick at `position + maxPicks - 1` could still take, in base order. */
  const getWindow = (maxPicks: number) => remaining.filter((unit) => (isSingle(unit)
    ? unit.singleBase <= singlePosition + N + maxPicks - 1
    : unit.started || (unit.unitBase <= unitPosition + N + maxPicks - 1 && !isWaitingChunk(unit))));

  /** Cut the window so the subset enumeration stays within {@link SUBSET_BUDGET}. */
  function pruneCandidates<T>(window: T[], sizes: number[]) {
    let n = window.length;
    const count = (c: number) => sizes.reduce((acc, m) => acc + combinations(c, m), 0);
    while (n > 1 && count(n) > SUBSET_BUDGET) n -= 1;
    return window.slice(0, n);
  }

  const clipCount = (units: Unit[]) => units.reduce((acc, unit) => acc + unit.clips.length, 0);

  /** Demand of each pending pin at its time: its clips plus the earlier pinned clips still playing then. */
  let pinDemands: number[] = [];
  const updatePinDemands = () => {
    pinDemands = pins.map((pin, i) => {
      const earlier = pins.slice(0, i).reduce((acc, e) => acc + e.clips.filter((clip) => e.pinTime! + clip.duration > pin.pinTime! + EPS).length, 0);
      // the row is never empty: without earlier pins still playing, some other column is always busy then
      return earlier > 0 ? pin.clips.length + earlier : Math.min(pin.clips.length, maxColumns - 1);
    });
  };
  updatePinDemands();

  /**
   * Reserve for the pending pins: given the clips of a row and when they end, how short of room the pins would be at
   * their times: per pin, the columns too many still busy then, or 1 if they are few enough but the pin's clips
   * wouldn't fit next to them (at their min rects). Summed over the pins; 0 when every pin will find room.
   */
  function getViolation(items: { clip: Clip, end: number }[]) {
    if (pins.length === 0) return 0;
    const maxEnd = Math.max(...items.map((item) => item.end));
    let violation = 0;
    for (let i = 0; i < pins.length && pins[i]!.pinTime! < maxEnd; i += 1) {
      const pin = pins[i]!;
      const time = pin.pinTime!;
      const busy = items.filter((item) => item.end > time + EPS);
      const over = busy.length + pinDemands[i]! - maxColumns;
      if (over > 0) {
        violation += over;
      } else if (busy.length > 0) {
        const pinned = pins.slice(0, i).flatMap((earlier) => earlier.clips.filter((clip) => earlier.pinTime! + clip.duration > time + EPS));
        const clips = [...busy.map((item) => item.clip), ...pinned, ...pin.clips];
        if (distributeWidths({ clips: clips.map((clip) => clip.range), width: W, height: H, gap }) == null) violation += 1;
      }
    }
    return violation;
  }

  /**
   * Widths for a row of clips, undefined if they don't fit even at their min rects. With `squeeze` (clips that must
   * start together: pins and groups) they always fit: each one is narrowed below its min in the same proportion
   * (letterboxed).
   */
  function distribute(row: Clip[], squeeze = false) {
    const result = distributeWidths({ clips: row.map((c) => c.range), width: W, height: H, gap });
    if (result != null) return result;
    // A lone clip that is too wide even at its min rect: letterbox it over the full width (last resort).
    if (row.length === 1) return { widths: [floorEven(W)], fill: W - floorEven(W) };
    if (!squeeze) return undefined;
    const usable = W - (row.length - 1) * gap;
    const sumMin = row.reduce((acc, clip) => acc + clip.widths.min, 0);
    if (usable < 2 * row.length) return undefined;
    const factor = (floorEven(usable) - 2 * row.length) / sumMin;
    const aspects = row.map((clip) => Math.max(2 / H, (clip.range.min * factor)));
    return distributeWidths({ clips: aspects.map((a) => ({ min: a, max: a, preferred: a })), width: W, height: H, gap });
  }

  /** Pins and groups can squeeze a row (see `distribute`). Plans without them never do. */
  const canSqueeze = pins.length > 0 || remaining.some((unit) => !isSingle(unit));
  /** The current row's clips don't fit at their min rects: it was squeezed. */
  const isRowSqueezed = () => canSqueeze && order.length > 1
    && distributeWidths({ clips: order.map((id) => columns.get(id)!.clip.range), width: W, height: H, gap }) == null;

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

  /** Takes placed clips out of their units, and their units out of the queues, advancing the order positions. */
  function commit(clips: Clip[]) {
    for (const unit of new Set(clips.map((clip) => clip.unit))) {
      if (unit.pinTime == null && !unit.started) {
        if (isSingle(unit)) singlePosition += 1;
        unitPosition += 1;
      }
      unit.started = true;
      unit.clips = unit.clips.filter((clip) => !clips.includes(clip));
      if (unit.clips.length === 0) {
        [remaining, pins, overdue].forEach((list) => {
          const i = list.indexOf(unit);
          if (i !== -1) list.splice(i, 1);
        });
      }
    }
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
    // pins at 0 go in first (as many as fit; the rest wait for room). With nothing else to start the video, the
    // earliest pin moves to 0.
    const atZero: Unit[] = [];
    while (pins.length > 0 && (pins[0]!.pinTime! <= EPS || (remaining.length === 0 && atZero.length === 0))) {
      const pin = pins.shift()!;
      if (clipCount(atZero) + pin.clips.length <= maxColumns) atZero.push(pin);
      else overdue.push(pin);
    }
    updatePinDemands();
    const pinnedClips = atZero.flatMap((unit) => unit.clips);
    const room = maxColumns - pinnedClips.length;
    const due = remaining.find((unit) => !isSingle(unit) && unitPosition >= unit.unitBase + N);

    const window = getWindow(room);
    const sizes = [...(pinnedClips.length > 0 ? [0] : []), ...range1(room)];
    const candidates = pruneCandidates(window, sizes);
    let best: { option: Option, missing: number, clips: Clip[], widths: number[], fill: number } | undefined;
    // clips that can't share the row even at their min rects only go in squeezed when nothing else fits (pins, groups)
    for (const squeeze of [false, true]) {
      if (best != null) break;
      for (const m of sizes) {
        for (const idx of subsets(candidates.length, m)) {
          const units = idx.map((i) => candidates[i]!);
          const picked = units.flatMap((unit) => unit.clips);
          const orderCost = picked.length <= room ? getOrderCost(units) : undefined;
          const clips = [...picked, ...pinnedClips];
          const dist = orderCost != null ? distribute(clips, squeeze) : undefined;
          if (orderCost != null && dist != null) {
            const cost = orderCost + fillCost(dist.fill, ROW_FILL_SECONDS)
            + rowCost(clips.map((clip, i) => ({ clip, width: dist.widths[i]!, seconds: clip.duration })));
            const option: Option = { violation: getViolation(clips.map((clip) => ({ clip, end: clip.duration }))), cost, assignments: [] };
            const missing = due != null && !units.includes(due) ? 1 : 0;
            if (best == null || missing < best.missing || (missing === best.missing && isBetter(option, best.option))) {
              best = { option, missing, clips, widths: dist.widths, fill: dist.fill };
            }
          }
        }
      }
    }
    invariant(best != null, 'No initial row');
    const ids = best.clips.map((clip) => {
      const id = newColumnId();
      place(id, clip, 0, 0);
      return id;
    });
    commit(best.clips);
    setRow(ids, best.widths, best.fill);
    layouts.push(buildLayout(0, 0, ids, best.widths, best.fill));
  }

  // --- events: the column whose clip ends first gets the next clip(s) ---

  /** Ends of the row's columns if `trigger`'s column gets a clip ending at `end`, without changing the layout. */
  const inPlaceItems = (trigger: Column, clip: Clip, end: number) => order.map((id) => (id === trigger.id ? { clip, end } : columns.get(id)!));
  const rowFillSeconds = (e1: number, ids: number[]) => Math.min(ROW_FILL_SECONDS, ...ids.map((id) => columns.get(id)!.end - e1));

  /**
   * Re-layout without picks: `trigger`'s column goes away (with the columns ending at the same time, as long as one
   * stays) and the others share the row (no merged event). Frees columns for a pin or a group.
   */
  function getDrainOption(trigger: Column): Option | undefined {
    const { end: e1 } = trigger;
    const removed = [trigger, ...order.map((id) => columns.get(id)!).filter((col) => col !== trigger && col.active && Math.abs(col.end - e1) <= EPS)];
    const keptActive = () => order.filter((id) => columns.get(id)!.active && !removed.some((col) => col.id === id));
    while (removed.length > 1 && keptActive().length === 0) removed.pop();
    if (keptActive().length === 0) return undefined;
    const kept = order.filter((id) => !removed.some((col) => col.id === id));
    const duration = Math.min(...removed.map((col) => getTransition(col.clip, undefined, e1, Math.max(lastStart, animationEnd))));
    if (e1 < animationEnd || (D > 0 && duration <= EPS)) return undefined;
    const row: RowItem[] = kept.map((id) => ({ column: id, clip: columns.get(id)!.clip, end: columns.get(id)!.end }));
    const dist = distribute(row.map((item) => item.clip), isRowSqueezed());
    if (dist == null) return undefined;
    const cost = fillCost(dist.fill, rowFillSeconds(e1, kept)) + RELAYOUT_WEIGHT
      + rowCost(row.map((item, i) => ({ clip: item.clip, width: dist.widths[i]!, seconds: item.end - e1 })));
    return {
      violation: getViolation(row),
      cost,
      assignments: [],
      relayout: { time: e1 - duration, duration, row, widths: dist.widths, fill: dist.fill, removed: removed.map((col) => col.id), closed: [] },
    };
  }

  /**
   * Options that start `clips` (a unit that can't wait, or part of it) together when `trigger`'s column ends: in place
   * (a single clip, keeping the layout) or a re-layout where the column takes the first clip and new columns right
   * after it take the others. No merged event, so every other column is kept. A pinned unit never starts before its
   * pin time (unless it is released early because nothing else is left to play).
   */
  function getForcedOptions(trigger: Column, unit: Unit, clips: Clip[], squeeze = false): Option[] {
    const { end: e1, clip: a1 } = trigger;
    const w1 = widthOf.get(trigger.id)!;
    const first = clips[0];
    invariant(first != null);
    const orderCost = getOrderCost([unit]);
    if (orderCost == null) return [];
    const notBefore = unit.pinTime == null ? lastStart : (unit.pinTime > e1 ? -Infinity : unit.pinTime);
    const others = order.filter((id) => id !== trigger.id);
    const options: Option[] = [];

    if (clips.length === 1) {
      const transitionIn = getTransition(a1, first, e1, notBefore);
      const start = e1 - transitionIn;
      const items = order.map((id) => {
        const col = columns.get(id)!;
        return id === trigger.id ? { clip: first, width: w1, seconds: first.duration } : { clip: col.clip, width: widthOf.get(id)!, seconds: col.end - e1 };
      });
      options.push({
        violation: getViolation(inPlaceItems(trigger, first, start + first.duration)),
        cost: orderCost + fillCost(rowFill, rowFillSeconds(e1, others)) + rowCost(items),
        assignments: [{ column: trigger.id, clip: first, start, transitionIn }],
      });
    }

    // Re-layout: the columns ending right now (this one first) take the clips with the same crossfade, the others go
    // away, and extra clips get new columns after this one. So they all start at `time`.
    const ending = [trigger, ...order.map((id) => columns.get(id)!).filter((col) => col !== trigger && col.active && Math.abs(col.end - e1) <= EPS)];
    const staying = others.filter((id) => !ending.some((col) => col.id === id));
    if (staying.length + clips.length <= maxColumns && e1 >= animationEnd) {
      const used = ending.slice(0, clips.length);
      const removed = ending.slice(clips.length);
      const duration = Math.min(
        ...used.map((col, i) => getTransition(col.clip, clips[i], e1, Math.max(notBefore, animationEnd))),
        ...removed.map((col) => getTransition(col.clip, undefined, e1, Math.max(notBefore, animationEnd))),
      );
      if (!(D > 0 && duration <= EPS)) {
        const time = e1 - duration;
        const assignments: Assignment[] = clips.map((clip, i) => ({ column: used[i]?.id, clip, start: time, transitionIn: i < used.length ? duration : 0 }));
        const row: RowItem[] = [];
        order.forEach((id) => {
          const col = columns.get(id)!;
          const a = assignments.find((x) => x.column === id);
          if (a != null) row.push({ column: id, clip: a.clip, end: time + a.clip.duration });
          if (id === trigger.id) assignments.filter((x) => x.column == null).forEach((x) => row.push({ column: undefined, clip: x.clip, end: time + x.clip.duration }));
          else if (a == null && !removed.includes(col)) row.push({ column: id, clip: col.clip, end: col.end });
        });
        const dist = distribute(row.map((item) => item.clip), squeeze || isRowSqueezed());
        if (dist != null) {
          const unchanged = clips.length === 1 && removed.length === 0 && dist.fill === rowFill && row.every((item, i) => widthOf.get(item.column!) === dist.widths[i]);
          options.push({
            violation: getViolation(row),
            cost: orderCost + fillCost(dist.fill, rowFillSeconds(e1, staying)) + (unchanged ? 0 : RELAYOUT_WEIGHT)
              + rowCost(row.map((item, i) => ({ clip: item.clip, width: dist.widths[i]!, seconds: Math.min(item.clip.duration, item.end - e1) }))),
            assignments,
            relayout: { time, duration, row, widths: dist.widths, fill: dist.fill, removed: removed.map((col) => col.id), closed: [] },
          });
        }
      }
    }
    return options;
  }

  const bestOf = (options: Option[]) => options.reduce<Option | undefined>((best, option) => (isBetter(option, best) ? option : best), undefined);

  /** A unit that can't wait: an overdue pin, the rest of a split group, or a group whose window is over. */
  const getForcedUnit = () => overdue[0]
    ?? remaining.find((unit) => unit.started)
    ?? remaining.find((unit) => !isSingle(unit) && unitPosition >= unit.unitBase + N && !isWaitingChunk(unit));

  /** The usual options of an event (04-diseno §3.3), with groups and the pins' reserve. Undefined if there's none. */
  function resolveNormalEvent(trigger: Column): Option | undefined {
    const { end: e1, clip: a1 } = trigger;
    const w1 = widthOf.get(trigger.id)!;

    // 1. Direct substitution: the first clip in order that fits the freed width. No layout change. It wins outright
    // unless the row has structural fill: then a re-layout that clearly reduces it goes first (see CLEAR_FILL_REDUCTION).
    // With pins pending, it must also leave room for them.
    const singleWindow = getWindow(1).filter((unit) => isSingle(unit));
    let direct: Option | undefined;
    for (const unit of singleWindow) {
      const clip = unit.clips[0]!;
      if (getColumnFit(clip.range, w1, H) === 'fill' && getOrderCost([unit]) != null) {
        const transitionIn = getTransition(a1, clip, e1, lastStart);
        const start = e1 - transitionIn;
        direct = { violation: getViolation(inPlaceItems(trigger, clip, start + clip.duration)), cost: 0, assignments: [{ column: trigger.id, clip, start, transitionIn }] };
        break;
      }
    }
    if (direct != null && direct.violation === 0 && rowFill <= 1) return direct;
    /** A direct substitution that respects the pins restricts the re-layouts (fill before direct substitution, T10b). */
    const restricted = direct != null && direct.violation === 0;
    /** With a direct substitution at hand, only re-layouts that clearly reduce the fill are considered. */
    const maxRelayoutFill = restricted ? Math.max(1, rowFill * CLEAR_FILL_REDUCTION) : Infinity;

    let best: Option | undefined;
    const consider = (option: Option) => {
      if (isBetter(option, best)) best = option;
    };
    if (direct != null && !restricted) consider(direct);

    // 2a. In place with fill (pillarbox/letterbox), no layout change.
    if (!restricted) {
      singleWindow.forEach((unit) => {
        const clip = unit.clips[0]!;
        const orderCost = getOrderCost([unit]);
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
          violation: getViolation(inPlaceItems(trigger, clip, start + clip.duration)),
          cost: orderCost + fillCost(rowFill, rowFillSeconds(e1, order.filter((id) => id !== trigger.id))) + rowCost(items),
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
    const R = remainingClipCount();
    const maxPicks = Math.min(R, maxColumns - kept.length);

    // family 'replace': the trigger column gets a clip (+ new columns after it); 'remove': it disappears
    const sizes = new Set<number>();
    for (let m = 1; m <= maxPicks; m += 1) if (m >= g || m === R) sizes.add(m);
    const removeSizes = new Set<number>();
    if (kept.length + g - 1 >= 1) {
      if (g - 1 <= R) removeSizes.add(g - 1);
      else removeSizes.add(R);
    }
    const window = getWindow(Math.max(maxPicks, g - 1, 1));
    // a row squeezed for a pin or a group may stay squeezed until its clips end
    const squeezed = isRowSqueezed();
    const hasGroups = window.some((unit) => !isSingle(unit));
    // subsets are enumerated by number of units; without groups a unit is a clip
    const replaceCounts = hasGroups ? range1(Math.max(0, ...sizes)) : [...sizes].sort((a, b) => a - b);
    const candidates = pruneCandidates(window, [...new Set([...replaceCounts, ...removeSizes])]);

    const evaluate = (family: 'replace' | 'remove', units: Unit[]) => {
      const m = clipCount(units);
      if (family === 'replace' && !sizes.has(m)) return;
      // Slots in start order: trigger, new columns (both at the animation start), then the other group columns.
      // Groups must start together, so they only go in the first ones.
      let atOnce: Unit[] = [];
      let later: Unit[];
      if (family === 'replace') {
        const T = 1 + Math.max(0, m - g);
        const groups = units.filter((unit) => !isSingle(unit));
        const singles = units.filter((unit) => isSingle(unit));
        const groupClips = clipCount(groups);
        if (groupClips > T) return;
        atOnce = [...groups, ...singles.slice(0, T - groupClips)].sort((a, b) => a.unitBase - b.unitBase);
        later = singles.slice(T - groupClips);
      } else {
        if (units.some((unit) => !isSingle(unit))) return;
        later = units;
      }
      const orderCost = getOrderCost(atOnce, later);
      if (orderCost == null) return;
      const picks = [...atOnce, ...later].flatMap((unit) => unit.clips);

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
      // a column left without clip while pins are pending would be a hole in the video
      if (closed.length > 0 && hasPendingPins()) return;

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

      const dist = distribute(row.map((item) => item.clip), squeezed);
      if (dist == null) return;
      if (dist.fill > maxRelayoutFill || (restricted && row.some((item, i) => getColumnFit(item.clip.range, dist.widths[i]!, H) !== 'fill'))) return;

      const unchanged = family === 'replace' && newClips.length === 0 && dist.fill === rowFill
        && row.every((item, i) => widthOf.get(item.column!) === dist.widths[i]);
      let cost = orderCost + fillCost(dist.fill, rowFillSeconds(e1, kept))
        + (unchanged ? 0 : RELAYOUT_WEIGHT)
        + rowCost(row.map((item, i) => ({ clip: item.clip, width: dist.widths[i]!, seconds: Math.min(item.clip.duration, item.end - e1) })));
      row.forEach((item, i) => {
        if (item.outgoing != null) cost += misfitCost(item.outgoing.clip, dist.widths[i]!, item.outgoing.end - e1);
      });

      consider({
        violation: getViolation(row),
        cost,
        assignments,
        relayout: { time, duration, row, widths: dist.widths, fill: dist.fill, removed: family === 'remove' ? [trigger.id] : [], closed },
      });
    };

    for (const u of replaceCounts) {
      for (const idx of subsets(candidates.length, u)) evaluate('replace', idx.map((i) => candidates[i]!));
    }
    for (const m of removeSizes) {
      for (const idx of subsets(candidates.length, m)) evaluate('remove', idx.map((i) => candidates[i]!));
    }
    // with pins pending, removing just this column (no merged event) also frees room
    if (hasPendingPins() && g > 1) {
      const drain = getDrainOption(trigger);
      if (drain != null) consider(drain);
    }

    // a direct substitution that respects the pins beats re-layouts that don't
    if (restricted && (best == null || best.violation > 0)) return direct;
    return best;
  }

  function resolveEvent(trigger: Column): Option {
    // A unit that can't wait goes in now if it can, else this column is removed to make room for it.
    const forced = getForcedUnit();
    if (forced != null) {
      const option = bestOf(getForcedOptions(trigger, forced, forced.clips));
      // an overdue pin goes first (pins keep their order)
      if (option != null && (forced.pinTime != null || option.violation === 0)) return option;
      const drain = getDrainOption(trigger);
      // squeezed (letterboxed below their min) only if there's no room otherwise
      const chosen = option ?? drain ?? bestOf(getForcedOptions(trigger, forced, forced.clips, true));
      if (chosen != null) {
        if (forced.pinTime != null || chosen.violation === 0) return chosen;
        // a group waits if it would take the room a pending pin needs
        return [drain, resolveNormalEvent(trigger)].reduce<Option>((a, b) => (b != null && b.violation < a.violation ? b : a), chosen);
      }
    }
    const normal = resolveNormalEvent(trigger);
    if (normal != null) return normal;

    // Nothing else fits. Only pins left: remove the column if others remain, else the next pin comes early.
    let unit = forced ?? remaining[0];
    if (unit == null) {
      const drain = getDrainOption(trigger);
      if (drain != null) return drain;
      unit = pins.shift();
      invariant(unit != null, 'No option for event');
      updatePinDemands();
      overdue.unshift(unit);
    } else {
      const option = bestOf(getForcedOptions(trigger, unit, unit.clips)) ?? getDrainOption(trigger)
        ?? bestOf(getForcedOptions(trigger, unit, unit.clips, true));
      if (option != null) return option;
    }
    // Last resort: split the unit, starting what fits now (at least one clip, in place).
    const room = Math.max(1, maxColumns - order.filter((id) => id !== trigger.id && columns.get(id)!.active).length);
    const option = bestOf(getForcedOptions(trigger, unit, unit.clips.slice(0, room), true))
      ?? bestOf(getForcedOptions(trigger, unit, unit.clips.slice(0, 1), true));
    invariant(option != null, 'No option for event');
    return option;
  }

  /**
   * A pin's time has come: its clips start now in new columns at the right end of the row if there are columns enough
   * (the reserve made it likely), squeezing the row if they don't fit at their min rects: an exact time wins over
   * letterboxing. The animation ends before any column ends or the next pin comes. Otherwise it waits (overdue).
   */
  function startPin(pin: Unit) {
    const time = pin.pinTime!;
    // pins at the same time start together, as many as there are columns for
    const due: Unit[] = [];
    while (pins.length > 0 && pins[0]!.pinTime! <= time + EPS) due.push(pins.shift()!);
    updatePinDemands();
    const ids = [...order];
    const rowClips = ids.map((id) => columns.get(id)!.clip);
    const starting: Unit[] = [];
    let dist: ReturnType<typeof distribute>;
    const allActive = ids.every((id) => columns.get(id)!.active);
    // pins already late go first, in order; a pin that doesn't fit waits and so do the ones after it
    const waiting = [...overdue, ...due];
    overdue.length = 0;
    waiting.forEach((unit) => {
      const clips = [...starting, unit].flatMap((u) => u.clips);
      const next = overdue.length === 0 && allActive && ids.length + clips.length <= maxColumns && time >= animationEnd - EPS
        ? distribute([...rowClips, ...clips], true)
        : undefined;
      if (next != null) {
        starting.push(unit);
        dist = next;
      } else {
        overdue.push(unit);
      }
    });
    if (dist == null) return;
    const clips = starting.flatMap((u) => u.clips);
    const ends = [...ids.map((id) => columns.get(id)!.end), ...clips.map((clip) => time + clip.duration)];
    const duration = Math.max(0, Math.min(D, (Math.min(...ends) - time) / 2, (pins[0]?.pinTime ?? Infinity) - time));
    clips.forEach((clip) => {
      const id = newColumnId();
      ids.push(id);
      place(id, clip, time, 0);
    });
    commit(clips);
    setRow(ids, dist.widths, dist.fill);
    layouts.push(buildLayout(time, duration, ids, dist.widths, dist.fill));
    animationEnd = Math.max(animationEnd, time + duration);
  }

  function applyOption(option: Option) {
    const newIds: number[] = [];
    option.assignments.forEach(({ column, clip, start, transitionIn }) => {
      let id = column;
      if (id == null) {
        id = newColumnId();
        newIds.push(id);
      }
      place(id, clip, start, transitionIn);
    });
    commit(option.assignments.map((a) => a.clip));

    const { relayout } = option;
    if (relayout != null) {
      relayout.closed.forEach((id) => { columns.get(id)!.active = false; });
      relayout.removed.forEach((id) => columns.delete(id));
      let nextNew = 0;
      const ids = relayout.row.map((item) => {
        if (item.column != null) return item.column;
        const id = newIds[nextNew]!;
        nextNew += 1;
        return id;
      });
      // a merged event may keep every width: then there's nothing to animate
      const changed = newIds.length > 0 || relayout.removed.length > 0 || relayout.fill !== rowFill
        || ids.some((id, i) => widthOf.get(id) !== relayout.widths[i]);
      if (changed) {
        setRow(ids, relayout.widths, relayout.fill);
        layouts.push(buildLayout(relayout.time, relayout.duration, ids, relayout.widths, relayout.fill));
        animationEnd = relayout.time + relayout.duration;
      }
    }
  }

  while (remaining.length > 0 || hasPendingPins()) {
    let trigger: Column | undefined;
    for (const id of order) {
      const col = columns.get(id)!;
      if (col.active && (trigger == null || col.end < trigger.end - EPS)) trigger = col;
    }
    invariant(trigger != null, 'No active column while clips remain');

    const pin = pins[0];
    if (pin != null && pin.pinTime! < trigger.end - EPS) startPin(pin);
    else applyOption(resolveEvent(trigger));
  }

  // Remaining columns just run out: their areas become fill, no re-layout (01-requisitos §4.3).

  // Pins may start before clips picked earlier; everything else is already in start order.
  const startKey = (p: ColumnPlacement) => Math.round(p.startTime * 1e6);
  placements.sort((a, b) => startKey(a) - startKey(b));
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
  let singleIndex = 0;
  const startedUnits = new Set<number>();
  placements.forEach((placement) => {
    const clip = allClips.get(placement.clipId)!;
    if (clip.unitBase >= 0 && !startedUnits.has(clip.unitBase)) {
      if (clip.singleBase >= 0) {
        score.order += ORDER_WEIGHT * Math.abs(singleIndex - clip.singleBase);
        singleIndex += 1;
      } else {
        score.order += ORDER_WEIGHT * Math.abs(startedUnits.size - clip.unitBase);
      }
      startedUnits.add(clip.unitBase);
    }
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
