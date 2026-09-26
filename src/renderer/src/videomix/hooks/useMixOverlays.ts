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
import type { MixOverlayPatch, OverlayLayerMove } from '../projectReducer';
import type { OverlayFileKind } from '../projectFile';
import type { MixPlan } from '../planner/types';
import { getOverlayTimesPlan, planRender } from '../render/renderOutput';
import { resolveOverlayTimes } from '../overlays/resolveOverlayTimes';
import type { ResolvedOverlayTimes } from '../overlays/resolveOverlayTimes';
import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay, createSoundOverlay, createTextOverlay } from '../overlays/factories';
import { getImageBox } from '../overlayTimeline';
import { getDuplicateClipName, getNextNumberedName } from '../clips';
import { getOverlayTypeLabel } from '../overlayTexts';
import { expandBlocks, resolveBlockTimes } from '../blocks/expandBlocks';
import type { ResolvedBlockTime } from '../blocks/expandBlocks';

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
  onFileReplaced?: ((overlayId: string, kind: OverlayFileKind) => void) | undefined,
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

  const [selectedId, setSelectedOverlayId] = useState<string>();
  const selectedOverlay = useMemo(() => overlays.find((o) => o.id === selectedId), [overlays, selectedId]);
  // Only if it still exists (e.g. after undoing its creation, nothing is selected)
  const selectedOverlayId = selectedOverlay?.id;

  // Mix view cursor (s in the final video): where new overlays are placed, and the frame shown when not hovering
  const [cursorTime, setCursorTime] = useState(0);

  const outputSize = getOutputSize(settings.output);

  const add = useCallback((overlay: MixOverlay) => {
    addOverlay(overlay);
    setSelectedOverlayId(overlay.id);
  }, [addOverlay]);

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

  /** Replace an image/sound file, or choose the countdown/text font. */
  const userChooseOverlayFile = useCallback(async (overlayId: string, kind: OverlayFileKind) => {
    const overlay = overlays.find((o) => o.id === overlayId);
    if (overlay == null) return;
    await withErrorHandling(async () => {
      let fileKind: keyof typeof overlayFileExtensions = 'font';
      if (kind === 'media') fileKind = overlay.type === 'sound' ? 'sound' : 'image';
      let current: string | undefined;
      if (kind === 'font') current = overlay.type === 'countdown' || overlay.type === 'text' ? overlay.font?.absolutePath : undefined;
      else if (overlay.type === 'image' || overlay.type === 'sound') current = overlay.absolutePath;
      const filePath = await askForFile(fileKind, current != null ? dirname(current) : undefined);
      if (filePath == null) return;
      relinkOverlayFile(overlayId, kind, filePath);
      onFileReplaced?.(overlayId, kind);
    }, i18n.t('Failed to open file'));
  }, [askForFile, onFileReplaced, overlays, relinkOverlayFile, withErrorHandling]);

  const update = useCallback((overlayId: string, patch: MixOverlayPatch, options?: EditOptions) => updateOverlay(overlayId, patch, options), [updateOverlay]);

  const userRemoveOverlay = useCallback((overlayId: string) => {
    // the dependants are detached (and the user told) by useMixProject's dispatch
    removeOverlay(overlayId);
    setSelectedOverlayId((id) => (id === overlayId ? undefined : id));
  }, [removeOverlay]);

  const userDuplicateOverlay = useCallback((overlayId: string) => {
    const overlay = overlays.find((o) => o.id === overlayId);
    if (overlay == null) return;
    const newId = duplicateOverlay(overlayId, getDuplicateClipName(overlay.name, overlays));
    setSelectedOverlayId(newId);
  }, [duplicateOverlay, overlays]);

  const userMoveOverlayLayer = useCallback((overlayId: string, to: OverlayLayerMove) => moveOverlayLayer(overlayId, to), [moveOverlayLayer]);

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
    // for the style presets of the properties panel (T26)
    withErrorHandling,
  };
}

export type UseMixOverlays = ReturnType<typeof useMixOverlays>;
