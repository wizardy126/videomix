import { getAspectRange } from '../geometry';
import { getClipChains, getClipDuration } from '../project';
import { getOutputSize } from '../types';
import type { MixClip, MixSettings } from '../types';
import type { PlanMixInput, PlannerClip, PlannerSettings } from './types';

export function toPlannerClip(clip: MixClip): PlannerClip {
  return {
    id: clip.id,
    duration: getClipDuration(clip),
    aspectRange: getAspectRange(clip.maxRect, clip.minRect),
    rects: { maxRect: clip.maxRect, minRect: clip.minRect },
    ...(clip.pinTime != null && { pinTime: clip.pinTime }),
    ...(clip.groupId != null && { groupId: clip.groupId }),
  };
}

export function toPlannerSettings(settings: MixSettings): PlannerSettings {
  const { width, height } = getOutputSize(settings.output);
  return {
    width,
    height,
    maxColumns: settings.maxColumns,
    gap: settings.gap.width,
    reorderWindow: settings.reorderWindow,
    order: settings.order,
    transitionDuration: settings.transition.duration,
    // E2/E5 (T38)
    linkTransition: settings.links.transition,
    // E4 (T38): only biases the scoring; the cut is `truncatePlan`
    ...(settings.maxDuration != null && { maxDuration: settings.maxDuration }),
  };
}

/**
 * Planner input for a project. Clips without a positive duration are left out (validateMixProject reports them),
 * so a transiently invalid clip doesn't break the plan preview. E2/E5 (T38): the chains (`getClipChains` over the valid
 * clips, only those of 2 or more) and the always-visible sequence (its valid clips) are passed when there are any.
 */
export function getPlannerInput({ clips, settings }: { clips: MixClip[], settings: MixSettings }): PlanMixInput {
  const valid = clips.filter((clip) => getClipDuration(clip) > 0);
  const validIds = new Set(valid.map((clip) => clip.id));
  const chains = getClipChains({ clips: valid, settings }).filter((chain) => chain.length >= 2).map((chain) => chain.map((clip) => clip.id));
  const sequence = settings.alwaysVisible.clipIds.filter((id) => validIds.has(id));
  return {
    clips: valid.map((clip) => toPlannerClip(clip)),
    settings: toPlannerSettings(settings),
    ...(chains.length > 0 && { chains }),
    ...(sequence.length > 0 && { sequence }),
  };
}
