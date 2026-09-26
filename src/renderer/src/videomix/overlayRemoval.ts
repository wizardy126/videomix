import type { MixBlock, MixOverlay, MixProject } from './types';
import type { MixProjectAction } from './projectReducer';
import { getDependentOverlays } from './overlays/anchors';
import { resolveOverlayTimes } from './overlays/resolveOverlayTimes';
import type { ResolvedOverlayTime } from './overlays/resolveOverlayTimes';
import { getOverlayTimesPlan, planRender } from './render/renderOutput';
import { expandBlocks, getBlockMemberOverlayId, resolveBlockTimes } from './blocks/expandBlocks';
import { getBlockRefIds, getDefInstances } from './blocks/blockOperations';

// Removing a clip, a source or an overlay that other overlays are anchored to (01-requisitos §9.2): those overlays
// become absolute at their current start. The reducer does it when the removal action carries the times resolved
// *before* the removal (`resolved`, T19); these helpers add them to every removal of an action (also inside batches,
// e.g. clips removed by deleting their segments in the timeline), so no call site can forget them.
// v7 (T56): the same for blocks (removing a block or one of its members, and what's anchored to them) and for grouping
// overlays into a block, which needs the times before the edit to keep them.

interface RemovedRefs { clipIds: Set<string>, overlayIds: Set<string> }

function collectRemovals(project: Pick<MixProject, 'clips' | 'blocks' | 'blockDefs'>, action: MixProjectAction, refs: RemovedRefs) {
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
    case 'removeBlock': {
      getBlockRefIds(project, action.blockId).forEach((id) => refs.overlayIds.add(id));
      break;
    }
    case 'removeBlockMember': {
      getDefInstances(project, action.defId).forEach((b) => refs.overlayIds.add(getBlockMemberOverlayId(b.id, action.memberId)));
      break;
    }
    case 'batch': {
      action.actions.forEach((a) => collectRemovals(project, a, refs));
      break;
    }
    default:
  }
}

/** Clips and overlays that `action` removes (a removed source removes its clips; a removed block, itself and its expanded members). */
export function getRemovedRefs(project: Pick<MixProject, 'clips'> & Partial<Pick<MixProject, 'blocks' | 'blockDefs'>>, action: MixProjectAction): RemovedRefs {
  const refs: RemovedRefs = { clipIds: new Set(), overlayIds: new Set() };
  collectRemovals({ blocks: [], blockDefs: [], ...project }, action, refs);
  return refs;
}

/** Overlays that stay but lose their anchor (or linked countdown) because of `action`: the ones to warn about. */
export function getOverlaysDetachedBy(project: Pick<MixProject, 'clips' | 'overlays'> & Partial<Pick<MixProject, 'blocks' | 'blockDefs'>>, action: MixProjectAction): MixOverlay[] {
  const { clipIds, overlayIds } = getRemovedRefs(project, action);
  if (clipIds.size === 0 && overlayIds.size === 0) return [];
  const detached = new Map<string, MixOverlay>();
  clipIds.forEach((clipId) => getDependentOverlays(project.overlays, { clipId }).forEach((o) => detached.set(o.id, o)));
  overlayIds.forEach((overlayId) => getDependentOverlays(project.overlays, { overlayId }).forEach((o) => detached.set(o.id, o)));
  return [...detached.values()].filter((o) => !overlayIds.has(o.id));
}

/** v7 (T56): blocks that stay but lose their anchor because of `action`. */
export function getBlocksDetachedBy(project: Pick<MixProject, 'clips' | 'blocks' | 'blockDefs'>, action: MixProjectAction): MixBlock[] {
  const { clipIds, overlayIds } = getRemovedRefs(project, action);
  if (clipIds.size === 0 && overlayIds.size === 0) return [];
  return project.blocks.filter(({ id, anchor }) => !overlayIds.has(id) && ((anchor.kind === 'clip' && clipIds.has(anchor.clipId)) || (anchor.kind === 'element' && overlayIds.has(anchor.elementId))));
}

const needsTimes = (action: MixProjectAction): boolean => (action.type === 'batch' ? action.actions.some((a) => needsTimes(a)) : action.type === 'groupOverlays' && action.resolved == null);

type ProjectTimesMap = ReadonlyMap<string, ResolvedOverlayTime>;

/** `action` with `resolved` set on every removal (and grouping, T56) that doesn't have it yet. */
export function withRemovalTimes(action: MixProjectAction, resolved: ProjectTimesMap): MixProjectAction {
  switch (action.type) {
    case 'removeClip':
    case 'removeSource':
    case 'removeOverlay':
    case 'removeBlock':
    case 'removeBlockMember':
    case 'groupOverlays': {
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
 * v7 (T56): the raw times of everything that can be referenced, right now: every overlay (loose and expanded block
 * members, `resolveOverlayTimes` of `expandBlocks(project).all`) and every block (`resolveBlockTimes`), in one map by
 * id (they never collide). `soundDurations` by expanded overlay id (`getKnownSoundDurations(expandBlocks(project).all)`).
 * The plan is computed here, synchronously (the planner is fast; like MixPlanView, it only runs with clips).
 */
export function resolveProjectTimes(project: MixProject, soundDurations: Readonly<Record<string, number>>): Map<string, ResolvedOverlayTime> {
  const plan = project.clips.length > 0 ? getOverlayTimesPlan(planRender(project)) : { duration: 0, placements: [] };
  const expanded = expandBlocks(project);
  const resolved = resolveOverlayTimes({ overlays: expanded.all, clips: project.clips }, plan, { soundDurations });
  if (project.blocks.length === 0) return resolved;
  return new Map([...resolved, ...resolveBlockTimes(project, plan, resolved, expanded)]);
}

/**
 * Prepares `action` for the reducer: if it removes something overlays or blocks depend on (or groups overlays into a
 * block, T56), adds the current resolved times (`resolveProjectTimes`) and returns the overlays and blocks that get
 * detached, to warn the user. Otherwise returns the same action.
 */
export function prepareOverlayRemoval(project: MixProject, action: MixProjectAction, soundDurations: Readonly<Record<string, number>>): { action: MixProjectAction, detached: MixOverlay[], detachedBlocks: MixBlock[] } {
  if (project.overlays.length === 0 && project.blocks.length === 0) return { action, detached: [], detachedBlocks: [] };
  const detached = getOverlaysDetachedBy(project, action);
  const detachedBlocks = getBlocksDetachedBy(project, action);
  if (detached.length === 0 && detachedBlocks.length === 0 && !needsTimes(action)) return { action, detached, detachedBlocks };
  return { action: withRemovalTimes(action, resolveProjectTimes(project, soundDurations)), detached, detachedBlocks };
}
