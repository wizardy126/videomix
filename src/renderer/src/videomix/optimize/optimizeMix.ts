import invariant from 'tiny-invariant';

import { getEmptyColumnTime } from '../planner/optimizeOrder';
import { planMixBest } from '../planner/planMix';
import { getPlannerInput } from '../planner/plannerInput';
import type { PlanMixInput } from '../planner/types';
import type { MixClip, MixSettings } from '../types';

// I2 (T61): glue between the project and the order optimizer (pure).

/**
 * What the optimizer searches on: the planner input of the render, without the source sizes (E7's extension beyond
 * the max never changes the plan's decisions, T38b, and the plan quality is measured before it, T52).
 */
export const getOptimizeInput = ({ clips, settings }: { clips: MixClip[], settings: MixSettings }): PlanMixInput => getPlannerInput({ clips, settings });

/** The before/after figures of an order. */
export interface MixOrderMetrics {
  /** Seconds, of the whole mix (before the cut at the maximum duration, like the "≈ m:ss" estimate). */
  duration: number,
  /** Fraction of the frame × seconds without a clip (`PlanQuality.fill`). */
  fill: number,
  /** Seconds during which some column has no clip (at the end of the video). */
  emptyColumnTime: number,
}

/** The metrics of the plan the render would make for `input` with its clips in `order` (ids; default: as they are). */
export function getMixOrderMetrics(input: PlanMixInput, order?: readonly string[] | undefined): MixOrderMetrics {
  let { clips } = input;
  if (order != null) {
    const byId = new Map(clips.map((clip) => [clip.id, clip]));
    clips = order.map((id) => byId.get(id)).filter((clip) => clip != null);
    invariant(clips.length === input.clips.length, 'The order must have the same clips');
  }
  const { plan, quality } = planMixBest({ ...input, clips });
  return { duration: quality.duration, fill: quality.fill, emptyColumnTime: getEmptyColumnTime(plan) };
}

/**
 * The project's clip list (`clipIds`) with the planner's clips in `plannerOrder`: they take the positions the
 * planner's clips had, in the new order; the others (clips without a valid duration, left out of the plan) stay put.
 */
export function applyPlannerOrder(clipIds: readonly string[], plannerOrder: readonly string[]): string[] {
  const planned = new Set(plannerOrder);
  let next = 0;
  const result = clipIds.map((id) => {
    if (!planned.has(id)) return id;
    const replacement = plannerOrder[next];
    next += 1;
    invariant(replacement != null);
    return replacement;
  });
  invariant(next === plannerOrder.length, 'The planner order has clips that are not in the list');
  return result;
}

/** How many clips are at another position of the list. */
export const countMovedClips = (before: readonly string[], after: readonly string[]) => before.filter((id, i) => after[i] !== id).length;
