import { ASPECT_TOLERANCE, getCellRect, getCropForAspect, getScaleFactor } from '../geometry';
import type { AspectRange } from '../geometry';
import { getPlanAxis } from './types';
import { getEffectiveGroups, getEffectivePins } from './units';
import type { LayoutKeyframe, MixPlan, PlanWarning, PlannerClip } from './types';

const EPS = 1e-9;
/** A pinned clip or a group member off its start by more than this (s) is warned about (and checked by validatePlan). */
export const PIN_TOLERANCE = 1e-6;

/**
 * How a clip sits in a column of `width`×`height` px: fill (within the aspect tolerance, as getCropForAspect),
 * pillarbox or letterbox. The planner calls it in main-axis units (transposed range, main length, cross length), where
 * `pillarbox` means "longer than the clip allows" along the main axis; with real sizes it is the real fit.
 */
export function getColumnFit(range: AspectRange, width: number, height: number) {
  const aspect = width / height;
  if (aspect > range.max * (1 + ASPECT_TOLERANCE)) return 'pillarbox';
  if (aspect < range.min * (1 - ASPECT_TOLERANCE)) return 'letterbox';
  return 'fill';
}

/** Keyframes with the interval where each one holds still: [time + transitionDuration, next keyframe time). */
export function getStableLayouts(plan: Pick<MixPlan, 'layouts'>) {
  return plan.layouts.map((layout, i): { from: number, to: number, layout: LayoutKeyframe } => ({
    from: layout.time + layout.transitionDuration,
    to: plan.layouts[i + 1]?.time ?? Infinity,
    layout,
  }));
}

/**
 * Warnings of a finished plan (see {@link PlanWarning}). `cutClipIds`: clips that follow the previous one of their
 * chain or sequence with a direct cut on purpose (E2/E5, T38), not a shortened transition.
 */
export function getPlanWarnings(
  plan: Omit<MixPlan, 'warnings'>,
  clips: readonly PlannerClip[],
  transitionDuration: number,
  cutClipIds: ReadonlySet<string> = new Set(),
): PlanWarning[] {
  const clipById = new Map(clips.map((clip) => [clip.id, clip]));
  const stable = getStableLayouts(plan);
  const axis = getPlanAxis(plan);
  // output size of a column/row: warnings are about what the viewer sees, whatever the axis
  const cellSize = (length: number) => getCellRect(axis, { offset: 0, length }, plan);
  const warnings: PlanWarning[] = [];

  plan.layouts.forEach((layout) => {
    const fill = layout.fills.reduce((acc, f) => acc + f.width, 0);
    // 1 px is just an odd usable width (odd gap), already warned about by validateMixProject
    if (layout.columns.length > 0 && fill > 1) warnings.push({ type: 'fill', time: layout.time, width: fill });
  });

  const firstInColumn = new Set<number>();
  plan.placements.forEach((placement) => {
    const clip = clipById.get(placement.clipId);
    if (clip == null) return;

    const isFirst = !firstInColumn.has(placement.column);
    firstInColumn.add(placement.column);
    if (!isFirst && placement.transitionIn < transitionDuration - EPS && !cutClipIds.has(clip.id)) {
      warnings.push({ type: 'transition-shortened', clipId: clip.id, duration: placement.transitionIn });
    }

    const misfits = new Set<string>();
    let maxFactor = 0;
    stable.forEach(({ from, to, layout }) => {
      if (Math.min(to, placement.endTime) - Math.max(from, placement.startTime) <= EPS) return;
      const col = layout.columns.find((c) => c.column === placement.column);
      if (col == null) return;
      const { width, height } = cellSize(col.width);
      const fit = getColumnFit(clip.aspectRange, width, height);
      if (fit !== 'fill' && !misfits.has(fit)) {
        misfits.add(fit);
        warnings.push({ type: fit, clipId: clip.id, time: Math.max(from, placement.startTime) });
      }
      if (clip.rects != null) {
        const { crop } = getCropForAspect(clip.rects.maxRect, clip.rects.minRect, width / height);
        maxFactor = Math.max(maxFactor, getScaleFactor(crop, width, height));
      }
    });
    if (maxFactor > 2) warnings.push({ type: 'upscale', clipId: clip.id, factor: maxFactor });
  });

  // A4 (T30): pins and groups the planner couldn't honour
  const startOf = new Map(plan.placements.map((p) => [p.clipId, p.startTime]));
  getEffectivePins(clips).forEach((pinTime, clipId) => {
    const time = startOf.get(clipId);
    if (time != null && Math.abs(time - pinTime) > PIN_TOLERANCE) warnings.push({ type: 'pin-shifted', clipId, pinTime, time });
  });
  getEffectiveGroups(clips).forEach((members, groupId) => {
    const starts = members.map((clip) => startOf.get(clip.id)).filter((t) => t != null);
    if (starts.length > 0 && Math.max(...starts) - Math.min(...starts) > PIN_TOLERANCE) {
      warnings.push({ type: 'group-split', groupId, clipIds: members.map((clip) => clip.id) });
    }
  });

  return warnings;
}
