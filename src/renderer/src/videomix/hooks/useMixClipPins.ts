import { useCallback, useMemo, useState } from 'react';
import { nanoid } from 'nanoid';
import i18n from 'i18next';

import { formatDuration } from '../../util/duration';
import type { ContextMenuTemplate } from '../../types';
import type { MixProjectAction } from '../projectReducer';
import type { MixClip, MixSettings } from '../types';
import { getClipPinTime, getGroupColors, getGroupMembers, getPinClipAction, getSelectionRange, getUnpinClipAction } from '../clipGroups';
import { canExtendBeyondMax } from '../planner/plannerInput';
import { addRotation, getClipRotation } from '../clipRotation';
import { getAlwaysVisibleAction, getClipLinkInfos, getSetClipLinkAction } from '../clipLinks';

const { getCurrentWindow, Menu } = window.require('@electron/remote');

/** Ctrl/Cmd-click adds or removes a clip from the selection, Shift-click selects the range from the selected clip. */
export interface ClipSelectModifiers {
  toggle?: boolean | undefined,
  range?: boolean | undefined,
}

export const getClipSelectModifiers = (e: { ctrlKey: boolean, metaKey: boolean, shiftKey: boolean }): ClipSelectModifiers => ({ toggle: e.ctrlKey || e.metaKey, range: e.shiftKey });

/** E7 (T38b): switch a clip's "extend beyond the max if needed" (on = the flag removed, the default). */
export const getToggleExtendBeyondMaxAction = (clip: Pick<MixClip, 'id' | 'extendBeyondMax'>): MixProjectAction => (
  { type: 'updateClip', clipId: clip.id, patch: { extendBeyondMax: canExtendBeyondMax(clip) ? false : undefined } }
);

/** E9 (T38d): turn a clip by `delta` degrees (clockwise, any multiple of 90); its rects turn with the picture. */
export const getRotateClipAction = (clip: Pick<MixClip, 'id' | 'rotation'>, delta: number): MixProjectAction => (
  { type: 'rotateClip', clipId: clip.id, rotation: addRotation(getClipRotation(clip), delta) }
);

/**
 * Pinned and grouped clips (A4, T30) in the clip list and the Mix view: a multi-selection on top of the selected clip
 * (which stays the current segment of its source), the clip menu entries ("Pin here" at the Mix view cursor, "Unpin",
 * "Group selected clips", "Ungroup", E7's "Extend beyond the max if needed", E9's turns, and T39's links (E2) and
 * always-visible sequence (E5)), the group colours, the chains, the sequence and pinning by dragging a block. Each edit
 * is one undo step.
 */
