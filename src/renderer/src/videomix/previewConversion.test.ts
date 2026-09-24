import { describe, test, expect } from 'vitest';

import { getPreviewConversionDir } from './previewConversion';
import { getProjectCacheRoot, pruneRenderCache } from './render/renderCache';
import type { CacheDirEntry } from './render/renderCache';

const posix = {
  join: (...parts: string[]) => parts.join('/').replaceAll(/\/+/g, '/'),
  dirname: (p: string) => p.slice(0, p.lastIndexOf('/')),
  basename: (p: string, ext?: string) => {
    const base = p.slice(p.lastIndexOf('/') + 1);
    return ext != null && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
  },
  extname: (p: string) => /\.[^./]*$/.exec(p)?.[0] ?? '',
};

const cacheRoot = getProjectCacheRoot(posix, '/projects/trip.vmx');

describe('getPreviewConversionDir', () => {
  test('is a per-source folder inside the converted folder of the project cache', async () => {
    const dir = await getPreviewConversionDir(posix, cacheRoot, '/media/a/clip.mts');
    expect(dir).toMatch(/^\/projects\/\.trip\.vmx\.cache\/converted\/[\da-f]{16}$/);
  });

  test('is stable for the same source', async () => {
    expect(await getPreviewConversionDir(posix, cacheRoot, '/media/a/clip.mts')).toBe(await getPreviewConversionDir(posix, cacheRoot, '/media/a/clip.mts'));
  });

  test('differs for sources with the same file name in different folders', async () => {
    expect(await getPreviewConversionDir(posix, cacheRoot, '/media/a/clip.mts')).not.toBe(await getPreviewConversionDir(posix, cacheRoot, '/media/b/clip.mts'));
  });

  test('the hash only depends on the source, not on the project', async () => {
    const other = getProjectCacheRoot(posix, '/elsewhere/other.vmx');
    const dir = await getPreviewConversionDir(posix, cacheRoot, '/media/a/clip.mts');
    const otherDir = await getPreviewConversionDir(posix, other, '/media/a/clip.mts');
    expect(posix.basename(dir)).toBe(posix.basename(otherDir));
  });

  test('the render cache pruning never touches converted previews', async () => {
    const convertedDir = await getPreviewConversionDir(posix, cacheRoot, '/media/a/clip.mts');
    const renderDir = posix.join(cacheRoot, 'render');
    const tree: Record<string, CacheDirEntry[]> = {
      [cacheRoot]: [
        { name: 'render', size: 0, mtimeMs: 0, isDirectory: true },
        { name: 'converted', size: 0, mtimeMs: 0, isDirectory: true },
      ],
      [renderDir]: [{ name: `v-${'a'.repeat(40)}.mp4`, size: 100, mtimeMs: 1, isDirectory: false }],
      [posix.join(cacheRoot, 'converted')]: [{ name: posix.basename(convertedDir), size: 0, mtimeMs: 0, isDirectory: true }],
      // named like a render cache file on purpose: it still isn't touched, it's one level too deep
      [convertedDir]: [
        { name: 'clip-converted-fastest.mkv', size: 10_000, mtimeMs: 0, isDirectory: false },
        { name: `v-${'b'.repeat(40)}.mp4`, size: 10_000, mtimeMs: 0, isDirectory: false },
      ],
    };
    const removed: string[] = [];
    const result = await pruneRenderCache({
      root: cacheRoot,
      dir: renderDir,
      keep: [],
      maxBytes: 0,
      now: 1_000_000_000,
      join: posix.join,
      deps: {
        list: async (dir) => tree[dir] ?? [],
        rm: async (filePath) => {
          removed.push(filePath);
          const dir = posix.dirname(filePath);
          tree[dir] = (tree[dir] ?? []).filter((e) => e.name !== posix.basename(filePath));
        },
      },
    });
    expect(removed).toEqual([posix.join(renderDir, `v-${'a'.repeat(40)}.mp4`)]);
    expect(result.totalBytes).toBe(0);
  });
});
