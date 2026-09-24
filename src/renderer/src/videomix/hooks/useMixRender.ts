import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import i18n from 'i18next';
import { nanoid } from 'nanoid';
import invariant from 'tiny-invariant';

import mainApi from '../../mainApi';
import { UserFacingError } from '../../../errors';
import { abortFfmpegs, getDefaultOverlayFontPath, getDuration, readFileFfprobeMeta, runFfmpegWithProgress } from '../../ffmpeg';
import getSwal from '../../swal';
import type { SetWorking, WorkingState } from '../../hooks/useLoading';
import type { WithErrorHandling } from '../../hooks/useErrorHandling';
import type { ShowGenericDialog } from '../../components/GenericDialog';
import type { UseMixProject } from './useMixProject';
import { validateMixProject } from '../project';
import type { MixProjectIssue } from '../project';
import { getOverlayFiles } from '../projectFile';
import { getUsedSources, refreshSourcesMeta } from '../workspace';
import { ensureLoudness, getSoundDurations } from '../loudness';
import type { LoudnessMeasurement } from '../types';
import { resolveOverlayTimes } from '../overlays/resolveOverlayTimes';
import { getOverlayTimeWarningText } from '../overlayTexts';
import { getKnownSoundDurations } from './useOverlaySoundDurations';
import { buildRenderJob, getChunkConcurrency } from '../render/buildRenderJob';
import type { ResolvedEncoder } from '../render/buildRenderJob';
import { buildAudioGraph } from '../render/buildAudioGraph';
import { getDefaultOutputPath, getOrphanTempEntries, getOverlayTimesPlan, getPartialOutputPath, getPreviewOutputPath, getRenderWarnings, getRenderWorkDir, planRender, withOutputExtension } from '../render/renderOutput';
import { RenderAbortedError, runRenderJob } from '../render/runRenderJob';
import type { RenderRunnerDeps } from '../render/runRenderJob';
import type { MixRenderPhase, MixRenderStatus } from '../render/renderStatus';
import type { CacheDirEntry, RenderCacheFsDeps } from '../render/renderCache';
import { DEFAULT_RENDER_CACHE_MAX_BYTES, applyRenderCache, clearRenderCache, getFileIdentity, getProjectCacheRoot, getRenderCacheDir, getRenderCacheFileNames, getRenderCacheKeys, getStaleUnsavedCaches, getUnsavedCacheParent, pruneRenderCache } from '../render/renderCache';
import { PREVIEW_CONVERSION_DIR_NAME } from '../previewConversion';
import { askForRenderWarnings, getIssueText, getRenderWarningText, showHardwareEncoderFallbackWarning, showRenderProblems } from '../renderDialogs';
import { showMixPreviewDialog } from '../components/MixPreviewDialog';
import { detectEncoders } from '../encoders';
import { resolveEncoderHardware } from '../../../../common/videomix/encoder';

const path = window.require('node:path');
const fs = window.require('node:fs/promises');
const remote = window.require('@electron/remote');
const { configStore } = remote.require('./index.js');

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
  // T28: a cache file is reused if it isn't empty and ffprobe (header only, fast) gives the expected duration
  verifyCached: async (filePath, { duration, tolerance }) => {
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile() || stats.size === 0) return false;
    } catch {
      return false;
    }
    const probed = await getDuration(filePath);
    if (probed == null || Math.abs(probed - duration) > tolerance) {
      console.warn('Invalid render cache file, rendering it again', filePath, probed, duration);
      return false;
    }
    // least recently used goes first when the cache is over its size limit
    const now = new Date();
    await fs.utimes(filePath, now, now);
    return true;
  },
};

const cacheFsDeps: RenderCacheFsDeps = {
  list: async (dir) => {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const entries = await Promise.all(names.map(async (name): Promise<CacheDirEntry | undefined> => {
      try {
        const stats = await fs.lstat(path.join(dir, name));
        return { name, size: stats.size, mtimeMs: stats.mtimeMs, isDirectory: stats.isDirectory() };
      } catch {
        return undefined;
      }
    }));
    return entries.filter((entry) => entry != null);
  },
  rm: async (filePath) => fs.rm(filePath, { recursive: true, force: true }),
};