export default function useMixClipPins({ clips, settings, selectedClipId, cursorTime, selectClip, dispatchStep }: {
  clips: MixClip[],
  /** E2/E5 (T39): the chains and the always-visible sequence. */
  settings: MixSettings,
  selectedClipId: string | undefined,
  /** The Mix view cursor (useMixOverlays), where "Pin here" pins. */
  cursorTime: number,
  /** Plain selection (useMixClips.userSelectClip). */
  selectClip: (clipId: string) => void,
  dispatchStep: (action: MixProjectAction) => void,
}) {
  // Clips selected besides the current one
  const [extraIds, setExtraIds] = useState<ReadonlySet<string>>(() => new Set());

  const selectedClipIds = useMemo<ReadonlySet<string>>(() => new Set(clips.filter((c) => c.id === selectedClipId || extraIds.has(c.id)).map((c) => c.id)), [clips, extraIds, selectedClipId]);

  const userSelectClip = useCallback((clipId: string, modifiers?: ClipSelectModifiers) => {
    if (modifiers?.toggle) {
      setExtraIds((prev) => {
        const next = new Set(prev);
        if (next.has(clipId)) next.delete(clipId);
        else next.add(clipId);
        return next;
      });
      return;
    }
    if (modifiers?.range) {
      setExtraIds(new Set(getSelectionRange(clips.map((c) => c.id), selectedClipId, clipId)));
      return;
    }
    setExtraIds(new Set());
    selectClip(clipId);
  }, [clips, selectClip, selectedClipId]);

  const groupColors = useMemo(() => getGroupColors(clips), [clips]);
  const pinTimes = useMemo(() => new Map(clips.flatMap((clip) => {
    const time = getClipPinTime(clips, clip);
    return time != null ? [[clip.id, time] as const] : [];
  })), [clips]);

  const userPinClip = useCallback((clipId: string, time: number) => {
    const action = getPinClipAction(clips, clipId, time);
    if (action != null) dispatchStep(action);
  }, [clips, dispatchStep]);

  const userUnpinClip = useCallback((clipId: string) => {
    const action = getUnpinClipAction(clips, clipId);
    if (action != null) dispatchStep(action);
  }, [clips, dispatchStep]);

  const userGroupSelectedClips = useCallback(() => {
    if (selectedClipIds.size < 2) return;
    dispatchStep({ type: 'groupClips', clipIds: [...selectedClipIds], groupId: nanoid() });
    setExtraIds(new Set());
  }, [dispatchStep, selectedClipIds]);

  const userUngroupClip = useCallback((clipId: string) => {
    const clip = clips.find((c) => c.id === clipId);
    if (clip?.groupId == null) return;
    dispatchStep({ type: 'ungroupClips', clipIds: getGroupMembers(clips, clip).map((c) => c.id) });
  }, [clips, dispatchStep]);

  // E2 (T39): chains of linked clips, as the planner makes them
  const linkInfos = useMemo(() => getClipLinkInfos({ clips, settings }), [clips, settings]);

  const userSetClipLink = useCallback((clipId: string, linked: boolean) => {
    const clip = clips.find((c) => c.id === clipId);
    const action = clip != null ? getSetClipLinkAction(clip, linkInfos.get(clipId), linked) : undefined;
    if (action != null) dispatchStep(action);
  }, [clips, dispatchStep, linkInfos]);

  // E5 (T39): the always-visible sequence
  const sequence = settings.alwaysVisible.clipIds;
  const sequenceIndexes = useMemo(() => new Map(sequence.map((id, i) => [id, i])), [sequence]);

  /** Adds clips to the sequence at `index` (or the end); those already in it move there. */
  const userAddToSequence = useCallback((clipIds: string[], index?: number) => {
    const action = getAlwaysVisibleAction(sequence, clipIds, { add: true, index });
    if (action != null) dispatchStep(action);
  }, [dispatchStep, sequence]);

  const userRemoveFromSequence = useCallback((clipIds: string[]) => {
    const action = getAlwaysVisibleAction(sequence, clipIds, { add: false });
    if (action != null) dispatchStep(action);
  }, [dispatchStep, sequence]);

  /** New order of the sequence (same clips). */
  const userReorderSequence = useCallback((clipIds: string[]) => {
    if (clipIds.length === sequence.length && clipIds.every((id, i) => id === sequence[i])) return;
    dispatchStep({ type: 'setAlwaysVisibleClips', clipIds });
  }, [dispatchStep, sequence]);

  /** Entries of a clip's context menu, for the clip list and the Mix view. */
  const getClipMenu = useCallback((clip: MixClip): ContextMenuTemplate => [
    { type: 'separator' },
    { label: i18n.t('Pin here ({{time}})', { time: formatDuration({ seconds: cursorTime, shorten: true }) }), click: () => userPinClip(clip.id, cursorTime) },
    { label: i18n.t('Unpin'), enabled: pinTimes.has(clip.id), click: () => userUnpinClip(clip.id) },
    { label: i18n.t('Group selected clips'), enabled: selectedClipIds.size >= 2, click: userGroupSelectedClips },
    { label: i18n.t('Ungroup'), enabled: clip.groupId != null && groupColors.has(clip.groupId), click: () => userUngroupClip(clip.id) },
    { type: 'separator' },
    // E7 (T38b): on by default (only `false` is stored)
    { label: i18n.t('Extend beyond the max if needed'), type: 'checkbox', checked: canExtendBeyondMax(clip), click: () => dispatchStep(getToggleExtendBeyondMaxAction(clip)) },
    { type: 'separator' },
    // E9 (T38d)
    { label: i18n.t('Rotate +90°'), click: () => dispatchStep(getRotateClipAction(clip, 90)) },
    { label: i18n.t('Rotate −90°'), click: () => dispatchStep(getRotateClipAction(clip, -90)) },
    { label: i18n.t('Rotate 180°'), click: () => dispatchStep(getRotateClipAction(clip, 180)) },
    { type: 'separator' },
    // E2 (T39): with the previous clip of its source
    linkInfos.get(clip.id)?.linked === true
      ? { label: i18n.t('Break link with the previous clip'), click: () => userSetClipLink(clip.id, false) }
      : { label: i18n.t('Link with the previous clip'), enabled: linkInfos.get(clip.id)?.previousId != null, click: () => userSetClipLink(clip.id, true) },
    // E5 (T39): the selected clips if this one is selected, else this one
    sequenceIndexes.has(clip.id)
      ? { label: i18n.t('Remove from the always-visible sequence'), click: () => userRemoveFromSequence(selectedClipIds.has(clip.id) ? [...selectedClipIds].filter((id) => sequenceIndexes.has(id)) : [clip.id]) }
      : { label: i18n.t('Add to the always-visible sequence'), click: () => userAddToSequence(selectedClipIds.has(clip.id) ? clips.filter((c) => selectedClipIds.has(c.id) && !sequenceIndexes.has(c.id)).map((c) => c.id) : [clip.id]) },
  ], [clips, cursorTime, dispatchStep, groupColors, linkInfos, pinTimes, selectedClipIds, sequenceIndexes, userAddToSequence, userGroupSelectedClips, userPinClip, userRemoveFromSequence, userSetClipLink, userUngroupClip, userUnpinClip]);

  /**
   * Opens the clip menu right away (Mix view blocks: a block per clip, so the native menu is only built when it's
   * asked for, not each time the cursor moves).
   */
  const openClipMenu = useCallback((clip: MixClip) => {
    Menu.buildFromTemplate(getClipMenu(clip).filter((item) => item.type !== 'separator')).popup({ window: getCurrentWindow() });
  }, [getClipMenu]);

  return {
    selectedClipIds,
    userSelectClip,
    groupColors,
    /** Effective pin time of each pinned clip (its own or its group's). */
    pinTimes,
    userPinClip,
    userUnpinClip,
    userGroupSelectedClips,
    userUngroupClip,
    getClipMenu,
    openClipMenu,
    /** E2 (T39): link state of the clips that can be in a chain. */
    linkInfos,
    userSetClipLink,
    /** E5 (T39): the always-visible sequence (ids in order) and each clip's index in it. */
    sequence,
    sequenceIndexes,
    userAddToSequence,
    userRemoveFromSequence,
    userReorderSequence,
  };
}

export type UseMixClipPins = ReturnType<typeof useMixClipPins>;
