import { describe, expect, test, vi } from 'vitest';

import { ThumbnailQueue, getThumbnailCacheKey, getThumbnailFileName } from './thumbnails';
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
