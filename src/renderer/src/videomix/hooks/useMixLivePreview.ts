import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getDefaultOverlayFontPath, getDuration } from '../../ffmpeg';
import { findExistingHtml5FriendlyFile } from '../../util';
import type { UseMixProject } from './useMixProject';
import type { UseMixOverlays } from './useMixOverlays';
import { getCachedLoudness } from '../loudness';
import type { LoudnessMeasurement } from '../types';
import { getRenderTimeline } from '../render/renderTimeline';
import { createPreviewDrawModel } from '../preview/previewDraw';
import { buildPreviewAudioModel } from '../preview/previewAudio';
import PreviewEngine from '../preview/previewEngine';
import type { PreviewEngineInput } from '../preview/previewEngine';

const remote = window.require('@electron/remote');
const { pathToFileURL } = remote.require('./index.js');
const { readFile } = window.require('node:fs/promises');

// Live preview of the mix in the player area (A1, T32), shown while the Mix tab is active: owns the preview engine
// (preview/previewEngine.ts), feeds it the plan of useMixOverlays with the cached loudness, and keeps the preview's
// time and the Mix view cursor in sync (clicking the lanes seeks the preview; playing moves the cursor).

/** While playing, the Mix view cursor follows the preview at this interval (ms): each update re-renders the app. */
const CURSOR_UPDATE_INTERVAL = 250;

// Durations of the music files without a measurement with one (probed once per session, like the sound overlays)
const musicDurationByPath = new Map<string, number | null>();

