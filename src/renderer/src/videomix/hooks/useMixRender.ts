import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import i18n from 'i18next';
import { nanoid } from 'nanoid';

import mainApi from '../../mainApi';
import { UserFacingError } from '../../../errors';
import { abortFfmpegs, runFfmpegWithProgress } from '../../ffmpeg';
import type { SetWorking } from '../../hooks/useLoading';
import type { WithErrorHandling } from '../../hooks/useErrorHandling';
import type { ShowGenericDialog } from '../../components/GenericDialog';
import type { UseMixProject } from './useMixProject';
import { validateMixProject } from '../project';
import { ensureLoudness } from '../loudness';
import { buildRenderJob, getChunkConcurrency } from '../render/buildRenderJob';
import { buildAudioGraph } from '../render/buildAudioGraph';
import { getDefaultOutputPath, getOrphanTempEntries, getPartialOutputPath, getPreviewOutputPath, getRenderWarnings, getRenderWorkDir, planRender, withOutputExtension } from '../render/renderOutput';
import { runRenderJob } from '../render/runRenderJob';
import type { RenderRunnerDeps } from '../render/runRenderJob';
import { askForRenderWarnings, getIssueText, getRenderWarningText, showRenderProblems } from '../renderDialogs';
import { showMixPreviewDialog } from '../components/MixPreviewDialog';

const path = window.require('node:path');
const fs = window.require('node:fs/promises');
const remote = window.require('@electron/remote');

const rmQuiet = async (filePath: string) => {
  try {
    await fs.rm(filePath, { recursive: true, force: true });
  } catch (err) {
    console.warn('Failed to remove', filePath, err);
  }
};

const runnerDeps: RenderRunnerDeps = {
  mkdir: async (dir) => { await fs.mkdir(dir, { recursive: true }); },
  writeFile: async (filePath, content) => fs.writeFile(filePath, content),
  rm: async (filePath) => fs.rm(filePath, { recursive: true, force: true }),
  rename: async (from, to) => fs.rename(from, to),
  // Main reports progress as time / duration of the step; runRenderJob turns it into frames (ADR-001)
  runFfmpeg: async ({ args, duration, onProgress }) => { await runFfmpegWithProgress({ ffmpegArgs: args, duration, onProgress }); },
  // There's no per-process kill through remote: this kills every running ffmpeg, like the Working dialog's abort
  abortAll: () => abortFfmpegs(),
};

/** Remove the temp dirs/files of renders and previews that were never cleaned up (app closed or crashed meanwhile). */
async function removeOrphanTempEntries() {
  try {
    const tmpDir: string = remote.app.getPath('temp');
    const names: string[] = (await fs.readdir(tmpDir)).filter((name: string) => name.startsWith('videomix-'));
    const entries = (await Promise.all(names.map(async (name) => {
      try {
        const stats = await fs.lstat(path.join(tmpDir, name));
        // never follow links
        return stats.isFile() || stats.isDirectory() ? { name, mtimeMs: stats.mtimeMs } : undefined;
      } catch {
        return undefined;
      }
    }))).filter((entry) => entry != null);
    const orphans = getOrphanTempEntries(entries, Date.now());
    if (orphans.length > 0) console.log('Removing orphan temp files', orphans);
    await Promise.all(orphans.map(async (name) => rmQuiet(path.join(tmpDir, name))));
  } catch (err) {
    console.warn('Failed to clean up orphan temp files', err);
  }
}

/**
 * Render and preview of the mix (T13, 04-diseno §6.6): project → validation → plan (+ warnings to confirm) →
 * loudness analysis (cached in the project) → chunked render (runRenderJob) → finished dialog / preview dialog.
 * Both are cancellable from the Working dialog; temp files are always removed.
 */
