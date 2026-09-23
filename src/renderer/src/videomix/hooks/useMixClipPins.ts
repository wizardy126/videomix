import { useCallback, useMemo, useState } from 'react';
import { nanoid } from 'nanoid';
import i18n from 'i18next';

import { formatDuration } from '../../util/duration';
import type { ContextMenuTemplate } from '../../types';
import type { MixProjectAction } from '../projectReducer';
import type { MixClip } from '../types';
import { getClipPinTime, getGroupColors, getGroupMembers, getPinClipAction, getSelectionRange, getUnpinClipAction } from '../clipGroups';

const { getCurrentWindow, Menu } = window.require('@electron/remote');

/** Ctrl/Cmd-click adds or removes a clip from the selection, Shift-click selects the range from the selected clip. */
export interface ClipSelectModifiers {
  toggle?: boolean | undefined,
  range?: boolean | undefined,
}

export const getClipSelectModifiers = (e: { ctrlKey: boolean, metaKey: boolean, shiftKey: boolean }): ClipSelectModifiers => ({ toggle: e.ctrlKey || e.metaKey, range: e.shiftKey });

/**
 * Pinned and grouped clips (A4, T30) in the clip list and the Mix view: a multi-selection on top of the selected clip
 * (which stays the current segment of its source), the clip menu entries ("Pin here" at the Mix view cursor, "Unpin",
 * "Group selected clips", "Ungroup"), the group colours and pinning by dragging a block. Each edit is one undo step.
 */
export default function useMixClipPins({ clips, selectedClipId, cursorTime, selectClip, dispatchStep }: {
  clips: MixClip[],
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

  /** Entries of a clip's context menu, for the clip list and the Mix view. */
  const getClipMenu = useCallback((clip: MixClip): ContextMenuTemplate => [
    { type: 'separator' },
    { label: i18n.t('Pin here ({{time}})', { time: formatDuration({ seconds: cursorTime, shorten: true }) }), click: () => userPinClip(clip.id, cursorTime) },
    { label: i18n.t('Unpin'), enabled: pinTimes.has(clip.id), click: () => userUnpinClip(clip.id) },
    { label: i18n.t('Group selected clips'), enabled: selectedClipIds.size >= 2, click: userGroupSelectedClips },
    { label: i18n.t('Ungroup'), enabled: clip.groupId != null && groupColors.has(clip.groupId), click: () => userUngroupClip(clip.id) },
  ], [cursorTime, groupColors, pinTimes, selectedClipIds.size, userGroupSelectedClips, userPinClip, userUngroupClip, userUnpinClip]);

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
  };
}

export type UseMixClipPins = ReturnType<typeof useMixClipPins>;
