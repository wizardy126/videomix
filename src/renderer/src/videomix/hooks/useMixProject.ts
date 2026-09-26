import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { nanoid } from 'nanoid';
import i18n from 'i18next';

import { showOpenDialog } from '../../dialogs';
import { readFileFfprobeMeta } from '../../ffmpeg';
import { createEmptyMixProject } from '../types';
import type { BlackBarsDetection, ImageOverlay, LoudnessMeasurement, MixClip, MixOverlay, MixProject, MixSettings } from '../types';
import type { Size } from '../overlayMath';
import { createMixSource, mixProjectReducer } from '../projectReducer';
import type { MixClipPatch, MixMusicPlaylistPatch, MixMusicTrackPatch, MixOverlayPatch, MixProjectAction, MixSourceRelink, OverlayLayerMove, ResolvedOverlayTimesForRemoval } from '../projectReducer';
import { createMusicTrack } from '../workspace';
import * as history from '../projectHistory';
import type { History } from '../projectHistory';
import { loadMixProject, mixProjectExtension, saveMixProject } from '../projectFile';
import type { LoadedMixProject, NodeDeps, OverlayFileKind } from '../projectFile';
import { deleteRecoveryFile, deleteRecoveryFilePath, findRecoverableProjects, getRecoveryDir, resolveRecoveredProject, writeRecoveryFile } from '../projectRecovery';
import type { RecoverableProject } from '../projectRecovery';
import { askForUnsavedChanges } from '../dialogs';
import { prepareOverlayRemoval } from '../overlayRemoval';
import { expandBlocks } from '../blocks/expandBlocks';
import { getKnownSoundDurations } from './useOverlaySoundDurations';
import getSwal from '../../swal';

const remote = window.require('@electron/remote');

const nodeDeps: NodeDeps = { path: window.require('node:path'), fs: window.require('node:fs/promises') };

const RECOVERY_DEBOUNCE_MS = 1500;

const vmxFilters = () => [{ name: i18n.t('VideoMix project'), extensions: [mixProjectExtension] }];

export interface EditOptions {
  /** Part of a continuous edit (e.g. dragging): no history step until `commitTransient()`. */
  transient?: boolean | undefined,
}

/**
 * The VideoMix project with undo/redo, save/open (.vmx) and recovery autosave.
 * Mount it above `resetState` in App.tsx so it survives switching the active source.
 *
 * Continuous edits: call e.g. `updateClip(id, patch, { transient: true })` on every move, then
 * `commitTransient()` on pointer up (one undo step for the whole gesture) or `cancelTransient()` to revert.
 * See projectHistory.ts.
 *
 * `user*` functions throw on I/O errors; callers wrap them in `withErrorHandling`.
 */
