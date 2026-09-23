import type { MixPlan } from '../planner/types';
import type { MixOverlay, MixProject } from '../types';
import { findOverlayCycleIds, getLinkedCountdown, getOverlayDependencyId, getOverlaysById } from './anchors';

export type OverlayTimeWarning =
  /** Part of an anchor cycle: resolved as if absolute at `max(0, offset)`. */
  | { type: 'cycle' }
  /** The anchor clip isn't in the project or wasn't placed by the planner (e.g. invalid clip): absolute at `max(0, offset)`. */
  | { type: 'missing-clip', clipId: string }
  /** The anchor overlay doesn't exist: absolute at `max(0, offset)`. */
  | { type: 'missing-element', elementId: string }
  /** `linkedCountdownId` isn't an existing countdown: the bar uses its own anchor and duration. */
  | { type: 'missing-linked-countdown', countdownId: string }
  /** Sound whose duration isn't known yet: it lasts 0 s. */
  | { type: 'unknown-duration' }
  /** Partly outside the video: `start`/`end` are cut to it. */
  | { type: 'clipped' }
  /** Completely outside the video: `start === end`, nothing is drawn/played. */
  | { type: 'outside-video' };

export interface ResolvedOverlayTime {
  /** In the final video (s), cut to [0, plan.duration]. Render/draw only if `end > start`. */
  start: number,
  end: number,
  /** Before cutting to the video. Anchors to this overlay are computed from these. */
  rawStart: number,
  rawEnd: number,
  warnings: OverlayTimeWarning[],
}

export type ResolvedOverlayTimes = Map<string, ResolvedOverlayTime>;

/**
 * Start/end of every overlay in the final video (04-diseno §8.1). Pure and O(overlays + placements), so it can run on
 * every plan recompute.
 *
 * - Anchors to clips use `ColumnPlacement.startTime` / `endTime`; anchors to overlays use their raw (uncut) times.
 * - A progress bar linked to a countdown takes the countdown's times.
 * - Sounds last `soundDurations[id]` (s); if missing, 0 with a warning (T21 provides them).
 * - Cycles and broken references don't throw: see {@link OverlayTimeWarning} for the fallbacks.
 */
export function resolveOverlayTimes(
  { overlays, clips }: Pick<MixProject, 'overlays' | 'clips'>,
  plan: Pick<MixPlan, 'duration' | 'placements'>,
  { soundDurations = {} }: { soundDurations?: Readonly<Record<string, number>> | undefined } = {},
): ResolvedOverlayTimes {
  const byId = getOverlaysById(overlays);
  const cycleIds = findOverlayCycleIds(overlays, byId);
  const placementsByClipId = new Map(plan.placements.map((p) => [p.clipId, p]));
  const clipIds = new Set(clips.map((c) => c.id));
  const videoDuration = Math.max(0, plan.duration);

  const result: ResolvedOverlayTimes = new Map();

  function resolveOne(overlay: MixOverlay) {
    const warnings: OverlayTimeWarning[] = [];
    let rawStart: number;
    let rawEnd: number | undefined;

    const countdown = getLinkedCountdown(overlay, byId);
    if (overlay.type === 'progressBar' && overlay.linkedCountdownId != null && countdown == null) {
      warnings.push({ type: 'missing-linked-countdown', countdownId: overlay.linkedCountdownId });
    }

    const { anchor } = overlay;
    const fallbackStart = () => Math.max(0, anchor.kind === 'absolute' ? anchor.time : anchor.offset);

    if (cycleIds.has(overlay.id)) {
      warnings.push({ type: 'cycle' });
      rawStart = fallbackStart();
    } else if (countdown != null) {
      const times = result.get(countdown.id)!;
      rawStart = times.rawStart;
      rawEnd = times.rawEnd;
    } else if (anchor.kind === 'absolute') {
      rawStart = anchor.time;
    } else if (anchor.kind === 'clip') {
      const placement = placementsByClipId.get(anchor.clipId);
      if (placement == null || !clipIds.has(anchor.clipId)) {
        warnings.push({ type: 'missing-clip', clipId: anchor.clipId });
        rawStart = fallbackStart();
      } else {
        rawStart = (anchor.edge === 'start' ? placement.startTime : placement.endTime) + anchor.offset;
      }
    } else {
      const times = result.get(anchor.elementId);
      if (times == null) {
        warnings.push({ type: 'missing-element', elementId: anchor.elementId });
        rawStart = fallbackStart();
      } else {
        rawStart = (anchor.edge === 'start' ? times.rawStart : times.rawEnd) + anchor.offset;
      }
    }

    if (rawEnd == null) {
      let duration: number;
      if (overlay.type === 'sound') {
        const soundDuration = soundDurations[overlay.id];
        if (soundDuration == null) warnings.push({ type: 'unknown-duration' });
        duration = soundDuration ?? 0;
      } else {
        ({ duration } = overlay);
      }
      rawEnd = rawStart + Math.max(0, Number.isFinite(duration) ? duration : 0);
    }

    const start = Math.min(Math.max(rawStart, 0), videoDuration);
    const end = Math.min(Math.max(rawEnd, start), videoDuration);
    if (rawEnd > rawStart) {
      if (end <= start) warnings.push({ type: 'outside-video' });
      else if (start !== rawStart || end !== rawEnd) warnings.push({ type: 'clipped' });
    }

    result.set(overlay.id, { start, end, rawStart, rawEnd, warnings });
  }

  // Dependencies first. Cycle members don't need theirs (fallback), so each chain stops at a resolved or cycle overlay.
  overlays.forEach((overlay) => {
    const chain: MixOverlay[] = [];
    let current: MixOverlay | undefined = overlay;
    while (current != null && !result.has(current.id)) {
      chain.push(current);
      if (cycleIds.has(current.id)) break;
      const depId = getOverlayDependencyId(current, byId);
      current = depId != null ? byId.get(depId) : undefined;
    }
    for (let i = chain.length - 1; i >= 0; i -= 1) resolveOne(chain[i]!);
  });

  return result;
}
