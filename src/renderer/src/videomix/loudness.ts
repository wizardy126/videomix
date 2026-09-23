import pMap from 'p-map';
import invariant from 'tiny-invariant';

import { getClipDuration } from './project';
import type { LoudnessMeasurement, MixClip, MixMusicTrack, MixProject, SoundOverlay } from './types';

export interface LoudnessDeps {
  stat: (path: string) => Promise<{ mtimeMs: number, size: number }>,
  /** src/main/videomix/loudness.ts. `start`/`end` omitted measures the whole file (music tracks, sound overlays). */
  measureLoudness: (params: { filePath: string, start?: number | undefined, end?: number | undefined, abortSignal?: AbortSignal | undefined }) => Promise<LoudnessMeasurement>,
}

// Lazy, so that the pure part can be tested in Node.
const getElectronDeps = (): LoudnessDeps => ({
  stat: window.require('node:fs/promises').stat,
  measureLoudness: window.require('@electron/remote').require('./index.js').videomix.measureLoudness,
});

/**
 * Cache key of a clip's loudness (04-diseno §5.1): `sha1(absolutePath + mtime + size + start + end)`, hex.
 * Changing the file or the clip's range invalidates it.
 */
export async function getLoudnessCacheKey({ absolutePath, mtimeMs, size, start, end }: {
  absolutePath: string,
  mtimeMs: number,
  size: number,
  start: number,
  end: number,
}) {
  const text = [absolutePath, mtimeMs, size, start, end].join('\n');
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Cache key of a whole file's loudness (music tracks, T12b/T24; sound overlays, T21): reuses `getLoudnessCacheKey` with
 * the sentinel range `[0, Infinity)`, which no clip (a finite range) can ever produce. Tracks and sound overlays sharing
 * a file share the measurement.
 */
export const getMusicLoudnessCacheKey = ({ absolutePath, mtimeMs, size }: { absolutePath: string, mtimeMs: number, size: number }) => getLoudnessCacheKey({ absolutePath, mtimeMs, size, start: 0, end: Infinity });

/** Clips whose audio is mixed, so they need a loudness measurement: not muted and with a positive duration. */
export const getClipsNeedingLoudness = (clips: MixClip[]) => clips.filter((clip) => !clip.muted && getClipDuration(clip) > 0);

/**
 * Makes sure every clip that is mixed has a loudness measurement, measuring only what's not in `project.loudnessCache`
 * (clips with the same file and range share one measurement).
 *
 * - `musicTracks` (T12b, per track since T24): when given, also measures the whole file of every music track (its own
 *   cache key, `getMusicLoudnessCacheKey`; looped if very short, T21b) and returns it under the track id, the input
 *   `buildAudioGraph` expects for the music normalization gain and, with its `duration`, the playlist's crossfades
 *   (T27). A cache entry without `duration` (from before T21) is re-measured.
 * - `sounds` (T21): when given, also measures the whole file of every sound overlay (same per-file cache key as the
 *   music) and returns each one under its overlay id. Its measurement carries `duration` (the file's length), which
 *   `getSoundDurations` turns into the `soundDurations` `resolveOverlayTimes` needs; a cache entry from before T21
 *   (no `duration`) is re-measured.
 * - `onCacheEntries` gets the new cache entries (pass `setLoudnessCache` of useMixProject). It's also called with the
 *   ones measured so far when aborted or failing, so the work isn't lost.
 * - `onProgress` goes from 0 to 1 over the measurements that are needed.
 * - Returns the measurements by clip id (plus the music tracks' and the sounds', if requested), the input of
 *   `buildAudioGraph`.
 */
export async function ensureLoudness({ project, musicTracks, sounds, onProgress, abortSignal, onCacheEntries, deps = getElectronDeps(), concurrency = 2 }: {
  project: Pick<MixProject, 'clips' | 'sources' | 'loudnessCache'>,
  musicTracks?: Pick<MixMusicTrack, 'id' | 'absolutePath'>[] | undefined,
  sounds?: Pick<SoundOverlay, 'id' | 'absolutePath'>[] | undefined,
  onProgress?: ((progress: number) => void) | undefined,
  abortSignal?: AbortSignal | undefined,
  onCacheEntries?: ((entries: Record<string, LoudnessMeasurement>) => void) | undefined,
  deps?: LoudnessDeps | undefined,
  concurrency?: number | undefined,
}): Promise<Record<string, LoudnessMeasurement>> {
  const sourcesById = new Map(project.sources.map((source) => [source.id, source]));
  const clips = getClipsNeedingLoudness(project.clips);

  // several clips (or the music) of the same source: stat once
  const statsByPath = new Map<string, Promise<{ mtimeMs: number, size: number }>>();
  const statOf = (filePath: string) => {
    let statPromise = statsByPath.get(filePath);
    if (statPromise == null) {
      statPromise = deps.stat(filePath);
      statsByPath.set(filePath, statPromise);
    }
    return statPromise;
  };

  const keyedClips = await Promise.all(clips.map(async (clip) => {
    const source = sourcesById.get(clip.sourceId);
    invariant(source != null, `Source ${clip.sourceId} of clip ${clip.id} not found`);
    const filePath = source.absolutePath;
    const { mtimeMs, size } = await statOf(filePath);
    const key = await getLoudnessCacheKey({ absolutePath: filePath, mtimeMs, size, start: clip.start, end: clip.end });
    return { clip, filePath, key };
  }));

  const keyedTracks = await Promise.all((musicTracks ?? []).map(async (track) => {
    const key = await getMusicLoudnessCacheKey({ absolutePath: track.absolutePath, ...await statOf(track.absolutePath) });
    return { track, key };
  }));
  const keyedSounds = await Promise.all((sounds ?? []).map(async (sound) => {
    const key = await getMusicLoudnessCacheKey({ absolutePath: sound.absolutePath, ...await statOf(sound.absolutePath) });
    return { sound, key };
  }));

  const toMeasure = new Map<string, { filePath: string, start?: number, end?: number }>();
  keyedClips.forEach(({ clip, filePath, key }) => {
    if (project.loudnessCache?.[key] == null && !toMeasure.has(key)) toMeasure.set(key, { filePath, start: clip.start, end: clip.end });
  });
  // Whole files, so a cache entry from before T21 (no `duration`) is re-measured: the sounds' and the tracks' durations
  // place them in the video (resolveOverlayTimes, the playlist's crossfades of T27)
  [...keyedTracks.map(({ track, key }) => ({ key, filePath: track.absolutePath })), ...keyedSounds.map(({ sound, key }) => ({ key, filePath: sound.absolutePath }))].forEach(({ key, filePath }) => {
    const cached = project.loudnessCache?.[key];
    if ((cached == null || cached.duration == null) && !toMeasure.has(key)) toMeasure.set(key, { filePath });
  });

  const newEntries: Record<string, LoudnessMeasurement> = {};
  let done = 0;
  onProgress?.(0);
  try {
    await pMap(toMeasure, async ([key, params]) => {
      abortSignal?.throwIfAborted();
      newEntries[key] = await deps.measureLoudness({ ...params, abortSignal });
      done += 1;
      onProgress?.(done / toMeasure.size);
    }, { concurrency, stopOnError: true });
  } finally {
    if (Object.keys(newEntries).length > 0) onCacheEntries?.({ ...newEntries });
  }

  const result = Object.fromEntries(keyedClips.map(({ clip, key }) => {
    const measurement = newEntries[key] ?? project.loudnessCache?.[key];
    invariant(measurement != null);
    return [clip.id, measurement];
  }));
  keyedTracks.forEach(({ track, key }) => {
    const measurement = newEntries[key] ?? project.loudnessCache?.[key];
    invariant(measurement != null);
    result[track.id] = measurement;
  });
  keyedSounds.forEach(({ sound, key }) => {
    const measurement = newEntries[key] ?? project.loudnessCache?.[key];
    invariant(measurement != null);
    result[sound.id] = measurement;
  });
  return result;
}

/**
 * `soundDurations` (id → s) that `resolveOverlayTimes` needs, from an `ensureLoudness` result and the sound overlays
 * it was called with. A sound whose measurement has no `duration` (not measured, or silent with the file unreadable
 * by ffprobe) is left out; `resolveOverlayTimes` then warns (`unknown-duration`) and treats it as 0 s.
 */
export function getSoundDurations(loudness: Record<string, LoudnessMeasurement>, sounds: Pick<SoundOverlay, 'id'>[]): Record<string, number> {
  const result: Record<string, number> = {};
  sounds.forEach(({ id }) => {
    const duration = loudness[id]?.duration;
    if (duration != null) result[id] = duration;
  });
  return result;
}

/**
 * The measurements already in `project.loudnessCache`, without measuring anything (the live preview, T32): by clip id
 * for the clips that would be mixed, and under their ids for the music tracks and the sound overlays. What isn't cached
 * (or whose file can't be read) is left out; the caller then plays it at its manual gain only.
 */
export async function getCachedLoudness({ project, musicTracks = [], sounds = [], deps = getElectronDeps() }: {
  project: Pick<MixProject, 'clips' | 'sources' | 'loudnessCache'>,
  musicTracks?: Pick<MixMusicTrack, 'id' | 'absolutePath'>[] | undefined,
  sounds?: Pick<SoundOverlay, 'id' | 'absolutePath'>[] | undefined,
  deps?: Pick<LoudnessDeps, 'stat'> | undefined,
}): Promise<Record<string, LoudnessMeasurement>> {
  const cache = project.loudnessCache ?? {};
  const statsByPath = new Map<string, Promise<{ mtimeMs: number, size: number } | undefined>>();
  const statOf = (filePath: string) => {
    let statPromise = statsByPath.get(filePath);
    if (statPromise == null) {
      statPromise = deps.stat(filePath).catch(() => undefined);
      statsByPath.set(filePath, statPromise);
    }
    return statPromise;
  };
  const sourcesById = new Map(project.sources.map((source) => [source.id, source]));
  const result: Record<string, LoudnessMeasurement> = {};

  await Promise.all(getClipsNeedingLoudness(project.clips).map(async (clip) => {
    const source = sourcesById.get(clip.sourceId);
    if (source == null) return;
    const stat = await statOf(source.absolutePath);
    if (stat == null) return;
    const measurement = cache[await getLoudnessCacheKey({ absolutePath: source.absolutePath, ...stat, start: clip.start, end: clip.end })];
    if (measurement != null) result[clip.id] = measurement;
  }));
  await Promise.all([...musicTracks, ...sounds].map(async ({ id, absolutePath }) => {
    const stat = await statOf(absolutePath);
    if (stat == null) return;
    const measurement = cache[await getMusicLoudnessCacheKey({ absolutePath, ...stat })];
    if (measurement != null) result[id] = measurement;
  }));
  return result;
}
