import { describe, expect, test, vi } from 'vitest';

import { ensureLoudness, getLoudnessCacheKey } from './loudness';
import type { LoudnessDeps } from './loudness';
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
  const measureLoudness = vi.fn<LoudnessDeps['measureLoudness']>(async ({ start }) => measurement(-20 - start));
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
