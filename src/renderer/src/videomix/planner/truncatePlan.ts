import type { MixPlan, PlanWarning } from './types';

const EPS = 1e-6;

/**
 * E4 (T38): the plan cut at the maximum duration (s). Pure; returns `plan` itself when it already fits.
 *
 * - Clips that would start at or after the cut are dropped; clips playing at the cut end there (their `endTime` is the
 *   cut and they lose `transitionOut`: the global fade out ends the video). Everything else is untouched.
 * - Layout keyframes from the cut on are dropped; an animation running at the cut stays as it is (the video just
 *   ends during it).
 * - `duration` is the cut, so the global fade to black (video and audio) happens at the cut.
 * - Warnings of dropped clips, and time-anchored ones after the cut, go away. A `truncated` warning says how many
 *   seconds and which clips are lost (and which are cut). Cutting a cut plan again adds up the losses.
 *
 * Overlays and sounds: `resolveOverlayTimes` cuts them to `plan.duration`. Resolve them with the placements of the
 * whole plan and the cut duration (`{ duration: cut.duration, placements: plan.placements }`), so an overlay anchored
 * to a lost clip still falls after the cut (outside the video) instead of losing its anchor.
 */
// eslint-disable-next-line import/prefer-default-export
export function truncatePlan(plan: MixPlan, maxDuration: number): MixPlan {
  if (!Number.isFinite(maxDuration) || maxDuration <= 0 || plan.duration <= maxDuration + EPS) return plan;

  const lost = new Set<string>();
  const cutClipIds: string[] = [];
  const placements = plan.placements.flatMap((placement) => {
    if (placement.startTime >= maxDuration - EPS) {
      lost.add(placement.clipId);
      return [];
    }
    if (placement.endTime < maxDuration - EPS) return [placement];
    if (placement.endTime > maxDuration + EPS) cutClipIds.push(placement.clipId);
    const cut = { ...placement, endTime: maxDuration };
    delete cut.transitionOut;
    return [cut];
  });
  const layouts = plan.layouts.filter((layout, i) => i === 0 || layout.time < maxDuration - EPS);

  const keptClip = (clipId: string) => !lost.has(clipId);
  const keep = (warning: PlanWarning): boolean => {
    switch (warning.type) {
      case 'fill': { return warning.time < maxDuration - EPS; }
      case 'pillarbox':
      case 'letterbox': { return keptClip(warning.clipId) && warning.time < maxDuration - EPS; }
      case 'upscale':
      case 'transition-shortened':
      case 'pin-shifted': { return keptClip(warning.clipId); }
      case 'group-split': { return warning.clipIds.some((id) => keptClip(id)); }
      default: { return false; }
    }
  };
  const warnings = plan.warnings.flatMap((warning): PlanWarning[] => {
    // E7 (T38b): an extension goes as far as the cut
    if (warning.type === 'extended') return keptClip(warning.clipId) && warning.time < maxDuration - EPS ? [{ ...warning, endTime: Math.min(warning.endTime, maxDuration) }] : [];
    return keep(warning) ? [warning] : [];
  });
  // cutting a cut plan again adds up what is lost
  const previous = plan.warnings.find((w) => w.type === 'truncated');
  const truncated: PlanWarning = {
    type: 'truncated',
    time: maxDuration,
    seconds: (previous?.seconds ?? 0) + plan.duration - maxDuration,
    clipIds: [...(previous?.clipIds ?? []), ...lost],
    cutClipIds,
  };
  return { ...plan, duration: maxDuration, placements, layouts, warnings: [...warnings, truncated] };
}