export default function useMixRender({ mixProject, workingRef, setWorking, setProgress, withErrorHandling, showGenericDialog, openExportFinishedDialog, appendFfmpegCommandLog }: {
  mixProject: UseMixProject,
  workingRef: RefObject<boolean>,
  setWorking: SetWorking,
  setProgress: (progress: number | undefined) => void,
  withErrorHandling: WithErrorHandling,
  showGenericDialog: ShowGenericDialog,
  openExportFinishedDialog: (params: { filePath: string, children: string }) => Promise<void>,
  appendFfmpegCommandLog: (args: string[]) => void,
}) {
  const { project, projectPath, setLoudnessCache } = mixProject;

  // Session memory for the save dialog, and the current preview file (removed when its dialog closes or a new
  // preview starts)
  const lastOutputPathRef = useRef<string>(undefined);
  const previewPathRef = useRef<string>(undefined);

  const removePreview = useCallback(async () => {
    const previewPath = previewPathRef.current;
    if (previewPath == null) return;
    previewPathRef.current = undefined;
    await rmQuiet(previewPath);
  }, []);

  useEffect(() => () => { removePreview(); }, [removePreview]);

  // Once at startup (T16). Only old entries, so it can't touch a render running in another instance
  useEffect(() => { removeOrphanTempEntries(); }, []);

  /** Validation, missing files and plan warnings. Returns the plan, or undefined if the user can't or won't go on. */
  const prepare = useCallback(async ({ preview }: { preview: boolean }) => {
    if (project.clips.length === 0) throw new UserFacingError(i18n.t('The project has no clips yet. Add clips before rendering.'));

    const clipNameById = new Map(project.clips.map((clip) => [clip.id, clip.name]));
    const issues = validateMixProject(project);
    const errors = issues.filter((issue) => issue.level === 'error');

    // Only the sources that are used (a source without clips doesn't matter) and the music
    const usedSourceIds = new Set(project.clips.map((clip) => clip.sourceId));
    const filesToCheck = [
      ...project.sources.filter((source) => usedSourceIds.has(source.id)).map((source) => ({ name: source.name, filePath: source.absolutePath })),
      ...(project.settings.music != null ? [{ name: path.basename(project.settings.music.absolutePath), filePath: project.settings.music.absolutePath }] : []),
    ];
    const missing = (await Promise.all(filesToCheck.map(async (file) => ((await mainApi.pathExists(file.filePath)) ? undefined : file)))).filter((file) => file != null);

    if (errors.length > 0 || missing.length > 0) {
      await showRenderProblems({
        title: i18n.t('The mix can\'t be rendered'),
        lines: [
          ...missing.map((file) => i18n.t('File not found: {{path}}', { path: file.filePath })),
          ...errors.map((issue) => getIssueText(issue, issue.clipId != null ? clipNameById.get(issue.clipId) : undefined)),
        ],
      });
      return undefined;
    }

    const renderPlan = planRender(project, { preview });
    const warningLines = [
      ...issues.filter((issue) => issue.level === 'warning').map((issue) => getIssueText(issue, issue.clipId != null ? clipNameById.get(issue.clipId) : undefined)),
      ...getRenderWarnings(renderPlan.plan, project.clips).map((warning) => getRenderWarningText(warning)),
    ];
    if (warningLines.length > 0 && !(await askForRenderWarnings({ lines: warningLines, preview }))) return undefined;
    return renderPlan;
  }, [project]);

  /** Loudness analysis + render into `outPath`. Throws RenderAbortedError (no error dialog) when cancelled. */
  const render = useCallback(async ({ renderPlan, outPath, partialPath, workDir, preview }: {
    renderPlan: NonNullable<Awaited<ReturnType<typeof prepare>>>,
    outPath: string,
    partialPath: string,
    workDir: string,
    preview: boolean,
  }) => {
    const abortController = new AbortController();
    try {
      setWorking({ text: i18n.t('Analyzing audio loudness'), abortController });
      setProgress(0);
      // Measures only what isn't cached yet; the new measurements are stored in the project (also when cancelled)
      const loudness = await ensureLoudness({ project, music: project.settings.music, onProgress: setProgress, abortSignal: abortController.signal, onCacheEntries: setLoudnessCache });

      setWorking({ text: preview ? i18n.t('Rendering preview') : i18n.t('Rendering mix'), abortController });
      setProgress(0);
      const { plan, settings, encoding } = renderPlan;
      const job = buildRenderJob({
        plan,
        clips: project.clips,
        sourcePaths: Object.fromEntries(project.sources.map((source) => [source.id, source.absolutePath])),
        settings,
        encoding,
        workDir,
        outPath: partialPath,
        // RenderClip has no muted/gainDb: close over the full clips (T12)
        buildAudioGraph: (input) => buildAudioGraph({ ...input, clips: project.clips, loudness }),
        join: path.join,
      });
      await runRenderJob({
        job,
        workDir,
        outPath,
        concurrency: getChunkConcurrency({ height: plan.height, cpuCount: navigator.hardwareConcurrency }),
        deps: runnerDeps,
        onProgress: setProgress,
        onCommand: appendFfmpegCommandLog,
        abortSignal: abortController.signal,
      });
    } finally {
      setWorking(undefined);
      setProgress(undefined);
    }
  }, [appendFfmpegCommandLog, project, setLoudnessCache, setProgress, setWorking]);

  const userRenderMix = useCallback(async () => {
    if (workingRef.current) return;
    await withErrorHandling(async () => {
      const renderPlan = await prepare({ preview: false });
      if (renderPlan == null) return;

      const defaultPath = getDefaultOutputPath({
        path,
        projectPath,
        firstSourcePath: project.sources[0]?.absolutePath,
        lastOutputPath: lastOutputPathRef.current,
        fallbackDir: remote.app.getPath('videos'),
        untitledName: i18n.t('Untitled project'),
      });
      const { canceled, filePath } = await remote.dialog.showSaveDialog({
        defaultPath,
        title: i18n.t('Render mix'),
        filters: [{ name: i18n.t('MP4 video'), extensions: ['mp4'] }],
        // Linux only (macOS and Windows always ask): confirm replacing an existing file
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      });
      if (canceled || !filePath) return;
      const outPath = withOutputExtension(filePath);
      lastOutputPathRef.current = outPath;

      // LosslessCut's "overwrite output" setting is ignored (T16): the save dialog already asked to replace the file, and
      // the render only replaces it once it has finished (partial name + rename)

      const id = nanoid(8);
      await render({
        renderPlan,
        outPath,
        partialPath: getPartialOutputPath(path, outPath, id),
        workDir: getRenderWorkDir(path, remote.app.getPath('temp'), 'render', id),
        preview: false,
      });

      await openExportFinishedDialog({ filePath: outPath, children: i18n.t('The mix has been rendered to: {{path}}', { path: outPath }) });
    }, i18n.t('Failed to render the mix'));
  }, [openExportFinishedDialog, prepare, project.sources, projectPath, render, withErrorHandling, workingRef]);

  const userPreviewMix = useCallback(async () => {
    if (workingRef.current) return;
    await withErrorHandling(async () => {
      const renderPlan = await prepare({ preview: true });
      if (renderPlan == null) return;

      await removePreview();
      const id = nanoid(8);
      const outPath = getPreviewOutputPath(path, remote.app.getPath('temp'), id);
      previewPathRef.current = outPath;
      try {
        // A temp file anyway: no partial name needed, runRenderJob removes it if the render doesn't finish
        await render({ renderPlan, outPath, partialPath: outPath, workDir: getRenderWorkDir(path, remote.app.getPath('temp'), 'preview', id), preview: true });
      } catch (err) {
        previewPathRef.current = undefined;
        throw err;
      }

      showMixPreviewDialog(showGenericDialog, {
        filePath: outPath,
        // On Windows the <video> may still hold the file for a moment after the dialog closes. If removing it still
        // fails, it's only logged: the file is in the OS temp dir
        onClose: () => {
          if (previewPathRef.current !== outPath) return;
          setTimeout(() => { removePreview(); }, 500);
        },
      });
    }, i18n.t('Failed to preview the mix'));
  }, [prepare, removePreview, render, showGenericDialog, withErrorHandling, workingRef]);

  return {
    userRenderMix,
    userPreviewMix,
  };
}

export type UseMixRender = ReturnType<typeof useMixRender>;
