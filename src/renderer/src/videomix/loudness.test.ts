import { describe, expect, test, vi } from 'vitest';

import { ensureLoudness, getLoudnessCacheKey, getSoundDurations } from './loudness';
import type { LoudnessDeps } from './loudness';
import { MUSIC_LOUDNESS_KEY } from './render/buildAudioGraph';
import { createEmptyMixProject } from './types';
import type { LoudnessMeasurement, MixClip, MixProject } from './types';

const rect = { x: 0, y: 0, width: 1920, height: 1080 };

const clip = (id: string, sourceId: string, start: number, end: number, muted = false): MixClip => ({
  id, sourceId, name: id, color: 0, start, end, maxRect: rect, muted, gainDb: 0,
});

function makeProject(clips: MixClip[], loudnessCache?: Record<string, LoudnessMeasurement>): MixProject {
  return {
    ...createEmptyMixProject(),
    sources: [
      { id: 's1', path: 'a.mp4', absolutePath: '/media/a.mp4', name: 'a.mp4' },
      { id: 's2', path: 'b.mp4', absolutePath: '/media/b.mp4', name: 'b.mp4' },
    ],
    clips,
    ...(loudnessCache != null && { loudnessCache }),
  };
}

const measurement = (inputI: number): LoudnessMeasurement => ({ hasAudio: true, inputI, inputTp: -1, inputLra: 2, inputThresh: inputI - 10 });

function makeDeps() {
  const stat = vi.fn(async (path: string) => ({ mtimeMs: 1000, size: path.length }));
  const measureLoudness = vi.fn<LoudnessDeps['measureLoudness']>(async ({ start = 0 }) => measurement(-20 - start));
  return { stat, measureLoudness };
}

describe('getLoudnessCacheKey', () => {
  test('sha1 of path, mtime, size and range', async () => {
    const params = { absolutePath: '/media/a.mp4', mtimeMs: 1000, size: 12, start: 1, end: 2.5 };
    const key = await getLoudnessCacheKey(params);
    expect(key).toMatch(/^[\da-f]{40}$/);
    expect(await getLoudnessCacheKey(params)).toBe(key);
    await Promise.all((['absolutePath', 'mtimeMs', 'size', 'start', 'end'] as const).map(async (field) => {
      const changed = { ...params, [field]: field === 'absolutePath' ? '/media/b.mp4' : params[field] + 1 };
      expect(await getLoudnessCacheKey(changed)).not.toBe(key);
    }));
  });
});