export default function useMixProject() {
  const [historyState, setHistoryState] = useState<History<MixProject>>(() => history.createHistory(createEmptyMixProject()));
  // The project as last saved/opened; `dirty` is a reference comparison (undo back to it clears dirty)
  const [savedProject, setSavedProjectState] = useState<MixProject>(historyState.present);
  const [projectPath, setProjectPathState] = useState<string>();
  const [sessionId] = useState(() => nanoid());

  // Mirror refs, always up to date (also between batched renders), so the callbacks below can be stable
  const historyRef = useRef(historyState);
  const savedProjectRef = useRef(savedProject);
  const projectPathRef = useRef(projectPath);

  const setHistory = useCallback((update: (h: History<MixProject>) => History<MixProject>) => {
    const next = update(historyRef.current);
    if (next === historyRef.current) return;
    historyRef.current = next;
    setHistoryState(next);
  }, []);

  const setSavedProject = useCallback((project: MixProject) => {
    savedProjectRef.current = project;
    setSavedProjectState(project);
  }, []);

  const setProjectPath = useCallback((path: string | undefined) => {
    projectPathRef.current = path;
    setProjectPathState(path);
  }, []);

  const project = historyState.present;
  const dirty = project !== savedProject;
  const isDirty = useCallback(() => historyRef.current.present !== savedProjectRef.current, []);
  // Reads the ref, not the `project` snapshot above: up to date right after a same-tick update like `setSourceMeta`
  // (T35b), without waiting for the next render.
  const getProject = useCallback(() => historyRef.current.present, []);
  // Same for the path: right after opening a project, its sources are loaded before the next render (T42)
  const getProjectPath = useCallback(() => projectPathRef.current, []);

  const dispatch = useCallback((action: MixProjectAction, { transient }: EditOptions = {}) => {
    // T22: every removal (clip, source, overlay; also inside batches from the timeline sync) gets the overlay times
    // resolved before it, so the overlays anchored to what's removed become absolute at their current start (01-requisitos §9.2)
    // T56: blocks too (and the times grouping overlays into a block needs); sound durations by expanded overlay id
    const { present } = historyRef.current;
    const { action: prepared, detached, detachedBlocks } = prepareOverlayRemoval(present, action, getKnownSoundDurations(expandBlocks(present).all));
    setHistory((h) => history.applyEdit(h, (p) => mixProjectReducer(p, prepared), { transient }));
    const count = detached.length + detachedBlocks.length;
    if (count > 0) {
      getSwal().toast.fire({ icon: 'info', timer: 6000, title: i18n.t('{{count}} overlay(s) anchored to what was removed now start at a fixed time', { count }) });
    }
  }, [setHistory]);

  const commitTransient = useCallback(() => setHistory((h) => history.commitTransient(h)), [setHistory]);
  const cancelTransient = useCallback(() => setHistory((h) => history.cancelTransient(h)), [setHistory]);
  const undo = useCallback(() => setHistory((h) => history.undo(h)), [setHistory]);
  const redo = useCallback(() => setHistory((h) => history.redo(h)), [setHistory]);

  /** Adds media files as sources (files already in the project are skipped). Returns the new source ids. */
  const addSources = useCallback((filePaths: string[]) => {
    const existing = new Set(historyRef.current.present.sources.map((s) => s.absolutePath));
    const sources = [...new Set(filePaths)].filter((p) => !existing.has(p)).map((filePath) => createMixSource({ id: nanoid(), filePath, name: nodeDeps.path.basename(filePath) }));
    dispatch({ type: 'addSources', sources });
    return sources.map((s) => s.id);
  }, [dispatch]);

  // `resolved`: the current resolveOverlayTimes result, so overlays anchored to what is removed become absolute at their current time
  const removeSource = useCallback((sourceId: string, resolved?: ResolvedOverlayTimesForRemoval) => dispatch({ type: 'removeSource', sourceId, resolved }), [dispatch]);
  const relinkSource = useCallback((sourceId: string, source: MixSourceRelink) => dispatch({ type: 'relinkSource', sourceId, source }), [dispatch]);
  const addClip = useCallback((clip: MixClip, index?: number) => dispatch({ type: 'addClip', clip, index }), [dispatch]);
  const updateClip = useCallback((clipId: string, patch: MixClipPatch, options?: EditOptions) => dispatch({ type: 'updateClip', clipId, patch }, options), [dispatch]);
  const removeClip = useCallback((clipId: string, resolved?: ResolvedOverlayTimesForRemoval) => dispatch({ type: 'removeClip', clipId, resolved }), [dispatch]);
  const duplicateClip = useCallback((clipId: string, name?: string) => {
    const newId = nanoid();
    dispatch({ type: 'duplicateClip', clipId, newId, name });
    return newId;
  }, [dispatch]);
  const reorderClips = useCallback((ids: string[]) => dispatch({ type: 'reorderClips', ids }), [dispatch]);
  /**
   * When `patch.output` changes the aspect, image overlays don't keep their pixel size (only read once, at creation,
   * T22): reread it here for each image overlay so the reducer can refit their box to the new frame (T34, pending
   * from T29). Best-effort: an overlay whose file can't be read (e.g. missing) just keeps its box.
   */
  const updateSettings = useCallback(async (patch: Partial<MixSettings>, options?: EditOptions) => {
    const current = historyRef.current.present;
    const aspectChanged = patch.output != null && patch.output.aspect !== current.settings.output.aspect;
    let imageSizes: Map<string, Size> | undefined;
    let memberImageSizes: Map<string, Map<string, Size>> | undefined;
    if (aspectChanged) {
      const readImageSizes = async (overlays: readonly MixOverlay[]) => {
        const imageOverlays = overlays.filter((o): o is ImageOverlay => o.type === 'image');
        const sizes = await Promise.all(imageOverlays.map(async (overlay) => {
          try {
            const { streams } = await readFileFfprobeMeta(overlay.absolutePath);
            const stream = streams.find((s) => s.width != null && s.height != null);
            if (stream?.width != null && stream.height != null) return [overlay.id, { width: stream.width, height: stream.height }] as const;
          } catch (err) {
            console.warn('Could not read the image size', err);
          }
          return undefined;
        }));
        return new Map(sizes.filter((s): s is readonly [string, Size] => s != null));
      };
      imageSizes = await readImageSizes(current.overlays);
      // T57: the images inside blocks too
      memberImageSizes = new Map(await Promise.all(current.blockDefs.map(async (def) => [def.id, await readImageSizes(def.members)] as const)));
    }
    dispatch({ type: 'updateSettings', patch, ...(imageSizes != null && { imageSizes }), ...(memberImageSizes != null && { memberImageSizes }) }, options);
  }, [dispatch]);

  // Pinned and grouped clips (A4, T30)
  /** `undefined` unpins it. */
  const setClipPinTime = useCallback((clipId: string, pinTime: number | undefined, options?: EditOptions) => dispatch({ type: 'setClipPinTime', clipId, pinTime }, options), [dispatch]);
  /** Returns the new group id (nothing happens with fewer than 2 existing clips). */
  const groupClips = useCallback((clipIds: string[]) => {
    const groupId = nanoid();
    dispatch({ type: 'groupClips', clipIds, groupId });
    return groupId;
  }, [dispatch]);
  const ungroupClips = useCallback((clipIds: string[]) => dispatch({ type: 'ungroupClips', clipIds }), [dispatch]);

  // Clip links and always-visible sequence (E2, E5, T36)
  /** `undefined` clears the manual exception, back to the automatic rule. */
  const setClipLink = useCallback((clipId: string, link: MixClip['link'], options?: EditOptions) => dispatch({ type: 'setClipLink', clipId, link }, options), [dispatch]);
  const setAlwaysVisibleClips = useCallback((clipIds: string[]) => dispatch({ type: 'setAlwaysVisibleClips', clipIds }), [dispatch]);
  /** Appends the clip to the always-visible sequence (no-op if it's already there), at `index` or at the end. */
  const addToAlwaysVisible = useCallback((clipId: string, index?: number) => {
    const current = historyRef.current.present.settings.alwaysVisible.clipIds;
    if (current.includes(clipId)) return;
    const clipIds = [...current];
    clipIds.splice(index ?? clipIds.length, 0, clipId);
    dispatch({ type: 'setAlwaysVisibleClips', clipIds });
  }, [dispatch]);
  const removeFromAlwaysVisible = useCallback((clipId: string) => {
    const current = historyRef.current.present.settings.alwaysVisible.clipIds;
    if (!current.includes(clipId)) return;
    dispatch({ type: 'setAlwaysVisibleClips', clipIds: current.filter((id) => id !== clipId) });
  }, [dispatch]);

  // Music playlist (C2, T27)
  /** Adds audio files (absolute paths) as tracks, at `index` or at the end. Returns the new track ids. */
  const addMusicTracks = useCallback((filePaths: string[], index?: number) => {
    const tracks = filePaths.map((filePath) => createMusicTrack({ id: nanoid(), filePath }));
    dispatch({ type: 'addMusicTracks', tracks, index });
    return tracks.map((t) => t.id);
  }, [dispatch]);
  const updateMusicTrack = useCallback((trackId: string, patch: MixMusicTrackPatch, options?: EditOptions) => dispatch({ type: 'updateMusicTrack', trackId, patch }, options), [dispatch]);
  const removeMusicTrack = useCallback((trackId: string) => dispatch({ type: 'removeMusicTrack', trackId }), [dispatch]);
  const reorderMusicTracks = useCallback((ids: string[]) => dispatch({ type: 'reorderMusicTracks', ids }), [dispatch]);
  const updateMusicPlaylist = useCallback((patch: MixMusicPlaylistPatch, options?: EditOptions) => dispatch({ type: 'updateMusicPlaylist', patch }, options), [dispatch]);
  /** Points a track to a new file (e.g. a missing file located again), keeping its volume and place. */
  const relinkMusicTrack = useCallback((trackId: string, filePath: string) => dispatch({ type: 'updateMusicTrack', trackId, patch: { path: filePath, absolutePath: filePath } }), [dispatch]);

  /** `overlay` comes from a `create*Overlay` factory (overlays/factories.ts), with e.g. `nanoid()` as id. */
  const addOverlay = useCallback((overlay: MixOverlay, index?: number) => dispatch({ type: 'addOverlay', overlay, index }), [dispatch]);
  const updateOverlay = useCallback((overlayId: string, patch: MixOverlayPatch, options?: EditOptions) => dispatch({ type: 'updateOverlay', overlayId, patch }, options), [dispatch]);
  const removeOverlay = useCallback((overlayId: string, resolved?: ResolvedOverlayTimesForRemoval) => dispatch({ type: 'removeOverlay', overlayId, resolved }), [dispatch]);
  const duplicateOverlay = useCallback((overlayId: string, name?: string) => {
    const newId = nanoid();
    dispatch({ type: 'duplicateOverlay', overlayId, newId, name });
    return newId;
  }, [dispatch]);
  const moveOverlayLayer = useCallback((overlayId: string, to: OverlayLayerMove) => dispatch({ type: 'moveOverlayLayer', overlayId, to }), [dispatch]);
  /** Points an overlay's image/sound (`media`) or countdown font to a new file (e.g. a missing file located again). */
  const relinkOverlayFile = useCallback((overlayId: string, kind: OverlayFileKind, filePath: string) => {
    const file = { path: filePath, absolutePath: filePath };
    dispatch({ type: 'updateOverlay', overlayId, patch: kind === 'font' ? { font: file } : file });
  }, [dispatch]);

  // The project being written by a save in progress: a cache update that lands during the write must reach it too,
  // or the save would mark a stale project as saved and leave the project dirty (T47's background detection)
  const savingProjectRef = useRef<MixProject>(undefined);

  /** Derived-data update (caches): applied to every snapshot and to the saved project, without an undo step or dirty. */
  const applyCacheUpdate = useCallback((update: (p: MixProject) => MixProject) => {
    setHistory((h) => history.applyToAll(h, update));
    setSavedProject(update(savedProjectRef.current));
    if (savingProjectRef.current != null) savingProjectRef.current = update(savingProjectRef.current);
  }, [setHistory, setSavedProject]);

  /** Merge measurements into the cache. Not an undo step and doesn't make the project dirty (it's recomputable). */
  const setLoudnessCache = useCallback((entries: Record<string, LoudnessMeasurement>) => {
    const update = history.memoizeByRef((p: MixProject) => mixProjectReducer(p, { type: 'setLoudnessCache', loudnessCache: { ...p.loudnessCache, ...entries } }));
    applyCacheUpdate(update);
  }, [applyCacheUpdate]);

  /**
   * Refresh the informative cache of a source (size, duration), e.g. from the probe done when it's activated (T05).
   * Like the loudness cache: not an undo step and doesn't make the project dirty. Undefined values don't erase the cache.
   */
  const setSourceMeta = useCallback((sourceId: string, meta: Pick<MixSourceRelink, 'width' | 'height' | 'duration' | 'sar'>) => {
    const definedMeta = Object.fromEntries(Object.entries(meta).filter(([, value]) => value != null)) as typeof meta;
    const update = history.memoizeByRef((p: MixProject) => {
      const source = p.sources.find((s) => s.id === sourceId);
      if (source == null) return p;
      return mixProjectReducer(p, { type: 'relinkSource', sourceId, source: { path: source.path, absolutePath: source.absolutePath, ...definedMeta } });
    });
    applyCacheUpdate(update);
  }, [applyCacheUpdate]);

  /**
   * A7 (T44): cache (or clear, `undefined`) the black bars detection of a source. Like the loudness cache: not an undo
   * step and doesn't make the project dirty.
   */
  const setSourceBlackBars = useCallback((sourceId: string, blackBars: BlackBarsDetection | undefined) => {
    const update = history.memoizeByRef((p: MixProject) => mixProjectReducer(p, { type: 'setSourceBlackBars', sourceId, blackBars }));
    applyCacheUpdate(update);
  }, [applyCacheUpdate]);

  // Recovery autosave: one file per session, written while dirty, removed when clean.
  // Operations are chained so a slow write can't land after a later delete.
  const recoveryDir = useMemo(() => getRecoveryDir(nodeDeps, remote.app.getPath('userData')), []);
  const recoveryQueueRef = useRef<Promise<void>>(Promise.resolve());
  const recoveryWrittenRef = useRef(false);

  const enqueueRecovery = useCallback((operation: () => Promise<void>) => {
    recoveryQueueRef.current = recoveryQueueRef.current.then(operation).catch((err) => console.error('Recovery autosave failed', err));
    return recoveryQueueRef.current;
  }, []);

  const clearRecovery = useCallback(async () => {
    if (!recoveryWrittenRef.current) return;
    recoveryWrittenRef.current = false;
    await enqueueRecovery(() => deleteRecoveryFile(nodeDeps, { recoveryDir, sessionId }));
  }, [enqueueRecovery, recoveryDir, sessionId]);

  const [debouncedProject] = useDebounce(project, RECOVERY_DEBOUNCE_MS);

  useEffect(() => {
    // Wait until edits settle (also skips a stale debounced value right after open/new)
    if (debouncedProject !== project) return;
    if (debouncedProject === savedProject) {
      clearRecovery();
      return;
    }
    recoveryWrittenRef.current = true;
    enqueueRecovery(() => writeRecoveryFile(nodeDeps, { recoveryDir, sessionId, projectPath: projectPathRef.current, project: debouncedProject }));
  }, [clearRecovery, debouncedProject, enqueueRecovery, project, recoveryDir, savedProject, sessionId]);

  const resetProject = useCallback((newProject: MixProject, newProjectPath: string | undefined) => {
    setHistory(() => history.createHistory(newProject));
    setSavedProject(newProject);
    setProjectPath(newProjectPath);
  }, [setHistory, setSavedProject, setProjectPath]);

  const saveTo = useCallback(async (filePath: string) => {
    setHistory((h) => history.commitTransient(h));
    const toSave = historyRef.current.present;
    savingProjectRef.current = toSave;
    try {
      await saveMixProject(nodeDeps, filePath, toSave);
      setSavedProject(savingProjectRef.current);
    } finally {
      savingProjectRef.current = undefined;
    }
    setProjectPath(filePath);
    await clearRecovery();
  }, [clearRecovery, setHistory, setProjectPath, setSavedProject]);

  /** Returns false if canceled. */
  const userSaveProjectAs = useCallback(async () => {
    const firstSource = historyRef.current.present.sources[0];
    const defaultPath = projectPathRef.current
      ?? (firstSource != null ? nodeDeps.path.join(nodeDeps.path.dirname(firstSource.path), `project.${mixProjectExtension}`) : `project.${mixProjectExtension}`);
    const { canceled, filePath } = await remote.dialog.showSaveDialog({ defaultPath, title: i18n.t('Save project'), filters: vmxFilters() });
    if (canceled || !filePath) return false;
    // Some platforms' dialogs don't add the extension
    await saveTo(filePath.toLowerCase().endsWith(`.${mixProjectExtension}`) ? filePath : `${filePath}.${mixProjectExtension}`);
    return true;
  }, [saveTo]);

  /** Returns false if canceled. */
  const userSaveProject = useCallback(async () => {
    if (projectPathRef.current == null) return userSaveProjectAs();
    await saveTo(projectPathRef.current);
    return true;
  }, [saveTo, userSaveProjectAs]);

  /** Ask to save if dirty. Returns false if the user canceled (or canceled the save dialog). */
  const confirmDiscardChanges = useCallback(async () => {
    if (!isDirty()) return true;
    const response = await askForUnsavedChanges();
    if (response === 'cancel') return false;
    if (response === 'save') return userSaveProject();
    return true;
  }, [isDirty, userSaveProject]);

  /** Returns false if canceled. */
  const userNewProject = useCallback(async () => {
    if (!(await confirmDiscardChanges())) return false;
    await clearRecovery();
    resetProject(createEmptyMixProject(), undefined);
    return true;
  }, [clearRecovery, confirmDiscardChanges, resetProject]);

  /**
   * Opens `filePath`, or asks for a .vmx. Returns undefined if canceled, else the missing sources/music tracks/overlay
   * files, which the caller asks the user to locate (`relinkSource`, `relinkMusicTrack`, `relinkOverlayFile`).
   */
  const userOpenProject = useCallback(async (filePath?: string): Promise<LoadedMixProject | undefined> => {
    if (!(await confirmDiscardChanges())) return undefined;
    let path = filePath;
    if (path == null) {
      const { canceled, filePaths } = await showOpenDialog({ title: i18n.t('Open project'), properties: ['openFile'], filters: vmxFilters() });
      [path] = filePaths;
      if (canceled || path == null) return undefined;
    }
    const loaded = await loadMixProject(nodeDeps, path);
    await clearRecovery();
    resetProject(loaded.project, path);
    return loaded;
  }, [clearRecovery, confirmDiscardChanges, resetProject]);

  /** Recovery files of previous sessions, newest first (see RecoverableProject.newerThanProjectFile). */
  const getRecoverableProjects = useCallback(async () => findRecoverableProjects(nodeDeps, { recoveryDir, excludeSessionId: sessionId }), [recoveryDir, sessionId]);

  /** Loads a recovered project as unsaved changes on top of its .vmx. The recovery file is then taken over by this session. */
  const userRecoverProject = useCallback(async (recoverable: RecoverableProject): Promise<LoadedMixProject | undefined> => {
    if (!(await confirmDiscardChanges())) return undefined;
    const loaded = await resolveRecoveredProject(nodeDeps, recoverable);
    resetProject(loaded.project, recoverable.projectPath);
    // The recovered changes aren't in the .vmx: a sentinel "saved" project keeps it dirty until saved
    setSavedProject(createEmptyMixProject());
    // Write our own recovery file before removing the old one, so a crash now loses nothing
    recoveryWrittenRef.current = true;
    await enqueueRecovery(() => writeRecoveryFile(nodeDeps, { recoveryDir, sessionId, projectPath: recoverable.projectPath, project: loaded.project }));
    await deleteRecoveryFilePath(nodeDeps, recoverable.recoveryFilePath);
    return loaded;
  }, [confirmDiscardChanges, enqueueRecovery, recoveryDir, resetProject, sessionId, setSavedProject]);

  const discardRecoverableProject = useCallback(async (recoverable: RecoverableProject) => {
    await deleteRecoveryFilePath(nodeDeps, recoverable.recoveryFilePath);
  }, []);

  return {
    project,
    getProject,
    projectPath,
    getProjectPath,
    dirty,
    canUndo: history.canUndo(historyState),
    canRedo: history.canRedo(historyState),
    undo,
    redo,
    dispatch,
    commitTransient,
    cancelTransient,
    addSources,
    removeSource,
    relinkSource,
    addClip,
    updateClip,
    removeClip,
    duplicateClip,
    reorderClips,
    updateSettings,
    setClipPinTime,
    groupClips,
    ungroupClips,
    setClipLink,
    setAlwaysVisibleClips,
    addToAlwaysVisible,
    removeFromAlwaysVisible,
    addMusicTracks,
    updateMusicTrack,
    removeMusicTrack,
    reorderMusicTracks,
    updateMusicPlaylist,
    relinkMusicTrack,
    addOverlay,
    updateOverlay,
    removeOverlay,
    duplicateOverlay,
    moveOverlayLayer,
    relinkOverlayFile,
    setLoudnessCache,
    setSourceMeta,
    setSourceBlackBars,
    userNewProject,
    userOpenProject,
    userSaveProject,
    userSaveProjectAs,
    confirmDiscardChanges,
    getRecoverableProjects,
    userRecoverProject,
    discardRecoverableProject,
  };
}

export type UseMixProject = ReturnType<typeof useMixProject>;
