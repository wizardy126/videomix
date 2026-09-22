import { getAspectRange } from '../geometry';
import { getClipDuration } from '../project';
import { mixResolutions } from '../types';
import type { MixClip, MixSettings } from '../types';
import type { PlanMixInput, PlannerClip, PlannerSettings } from './types';

export function toPlannerClip(clip: MixClip): PlannerClip {
  return {
    id: clip.id,
    duration: getClipDuration(clip),
    aspectRange: getAspectRange(clip.maxRect, clip.minRect),
    rects: { maxRect: clip.maxRect, minRect: clip.minRect },
  };
}

export function toPlannerSettings(settings: MixSettings): PlannerSettings {
  const { width, height } = mixResolutions[settings.resolution];
  return {
    width,
    height,
    maxColumns: settings.maxColumns,
    gap: settings.gap.width,
    reorderWindow: settings.reorderWindow,
    order: settings.order,
    transitionDuration: settings.transition.duration,
  };
}

/**
 * Planner input for a project. Clips without a positive duration are left out (validateMixProject reports them),
 * so a transiently invalid clip doesn't break the plan preview.
 */
export function getPlannerInput({ clips, settings }: { clips: MixClip[], settings: MixSettings }): PlanMixInput {
  return {
    clips: clips.filter((clip) => getClipDuration(clip) > 0).map((clip) => toPlannerClip(clip)),
    settings: toPlannerSettings(settings),
  };
}