describe('ensureLoudness', () => {
  test('measures what is missing, once per file and range', async () => {
    const deps = makeDeps();
    const onCacheEntries = vi.fn();
    const onProgress = vi.fn();
    const project = makeProject([
      clip('c1', 's1', 0, 5),
      clip('c2', 's1', 0, 5), // same range: shares the measurement
      clip('c3', 's2', 2, 4),
      clip('c4', 's2', 5, 6, true), // muted: not needed
    ]);
    const result = await ensureLoudness({ project, deps, onCacheEntries, onProgress });

    expect(result).toEqual({ c1: measurement(-20), c2: measurement(-20), c3: measurement(-22) });
    expect(deps.measureLoudness).toHaveBeenCalledTimes(2);
    expect(deps.stat).toHaveBeenCalledTimes(2);
    expect(onCacheEntries).toHaveBeenCalledTimes(1);
    const entries = onCacheEntries.mock.calls[0]![0] as Record<string, LoudnessMeasurement>;
    expect(Object.values(entries)).toHaveLength(2);
    expect(onProgress).toHaveBeenLastCalledWith(1);

    // second run with the cache: nothing to measure
    const deps2 = makeDeps();
    const onCacheEntries2 = vi.fn();
    const result2 = await ensureLoudness({ project: { ...project, loudnessCache: entries }, deps: deps2, onCacheEntries: onCacheEntries2 });
    expect(result2).toEqual(result);
    expect(deps2.measureLoudness).not.toHaveBeenCalled();
    expect(onCacheEntries2).not.toHaveBeenCalled();
  });

  test('a changed file is measured again', async () => {
    const deps = makeDeps();
    const onCacheEntries = vi.fn();
    const project = makeProject([clip('c1', 's1', 0, 5)]);
    await ensureLoudness({ project, deps, onCacheEntries });
    const entries = onCacheEntries.mock.calls[0]![0] as Record<string, LoudnessMeasurement>;

    const deps2 = makeDeps();
    deps2.stat.mockResolvedValue({ mtimeMs: 2000, size: 1 });
    await ensureLoudness({ project: { ...project, loudnessCache: entries }, deps: deps2 });
    expect(deps2.measureLoudness).toHaveBeenCalledTimes(1);
  });

  test('measures the music too, whole file, when asked (T12b)', async () => {
    const deps = makeDeps();
    const onCacheEntries = vi.fn();
    const project = makeProject([clip('c1', 's1', 0, 5)]);
    const music = { absolutePath: '/media/m.mp3' };
    const result = await ensureLoudness({ project, music, deps, onCacheEntries });

    expect(result[MUSIC_LOUDNESS_KEY]).toEqual(measurement(-20)); // start defaults to 0 in the mock
    expect(deps.measureLoudness).toHaveBeenCalledTimes(2);
    expect(deps.measureLoudness).toHaveBeenCalledWith({ filePath: '/media/m.mp3', abortSignal: undefined });
    expect(deps.stat).toHaveBeenCalledTimes(2); // one clip's file, one music file

    // cached the second time
    const entries = onCacheEntries.mock.calls[0]![0] as Record<string, LoudnessMeasurement>;
    const deps2 = makeDeps();
    const result2 = await ensureLoudness({ project: { ...project, loudnessCache: entries }, music, deps: deps2 });
    expect(result2).toEqual(result);
    expect(deps2.measureLoudness).not.toHaveBeenCalled();
  });

  test('measures sound overlays too, whole file, under their overlay id (T21)', async () => {
    const deps = makeDeps();
    deps.measureLoudness.mockImplementation(async ({ filePath }) => ({ ...measurement(-14), duration: filePath.length }));
    const onCacheEntries = vi.fn();
    const project = makeProject([clip('c1', 's1', 0, 5)]);
    const sounds = [{ id: 'beep', absolutePath: '/media/beep.wav' }, { id: 'boop', absolutePath: '/media/boop.wav' }];
    const result = await ensureLoudness({ project, sounds, deps, onCacheEntries });

    expect(result['beep']).toEqual({ ...measurement(-14), duration: '/media/beep.wav'.length });
    expect(result['boop']).toEqual({ ...measurement(-14), duration: '/media/boop.wav'.length });
    expect(deps.measureLoudness).toHaveBeenCalledTimes(3); // clip + 2 sounds

    // cached the second time, and getSoundDurations reads the durations back out
    const entries = onCacheEntries.mock.calls[0]![0] as Record<string, LoudnessMeasurement>;
    const deps2 = makeDeps();
    const result2 = await ensureLoudness({ project: { ...project, loudnessCache: entries }, sounds, deps: deps2 });
    expect(result2).toEqual(result);
    expect(deps2.measureLoudness).not.toHaveBeenCalled();
    expect(getSoundDurations(result2, sounds)).toEqual({ beep: '/media/beep.wav'.length, boop: '/media/boop.wav'.length });
  });

  test('two sound overlays sharing a file share the measurement (one measureLoudness call)', async () => {
    const deps = makeDeps();
    deps.measureLoudness.mockResolvedValue({ ...measurement(-14), duration: 3 });
    const project = makeProject([]);
    const sounds = [{ id: 'beep1', absolutePath: '/media/beep.wav' }, { id: 'beep2', absolutePath: '/media/beep.wav' }];
    const result = await ensureLoudness({ project, sounds, deps });
    expect(result['beep1']).toEqual(result['beep2']);
    expect(deps.measureLoudness).toHaveBeenCalledTimes(1);
  });

  test('a sound cached without a duration (before T21) is re-measured', async () => {
    const project = makeProject([]);
    const sounds = [{ id: 'beep', absolutePath: '/media/beep.wav' }];

    // A cache entry that looks like it came from before T21 (no `duration`), under the real key
    const onCacheEntries = vi.fn();
    await ensureLoudness({ project, sounds, deps: makeDeps(), onCacheEntries }); // deps' default mock has no duration
    const staleEntries = onCacheEntries.mock.calls[0]![0] as Record<string, LoudnessMeasurement>;
    expect(Object.values(staleEntries)[0]!.duration).toBeUndefined();

    const deps = makeDeps();
    deps.measureLoudness.mockResolvedValue({ ...measurement(-14), duration: 5 });
    const result = await ensureLoudness({ project: { ...project, loudnessCache: staleEntries }, sounds, deps });
    expect(deps.measureLoudness).toHaveBeenCalledTimes(1); // re-measured, not reused from the stale cache
    expect(result['beep']!.duration).toBe(5);
  });

  test('getSoundDurations leaves out sounds without a duration', () => {
    expect(getSoundDurations({ beep: measurement(-14), boop: { ...measurement(-14), duration: 2 } }, [{ id: 'beep' }, { id: 'boop' }, { id: 'missing' }])).toEqual({ boop: 2 });
  });

  test('keeps what was measured when aborted', async () => {
    const abortController = new AbortController();
    const deps = makeDeps();
    deps.measureLoudness.mockImplementation(async ({ start }) => {
      if (start === 0) abortController.abort();
      return measurement(-20);
    });
    const onCacheEntries = vi.fn();
    const project = makeProject([clip('c1', 's1', 0, 5), clip('c2', 's1', 6, 7), clip('c3', 's1', 8, 9)]);
    await expect(ensureLoudness({ project, deps, onCacheEntries, abortSignal: abortController.signal, concurrency: 1 })).rejects.toThrow();
    expect(deps.measureLoudness).toHaveBeenCalledTimes(1);
    expect(Object.keys(onCacheEntries.mock.calls[0]![0] as object)).toHaveLength(1);
  });
});
