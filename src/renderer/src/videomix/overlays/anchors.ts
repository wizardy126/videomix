import omit from 'lodash/omit';

import type { MixOverlay, ProgressBarOverlay } from '../types';

// Anchor graph helpers. Every overlay depends on at most one other overlay (its anchor element, or the countdown a bar
// is linked to, which replaces its own anchor), so the graph is a functional graph: following the chain from any
// overlay either ends or enters exactly one cycle.

export type OverlaysById = ReadonlyMap<string, MixOverlay>;

export const getOverlaysById = (overlays: readonly MixOverlay[]): OverlaysById => new Map(overlays.map((o) => [o.id, o]));

/** The countdown a progress bar takes its start and duration from, if it's linked to an existing countdown. */
export function getLinkedCountdown(overlay: MixOverlay, byId: OverlaysById) {
  if (overlay.type !== 'progressBar' || overlay.linkedCountdownId == null) return undefined;
  const countdown = byId.get(overlay.linkedCountdownId);
  return countdown?.type === 'countdown' ? countdown : undefined;
}

/** Id of the overlay whose times this one needs, if any (and if it exists). */
export function getOverlayDependencyId(overlay: MixOverlay, byId: OverlaysById): string | undefined {
  const countdown = getLinkedCountdown(overlay, byId);
  if (countdown != null) return countdown.id;
  if (overlay.anchor.kind === 'element' && byId.has(overlay.anchor.elementId)) return overlay.anchor.elementId;
  return undefined;
}

/** Ids of the overlays that are part of an anchor cycle (not the ones that merely depend on a cycle). */
export function findOverlayCycleIds(overlays: readonly MixOverlay[], byId = getOverlaysById(overlays)): Set<string> {
  const inCycle = new Set<string>();
  const done = new Set<string>();
  overlays.forEach((overlay) => {
    const path: string[] = [];
    const onPath = new Set<string>();
    let cur: string | undefined = overlay.id;
    while (cur != null && !done.has(cur) && !onPath.has(cur)) {
      path.push(cur);
      onPath.add(cur);
      const current = byId.get(cur);
      cur = current != null ? getOverlayDependencyId(current, byId) : undefined;
    }
    if (cur != null && onPath.has(cur)) path.slice(path.indexOf(cur)).forEach((cycleId) => inCycle.add(cycleId));
    path.forEach((p) => done.add(p));
  });
  return inCycle;
}

/**
 * True if `overlayId` can depend on `targetId` (anchor to it, or link to it if it's a countdown) without creating a cycle.
 * For the UI, to offer only valid anchor targets.
 */
export function canOverlayDependOn(overlays: readonly MixOverlay[], overlayId: string, targetId: string) {
  if (overlayId === targetId) return false;
  const byId = getOverlaysById(overlays);
  const seen = new Set<string>();
  let id: string | undefined = targetId;
  while (id != null && !seen.has(id)) {
    if (id === overlayId) return false;
    seen.add(id);
    const current = byId.get(id);
    id = current != null ? getOverlayDependencyId(current, byId) : undefined;
  }
  return true;
}

/** Overlays anchored to the clip or overlay `refId`, or bars linked to it (direct dependents only). */
export function getDependentOverlays(overlays: readonly MixOverlay[], ref: { clipId: string } | { overlayId: string }) {
  return overlays.filter((o) => {
    if ('clipId' in ref) return o.anchor.kind === 'clip' && o.anchor.clipId === ref.clipId;
    return (o.anchor.kind === 'element' && o.anchor.elementId === ref.overlayId)
      || (o.type === 'progressBar' && o.linkedCountdownId === ref.overlayId);
  });
}

/** Unclipped times of an overlay, as returned by resolveOverlayTimes (`rawStart` / `rawEnd`). */
export interface OverlayTimeRange { rawStart: number, rawEnd: number }

/**
 * After removing clips/overlays: the overlays anchored to them become absolute at their current time, and bars linked to
 * a removed countdown are unlinked, keeping its start and duration (01-requisitos §9.2).
 * `resolved` should be the times resolved before the removal; without an entry the start falls back to `max(0, offset)`
 * and a linked bar keeps its own anchor/duration.
 * Returns the same array if nothing changed.
 */
export function detachOverlayReferences(overlays: MixOverlay[], { clipIds = new Set(), overlayIds = new Set(), resolved }: {
  clipIds?: ReadonlySet<string> | undefined,
  overlayIds?: ReadonlySet<string> | undefined,
  resolved?: ReadonlyMap<string, OverlayTimeRange> | undefined,
}): MixOverlay[] {
  let changed = false;
  const ret = overlays.map((overlay): MixOverlay => {
    const { anchor } = overlay;
    const times = resolved?.get(overlay.id);
    const absoluteAt = (offset: number) => ({ kind: 'absolute' as const, time: Math.max(0, times?.rawStart ?? offset) });

    let next = overlay;
    if (next.type === 'progressBar' && next.linkedCountdownId != null && overlayIds.has(next.linkedCountdownId)) {
      const rest = omit(next, 'linkedCountdownId');
      const bar: ProgressBarOverlay = times != null
        ? { ...rest, anchor: absoluteAt(0), duration: times.rawEnd - times.rawStart }
        : rest;
      next = bar;
    }
    if ((anchor.kind === 'clip' && clipIds.has(anchor.clipId)) || (anchor.kind === 'element' && overlayIds.has(anchor.elementId))) {
      next = { ...next, anchor: absoluteAt(anchor.offset) };
    }
    if (next !== overlay) changed = true;
    return next;
  });
  return changed ? ret : overlays;
}