export default function useMixLivePreview({ mixProject, mixOverlays, enabled, volume, customOutDir }: {
  mixProject: UseMixProject,
  mixOverlays: Pick<UseMixOverlays, 'plan' | 'resolved' | 'cursorTime' | 'setCursorTime'>,
  /** VideoMix mode with the Mix tab shown: otherwise the engine stops and frees its media elements. */
  enabled: boolean,
  /** The app's playback volume (0..1). */
  volume: number,
  /** Where html5ified copies of unplayable sources are looked for (next to the source otherwise). */
  customOutDir: string | undefined,
}) {
  const { project } = mixProject;
  const { plan, resolved, cursorTime, setCursorTime } = mixOverlays;
  const { settings, clips, sources, overlays } = project;

  const [engine] = useState(() => new PreviewEngine({
    getFileUrl: (path) => pathToFileURL(path).href,
    readFile: async (path) => {
      const data: Uint8Array = await readFile(path);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    },
    defaultFontPath: (() => {
      try {
        return getDefaultOverlayFontPath();
      } catch (err) {
        console.warn('No default overlay font', err);
        return undefined;
      }
    })(),
  }));
  useEffect(() => () => engine.destroy(), [engine]);

  useEffect(() => engine.setPlayableCopyFinder(async (path) => {
    const copy = await findExistingHtml5FriendlyFile(path, customOutDir);
    // a "dummy" copy has no real video (FFmpeg-assisted playback)
    return copy != null && !copy.usingDummyVideo ? copy.path : undefined;
  }), [customOutDir, engine]);

  // Cached loudness only (never measured here), refreshed when the plan or the cache changes
  const [loudness, setLoudness] = useState<Record<string, LoudnessMeasurement>>({});
  const projectRef = useRef(project);
  useEffect(() => { projectRef.current = project; }, [project]);
  const { loudnessCache } = project;
  const soundsKey = useMemo(() => overlays.flatMap((o) => (o.type === 'sound' ? [`${o.id}:${o.absolutePath}`] : [])).join('\n'), [overlays]);
  const tracksKey = settings.musicPlaylist.tracks.map((track) => `${track.id}:${track.absolutePath}`).join('\n');
  useEffect(() => {
    if (!enabled || plan == null) return undefined;
    let current = true;
    const p = projectRef.current;
    getCachedLoudness({
      project: { ...p, loudnessCache },
      musicTracks: p.settings.musicPlaylist.tracks,
      sounds: p.overlays.flatMap((o) => (o.type === 'sound' ? [o] : [])),
    }).then((result) => {
      if (current) setLoudness(result);
    }, (err) => console.warn('Cannot read the cached loudness', err));
    return () => { current = false; };
  }, [enabled, plan, loudnessCache, soundsKey, tracksKey]);

  // Music durations for the playlist's crossfades when the loudness (which carries them) isn't cached yet
  const [musicDurationsVersion, setMusicDurationsVersion] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    const paths = settings.musicPlaylist.tracks.map((track) => track.absolutePath).filter((path) => !musicDurationByPath.has(path));
    if (paths.length === 0) return undefined;
    Promise.all(paths.map(async (path) => {
      try {
        const duration: number | undefined = await getDuration(path);
        musicDurationByPath.set(path, duration != null && Number.isFinite(duration) && duration > 0 ? duration : null);
      } catch (err) {
        console.warn('Cannot read the duration of', path, err);
        musicDurationByPath.set(path, null);
      }
    })).then(() => {
      if (current) setMusicDurationsVersion((v) => v + 1);
    });
    return () => { current = false; };
  }, [enabled, settings.musicPlaylist.tracks]);
  const musicDurations = useMemo(
    () => Object.fromEntries(settings.musicPlaylist.tracks.map((track) => [track.id, musicDurationByPath.get(track.absolutePath) ?? undefined])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.musicPlaylist.tracks, musicDurationsVersion],
  );

  const input = useMemo<PreviewEngineInput | undefined>(() => {
    if (!enabled || plan == null) return undefined;
    const tl = getRenderTimeline(plan, { fps: settings.fps, gap: settings.gap.width, transitionDuration: settings.transition.duration });
    return {
      drawModel: createPreviewDrawModel(tl, clips, settings),
      // the exact duration of the render (frames / fps)
      audioModel: buildPreviewAudioModel({ plan, clips, settings, duration: tl.totalFrames / settings.fps, loudness, musicDurations, overlays: overlays.flatMap((o) => (o.type === 'sound' ? [o] : [])), overlayTimes: resolved }),
      clips: new Map(clips.map((clip) => [clip.id, clip])),
      sources: new Map(sources.map((source) => [source.id, source])),
      tracks: new Map(settings.musicPlaylist.tracks.map((track) => [track.id, track.absolutePath])),
      loopMusic: settings.musicPlaylist.loop,
      overlays,
      resolved,
    };
  }, [clips, enabled, loudness, musicDurations, overlays, plan, resolved, settings, sources]);

  useEffect(() => {
    engine.setInput(input);
  }, [engine, input]);

  useEffect(() => {
    if (!enabled) engine.suspend();
  }, [enabled, engine]);

  useEffect(() => engine.setVolume(volume), [engine, volume]);

  // Preview time → Mix view cursor: throttled while playing, exact when paused
  const [playing, setPlaying] = useState(false);
  const reportedTimeRef = useRef<number>(undefined);
  const lastReportRef = useRef(0);
  useEffect(() => engine.subscribe(() => {
    setPlaying(engine.playing);
    const now = performance.now();
    if (engine.playing && now - lastReportRef.current < CURSOR_UPDATE_INTERVAL) return;
    lastReportRef.current = now;
    const time = engine.getTime();
    if (time === reportedTimeRef.current) return;
    reportedTimeRef.current = time;
    setCursorTime(time);
  }), [engine, setCursorTime]);

  // Mix view cursor → preview time (a click on the lanes, a new plan clamping it…), unless it's our own report
  useEffect(() => {
    if (cursorTime !== reportedTimeRef.current) {
      reportedTimeRef.current = cursorTime;
      engine.seek(cursorTime);
    }
  }, [cursorTime, engine]);

  const togglePlay = useCallback(() => engine.togglePlay(), [engine]);
  const play = useCallback(() => engine.play(), [engine]);
  const pause = useCallback(() => engine.pause(), [engine]);
  const seek = useCallback((time: number) => {
    engine.seek(time);
    reportedTimeRef.current = engine.getTime();
    setCursorTime(engine.getTime());
  }, [engine, setCursorTime]);

  return useMemo(() => ({
    engine,
    playing,
    togglePlay,
    play,
    pause,
    seek,
    /** There is a plan to show (at least one clip). */
    hasPlan: input != null,
    outputSize: plan != null ? { width: plan.width, height: plan.height } : undefined,
    /** Audible clips without a cached loudness measurement (levels not normalized until the first render/preview). */
    unnormalizedCount: input?.audioModel.unnormalizedCount ?? 0,
  }), [engine, input, pause, play, playing, plan, seek, togglePlay]);
}

export type UseMixLivePreview = ReturnType<typeof useMixLivePreview>;