function getRenderCacheMaxBytes() {
  try {
    const value: unknown = configStore.get('renderCacheMaxBytes');
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : DEFAULT_RENDER_CACHE_MAX_BYTES;
  } catch (err) {
    console.warn('Failed to read renderCacheMaxBytes', err);
    return DEFAULT_RENDER_CACHE_MAX_BYTES;
  }
}

/** Identity (size + mtime) of each file the render reads, for the cache keys. */
async function getFileIdentities(filePaths: string[]) {
  const entries = await Promise.all([...new Set(filePaths)].map(async (filePath) => {
    try {
      return [filePath, getFileIdentity(await fs.stat(filePath))] as const;
    } catch {
      return [filePath, 'missing'] as const;
    }
  }));
  return Object.fromEntries(entries);
}

/** Caches of unsaved projects of earlier sessions (userData/videomix-cache/<id>) that weren't used for a week. */
async function removeStaleUnsavedCaches() {
  try {
    const parent = getUnsavedCacheParent(path, remote.app.getPath('userData'));
    const stale = getStaleUnsavedCaches(await cacheFsDeps.list(parent), Date.now());
    if (stale.length > 0) console.log('Removing stale render caches', stale);
    await Promise.all(stale.map(async (name) => rmQuiet(path.join(parent, name))));
  } catch (err) {
    console.warn('Failed to clean up stale render caches', err);
  }
}

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
 * Both show their progress in RenderProgressDialog (T41), which can cancel them; temp files are always removed.
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
  const { project, getProject, projectPath, setLoudnessCache, setSourceMeta } = mixProject;

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
  useEffect(() => {
    removeOrphanTempEntries();
    removeStaleUnsavedCaches();
  }, []);

  // Render cache (T28, D1): next to the project, or per session in userData while it's unsaved
  const unsavedCacheIdRef = useRef(nanoid(8));
  const getCacheRoot = useCallback(() => (projectPath != null
    ? getProjectCacheRoot(path, projectPath)
    : path.join(getUnsavedCacheParent(path, remote.app.getPath('userData')), unsavedCacheIdRef.current)), [projectPath]);

  /** Validation, missing files and plan warnings. Returns the plan, or undefined if the user can't or won't go on. */
  const prepare = useCallback(async ({ preview }: { preview: boolean }) => {
    if (project.clips.length === 0) throw new UserFacingError(i18n.t('The project has no clips yet. Add clips before rendering.'));

    // T35b/T39 point 5: refresh with ffprobe the meta (display size + SAR) of the sources actually used, so an old
    // project whose anamorphic source wasn't reactivated this session doesn't fail validation with
    // `max-rect-outside-frame`. `setSourceMeta` is a cache update only (no undo step, no dirty) and applies T35's
    // no-rescale rule; `getProject` reads it back right away, without waiting for the next render.
    await refreshSourcesMeta(getUsedSources(project.sources, project.clips), { pathExists: mainApi.pathExists, probe: readFileFfprobeMeta }, (source, meta) => setSourceMeta(source.id, meta));
    const currentProject = getProject();

    const clipNameById = new Map(currentProject.clips.map((clip) => [clip.id, clip.name]));
    const overlayNameById = new Map(currentProject.overlays.map((overlay) => [overlay.id, overlay.name]));
    const issueText = (issue: MixProjectIssue) => getIssueText(
      issue,
      issue.clipId != null ? clipNameById.get(issue.clipId) : undefined,
      issue.overlayId != null ? overlayNameById.get(issue.overlayId) : undefined,
    );
    const issues = validateMixProject(currentProject);
    const errors = issues.filter((issue) => issue.level === 'error');

    // Only the sources that are used (a source without clips doesn't matter), the music and the overlay files
    const usedSourceIds = new Set(currentProject.clips.map((clip) => clip.sourceId));
    const filesToCheck = [
      ...currentProject.sources.filter((source) => usedSourceIds.has(source.id)).map((source) => ({ name: source.name, filePath: source.absolutePath })),
      ...currentProject.settings.musicPlaylist.tracks.map((track) => ({ name: path.basename(track.absolutePath), filePath: track.absolutePath })),
      // overlay images, sounds and countdown fonts (T20)
      ...currentProject.overlays.flatMap((overlay) => getOverlayFiles(overlay).map(({ file }) => ({ name: overlay.name, filePath: file.absolutePath }))),
      // the bundled font, if used (a broken install would otherwise fail inside ffmpeg)
      ...(currentProject.overlays.some((overlay) => (overlay.type === 'countdown' || overlay.type === 'text') && overlay.font == null) ? [{ name: 'OpenSans-Bold.ttf', filePath: getDefaultOverlayFontPath() }] : []),
    ];
    const missing = (await Promise.all(filesToCheck.map(async (file) => ((await mainApi.pathExists(file.filePath)) ? undefined : file)))).filter((file) => file != null);

    if (errors.length > 0 || missing.length > 0) {
      await showRenderProblems({
        title: i18n.t('The mix can\'t be rendered'),
        lines: [
          ...missing.map((file) => i18n.t('File not found: {{path}}', { path: file.filePath })),
          ...errors.map((issue) => issueText(issue)),
        ],
      });
      return undefined;
    }

    const renderPlan = planRender(currentProject, { preview });
    // Overlay time warnings (clipped, outside the video, cycles, broken references…), from a resolution with the
    // sound durations already known to the UI (T22's useOverlaySoundDurations): the render itself re-resolves them
    // with the exact durations from the loudness analysis (T21), so this is only for the confirmation's wording.
    // E4 (T39): on the placements of the whole plan, cut to the maximum duration (getOverlayTimesPlan)
    const overlayTimes = resolveOverlayTimes(currentProject, getOverlayTimesPlan(renderPlan), { soundDurations: getKnownSoundDurations(currentProject.overlays) });
    const overlayTimeWarningLines = currentProject.overlays.flatMap((overlay) => {
      const warnings = overlayTimes.get(overlay.id)?.warnings ?? [];
      return warnings.map((warning) => i18n.t('Overlay "{{overlay}}": {{warning}}', { overlay: overlay.name, warning: getOverlayTimeWarningText(warning) }));
    });
    const warningLines = [
      ...issues.filter((issue) => issue.level === 'warning').map((issue) => issueText(issue)),
      ...getRenderWarnings(renderPlan.plan, currentProject.clips).map((warning) => getRenderWarningText(warning)),
      ...overlayTimeWarningLines,
    ];
    if (warningLines.length > 0 && !(await askForRenderWarnings({ lines: warningLines, preview }))) return undefined;
    return renderPlan;
  }, [getProject, project, setSourceMeta]);

  /** Loudness analysis + render into `outPath`. Throws RenderAbortedError (no error dialog) when cancelled. */
  const render = useCallback(async ({ renderPlan, outPath, partialPath, workDir, preview }: {
    renderPlan: NonNullable<Awaited<ReturnType<typeof prepare>>>,
    outPath: string,
    partialPath: string,
    workDir: string,
    preview: boolean,
  }) => {
    // T35b: read the project again instead of using the `project` closure, which may still be missing the meta
    // `prepare` just refreshed — `getProject` is up to date right after `setSourceMeta`, without waiting for a
    // re-render.
    const currentProject = getProject();
    const abortController = new AbortController();
    // Sound overlays (T21): measured and mixed in alongside the clips
    const soundOverlays = currentProject.overlays.filter((overlay) => overlay.type === 'sound');

    // T41: the working state carries what the render progress dialog shows; the elapsed time counts from here
    const renderText = preview ? i18n.t('Rendering preview') : i18n.t('Rendering mix');
    const startedAt = Date.now();
    let status: WorkingState = { text: i18n.t('Analyzing audio loudness'), abortController, mixRender: { kind: preview ? 'preview' : 'mix', startedAt, phase: 'loudness', phaseStartedAt: startedAt } };
    const setStatus = (text: string, changes: Partial<MixRenderStatus>) => {
      invariant(status.mixRender != null);
      status = { text, abortController, mixRender: { ...status.mixRender, ...changes } };
      setWorking(status);
    };
    const startPhase = (text: string, phase: MixRenderPhase) => {
      setStatus(text, { phase, phaseStartedAt: Date.now(), etaBaseline: undefined });
      setProgress(0);
    };
    // A question in the middle of the render: the progress dialog steps aside meanwhile (a modal would take the focus)
    const ask = async <T>(question: () => Promise<T>) => {
      const previous = status;
      setStatus(previous.text, { phase: 'confirm' });
      try {
        return await question();
      } finally {
        status = previous;
        setWorking(previous);
      }
    };

    try {
      setWorking(status);
      setProgress(0);
      // Measures only what isn't cached yet; the new measurements are stored in the project (also when cancelled)
      const loudness = await ensureLoudness({ project: currentProject, musicTracks: currentProject.settings.musicPlaylist.tracks, sounds: soundOverlays, onProgress: setProgress, abortSignal: abortController.signal, onCacheEntries: setLoudnessCache });

      // T21b: a sound overlay whose level couldn't be measured (very short or otherwise unusual file) still plays
      // (buildAudioGraph, at its manual gain only), but warn about it here instead of doing that silently.
      const isUnmeasured = (measurement: LoudnessMeasurement | undefined) => measurement != null && !measurement.hasAudio && measurement.unmeasured === true;
      const unmeasuredSounds = soundOverlays.filter((overlay) => isUnmeasured(loudness[overlay.id]));
      if (unmeasuredSounds.length > 0) {
        const lines = unmeasuredSounds.map((overlay) => i18n.t('Sound overlay "{{overlay}}": couldn\'t measure its loudness, so it will play at its manual gain only, without normalization.', { overlay: overlay.name }));
        if (!(await ask(async () => askForRenderWarnings({ lines, preview })))) throw new RenderAbortedError();
      }

      startPhase(renderText, 'render');
      const { plan, settings, encoding } = renderPlan;
      const overlayTimes = resolveOverlayTimes(currentProject, getOverlayTimesPlan(renderPlan), { soundDurations: getSoundDurations(loudness, soundOverlays) });

      // T25: 'auto'/a specific choice resolved against what actually works on this machine (main's detectEncoders,
      // cached for the session); a manual choice that isn't available (e.g. a project made on another machine)
      // falls back to software too.
      const available = await detectEncoders();
      const hardware = resolveEncoderHardware({ encoder: settings.encoder, available });

      const cacheMaxBytes = getRenderCacheMaxBytes();
      const cacheRoot = getCacheRoot();
      const cacheDir = getRenderCacheDir(path, cacheRoot, { preview, width: plan.width, height: plan.height });
      const sourcePaths = Object.fromEntries(currentProject.sources.map((source) => [source.id, source.absolutePath]));
      const fileIdentities = cacheMaxBytes > 0 ? await getFileIdentities([
        ...Object.values(sourcePaths),
        ...currentProject.settings.musicPlaylist.tracks.map((track) => track.absolutePath),
        ...currentProject.overlays.flatMap((overlay) => getOverlayFiles(overlay).map(({ file }) => file.absolutePath)),
        getDefaultOverlayFontPath(),
      ]) : {};

      const runWithEncoder = async (resolvedEncoder: ResolvedEncoder) => {
        const uncachedJob = buildRenderJob({
          plan,
          clips: currentProject.clips,
          sourcePaths,
          // B1: anamorphic sources are cropped in coded pixels
          sourceFrames: Object.fromEntries(currentProject.sources.map((source) => [source.id, source])),
          settings,
          encoding,
          resolvedEncoder,
          workDir,
          outPath: partialPath,
          // RenderClip has no muted/gainDb: close over the full clips (T12)
          buildAudioGraph: (input) => buildAudioGraph({ ...input, clips: currentProject.clips, loudness, overlays: soundOverlays, overlayTimes }),
          join: path.join,
          // images, countdowns and progress bars (T20)
          overlays: { overlays: currentProject.overlays, times: overlayTimes, defaultFontPath: getDefaultOverlayFontPath() },
        });
        // T41: the first ffmpeg starts the timed work, for the remaining time estimate: the cached blocks, which count
        // as done at once, come before it
        let lastProgress = 0;
        let started = false;
        const deps: RenderRunnerDeps = {
          ...runnerDeps,
          runFfmpeg: async (params) => {
            if (!started) {
              started = true;
              setStatus(renderText, { etaBaseline: { time: Date.now(), progress: lastProgress } });
            }
            await runnerDeps.runFfmpeg(params);
          },
        };
        const job = cacheMaxBytes > 0
          ? applyRenderCache(uncachedJob, { dir: cacheDir, keys: await getRenderCacheKeys(uncachedJob, { fileIdentities }), runId: nanoid(8), join: path.join, fps: settings.fps })
          : uncachedJob;
        const result = await runRenderJob({
          job,
          workDir,
          outPath,
          // by the short side (T29): a 1080×1920 output has the pixels of 1080p, not of 2160p
          concurrency: getChunkConcurrency({ height: Math.min(plan.width, plan.height), cpuCount: navigator.hardwareConcurrency }),
          deps,
          onProgress: (value) => {
            lastProgress = value;
            setProgress(value);
          },
          onCommand: appendFfmpegCommandLog,
          abortSignal: abortController.signal,
        });
        console.log('Render done:', result);
        if (job.cacheDir == null) return;
        // Chunks the render didn't use go, and the cache is kept under its size limit (failures are only logged: the
        // render itself succeeded)
        try {
          const pruned = await pruneRenderCache({ root: cacheRoot, dir: job.cacheDir, keep: getRenderCacheFileNames(job, path.basename), maxBytes: cacheMaxBytes, now: Date.now(), deps: cacheFsDeps, join: path.join });
          console.log('Render cache:', pruned);
        } catch (err) {
          console.warn('Failed to clean up the render cache', err);
        }
      };

      try {
        await runWithEncoder({ codec: settings.encoder.codec, hardware });
      } catch (err) {
        // Cancelling isn't a hardware failure: let it propagate as-is. A hardware encoder can fail mid-render (a
        // driver quirk a short test-encode didn't catch): retry once with software rather than losing the render.
        if (hardware === 'none' || err instanceof RenderAbortedError) throw err;
        console.warn('Hardware encoder failed, retrying with software', err);
        await ask(showHardwareEncoderFallbackWarning);
        startPhase(renderText, 'render');
        await runWithEncoder({ codec: settings.encoder.codec, hardware: 'none' });
      }
    } finally {
      setWorking(undefined);
      setProgress(undefined);
    }
  }, [appendFfmpegCommandLog, getCacheRoot, getProject, setLoudnessCache, setProgress, setWorking]);

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

  /** Project → Clear render cache: this project's cache and those of unsaved projects. */
  const userClearRenderCache = useCallback(async () => {
    if (workingRef.current) return;
    await withErrorHandling(async () => {
      const unsavedParent = getUnsavedCacheParent(path, remote.app.getPath('userData'));
      const roots = [...(projectPath != null ? [getProjectCacheRoot(path, projectPath)] : []), unsavedParent];
      // the converted previews of the sources (T42) stay: they aren't render cache (T43)
      const bytes = (await Promise.all(roots.map(async (root) => clearRenderCache({ root, keep: [PREVIEW_CONVERSION_DIR_NAME], deps: cacheFsDeps, join: path.join }))))
        .reduce((acc, size) => acc + size, 0);
      getSwal().toast.fire({ icon: 'success', timer: 4000, title: i18n.t('Render cache cleared ({{size}} MB freed)', { size: Math.round(bytes / 1024 ** 2) }) });
    }, i18n.t('Failed to clear the render cache'));
  }, [projectPath, withErrorHandling, workingRef]);

  return {
    userRenderMix,
    userPreviewMix,
    userClearRenderCache,
  };
}

export type UseMixRender = ReturnType<typeof useMixRender>;
