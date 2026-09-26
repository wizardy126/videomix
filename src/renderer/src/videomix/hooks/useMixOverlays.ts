import { useCallback, useMemo, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { nanoid } from 'nanoid';
import i18n from 'i18next';

import { showOpenDialog } from '../../dialogs';
import { readFileFfprobeMeta } from '../../ffmpeg';
import type { WithErrorHandling } from '../../hooks/useErrorHandling';
import type { EditOptions, UseMixProject } from './useMixProject';
import useOverlaySoundDurations from './useOverlaySoundDurations';
import { getOutputSize } from '../types';
import type { MixOverlay } from '../types';
import type { MixBlockDefPatch, MixBlockPatch, MixOverlayPatch, MixProjectAction, OverlayLayerMove } from '../projectReducer';
import type { OverlayFileKind } from '../projectFile';
import type { MixPlan } from '../planner/types';
import { getOverlayTimesPlan, planRender } from '../render/renderOutput';
import { resolveOverlayTimes } from '../overlays/resolveOverlayTimes';
import type { ResolvedOverlayTimes } from '../overlays/resolveOverlayTimes';
import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay, createSoundOverlay, createTextOverlay } from '../overlays/factories';
import { getImageBox } from '../overlayTimeline';
import { getDuplicateClipName, getNextNumberedName } from '../clips';
import { getOverlayTypeLabel } from '../overlayTexts';
import { expandBlocks, getBlockDefDuration, getBlockMemberOverlayId, resolveBlockTimes } from '../blocks/expandBlocks';
import type { BlockMemberRef, ResolvedBlockTime } from '../blocks/expandBlocks';
import { ungroupBlock } from '../blocks/blockOperations';
import { getNextSelection, getRepeatClipIds, isBlockDefLocked } from '../blocks/blockUi';
import type { SelectionMode } from '../blocks/blockUi';
import { askForBlockDuration, askForBlockRepeat } from '../components/BlockDialogs';
import { segColorsCount } from '../../util/colors';
import getSwal from '../../swal';

const { basename, dirname } = window.require('node:path');

// The planner is fast (04-diseno §3.3), but recomputing on every keystroke/drag would still be wasteful (T15)
const PLAN_DEBOUNCE_MS = 300;

/** File types of the overlays (T22 §2). */
export const overlayFileExtensions = {
  image: ['png'],
  sound: ['wav', 'mp3', 'm4a', 'ogg', 'flac'],
  font: ['ttf', 'otf'],
};

/**
 * Overlays in the Mix view (T22): the mix plan and the overlay times resolved on it, the selected overlay, the Mix view
 * cursor (where new overlays go), and the overlay actions of the lanes, the mini frame and the properties panel.
 * Edits go through useMixProject, so they are undoable; drags use transient edits (one undo step per drag).
 */
