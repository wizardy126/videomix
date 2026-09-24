import { describe, expect, test, vi } from 'vitest';

import { ThumbnailQueue, getThumbnailCacheKey, getThumbnailCrop, getThumbnailFileName } from './thumbnails';
import type { Rect } from './types';

const rect: Rect = { x: 0, y: 0, width: 1920, height: 1080 };

describe('getThumbnailCacheKey', () => {
  test('sha1 of path, mtime, size, start and maxRect', async () => {
    const params = { absolutePath: '/media/a.mp4', mtimeMs: 1000, size: 12, start: 1.5, maxRect: rect };
    const key = await getThumbnailCacheKey(params);
    expect(key).toMatch(/^[\da-f]{40}$/);
    expect(await getThumbnailCacheKey(params)).toBe(key); // stable
  });

  test('changing any field changes the key', async () => {
    const base = { absolutePath: '/media/a.mp4', mtimeMs: 1000, size: 12, start: 1.5, maxRect: rect };
    const baseKey = await getThumbnailCacheKey(base);

    expect(await getThumbnailCacheKey({ ...base, absolutePath: '/media/b.mp4' })).not.toBe(baseKey);
    expect(await getThumbnailCacheKey({ ...base, mtimeMs: 2000 })).not.toBe(baseKey);
    expect(await getThumbnailCacheKey({ ...base, size: 13 })).not.toBe(baseKey);
    expect(await getThumbnailCacheKey({ ...base, start: 2 })).not.toBe(baseKey);
    expect(await getThumbnailCacheKey({ ...base, maxRect: { ...rect, x: 10 } })).not.toBe(baseKey);
    expect(await getThumbnailCacheKey({ ...base, maxRect: { ...rect, width: 100 } })).not.toBe(baseKey);
  });

  test('B1: an anamorphic SAR changes the key, square pixels keep the pre-v3 key', async () => {
    const base = { absolutePath: '/media/a.mp4', mtimeMs: 1000, size: 12, start: 1.5, maxRect: rect };
    const baseKey = await getThumbnailCacheKey(base);
    expect(await getThumbnailCacheKey({ ...base, sar: undefined })).toBe(baseKey);
    expect(await getThumbnailCacheKey({ ...base, sar: { num: 1, den: 1 } })).toBe(baseKey);
    expect(await getThumbnailCacheKey({ ...base, sar: { num: 679, den: 640 } })).not.toBe(baseKey);
  });

  test('E9: a turn changes the key, no turn keeps it', async () => {
    const base = { absolutePath: '/media/a.mp4', mtimeMs: 1000, size: 12, start: 1.5, maxRect: rect };
    const baseKey = await getThumbnailCacheKey(base);
    expect(await getThumbnailCacheKey({ ...base, rotation: 0 })).toBe(baseKey);
    const keys = await Promise.all(([90, 180, 270] as const).map(async (rotation) => getThumbnailCacheKey({ ...base, rotation })));
    expect(new Set([baseKey, ...keys]).size).toBe(4);
  });
});

describe('getThumbnailCrop', () => {
  test('square pixels: the max rect as is', () => {
    expect(getThumbnailCrop(rect, { width: 1920, height: 1080 })).toEqual({ crop: rect });
  });

  test('B1: coded crop plus the display aspect', () => {
    const maxRect = { x: 78, y: 14, width: 1232, height: 694 };
    expect(getThumbnailCrop(maxRect, { width: 1358, height: 720, sar: { num: 679, den: 640 } })).toEqual({ crop: { x: 74, y: 14, width: 1160, height: 694 }, aspect: 1232 / 694 });
  });

  test('E9: a turned clip crops the unturned frame and turns the crop', () => {
    const source = { width: 1920, height: 1080 };
    expect(getThumbnailCrop({ x: 0, y: 200, width: 1080, height: 920 }, source, 90)).toEqual({ crop: { x: 200, y: 0, width: 920, height: 1080 }, rotation: 'transpose=clock' });
    expect(getThumbnailCrop(rect, source, 180)).toEqual({ crop: rect, rotation: 'hflip,vflip' });
    // anamorphic: turned (14, 48) 694x1232 of the 720x1358 turned frame = display (48, 12) 1232x694 → coded
    expect(getThumbnailCrop({ x: 14, y: 48, width: 694, height: 1232 }, { width: 1358, height: 720, sar: { num: 679, den: 640 } }, 90))
      .toEqual({ crop: { x: 46, y: 12, width: 1160, height: 694 }, aspect: 694 / 1232, rotation: 'transpose=clock' });
  });
});

describe('getThumbnailFileName', () => {
  test('appends .jpg', () => {
    expect(getThumbnailFileName('abc123')).toBe('abc123.jpg');
  });
});

describe('ThumbnailQueue', () => {
  test('runs at most `concurrency` tasks at once, then drains the rest', async () => {
    const queue = new ThumbnailQueue(2);
    const running: string[] = [];
    const maxConcurrent: number[] = [];
    const resolvers = new Map<string, () => void>();

    const makeTask = (key: string) => vi.fn(async () => {
      running.push(key);
      maxConcurrent.push(queue.runningCount);
      await new Promise<void>((resolve) => resolvers.set(key, resolve));
      running.splice(running.indexOf(key), 1);
    });

    const tasks = ['a', 'b', 'c', 'd'].map((key) => ({ key, task: makeTask(key) }));
    tasks.forEach(({ key, task }) => queue.enqueue(key, task));

    // a and b start immediately (concurrency 2); c and d wait
    await vi.waitFor(() => expect(running.sort()).toEqual(['a', 'b']));
    expect(queue.pendingCount).toBe(2);

    resolvers.get('a')!();
    await vi.waitFor(() => expect(running.sort()).toEqual(['b', 'c']));

    resolvers.get('b')!();
    resolvers.get('c')!();
    await vi.waitFor(() => expect(running.sort()).toEqual(['d']));
    resolvers.get('d')!();

    await vi.waitFor(() => expect(queue.runningCount).toBe(0));
    expect(Math.max(...maxConcurrent)).toBeLessThanOrEqual(2);
    tasks.forEach(({ task }) => expect(task).toHaveBeenCalledTimes(1));
  });

  test('re-queuing a key still waiting replaces its task instead of running both', async () => {
    const queue = new ThumbnailQueue(1);
    const first = vi.fn(async () => { /* never resolves before being replaced */ await new Promise(() => undefined); });
    const blocker = vi.fn(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    const second = vi.fn(async () => undefined);

    queue.enqueue('blocker', blocker); // occupies the single slot
    queue.enqueue('clip-1', first);
    queue.enqueue('clip-1', second); // replaces `first` before it ever started

    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(first).not.toHaveBeenCalled();
  });

  test('a key can run again once its previous run has already started', async () => {
    const queue = new ThumbnailQueue(1);
    const calls: string[] = [];
    queue.enqueue('clip-1', async () => { calls.push('run-1'); });
    await vi.waitFor(() => expect(calls).toEqual(['run-1']));
    queue.enqueue('clip-1', async () => { calls.push('run-2'); });
    await vi.waitFor(() => expect(calls).toEqual(['run-1', 'run-2']));
  });

  test('a failing task does not stop the queue from draining the rest', async () => {
    const queue = new ThumbnailQueue(1);
    const calls: string[] = [];
    queue.enqueue('a', async () => { throw new Error('boom'); });
    queue.enqueue('b', async () => { calls.push('b'); });
    await vi.waitFor(() => expect(calls).toEqual(['b']));
  });
});
