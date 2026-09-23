import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import i18n from 'i18next';

import mainApi from '../../mainApi';
import getSwal, { errorToast } from '../../swal';
import { showOpenDialog } from '../../dialogs';
import type { ConfirmDialog } from '../../components/GenericDialog';
import type { SetWorking } from '../../hooks/useLoading';
import type { WithErrorHandling } from '../../hooks/useErrorHandling';
import type { FileFfprobeMeta } from '../../ffmpeg';
import type { UseMixProject } from './useMixProject';
import type { LoadedMixProject, MissingOverlayFile, OverlayFileKind } from '../projectFile';
import { getOverlayFiles } from '../projectFile';
import { askForRecoverProject } from '../dialogs';
import { classifyOpenedPaths, countClipsBySource, createMusic, getMixProjectTitle, getSourceMeta, isSourceMetaChanged } from '../workspace';

const { basename, dirname } = window.require('node:path');

/**
 * Glue between the VideoMix project (useMixProject) and the single-file LosslessCut player in App.tsx (T05):
 * the active source, adding/removing/relinking sources, the project menu flows and the recovery offer at startup.
 *
 * The active source is derived from the loaded `filePath` instead of being separate state, so it can never disagree
 * with what the player shows (e.g. if `loadMedia` bails out with a toast).
 */
