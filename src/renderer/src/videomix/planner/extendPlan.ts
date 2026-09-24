import { extendMaxRect, getAxisLengths, getCellRect, getCropForAspect, getExtensionRoom, normalizeClipRects } from '../geometry';
import type { ExtendDirection, FrameSize, LayoutAxis } from '../geometry';
import type { Rect } from '../types';
import { getStableLayouts } from './planWarnings';
import { getPlanAxis } from './types';
import type { ColumnPlacement, LayoutKeyframe, MixPlan, PlannerClip } from './types';

// E7 (T38b, 01-requisitos §11, 04-diseno §3.8): extend clips beyond their max rect to cover fill, as a last resort.
// The planner picks its options exactly as before (with the normal aspect ranges); this pass runs on the finished plan:
// 1. every layout keyframe with structural fill gives it to its columns whose clips can show more material (along the
//    main axis, up to the source frame), in proportion to the material each one has, saturating; the rest stays fill;
// 2. every placement whose cells are longer than its max allows (pillarbox in columns, letterbox in rows: its own
//    in-place fill, or a column just made longer) gets `extendedMaxRect`, the max extended as much as those cells need
//    (centred on the max, asymmetric at the frame edge). Render and preview crop with it (getExtendedCropForAspect).
// The end of the video is untouched: columns whose clips have ended become fill as before (no keyframe is added), and
// without extendable clips the plan is the same object.

const EPS = 1e-9;

const floorEven = (v: number) => 2 * Math.floor(v / 2 + 1e-6) + 0;
const ceilEven = (v: number) => 2 * Math.ceil(v / 2 - 1e-6) + 0;

/** Direction of the extension: the plan's main axis (widths for columns, heights for rows). */
export const getExtendDirection = (axis: LayoutAxis): ExtendDirection => (axis === 'columns' ? 'horizontal' : 'vertical');

interface Extendable {
  maxRect: Rect,
  minRect: Rect | undefined,
  frame: FrameSize,
  /** Source px the max can grow along the main axis (both sides together). */
  room: number,
  /** Length of the (normalized) max along the main axis, source px. */
  mainMax: number,
  /** Cross length of the crop at the range limit (the min's height for columns, its width for rows), source px. */
  crossMin: number,
}

function getExtendable(clip: PlannerClip, direction: ExtendDirection): Extendable | undefined {
  if (clip.extendBeyondMax == null || clip.rects == null) return undefined;
  const { maxRect, minRect } = clip.rects;
  const { frame } = clip.extendBeyondMax;
  const room = getExtensionRoom(maxRect, frame, direction);
  if (room <= 0) return undefined;
  const { max, min } = normalizeClipRects(maxRect, minRect);
  const horizontal = direction === 'horizontal';
  return { maxRect, minRect, frame, room, mainMax: horizontal ? max.width : max.height, crossMin: horizontal ? min.height : min.width };
}

/**
 * Share `total` px (even) among items with the given even capacities, in proportion to them (never above one), in
 * units of 2 px by largest remainder (ties: lower index). Requires `total ≤ Σ capacities`.
 */
export function shareEven(total: number, capacities: number[]) {
  const sum = capacities.reduce((acc, c) => acc + c, 0);
  if (sum <= 0 || total <= 0) return capacities.map(() => 0);
  const ideal = capacities.map((c) => (total / 2) * (c / sum));
  const units = ideal.map((v, i) => Math.min(Math.floor(v + 1e-9), capacities[i]! / 2));
  let remaining = total / 2 - units.reduce((acc, u) => acc + u, 0);
  const order = ideal.map((_v, i) => i).sort((a, b) => (ideal[b]! - units[b]!) - (ideal[a]! - units[a]!));
  while (remaining > 0) {
    const before = remaining;
    for (const i of order) {
      if (remaining <= 0) break;
      if (units[i]! < capacities[i]! / 2) {
        units[i]! += 1;
        remaining -= 1;
      }
    }
    if (remaining === before) break; // no capacity left (not expected: total ≤ Σ capacities)
  }
  return units.map((u) => 2 * u);
}

