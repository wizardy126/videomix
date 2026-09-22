import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { nanoid } from 'nanoid';
import i18n from 'i18next';

import { showOpenDialog } from '../../dialogs';
import { createEmptyMixProject } from '../types';
import type { LoudnessMeasurement, MixClip, MixProject, MixSettings } from '../types';
import { createMixSource, mixProjectReducer } from '../projectReducer';
import type { MixClipPatch, MixProjectAction, MixSourceRelink } from '../projectReducer';
import * as history from '../projectHistory';
import type { History } from '../projectHistory';
import { loadMixProject, mixProjectExtension, saveMixProject } from '../projectFile';
import type { LoadedMixProject, NodeDeps } from '../projectFile';
import { deleteRecoveryFile, deleteRecoveryFilePath, findRecoverableProjects, getRecoveryDir, resolveRecoveredProject, writeRecoveryFile } from '../projectRecovery';
import type { RecoverableProject } from '../projectRecovery';
import { askForUnsavedChanges } from '../dialogs';

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
    setHistory((h) => history.applyEdit(h, (p) => mixProjectReducer(p, action), { transient }));
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

  const removeSource = useCallback((sourceId: string) => dispatch({ type: 'removeSource', sourceId }), [dispatch]);
  const relinkSource = useCallback((sourceId: string, source: MixSourceRelink) => dispatch({ type: 'relinkSource', sourceId, source }), [dispatch]);
  const addClip = useCallback((clip: MixClip, index?: number) => dispatch({ type: 'addClip', clip, index }), [dispatch]);
  const updateClip = useCallback((clipId: string, patch: MixClipPatch, options?: EditOptions) => dispatch({ type: 'updateClip', clipId, patch }, options), [dispatch]);
  const removeClip = useCallback((clipId: string) => dispatch({ type: 'removeClip', clipId }), [dispatch]);
  const duplicateClip = useCallback((clipId: string, name?: string) => {
    const newId = nanoid();
    dispatch({ type: 'duplicateClip', clipId, newId, name });
    return newId;
  }, [dispatch]);
  const reorderClips = useCallback((ids: string[]) => dispatch({ type: 'reorderClips', ids }), [dispatch]);
  const updateSettings = useCallback((patch: Partial<MixSettings>, options?: EditOptions) => dispatch({ type: 'updateSettings', patch }, options), [dispatch]);

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
   * Opens `filePath`, or asks for a .vmx. Returns undefined if canceled, else the missing sources/music,
   * which the caller asks the user to locate (`relinkSource`).
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
