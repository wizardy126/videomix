import type { MixOverlay, MixProject } from './types';
import type { MixProjectAction } from './projectReducer';
import { getDependentOverlays } from './overlays/anchors';
import { resolveOverlayTimes } from './overlays/resolveOverlayTimes';
import type { ResolvedOverlayTimes } from './overlays/resolveOverlayTimes';
import { planRender } from './render/renderOutput';

// Removing a clip, a source or an overlay that other overlays are anchored to (01-requisitos §9.2): those overlays
// become absolute at their current start. The reducer does it when the removal action carries the times resolved
// *before* the removal (`resolved`, T19); these helpers add them to every removal of an action (also inside batches,
// e.g. clips removed by deleting their segments in the timeline), so no call site can forget them.

interface RemovedRefs { clipIds: Set<string>, overlayIds: Set<string> }

function collectRemovals(project: Pick<MixProject, 'clips'>, action: MixProjectAction, refs: RemovedRefs) {
  switch (action.type) {
    case 'removeClip': {
      refs.clipIds.add(action.clipId);
      break;
    }
    case 'removeSource': {
      project.clips.filter((c) => c.sourceId === action.sourceId).forEach((c) => refs.clipIds.add(c.id));
      break;
    }
    case 'removeOverlay': {
      refs.overlayIds.add(action.overlayId);
      break;
    }
    case 'batch': {
      action.actions.forEach((a) => collectRemovals(project, a, refs));
      break;
    }
    default:
  }
}

/** Clips and overlays that `action` removes (a removed source removes its clips). */
export function getRemovedRefs(project: Pick<MixProject, 'clips'>, action: MixProjectAction): RemovedRefs {
  const refs: RemovedRefs = { clipIds: new Set(), overlayIds: new Set() };
  collectRemovals(project, action, refs);
  return refs;
}

/** Overlays that stay but lose their anchor (or linked countdown) because of `action`: the ones to warn about. */
export function getOverlaysDetachedBy(project: Pick<MixProject, 'clips' | 'overlays'>, action: MixProjectAction): MixOverlay[] {
  const { clipIds, overlayIds } = getRemovedRefs(project, action);
  if (clipIds.size === 0 && overlayIds.size === 0) return [];
  const detached = new Map<string, MixOverlay>();
  clipIds.forEach((clipId) => getDependentOverlays(project.overlays, { clipId }).forEach((o) => detached.set(o.id, o)));
  overlayIds.forEach((overlayId) => getDependentOverlays(project.overlays, { overlayId }).forEach((o) => detached.set(o.id, o)));
  return [...detached.values()].filter((o) => !overlayIds.has(o.id));
}

/** `action` with `resolved` set on every removal that doesn't have it yet. */
export function withRemovalTimes(action: MixProjectAction, resolved: ResolvedOverlayTimes): MixProjectAction {
  switch (action.type) {
    case 'removeClip':
    case 'removeSource':
    case 'removeOverlay': {
      return action.resolved != null ? action : { ...action, resolved };
    }
    case 'batch': {
      return { ...action, actions: action.actions.map((a) => withRemovalTimes(a, resolved)) };
    }
    default: {
      return action;
    }
  }
}

/**
 * Prepares `action` for the reducer: if it removes something overlays depend on, adds the current resolved times (the
 * plan is computed here, synchronously: the planner is fast) and returns the overlays that get detached, to warn the user.
 * Otherwise returns the same action.
 */
export function prepareOverlayRemoval(project: MixProject, action: MixProjectAction, soundDurations: Readonly<Record<string, number>>): { action: MixProjectAction, detached: MixOverlay[] } {
  if (project.overlays.length === 0) return { action, detached: [] };
  const detached = getOverlaysDetachedBy(project, action);
  if (detached.length === 0) return { action, detached };
  // (like MixPlanView, the planner only runs with clips)
  const plan = project.clips.length > 0 ? planRender(project).plan : { duration: 0, placements: [] };
  const resolved = resolveOverlayTimes(project, plan, { soundDurations });
  return { action: withRemovalTimes(action, resolved), detached };
}