/** The keyframe with new column lengths: the columns side by side with their gaps, the rest as fill centred around them (as the planner lays it out). */
function relayoutKeyframe(layout: LayoutKeyframe, widths: number[], main: number, gap: number): LayoutKeyframe {
  const used = widths.reduce((acc, w) => acc + w, 0) + (widths.length - 1) * gap;
  const fill = main - used;
  const left = floorEven(fill / 2);
  const fills: LayoutKeyframe['fills'] = [];
  if (left > 0) fills.push({ x: 0, width: left });
  let x = left;
  const columns = layout.columns.map((c, i) => {
    const col = { column: c.column, x, width: widths[i]! };
    x += widths[i]! + gap;
    return col;
  });
  const right = x - gap;
  if (right < main) fills.push({ x: right, width: main - right });
  return { ...layout, columns, fills };
}

/**
 * Source px (even, at most the room) the clip's max must grow along the main axis to fill a cell `length` px long;
 * 0 if the cell isn't longer than the clip allows. Decided with getCropForAspect on the real cell, like the render.
 */
function getNeededExtension(e: Extendable, axis: LayoutAxis, length: number, frame: { width: number, height: number }) {
  const cell = getCellRect(axis, { offset: 0, length }, frame);
  const { fit } = getCropForAspect(e.maxRect, e.minRect, cell.width / cell.height);
  if (fit !== (axis === 'columns' ? 'pillarbox' : 'letterbox')) return 0;
  const crossLength = axis === 'columns' ? cell.height : cell.width;
  const needed = (length * e.crossMin) / crossLength - e.mainMax;
  return Math.min(e.room, Math.max(0, ceilEven(needed)));
}

/**
 * E7 (T38b): the plan with fill turned into extended clips where the source has material (see the comment at the top).
 * `plan` without warnings (they depend on the result); `clips` are the planner's clips (only those with
 * `extendBeyondMax` and `rects` extend); `gap` is the settings' gap. Pure and deterministic.
 */
export function extendPlan(plan: MixPlan, clips: readonly PlannerClip[], gap: number): MixPlan {
  const axis = getPlanAxis(plan);
  const direction = getExtendDirection(axis);
  const { main, cross } = getAxisLengths(axis, plan);
  const extendable = new Map(clips.flatMap((clip) => {
    const e = getExtendable(clip, direction);
    return e != null ? [[clip.id, e] as const] : [];
  }));
  if (extendable.size === 0 || plan.placements.length === 0) return plan;

  const overlaps = (p: ColumnPlacement, from: number, to: number) => Math.min(to, p.endTime) - Math.max(from, p.startTime) > EPS;
  /** Longest cell (output px along the main axis, even) the clip fills with all its material. */
  const maxLength = (e: Extendable) => floorEven(((e.mainMax + e.room) * cross) / e.crossMin);

  // 1. structural fill → longer columns, where every clip the column shows while the keyframe holds can extend
  let layoutsChanged = false;
  const layouts = getStableLayouts(plan).map(({ from, to, layout }) => {
    const fill = layout.fills.reduce((acc, f) => acc + f.width, 0);
    if (layout.columns.length === 0 || fill < 2) return layout;
    const capacities = layout.columns.map((col) => {
      const shown = plan.placements.filter((p) => p.column === col.column && overlaps(p, from, to));
      if (shown.length === 0) return 0;
      let capacity = Infinity;
      for (const p of shown) {
        const e = extendable.get(p.clipId);
        if (e == null) return 0;
        capacity = Math.min(capacity, maxLength(e) - col.width);
      }
      return Math.max(0, floorEven(capacity));
    });
    const total = Math.min(capacities.reduce((acc, c) => acc + c, 0), floorEven(fill));
    if (total <= 0) return layout;
    const extra = shareEven(total, capacities);
    layoutsChanged = true;
    return relayoutKeyframe(layout, layout.columns.map((c, i) => c.width + extra[i]!), main, gap);
  });

  // 2. per placement, the extension its cells need (the longest one; the crop takes less in shorter cells)
  const stable = getStableLayouts({ layouts });
  let placementsChanged = false;
  const placements = plan.placements.map((p) => {
    const e = extendable.get(p.clipId);
    if (e == null) return p;
    let extra = 0;
    for (const { from, to, layout } of stable) {
      const col = overlaps(p, from, to) ? layout.columns.find((c) => c.column === p.column) : undefined;
      if (col != null) extra = Math.max(extra, getNeededExtension(e, axis, col.width, plan));
    }
    if (extra <= 0) return p;
    placementsChanged = true;
    return { ...p, extendedMaxRect: extendMaxRect(e.maxRect, e.frame, direction, extra) };
  });

  if (!layoutsChanged && !placementsChanged) return plan;
  return { ...plan, layouts, placements };
}