export default function useMixWorkspace({ mixProject, filePath, ffprobeMeta, loadMedia, closeMedia, workingRef, setWorking, withErrorHandling, confirmDialog }: {
  mixProject: UseMixProject,
  filePath: string | undefined,
  ffprobeMeta: Pick<FileFfprobeMeta, 'streams' | 'format'> | undefined,
  loadMedia: (params: { filePath: string }) => Promise<void>,
  /** Unloads the current file and its timeline (the project is kept). */
  closeMedia: () => void,
  workingRef: RefObject<boolean>,
  setWorking: SetWorking,
  withErrorHandling: WithErrorHandling,
  confirmDialog: ConfirmDialog,
}) {
  const { project, addSources, removeSource, relinkSource, updateSettings, setSourceMeta, relinkOverlayFile } = mixProject;

  // Sources whose file wasn't found (when opening/recovering the project or activating the source)
  const [missingSourceIds, setMissingSourceIds] = useState<ReadonlySet<string>>(new Set());
  // Overlay files (image/sound/font) not found when opening/recovering the project, for T22 to offer "Locate..."
  const [missingOverlayFiles, setMissingOverlayFiles] = useState<readonly MissingOverlayFile[]>([]);
  // Settles when the recovery offer at startup is over (see the effect at the end)
  const recoveryDoneRef = useRef<Promise<void>>(Promise.resolve());

  const setSourceMissing = useCallback((sourceId: string, missing: boolean) => setMissingSourceIds((existing) => {
    if (existing.has(sourceId) === missing) return existing;
    const ret = new Set(existing);
    if (missing) ret.add(sourceId);
    else ret.delete(sourceId);
    return ret;
  }), []);

  const currentSource = useMemo(() => (filePath != null ? project.sources.find((s) => s.path === filePath) : undefined), [filePath, project.sources]);
  const currentSourceId = currentSource?.id;

  // T22: the list isn't pruned when an overlay is removed (T19), so only report the files of overlays that still exist
  const existingMissingOverlayFiles = useMemo(() => {
    const ids = new Set(project.overlays.map((o) => o.id));
    return missingOverlayFiles.filter((m) => ids.has(m.overlayId));
  }, [missingOverlayFiles, project.overlays]);

  const clipCountBySource = useMemo(() => countClipsBySource(project.clips), [project.clips]);

  // Keep the informative cache (size, duration) of the active source up to date with what loadMedia probed
  useEffect(() => {
    if (currentSource == null || ffprobeMeta == null) return;
    const meta = getSourceMeta(ffprobeMeta);
    if (isSourceMetaChanged(currentSource, meta)) setSourceMeta(currentSource.id, meta);
  }, [currentSource, ffprobeMeta, setSourceMeta]);

  // The file in the player is no longer a source (e.g. undo of "Add videos", or a relink): unload it, so the timeline
  // doesn't show a file whose clips can't be edited
  useEffect(() => {
    if (filePath != null && currentSource == null) closeMedia();
  }, [closeMedia, currentSource, filePath]);

  // loadMedia doesn't clear `working` itself (callers do, see batchOpenSingleFile in App.tsx)
  const loadSourceFile = useCallback(async (path: string) => {
    if (workingRef.current) return;
    try {
      setWorking({ text: i18n.t('Loading file') });
      await loadMedia({ filePath: path });
    } finally {
      setWorking(undefined);
    }
  }, [loadMedia, setWorking, workingRef]);

  /** Loads the source in the player/timeline (the project is kept). Returns false if its file is missing. */
  const activateSourceFile = useCallback(async (source: { id: string, path: string }) => {
    if (!(await mainApi.pathExists(source.path))) {
      setSourceMissing(source.id, true);
      return false;
    }
    setSourceMissing(source.id, false);
    await loadSourceFile(source.path);
    return true;
  }, [loadSourceFile, setSourceMissing]);

  const userActivateSource = useCallback(async (sourceId: string) => {
    const source = project.sources.find((s) => s.id === sourceId);
    if (source == null || source.path === filePath || workingRef.current) return;
    await withErrorHandling(async () => {
      if (!(await activateSourceFile(source))) errorToast(i18n.t('Source file not found: {{name}}', { name: source.name }));
    }, i18n.t('Failed to open file'));
  }, [activateSourceFile, filePath, project.sources, withErrorHandling, workingRef]);

  const userLocateSource = useCallback(async (sourceId: string) => {
    const source = project.sources.find((s) => s.id === sourceId);
    if (source == null) return;
    await withErrorHandling(async () => {
      const { canceled, filePaths } = await showOpenDialog({ properties: ['openFile'], defaultPath: dirname(source.absolutePath), title: i18n.t('Locate {{name}}', { name: source.name }) });
      const [newPath] = filePaths;
      if (canceled || newPath == null) return;
      if (project.sources.some((s) => s.id !== sourceId && s.absolutePath === newPath)) {
        errorToast(i18n.t('That file is already a source of the project'));
        return;
      }
      relinkSource(sourceId, { path: newPath, absolutePath: newPath, name: basename(newPath) });
      await activateSourceFile({ id: sourceId, path: newPath });
    }, i18n.t('Failed to open file'));
  }, [activateSourceFile, project.sources, relinkSource, withErrorHandling]);

  /** Clears a pending "file not found" warning for one overlay file, e.g. once it's relinked ("Locate...", "Replace…"). */
  const clearMissingOverlayFile = useCallback((overlayId: string, kind: OverlayFileKind) => {
    setMissingOverlayFiles((existing) => existing.filter((m) => m.overlayId !== overlayId || m.kind !== kind));
  }, []);

  const userLocateOverlayFile = useCallback(async (overlayId: string, kind: OverlayFileKind) => {
    const overlay = project.overlays.find((o) => o.id === overlayId);
    const file = overlay != null ? getOverlayFiles(overlay).find((f) => f.kind === kind)?.file : undefined;
    if (file == null) return;
    await withErrorHandling(async () => {
      const { canceled, filePaths } = await showOpenDialog({ properties: ['openFile'], defaultPath: dirname(file.absolutePath), title: i18n.t('Locate {{name}}', { name: basename(file.absolutePath) }) });
      const [newPath] = filePaths;
      if (canceled || newPath == null) return;
      relinkOverlayFile(overlayId, kind, newPath);
      clearMissingOverlayFile(overlayId, kind);
    }, i18n.t('Failed to open file'));
  }, [clearMissingOverlayFile, project.overlays, relinkOverlayFile, withErrorHandling]);

  const userRemoveSource = useCallback(async (sourceId: string) => {
    const source = project.sources.find((s) => s.id === sourceId);
    if (source == null || workingRef.current) return;
    const numClips = clipCountBySource.get(sourceId) ?? 0;
    if (numClips > 0 && !(await confirmDialog({
      description: i18n.t('The source "{{name}}" has {{numClips}} clip(s). They will be removed from the project too.', { name: source.name, numClips }),
      confirmButtonText: i18n.t('Remove'),
    }))) return;
    if (sourceId === currentSourceId) closeMedia();
    removeSource(sourceId);
    setSourceMissing(sourceId, false);
  }, [clipCountBySource, closeMedia, confirmDialog, currentSourceId, project.sources, removeSource, setSourceMissing, workingRef]);

  const askToUseAsMusic = useCallback(async (musicPath: string) => {
    const { music } = project.settings;
    const name = basename(musicPath);
    const confirmed = await confirmDialog({
      title: i18n.t('Project music'),
      description: music != null
        ? i18n.t('Replace the project music with "{{name}}"?', { name })
        : i18n.t('Use "{{name}}" as the project music? It will be mixed with the audio of the clips.', { name }),
      confirmButtonText: i18n.t('Use as music'),
      focusConfirm: true,
    });
    if (confirmed) updateSettings({ music: createMusic(musicPath, music) });
  }, [confirmDialog, project.settings, updateSettings]);

  const askToLocateMusic = useCallback(async (loaded: LoadedMixProject) => {
    const { music } = loaded.project.settings;
    if (!loaded.missingMusic || music == null) return;
    if (!(await confirmDialog({
      title: i18n.t('Project music'),
      description: i18n.t('The music file of the project was not found: {{path}}. Do you want to locate it?', { path: music.absolutePath }),
      confirmButtonText: i18n.t('Locate...'),
    }))) return;
    const { canceled, filePaths } = await showOpenDialog({ properties: ['openFile'], defaultPath: dirname(music.absolutePath), title: i18n.t('Project music') });
    const [newPath] = filePaths;
    if (canceled || newPath == null) return;
    updateSettings({ music: createMusic(newPath, music) });
  }, [confirmDialog, updateSettings]);

  // After new/open/recover: the old file isn't part of the new project, so unload it, then show the first source found
  const handleProjectReplaced = useCallback(async (loaded: LoadedMixProject | undefined) => {
    closeMedia();
    const missing = new Set(loaded?.missingSourceIds);
    setMissingSourceIds(missing);
    setMissingOverlayFiles(loaded?.missingOverlayFiles ?? []);
    if (loaded == null) return;
    if (missing.size > 0) {
      getSwal().toast.fire({ icon: 'warning', timer: 10000, title: i18n.t('{{numMissing}} source file(s) not found. Use "Locate..." in the sources list.', { numMissing: missing.size }) });
    }
    // (one toast at a time: the missing sources matter more)
    if (missing.size === 0 && loaded.missingOverlayFiles.length > 0) {
      getSwal().toast.fire({ icon: 'warning', timer: 10000, title: i18n.t('{{numMissing}} overlay file(s) not found. Select the overlay in the Mix view and use "Locate...".', { numMissing: loaded.missingOverlayFiles.length }) });
    }
    await askToLocateMusic(loaded);
    const firstFound = loaded.project.sources.find((s) => !missing.has(s.id));
    if (firstFound != null) await activateSourceFile(firstFound);
  }, [activateSourceFile, askToLocateMusic, closeMedia]);

  const userNewProject = useCallback(async () => {
    await withErrorHandling(async () => {
      if (await mixProject.userNewProject()) await handleProjectReplaced(undefined);
    }, i18n.t('Failed to create project'));
  }, [handleProjectReplaced, mixProject, withErrorHandling]);

  const openProject = useCallback(async (projectFilePath?: string) => {
    const loaded = await mixProject.userOpenProject(projectFilePath);
    if (loaded != null) await handleProjectReplaced(loaded);
  }, [handleProjectReplaced, mixProject]);

  const userOpenProject = useCallback(async () => {
    await withErrorHandling(async () => openProject(), i18n.t('Failed to open project'));
  }, [openProject, withErrorHandling]);

  const userSaveProject = useCallback(async ({ saveAs = false }: { saveAs?: boolean } = {}) => {
    await withErrorHandling(async () => {
      const saved = saveAs ? await mixProject.userSaveProjectAs() : await mixProject.userSaveProject();
      if (saved) getSwal().toast.fire({ icon: 'success', title: i18n.t('Project saved') });
    }, i18n.t('Failed to save project'));
  }, [mixProject, withErrorHandling]);

  /**
   * VideoMix replacement for LosslessCut's "open file" flow: a .vmx opens the project, videos become sources
   * (without asking for the open action) and an audio file is offered as the project music.
   * Throws (the caller wraps it in withErrorHandling).
   */
  const openFiles = useCallback(async (filePaths: string[]) => {
    // Files opened at startup (command line, file association) wait for the recovery offer, so the dialogs don't overlap
    await recoveryDoneRef.current;

    const { projectPaths, audioPaths, mediaPaths, unsupportedPaths } = classifyOpenedPaths(filePaths);

    const [projectFilePath] = projectPaths;
    if (projectFilePath != null) {
      if (filePaths.length > 1) console.warn('Opening a project, ignoring the other files', filePaths);
      await openProject(projectFilePath);
      return;
    }

    if (unsupportedPaths.length > 0) {
      errorToast(i18n.t('These files cannot be used as sources: {{files}}', { files: unsupportedPaths.map((p) => basename(p)).join(', ') }));
    }

    const existingPaths = new Set(project.sources.map((s) => s.absolutePath));
    const newPaths = [...new Set(mediaPaths)].filter((p) => !existingPaths.has(p));
    if (newPaths.length > 0) addSources(newPaths);

    const [firstAudioPath] = audioPaths;
    if (firstAudioPath != null) await askToUseAsMusic(firstAudioPath);

    // Show the first new video (switching sources loses nothing, the clips are in the project).
    // Opening a single file that is already a source switches to it, like clicking it in the list.
    const [firstNewPath] = newPaths;
    const [singleMediaPath] = mediaPaths;
    if (firstNewPath != null) {
      await loadSourceFile(firstNewPath);
    } else if (newPaths.length === 0 && mediaPaths.length === 1 && singleMediaPath != null && singleMediaPath !== filePath) {
      const existing = project.sources.find((s) => s.absolutePath === singleMediaPath);
      if (existing != null) await activateSourceFile(existing);
    }
  }, [activateSourceFile, addSources, askToUseAsMusic, filePath, loadSourceFile, openProject, project.sources]);

  const userAddSourcesDialog = useCallback(async () => {
    await withErrorHandling(async () => {
      const { canceled, filePaths } = await showOpenDialog({ properties: ['openFile', 'multiSelections'], title: i18n.t('Add videos') });
      if (canceled || filePaths.length === 0) return;
      await openFiles(filePaths);
    }, i18n.t('Failed to open file'));
  }, [openFiles, withErrorHandling]);

  // Offer to restore the recovery files left by previous sessions, once at startup.
  // The ref (not state) also guards against React StrictMode's double effect in dev.
  const recoveryCheckedRef = useRef(false);
  useEffect(() => {
    if (recoveryCheckedRef.current) return;
    recoveryCheckedRef.current = true;

    recoveryDoneRef.current = (async () => {
      await withErrorHandling(async () => {
        const recoverables = await mixProject.getRecoverableProjects();
        // The .vmx was saved after these, so there's nothing to recover: purge them so they don't pile up
        await Promise.all(recoverables.filter((r) => !r.newerThanProjectFile).map(async (r) => mixProject.discardRecoverableProject(r)));

        for (const recoverable of recoverables.filter((r) => r.newerThanProjectFile)) {
          // eslint-disable-next-line no-await-in-loop
          const response = await askForRecoverProject({
            projectName: getMixProjectTitle({ projectPath: recoverable.projectPath, dirty: false, untitledName: i18n.t('Untitled project') }),
            savedAt: recoverable.savedAt,
            numSources: recoverable.project.sources.length,
            numClips: recoverable.project.clips.length,
          });
          if (response === 'restore') {
            // eslint-disable-next-line no-await-in-loop
            const loaded = await mixProject.userRecoverProject(recoverable);
            // eslint-disable-next-line no-await-in-loop
            if (loaded != null) await handleProjectReplaced(loaded);
            // Any other recovery files are offered again at the next start
            break;
          }
          if (response === 'later') break;
          // eslint-disable-next-line no-await-in-loop
          await mixProject.discardRecoverableProject(recoverable);
        }
      }, i18n.t('Failed to restore project'));
    })();
  }, [handleProjectReplaced, mixProject, withErrorHandling]);

  return {
    currentSourceId,
    missingSourceIds,
    missingOverlayFiles: existingMissingOverlayFiles,
    clipCountBySource,
    openFiles,
    userActivateSource,
    userLocateSource,
    userLocateOverlayFile,
    clearMissingOverlayFile,
    userRemoveSource,
    userAddSourcesDialog,
    userNewProject,
    userOpenProject,
    userSaveProject,
  };
}

export type UseMixWorkspace = ReturnType<typeof useMixWorkspace>;
