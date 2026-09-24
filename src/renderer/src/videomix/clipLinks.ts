import type { MixProjectAction } from './projectReducer';
import { LINK_GAP_TOLERANCE, clipsBySource, getClipChains, getClipDuration } from './project';
import type { MixClip, MixProject } from './types';

// Chains of linked clips (E2) and the always-visible sequence (E5) as the clip list and the Mix view show them (T39).
// Pure: the chains are those of the planner (getClipChains over the valid clips, like getPlannerInput).

export interface ClipLinkInfo {
  /** The previous clip of its source (by start) it can be linked with; undefined for the first one. */
  previousId: string | undefined,
  /** Linked with that clip: it plays right after it, in the same slot. */
  linked: boolean,
  /** What the automatic rule alone gives (gap ≤ `links.maxGap`, no overlap), without the clip's `link`. */
  autoLinked: boolean,
  /** 1-based position in its chain, and the chain's length (1: not in a chain). */
  position: number,
  length: number,
}

/**
 * Link state of every clip that can be in a chain (not pinned, grouped or in the always-visible sequence, and with a
 * positive duration): the others are missing from the map.
 */
export function getClipLinkInfos(project: Pick<MixProject, 'clips' | 'settings'>): Map<string, ClipLinkInfo> {
  const { settings } = project;
  const valid = project.clips.filter((clip) => getClipDuration(clip) > 0);
  const infos = new Map<string, ClipLinkInfo>();
  getClipChains({ clips: valid, settings }).forEach((chain) => {
    chain.forEach((clip, i) => infos.set(clip.id, { previousId: undefined, linked: i > 0, autoLinked: false, position: i + 1, length: chain.length }));
  });
  // previous clip and automatic rule: the same order and test as getClipChains
  const { maxGap } = settings.links;
  clipsBySource(valid.filter((clip) => infos.has(clip.id))).forEach((clips) => {
    const sorted = [...clips].sort((a, b) => a.start - b.start);
    sorted.forEach((clip, i) => {
      const previous = sorted[i - 1];
      const info = infos.get(clip.id);
      if (previous == null || info == null) return;
      const gap = clip.start - previous.end;
      info.previousId = previous.id;
      info.autoLinked = maxGap > 0 && gap >= -LINK_GAP_TOLERANCE && gap <= maxGap;
    });
  });
  return infos;
}

/**
 * Links a clip with the previous clip of its source, or breaks that link: `link` is only stored when it differs from
 * the automatic rule ('force' or 'break'), so the clip follows the rule again otherwise. Undefined if nothing changes
 * or the clip can't be linked.
 */
export function getSetClipLinkAction(clip: Pick<MixClip, 'id' | 'link'>, info: ClipLinkInfo | undefined, linked: boolean): MixProjectAction | undefined {
  if (info?.previousId == null) return undefined;
  let link: MixClip['link'];
  if (linked !== info.autoLinked) link = linked ? 'force' : 'break';
  if (link === clip.link && linked === info.linked) return undefined;
  return { type: 'setClipLink', clipId: clip.id, link };
}

/**
 * Adds clips to the always-visible sequence (at `index`, or at the end; those already in it move there) or removes
 * them. Undefined if nothing changes.
 */
export function getAlwaysVisibleAction(sequence: readonly string[], clipIds: readonly string[], change: { add: true, index?: number | undefined } | { add: false }): MixProjectAction | undefined {
  const moving = new Set(clipIds);
  const rest = sequence.filter((id) => !moving.has(id));
  let next: string[] = rest;
  if (change.add) {
    // the index is in the sequence before removing the moved clips
    const index = change.index == null ? rest.length : sequence.slice(0, change.index).filter((id) => !moving.has(id)).length;
    next = [...rest.slice(0, index), ...clipIds, ...rest.slice(index)];
  }
  if (next.length === sequence.length && next.every((id, i) => id === sequence[i])) return undefined;
  return { type: 'setAlwaysVisibleClips', clipIds: next };
}
