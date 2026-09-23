import type { MixProjectAction } from './projectReducer';
import type { MixClip } from './types';

// Pinned and grouped clips in the UI (A4, T30): selection, group colours and the edits behind the clip menus. Pure,
// so it can be tested without React. The planner side is in planner/units.ts.

/** Group indicator colours, handed out in list order so the first groups never share one. */
const groupColors = ['var(--cyan-9)', 'var(--crimson-9)', 'var(--lime-9)', 'var(--violet-9)', 'var(--amber-9)', 'var(--teal-9)', 'var(--pink-9)', 'var(--indigo-9)'];

/** Colour of each group with at least 2 clips (smaller ones aren't groups for the planner either). */
export function getGroupColors(clips: Pick<MixClip, 'groupId'>[]): Map<string, string> {
  const counts = new Map<string, number>();
  clips.forEach(({ groupId }) => { if (groupId != null) counts.set(groupId, (counts.get(groupId) ?? 0) + 1); });
  const colors = new Map<string, string>();
  clips.forEach(({ groupId }) => {
    if (groupId != null && counts.get(groupId)! >= 2 && !colors.has(groupId)) colors.set(groupId, groupColors[colors.size % groupColors.length]!);
  });
  return colors;
}

/** The clips of `clip`'s group (itself included), or just `clip`. */
export function getGroupMembers<T extends Pick<MixClip, 'id' | 'groupId'>>(clips: T[], clip: T): T[] {
  return clip.groupId != null ? clips.filter((c) => c.groupId === clip.groupId) : [clip];
}

/** Clip ids from `anchorId` to `targetId` (both included) in list order, for a Shift-click; just the target without anchor. */
export function getSelectionRange(ids: string[], anchorId: string | undefined, targetId: string): string[] {
  const from = anchorId != null ? ids.indexOf(anchorId) : -1;
  const to = ids.indexOf(targetId);
  if (to === -1) return [];
  if (from === -1) return [targetId];
  return ids.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/**
 * Pin a clip at `time` (s, ≥ 0). In a group the pin moves to this clip: the group starts then (the planner uses the
 * earliest pin of a group, and two different pins in a group are warned about).
 */
export function getPinClipAction(clips: MixClip[], clipId: string, time: number): MixProjectAction | undefined {
  const clip = clips.find((c) => c.id === clipId);
  if (clip == null) return undefined;
  const pinTime = Math.max(0, time);
  const others = getGroupMembers(clips, clip).filter((c) => c.id !== clipId && c.pinTime != null);
  return {
    type: 'batch',
    actions: [
      ...others.map((c): MixProjectAction => ({ type: 'setClipPinTime', clipId: c.id, pinTime: undefined })),
      { type: 'setClipPinTime', clipId, pinTime },
    ],
  };
}

/** Unpin a clip, and the rest of its group (a group is pinned as a whole). Undefined if nothing is pinned. */
export function getUnpinClipAction(clips: MixClip[], clipId: string): MixProjectAction | undefined {
  const clip = clips.find((c) => c.id === clipId);
  if (clip == null) return undefined;
  const pinned = getGroupMembers(clips, clip).filter((c) => c.pinTime != null);
  if (pinned.length === 0) return undefined;
  return { type: 'batch', actions: pinned.map((c): MixProjectAction => ({ type: 'setClipPinTime', clipId: c.id, pinTime: undefined })) };
}

/** The pin time of a clip as the planner sees it: its own, or its group's (the earliest of the group). */
export function getClipPinTime(clips: MixClip[], clip: MixClip): number | undefined {
  const times = getGroupMembers(clips, clip).flatMap((c) => (c.pinTime != null ? [c.pinTime] : []));
  return times.length > 0 ? Math.min(...times) : undefined;
}