export default function useMixOverlays({ mixProject, enabled, withErrorHandling, onFileReplaced }: {
  mixProject: UseMixProject,
  /** The plan is only computed while the Mix view is shown. */
  enabled: boolean,
  withErrorHandling: WithErrorHandling,
  /** Called after "Replace…"/"Choose a font" relinks a file, so a pending "file not found" warning is cleared too (T23). */
  /** T57: `blockDefId` for a member of a block (`overlayId` is then its member id). */
  onFileReplaced?: ((overlayId: string, kind: OverlayFileKind, blockDefId?: string | undefined) => void) | undefined,
}) {
  const { project, addOverlay, updateOverlay, removeOverlay, duplicateOverlay, moveOverlayLayer, relinkOverlayFile, commitTransient, cancelTransient } = mixProject;
  const { clips, settings, overlays, sources } = project;

  const [debouncedClips] = useDebounce(clips, PLAN_DEBOUNCE_MS);
  const [debouncedSettings] = useDebounce(settings, PLAN_DEBOUNCE_MS);
  const renderPlan = useMemo(
    // E7 (T38b): the source sizes bound the extension beyond the max (they change rarely: not debounced)
    () => (enabled && debouncedClips.length > 0 ? planRender({ clips: debouncedClips, settings: debouncedSettings, sources }) : undefined),
    [debouncedClips, debouncedSettings, enabled, sources],
  );
  // E4 (T39): the Mix view and the live preview show the mix cut at the maximum duration, like the render
  const plan: MixPlan | undefined = renderPlan?.plan;
  /** Before the cut: E3's estimate shows its whole duration. */
  const fullPlan: MixPlan | undefined = renderPlan?.fullPlan;

  // T56: blocks of overlays expanded into concrete overlays (the same `overlays` array without blocks). `resolved` has
  // the times of all of them (hidden blocks too, so what's anchored to them keeps its times); the lanes below still
  // list the loose overlays only (blocks in the Mix view: T57).
  const { blocks, blockDefs } = project;
  const expanded = useMemo(() => expandBlocks({ overlays, blocks, blockDefs }), [blockDefs, blocks, overlays]);
  const soundDurations = useOverlaySoundDurations(expanded.all);

  // Not debounced: overlay edits don't change the plan, and resolving is O(n), so blocks follow a drag immediately
  const resolved = useMemo<ResolvedOverlayTimes>(
    () => (renderPlan != null ? resolveOverlayTimes({ overlays: expanded.all, clips: project.clips }, getOverlayTimesPlan(renderPlan), { soundDurations }) : new Map()),
    [renderPlan, expanded, project.clips, soundDurations],
  );
  /** T56: start/end of each block instance (see `resolveBlockTimes`). */
  const blockTimes = useMemo<Map<string, ResolvedBlockTime>>(
    () => (renderPlan != null && blocks.length > 0 ? resolveBlockTimes({ overlays, blocks, blockDefs, clips: project.clips }, getOverlayTimesPlan(renderPlan), resolved, expanded) : new Map()),
    [blockDefs, blocks, expanded, overlays, project.clips, renderPlan, resolved],
  );

  // T57: multi-selection of loose overlays and blocks (ids in click order), or a member being edited inside its block.
  // Only what still exists counts (e.g. after undoing its creation, nothing is selected).
  const [selection, setSelection] = useState<{ ids: string[], member?: BlockMemberRef | undefined }>({ ids: [] });
  const selectedIds = useMemo(() => {
    const existing = new Set([...overlays.map((o) => o.id), ...blocks.map((b) => b.id)]);
    return selection.ids.filter((id) => existing.has(id));
  }, [blocks, overlays, selection.ids]);
  /** The member edited inside its block (its panel), if it still exists. */
  const selectedMember = useMemo(() => {
    const ref = selection.member;
    const block = ref != null ? blocks.find((b) => b.id === ref.blockId) : undefined;
    const def = block != null ? blockDefs.find((d) => d.id === block.defId) : undefined;
    const member = def?.members.find((m) => m.id === ref?.memberId);
    return block != null && def != null && member != null ? { block, def, member, overlayId: getBlockMemberOverlayId(block.id, member.id) } : undefined;
  }, [blockDefs, blocks, selection.member]);
  const single = selectedMember == null && selectedIds.length === 1 ? selectedIds[0] : undefined;
  const selectedOverlay = useMemo(() => (single != null ? overlays.find((o) => o.id === single) : undefined), [overlays, single]);
  const selectedOverlayId = selectedOverlay?.id;
  const selectedBlock = useMemo(() => (single != null ? blocks.find((b) => b.id === single) : undefined), [blocks, single]);
  /** For T58's "Export selection": the selected loose overlays and blocks, in layer order. */
  const selectedLooseOverlayIds = useMemo(() => overlays.filter((o) => selectedIds.includes(o.id)).map((o) => o.id), [overlays, selectedIds]);
  const selectedBlockIds = useMemo(() => blocks.filter((b) => selectedIds.includes(b.id)).map((b) => b.id), [blocks, selectedIds]);
  /** Something is selected: the properties panel replaces the clip list. */
  const hasOverlaySelection = selectedMember != null || selectedIds.length > 0;
  /** The id (loose or expanded member) shown as selected on the mini frame, with its resize handles. */
  const selectedFrameOverlayId = selectedMember?.overlayId ?? selectedOverlayId;

  /** Selects only that loose overlay (or nothing). */
  const setSelectedOverlayId = useCallback((id: string | undefined) => setSelection({ ids: id != null ? [id] : [] }), []);
  /** A click on a loose overlay or a block (Ctrl/Cmd toggles it, Shift adds it, see `getSelectionMode`). */
  const selectOverlayItem = useCallback((id: string, mode: SelectionMode = 'replace') => setSelection((s) => ({ ids: getNextSelection(s.member != null ? [s.member.blockId] : s.ids, id, mode) })), []);
  /** Edit a member inside its block. */
  const selectBlockMember = useCallback((blockId: string, memberId: string) => setSelection({ ids: [blockId], member: { blockId, memberId } }), []);
  const clearOverlaySelection = useCallback(() => setSelection({ ids: [] }), []);

  // Mix view cursor (s in the final video): where new overlays are placed, and the frame shown when not hovering
  const [cursorTime, setCursorTime] = useState(0);

  const outputSize = getOutputSize(settings.output);

  const add = useCallback((overlay: MixOverlay) => {
    addOverlay(overlay);
    setSelectedOverlayId(overlay.id);
  }, [addOverlay, setSelectedOverlayId]);

  const askForFile = useCallback(async (kind: keyof typeof overlayFileExtensions, defaultPath?: string | undefined) => {
    const names = { image: i18n.t('PNG images'), sound: i18n.t('Audio files'), font: i18n.t('Fonts') };
    const titles = { image: i18n.t('Choose an image'), sound: i18n.t('Choose a sound'), font: i18n.t('Choose a font') };
    const { canceled, filePaths } = await showOpenDialog({
      title: titles[kind],
      properties: ['openFile'],
      ...(defaultPath != null && { defaultPath }),
      filters: [{ name: names[kind], extensions: overlayFileExtensions[kind] }],
    });
    const [filePath] = filePaths;
    return canceled ? undefined : filePath;
  }, []);

  const userAddImage = useCallback(async () => {
    await withErrorHandling(async () => {
      const filePath = await askForFile('image');
      if (filePath == null) return;
      const overlay = createImageOverlay({ id: nanoid(), name: basename(filePath), start: cursorTime, filePath });
      // Keep the image's proportion (the factory's box is square in fractions, i.e. stretched)
      try {
        const { streams } = await readFileFfprobeMeta(filePath);
        const stream = streams.find((s) => s.width != null && s.height != null);
        if (stream?.width != null && stream.height != null) overlay.box = getImageBox({ width: stream.width, height: stream.height }, outputSize, overlay.box.width);
      } catch (err) {
        console.warn('Could not read the image size', err);
      }
      add(overlay);
    }, i18n.t('Failed to open file'));
  }, [add, askForFile, cursorTime, outputSize, withErrorHandling]);

  const userAddSound = useCallback(async () => {
    await withErrorHandling(async () => {
      const filePath = await askForFile('sound');
      if (filePath == null) return;
      add(createSoundOverlay({ id: nanoid(), name: basename(filePath), start: cursorTime, filePath }));
    }, i18n.t('Failed to open file'));
  }, [add, askForFile, cursorTime, withErrorHandling]);

  const userAddCountdown = useCallback(() => {
    add(createCountdownOverlay({ id: nanoid(), name: getNextNumberedName(getOverlayTypeLabel('countdown'), overlays.map((o) => o.name)), start: cursorTime }));
  }, [add, cursorTime, overlays]);

  const userAddProgressBar = useCallback(() => {
    add(createProgressBarOverlay({ id: nanoid(), name: getNextNumberedName(getOverlayTypeLabel('progressBar'), overlays.map((o) => o.name)), start: cursorTime }));
  }, [add, cursorTime, overlays]);

  const userAddText = useCallback(() => {
    add(createTextOverlay({ id: nanoid(), name: getNextNumberedName(getOverlayTypeLabel('text'), overlays.map((o) => o.name)), start: cursorTime, text: i18n.t('Your text') }));
  }, [add, cursorTime, overlays]);

  /** Asks for the new file of an overlay's image/sound (`media`) or countdown/text font. */
  const askForOverlayFile = useCallback(async (overlay: MixOverlay, kind: OverlayFileKind) => {
    let fileKind: keyof typeof overlayFileExtensions = 'font';
    if (kind === 'media') fileKind = overlay.type === 'sound' ? 'sound' : 'image';
    let current: string | undefined;
    if (kind === 'font') current = overlay.type === 'countdown' || overlay.type === 'text' ? overlay.font?.absolutePath : undefined;
    else if (overlay.type === 'image' || overlay.type === 'sound') current = overlay.absolutePath;
    return askForFile(fileKind, current != null ? dirname(current) : undefined);
  }, [askForFile]);

  /** Replace an image/sound file, or choose the countdown/text font. */
  const userChooseOverlayFile = useCallback(async (overlayId: string, kind: OverlayFileKind) => {
    const overlay = overlays.find((o) => o.id === overlayId);
    if (overlay == null) return;
    await withErrorHandling(async () => {
      const filePath = await askForOverlayFile(overlay, kind);
      if (filePath == null) return;
      relinkOverlayFile(overlayId, kind, filePath);
      onFileReplaced?.(overlayId, kind);
    }, i18n.t('Failed to open file'));
  }, [askForOverlayFile, onFileReplaced, overlays, relinkOverlayFile, withErrorHandling]);

  const update = useCallback((overlayId: string, patch: MixOverlayPatch, options?: EditOptions) => updateOverlay(overlayId, patch, options), [updateOverlay]);

  const userRemoveOverlay = useCallback((overlayId: string) => {
    // the dependants are detached (and the user told) by useMixProject's dispatch
    removeOverlay(overlayId);
    setSelection((sel) => ({ ids: sel.ids.filter((id) => id !== overlayId) }));
  }, [removeOverlay]);

  const userDuplicateOverlay = useCallback((overlayId: string) => {
    const overlay = overlays.find((o) => o.id === overlayId);
    if (overlay == null) return;
    const newId = duplicateOverlay(overlayId, getDuplicateClipName(overlay.name, overlays));
    setSelectedOverlayId(newId);
  }, [duplicateOverlay, overlays, setSelectedOverlayId]);

  const userMoveOverlayLayer = useCallback((overlayId: string, to: OverlayLayerMove) => moveOverlayLayer(overlayId, to), [moveOverlayLayer]);

  // Blocks of overlays (T57, H1, H5, H6, H8). Every action is one undo step. A locked block (H8) can't be moved or
  // edited (the reducer doesn't enforce it, T56): these guards do, besides the disabled controls. Its content can't be
  // edited either while any linked instance is locked (`isBlockDefLocked`).
  const { dispatch, getProject } = mixProject;
  const getBlock = useCallback((blockId: string) => getProject().blocks.find((b) => b.id === blockId), [getProject]);
  const isLockedBlock = useCallback((blockId: string) => getBlock(blockId)?.locked === true, [getBlock]);
  const isLockedDef = useCallback((defId: string) => isBlockDefLocked(getProject(), defId), [getProject]);
  const warnLocked = useCallback(() => {
    getSwal().toast.fire({ icon: 'info', title: i18n.t('The block is locked: unlock it to change it') });
  }, []);

  /** H1 "Group into block": the selected loose overlays (their times don't change); the new block gets selected. */
  const userGroupSelection = useCallback(() => {
    if (selectedLooseOverlayIds.length === 0) return;
    const current = getProject();
    const blockId = nanoid();
    const name = getNextNumberedName(i18n.t('Block'), current.blockDefs.map((d) => d.name));
    // the least used palette colour, like new clips
    const counts = Array.from({ length: segColorsCount }, (_, color) => current.blockDefs.filter((d) => d.color % segColorsCount === color).length);
    const color = Math.max(0, counts.indexOf(Math.min(...counts)));
    dispatch({ type: 'groupOverlays', overlayIds: selectedLooseOverlayIds, blockId, defId: nanoid(), name, color });
    setSelection({ ids: [blockId] });
  }, [dispatch, getProject, selectedLooseOverlayIds]);

  /** Removes the selected loose overlays and blocks (locked ones are kept) in one step. */
  const userRemoveSelection = useCallback(() => {
    const current = getProject();
    const actions: MixProjectAction[] = [
      ...selectedLooseOverlayIds.map((overlayId): MixProjectAction => ({ type: 'removeOverlay', overlayId })),
      ...selectedBlockIds.filter((id) => !current.blocks.find((b) => b.id === id)?.locked).map((blockId): MixProjectAction => ({ type: 'removeBlock', blockId })),
    ];
    if (actions.length === 0) return;
    dispatch(actions.length === 1 ? actions[0]! : { type: 'batch', actions });
    setSelection({ ids: [] });
  }, [dispatch, getProject, selectedBlockIds, selectedLooseOverlayIds]);

  /** Its members become loose overlays (selected). Not for a hidden block: its overlays would suddenly show. */
  const userUngroupBlock = useCallback((blockId: string) => {
    const current = getProject();
    const block = current.blocks.find((b) => b.id === blockId);
    if (block == null) return;
    if (block.locked) {
      warnLocked();
      return;
    }
    if (block.hidden) {
      getSwal().toast.fire({ icon: 'info', title: i18n.t('Show the block before ungrouping it: its overlays would appear in the video') });
      return;
    }
    const before = new Set(current.overlays.map((o) => o.id));
    const newIds = ungroupBlock(current, { blockId }).overlays.map((o) => o.id).filter((id) => !before.has(id));
    dispatch({ type: 'ungroupBlock', blockId });
    setSelection({ ids: newIds });
  }, [dispatch, getProject, warnLocked]);

  const userRemoveBlock = useCallback((blockId: string) => {
    if (isLockedBlock(blockId)) {
      warnLocked();
      return;
    }
    dispatch({ type: 'removeBlock', blockId });
    setSelection((sel) => ({ ids: sel.ids.filter((id) => id !== blockId) }));
  }, [dispatch, isLockedBlock, warnLocked]);

  /** An independent copy (its own content), selected. */
  const userDuplicateBlock = useCallback((blockId: string) => {
    const current = getProject();
    const def = current.blockDefs.find((d) => d.id === getBlock(blockId)?.defId);
    if (def == null) return;
    const newBlockId = nanoid();
    dispatch({ type: 'duplicateBlock', blockId, newBlockId, newDefId: nanoid(), name: getDuplicateClipName(def.name, current.blockDefs) });
    setSelection({ ids: [newBlockId] });
  }, [dispatch, getBlock, getProject]);

  /** H5: its own copy of the content, so it can be edited alone (also the way out when another linked copy is locked). */
  const userUnlinkBlock = useCallback((blockId: string) => {
    if (isLockedBlock(blockId)) {
      warnLocked();
      return;
    }
    dispatch({ type: 'unlinkBlock', blockId, newDefId: nanoid() });
  }, [dispatch, isLockedBlock, warnLocked]);

  /** H5 "Repeat…": asks how; `clipIds` = the selected clips (in video order), for "at the start of each selected clip". */
  const userRepeatBlock = useCallback(async (blockId: string, clipIds: readonly string[]) => {
    const block = getBlock(blockId);
    const def = getProject().blockDefs.find((d) => d.id === block?.defId);
    if (block == null || def == null) return;
    if (block.locked) {
      warnLocked();
      return;
    }
    const repeatClipIds = getRepeatClipIds(block, clipIds);
    const answer = await askForBlockRepeat({ clipCount: repeatClipIds.length, defaultInterval: Math.max(1, getBlockDefDuration(def)) });
    if (answer == null) return;
    if (answer.kind === 'clips') {
      dispatch({ type: 'repeatBlock', blockId, newBlockIds: repeatClipIds.map(() => nanoid()), repeat: { kind: 'clips', clipIds: repeatClipIds } });
    } else {
      dispatch({ type: 'repeatBlock', blockId, newBlockIds: Array.from({ length: answer.times - 1 }, () => nanoid()), repeat: { kind: 'interval', interval: answer.interval } });
    }
  }, [dispatch, getBlock, getProject, warnLocked]);

  /** H6 "Block duration…" (the content, so every linked copy). */
  const userStretchBlock = useCallback(async (blockId: string) => {
    const block = getBlock(blockId);
    const def = getProject().blockDefs.find((d) => d.id === block?.defId);
    if (block == null || def == null) return;
    if (isLockedDef(def.id)) {
      warnLocked();
      return;
    }
    const current = getBlockDefDuration(def);
    if (!(current > 0)) {
      getSwal().toast.fire({ icon: 'info', title: i18n.t('The block has no duration to scale (only sounds)') });
      return;
    }
    const duration = await askForBlockDuration(current);
    if (duration != null) dispatch({ type: 'stretchBlock', blockId, duration });
  }, [dispatch, getBlock, getProject, isLockedDef, warnLocked]);

  const userMoveBlockLayer = useCallback((blockId: string, to: OverlayLayerMove) => {
    if (isLockedBlock(blockId)) return;
    dispatch({ type: 'moveBlockLayer', blockId, to });
  }, [dispatch, isLockedBlock]);

  /** Instance fields (anchor, variables, hidden, locked, collapsed). A locked block only changes hidden/locked/collapsed. */
  const userUpdateBlock = useCallback((blockId: string, patch: MixBlockPatch, options?: EditOptions) => {
    const block = getBlock(blockId);
    if (block == null) return;
    if (block.locked && Object.keys(patch).some((key) => key !== 'hidden' && key !== 'locked' && key !== 'collapsed')) return;
    dispatch({ type: 'updateBlock', blockId, patch }, options);
  }, [dispatch, getBlock]);

  /** Name and colour of the content (shared by its linked copies). */
  const userUpdateBlockDef = useCallback((defId: string, patch: MixBlockDefPatch) => {
    if (isLockedDef(defId)) return;
    dispatch({ type: 'updateBlockDef', defId, patch });
  }, [dispatch, isLockedDef]);

  /** Edits a member (every linked copy changes, H5). */
  const userUpdateBlockMember = useCallback((defId: string, memberId: string, patch: MixOverlayPatch, options?: EditOptions) => {
    if (isLockedDef(defId)) return;
    dispatch({ type: 'updateBlockMember', defId, memberId, patch }, options);
  }, [dispatch, isLockedDef]);

  const userRemoveBlockMember = useCallback((defId: string, memberId: string) => {
    if (isLockedDef(defId)) {
      warnLocked();
      return;
    }
    dispatch({ type: 'removeBlockMember', defId, memberId });
    setSelection((sel) => ({ ids: sel.member != null ? [sel.member.blockId] : sel.ids }));
  }, [dispatch, isLockedDef, warnLocked]);

  /** Replace a member's image/sound file, or choose its font. */
  const userChooseBlockMemberFile = useCallback(async (defId: string, memberId: string, kind: OverlayFileKind) => {
    const member = getProject().blockDefs.find((d) => d.id === defId)?.members.find((m) => m.id === memberId);
    if (member == null || isLockedDef(defId)) return;
    await withErrorHandling(async () => {
      const filePath = await askForOverlayFile(member, kind);
      if (filePath == null) return;
      const file = { path: filePath, absolutePath: filePath };
      dispatch({ type: 'updateBlockMember', defId, memberId, patch: kind === 'font' ? { font: file } : file });
      onFileReplaced?.(memberId, kind, defId);
    }, i18n.t('Failed to open file'));
  }, [askForOverlayFile, dispatch, getProject, isLockedDef, onFileReplaced, withErrorHandling]);

  return {
    plan,
    fullPlan,
    resolved,
    /** T56: the project's overlays with its blocks expanded (`all` to resolve, `visible` to draw and play). */
    expanded,
    blockTimes,
    soundDurations,
    outputSize,
    selectedOverlay,
    selectedOverlayId,
    setSelectedOverlayId,
    // T57: selection of loose overlays and blocks, and the member being edited
    selectedIds,
    selectedLooseOverlayIds,
    selectedBlockIds,
    selectedBlock,
    selectedMember,
    selectedFrameOverlayId,
    hasOverlaySelection,
    selectOverlayItem,
    selectBlockMember,
    clearOverlaySelection,
    cursorTime,
    setCursorTime,
    userAddImage,
    userAddSound,
    userAddCountdown,
    userAddProgressBar,
    userAddText,
    userChooseOverlayFile,
    update,
    commitTransient,
    cancelTransient,
    userRemoveOverlay,
    userDuplicateOverlay,
    userMoveOverlayLayer,
    // T57: blocks
    userGroupSelection,
    userRemoveSelection,
    userUngroupBlock,
    userRemoveBlock,
    userDuplicateBlock,
    userUnlinkBlock,
    userRepeatBlock,
    userStretchBlock,
    userMoveBlockLayer,
    userUpdateBlock,
    userUpdateBlockDef,
    userUpdateBlockMember,
    userRemoveBlockMember,
    userChooseBlockMemberFile,
    project,
    // for the style presets of the properties panel (T26)
    withErrorHandling,
  };
}

export type UseMixOverlays = ReturnType<typeof useMixOverlays>;
