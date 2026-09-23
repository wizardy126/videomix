import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { nanoid } from 'nanoid';
import i18n from 'i18next';

import { showOpenDialog } from '../../dialogs';
import { createEmptyMixProject } from '../types';
import type { LoudnessMeasurement, MixClip, MixOverlay, MixProject, MixSettings } from '../types';
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

  const dispatch = useCallback((action: MixProjectAction, { transient }: EditOptions = {}) => {
    // T22: every removal (clip, source, overlay; also inside batches from the timeline sync) gets the overlay times
    // resolved before it, so the overlays anchored to what's removed become absolute at their current start (01-requisitos §9.2)
    const { action: prepared, detached } = prepareOverlayRemoval(historyRef.current.present, action, getKnownSoundDurations(historyRef.current.present.overlays));
    setHistory((h) => history.applyEdit(h, (p) => mixProjectReducer(p, prepared), { transient }));
    if (detached.length > 0) {
      getSwal().toast.fire({ icon: 'info', timer: 6000, title: i18n.t('{{count}} overlay(s) anchored to what was removed now start at a fixed time', { count: detached.length }) });
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
  const updateSettings = useCallback((patch: Partial<MixSettings>, options?: EditOptions) => dispatch({ type: 'updateSettings', patch }, options), [dispatch]);

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

  /** Merge measurements into the cache. Not an undo step and doesn't make the project dirty (it's recomputable). */
  const setLoudnessCache = useCallback((entries: Record<string, LoudnessMeasurement>) => {
    const update = history.memoizeByRef((p: MixProject) => mixProjectReducer(p, { type: 'setLoudnessCache', loudnessCache: { ...p.loudnessCache, ...entries } }));
    setHistory((h) => history.applyToAll(h, update));
    setSavedProject(update(savedProjectRef.current));
  }, [setHistory, setSavedProject]);

  /**
   * Refresh the informative cache of a source (size, duration), e.g. from the probe done when it's activated (T05).
   * Like the loudness cache: not an undo step and doesn't make the project dirty. Undefined values don't erase the cache.
   */
  const setSourceMeta = useCallback((sourceId: string, meta: Pick<MixSourceRelink, 'width' | 'height' | 'duration'>) => {
    const definedMeta = Object.fromEntries(Object.entries(meta).filter(([, value]) => value != null)) as typeof meta;
    const update = history.memoizeByRef((p: MixProject) => {
      const source = p.sources.find((s) => s.id === sourceId);
      if (source == null) return p;
      return mixProjectReducer(p, { type: 'relinkSource', sourceId, source: { path: source.path, absolutePath: source.absolutePath, ...definedMeta } });
    });
    setHistory((h) => history.applyToAll(h, update));
    setSavedProject(update(savedProjectRef.current));
  }, [setHistory, setSavedProject]);

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
    await saveMixProject(nodeDeps, filePath, toSave);
    setSavedProject(toSave);
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
    projectPath,
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
