import pMap from 'p-map';
import invariant from 'tiny-invariant';

import { getClipDuration } from './project';
import { MUSIC_LOUDNESS_KEY } from './render/buildAudioGraph';
import type { LoudnessMeasurement, MixClip, MixMusic, MixProject } from './types';

export interface LoudnessDeps {
  stat: (path: string) => Promise<{ mtimeMs: number, size: number }>,
  /** src/main/videomix/loudness.ts. `start`/`end` omitted measures the whole file (the music track). */
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
 * Cache key of the music track's loudness (T12b): the whole file, so it reuses `getLoudnessCacheKey` with the
 * sentinel range `[0, Infinity)`, which no clip (a finite range) can ever produce.
 */
export const getMusicLoudnessCacheKey = ({ absolutePath, mtimeMs, size }: { absolutePath: string, mtimeMs: number, size: number }) => getLoudnessCacheKey({ absolutePath, mtimeMs, size, start: 0, end: Infinity });

/** Clips whose audio is mixed, so they need a loudness measurement: not muted and with a positive duration. */
export const getClipsNeedingLoudness = (clips: MixClip[]) => clips.filter((clip) => !clip.muted && getClipDuration(clip) > 0);

/**
 * Makes sure every clip that is mixed has a loudness measurement, measuring only what's not in `project.loudnessCache`
 * (clips with the same file and range share one measurement).
 *
 * - `music` (T12b): when given, also measures the whole music file (its own cache key, `getMusicLoudnessCacheKey`) and
 *   returns it under `MUSIC_LOUDNESS_KEY` (a key no clip id can be), the input `buildAudioGraph` expects for the music
 *   normalization gain.
 * - `onCacheEntries` gets the new cache entries (pass `setLoudnessCache` of useMixProject). It's also called with the
 *   ones measured so far when aborted or failing, so the work isn't lost.
 * - `onProgress` goes from 0 to 1 over the measurements that are needed.
 * - Returns the measurements by clip id (plus the music's, if requested), the input of `buildAudioGraph`.
 */
export async function ensureLoudness({ project, music, onProgress, abortSignal, onCacheEntries, deps = getElectronDeps(), concurrency = 2 }: {
  project: Pick<MixProject, 'clips' | 'sources' | 'loudnessCache'>,
  music?: Pick<MixMusic, 'absolutePath'> | undefined,
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

  const musicKey = music != null ? await getMusicLoudnessCacheKey({ absolutePath: music.absolutePath, ...await statOf(music.absolutePath) }) : undefined;

  const toMeasure = new Map<string, { filePath: string, start?: number, end?: number }>();
  keyedClips.forEach(({ clip, filePath, key }) => {
    if (project.loudnessCache?.[key] == null && !toMeasure.has(key)) toMeasure.set(key, { filePath, start: clip.start, end: clip.end });
  });
  if (musicKey != null && music != null && project.loudnessCache?.[musicKey] == null) toMeasure.set(musicKey, { filePath: music.absolutePath });

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
  if (musicKey != null) {
    const measurement = newEntries[musicKey] ?? project.loudnessCache?.[musicKey];
    invariant(measurement != null);
    result[MUSIC_LOUDNESS_KEY] = measurement;
  }
  return result;
}
