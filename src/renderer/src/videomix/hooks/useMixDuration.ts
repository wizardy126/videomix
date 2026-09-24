import { useMemo } from 'react';
import { useDebounce } from 'use-debounce';

import type { MixPlan } from '../planner/types';
import { planRender } from '../render/renderOutput';
import type { MixClip, MixSettings } from '../types';

// Same debounce as useMixOverlays's plan (T22), so reusing it (see below) never waits longer than computing our own.
const PLAN_DEBOUNCE_MS = 300;

export interface MixDurationEstimate {
  /** Seconds; `undefined` until there's a plan (no clips yet). */
  duration: number | undefined,
  clipCount: number,
}

/**
 * E3's "≈ m:ss" estimate, kept up to date in both the Source and Mix tabs. `mixPlan` (`useMixOverlays.plan`, T22) is
 * only computed while the Mix view is open; when it's there (debounced the same way) it's reused as is, so the mix
 * isn't planned twice for the same clips/settings. Otherwise (Source tab, or before the Mix view has a plan yet)
 * this debounces `clips`/`settings` itself with `planRender` (the same helper T13/T15 use for the real plan).
 */
// E7 (T38b): extending clips beyond their max never changes the timing, so the estimate plans without source sizes
const noSources: [] = [];

export default function useMixDuration({ clips, settings, mixPlan }: {
  clips: MixClip[],
  settings: MixSettings,
  /** `useMixOverlays.fullPlan`: the whole mix, before the cut at the maximum duration (E4). */
  mixPlan: MixPlan | undefined,
}): MixDurationEstimate {
  const [debouncedClips] = useDebounce(clips, PLAN_DEBOUNCE_MS);
  const [debouncedSettings] = useDebounce(settings, PLAN_DEBOUNCE_MS);

  const ownPlan = useMemo<MixPlan | undefined>(
    () => (mixPlan == null && debouncedClips.length > 0 ? planRender({ clips: debouncedClips, settings: debouncedSettings, sources: noSources }).fullPlan : undefined),
    [debouncedClips, debouncedSettings, mixPlan],
  );

  return useMemo(() => ({ duration: (mixPlan ?? ownPlan)?.duration, clipCount: clips.length }), [clips.length, mixPlan, ownPlan]);
}

export type UseMixDuration = ReturnType<typeof useMixDuration>;
