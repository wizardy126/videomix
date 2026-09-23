import { describe, test, expect } from 'vitest';

import { buildRenderJob } from './buildRenderJob';
import { buildAudioGraph } from './buildAudioGraph';
import type { RenderClip } from './buildVideoGraph';
import { applyRenderCache, getConcatListLine, getProjectCacheRoot, getRenderCacheDir, getRenderCacheFileNames, getRenderCacheKeys, getStaleUnsavedCaches, getStepKeySource, pruneRenderCache, sha256Hex, PARTIAL_MAX_AGE_MS } from './renderCache';
import type { CacheDirEntry, RenderCacheFsDeps } from './renderCache';
import { scalePlan, testClips, testPlans, testSettings, testSourcePaths } from './renderTestFixtures';
import type { MixPlan } from '../planner/types';
import type { MixClip, MixSettings } from '../types';

const posix = {
  join: (...parts: string[]) => parts.join('/').replaceAll(/\/+/g, '/'),
  dirname: (p: string) => p.slice(0, p.lastIndexOf('/')),
  basename: (p: string, ext?: string) => {
    const base = p.slice(p.lastIndexOf('/') + 1);
    return ext != null && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
  },
  extname: (p: string) => /\.[^./]*$/.exec(p)?.[0] ?? '',
};

const sourcePaths = testSourcePaths('/media');
const fileIdentities = Object.fromEntries(Object.values(sourcePaths).map((p) => [p, '1000:1']));
const loudness = Object.fromEntries(testClips.map((c) => [c.id, { hasAudio: true, inputI: -20, inputTp: -3, inputLra: 5, inputThresh: -30 } as const]));

// short chunks: several per plan
const plan = scalePlan(testPlans.substitutions, 320, 180);

function job({ workDir = '/tmp/work-1', clips = testClips, settings = testSettings(), p = plan, withAudio = false }: {
  workDir?: string, clips?: RenderClip[], settings?: MixSettings, p?: MixPlan, withAudio?: boolean,
} = {}) {
  return buildRenderJob({
    plan: p,
    clips,
    sourcePaths,
    settings,
    encoding: { preset: 'ultrafast', crf: 30 },
    workDir,
    outPath: `${workDir}/out.part.mp4`,
    maxChunkSeconds: 1,
    join: posix.join,
    ...(withAudio && {
      buildAudioGraph: (input) => buildAudioGraph({ ...input, clips: clips.map((c): Pick<MixClip, 'id' | 'sourceId' | 'start' | 'muted' | 'gainDb'> => ({ ...c, muted: false, gainDb: 0 })), loudness }),
    }),
  });
}

const changedChunks = (a: string[], b: string[]) => a.flatMap((key, i) => (key !== b[i] ? [i] : []));

describe('render cache keys', () => {
  test('sha256Hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('the same project gives the same keys, whatever the temp dir', async () => {
    const a = await getRenderCacheKeys(job({ workDir: '/tmp/videomix-render-aaaa' }), { fileIdentities });
    const b = await getRenderCacheKeys(job({ workDir: String.raw`C:\Temp\videomix-render-bbbb` }), { fileIdentities });
    expect(a.chunks.length).toBeGreaterThan(3);
    expect(new Set(a.chunks).size).toBe(a.chunks.length);
    expect(a).toEqual(b);
    expect(a.chunks[0]).toMatch(/^[\da-f]{40}$/);
  });

  test('the key text has no temp path', () => {
    const j = job({ workDir: '/tmp/videomix-render-aaaa' });
    const files = new Map(j.files.map((f) => [f.path, f.content]));
    const source = getStepKeySource(j.chunks[0]!, { files, fileIdentities });
    expect(source).not.toContain('videomix-render-aaaa');
    expect(source).toContain('libx264');
    // only the files the chunk reads
    expect(source).toContain('/media/h-1080p-10s.mp4');
    expect(source).not.toContain('/media/h-720p-25fps-8s.mp4');
  });

  test('changing a clip changes only the chunks that show it', async () => {
    const before = await getRenderCacheKeys(job(), { fileIdentities });
    // clip c plays from 2.5 s (xfade from 2.5 to 3 s) to the end; a from 0 to 3 s
    const cChanged = await getRenderCacheKeys(job({ clips: testClips.map((c) => (c.id === 'c' ? { ...c, start: c.start + 1 } : c)) }), { fileIdentities });
    const aChanged = await getRenderCacheKeys(job({ clips: testClips.map((c) => (c.id === 'a' ? { ...c, start: c.start + 1 } : c)) }), { fileIdentities });
    const { chunks } = job();
    const showing = (from: number, to: number) => chunks.flatMap((c, i) => (c.chunk.f0 < to * 30 && c.chunk.f1 > from * 30 ? [i] : []));
    expect(changedChunks(before.chunks, cChanged.chunks)).toEqual(showing(2.5, 6));
    expect(changedChunks(before.chunks, aChanged.chunks)).toEqual(showing(0, 3));
    expect(showing(2.5, 6).length).toBeLessThan(chunks.length);
    // the (silent) audio pass doesn't depend on the clips' pictures
    expect(cChanged.audio).toBe(before.audio);
  });

  test('a source file replaced in place (other size or mtime) changes the chunks that read it', async () => {
    const before = await getRenderCacheKeys(job(), { fileIdentities });
    const after = await getRenderCacheKeys(job(), { fileIdentities: { ...fileIdentities, [sourcePaths['h720']!]: '2000:1' } });
    const { chunks } = job();
    expect(changedChunks(before.chunks, after.chunks)).toEqual(chunks.flatMap((c, i) => (c.chunk.f1 > 2.5 * 30 ? [i] : [])));
  });

  test('encoding settings change every key', async () => {
    const before = await getRenderCacheKeys(job(), { fileIdentities });
    const after = await getRenderCacheKeys(job({ settings: testSettings({ encoder: { codec: 'h265', hardware: 'none' } }) }), { fileIdentities });
    expect(changedChunks(before.chunks, after.chunks)).toHaveLength(before.chunks.length);
  });

  test('the audio pass has its own key: it changes with the audio, not with the picture', async () => {
    const before = await getRenderCacheKeys(job({ withAudio: true }), { fileIdentities });
    const moved = await getRenderCacheKeys(job({ withAudio: true, clips: testClips.map((c) => (c.id === 'c' ? { ...c, start: c.start + 1 } : c)) }), { fileIdentities });
    expect(moved.audio).not.toBe(before.audio);
    const cropped = await getRenderCacheKeys(job({ withAudio: true, clips: testClips.map((c) => (c.id === 'c' ? { ...c, maxRect: { ...c.maxRect, x: 2, width: c.maxRect.width - 2 } } : c)) }), { fileIdentities });
    expect(cropped.audio).toBe(before.audio);
  });
});

describe('applyRenderCache', () => {
  test('chunks and audio write partials into the cache dir, the concat reads the cache files', async () => {
    const uncached = job();
    const keys = await getRenderCacheKeys(uncached, { fileIdentities });
    const cached = applyRenderCache(uncached, { dir: '/p/.x.vmx.cache/render', keys, runId: 'run1', join: posix.join, fps: 30 });
    const chunk = cached.chunks[1]!;
    expect(chunk.outPath).toBe(`/p/.x.vmx.cache/render/v-${keys.chunks[1]}.run1-1.part.mp4`);
    expect(chunk.args.at(-1)).toBe(chunk.outPath);
    expect(chunk.cache).toEqual({ path: `/p/.x.vmx.cache/render/v-${keys.chunks[1]}.mp4`, tolerance: 1 / 30 + 0.001 });
    expect(cached.audio.cache?.path).toBe(`/p/.x.vmx.cache/render/a-${keys.audio}.m4a`);
    expect(cached.audio.args.at(-1)).toBe(cached.audio.outPath);
    expect(cached.concat.args).toContain(cached.audio.cache?.path);
    expect(cached.concat.args).not.toContain(uncached.audio.outPath);
    const list = cached.files.find((f) => f.path === '/tmp/work-1/chunks.txt')!.content;
    expect(list.split('\n')[0]).toBe(`file '/p/.x.vmx.cache/render/v-${keys.chunks[0]}.mp4'`);
    expect(cached.cacheDir).toBe('/p/.x.vmx.cache/render');
    expect(getRenderCacheFileNames(cached, posix.basename)).toEqual([...keys.chunks.map((k) => `v-${k}.mp4`), `a-${keys.audio}.m4a`]);
  });

  test('concat list lines are quoted', () => {
    expect(getConcatListLine('/a/it\'s here/v.mp4')).toBe(`${String.raw`file '/a/it'\''s here/v.mp4'`}\n`);
    expect(getConcatListLine(String.raw`C:\Users\me\.p.vmx.cache\render\v-1.mp4`)).toBe(`${String.raw`file 'C:\Users\me\.p.vmx.cache\render\v-1.mp4'`}\n`);
  });

  test('cache paths', () => {
    expect(getProjectCacheRoot(posix, '/home/me/trip.vmx')).toBe('/home/me/.trip.vmx.cache');
    expect(getRenderCacheDir(posix, '/r', { preview: false, width: 1920, height: 1080 })).toBe('/r/render');
    expect(getRenderCacheDir(posix, '/r', { preview: true, width: 640, height: 360 })).toBe('/r/preview-640x360');
  });
});

describe('pruneRenderCache', () => {
  const key = (n: number) => String(n).repeat(40).slice(0, 40);
  function fakeFs(tree: Record<string, Omit<CacheDirEntry, 'name' | 'isDirectory'>>) {
    const files = new Map(Object.entries(tree));
    const removed: string[] = [];
    const deps: RenderCacheFsDeps = {
      list: async (dir) => {
        const names = new Map<string, CacheDirEntry>();
        [...files].filter(([p]) => p.startsWith(`${dir}/`)).forEach(([p, stats]) => {
          const [name, ...rest] = p.slice(dir.length + 1).split('/');
          names.set(name!, rest.length > 0 ? { name: name!, size: 0, mtimeMs: 0, isDirectory: true } : { name: name!, ...stats, isDirectory: false });
        });
        return [...names.values()];
      },
      rm: async (p) => {
        removed.push(p);
        [...files.keys()].filter((f) => f === p || f.startsWith(`${p}/`)).forEach((f) => files.delete(f));
      },
    };
    return { deps, files, removed };
  }
  const now = 10 * PARTIAL_MAX_AGE_MS;

  test('removes the unused files of its dir and old partials, keeps the other dirs and unknown files', async () => {
    const fake = fakeFs({
      [`/c/render/v-${key(1)}.mp4`]: { size: 10, mtimeMs: now },
      [`/c/render/v-${key(2)}.mp4`]: { size: 10, mtimeMs: now },
      [`/c/render/a-${key(3)}.m4a`]: { size: 5, mtimeMs: now },
      [`/c/render/v-${key(4)}.run-1.part.mp4`]: { size: 5, mtimeMs: now - 1000 },
      [`/c/render/v-${key(5)}.run-2.part.mp4`]: { size: 5, mtimeMs: 0 },
      '/c/render/notes.txt': { size: 5, mtimeMs: 0 },
      [`/c/preview-640x360/v-${key(6)}.mp4`]: { size: 10, mtimeMs: 0 },
    });
    const result = await pruneRenderCache({ root: '/c', dir: '/c/render', keep: [`v-${key(1)}.mp4`], maxBytes: 1000, now, deps: fake.deps, join: posix.join });
    expect(fake.removed.sort()).toEqual([`/c/render/a-${key(3)}.m4a`, `/c/render/v-${key(2)}.mp4`, `/c/render/v-${key(5)}.run-2.part.mp4`]);
    expect(result).toEqual({ removedFiles: 3, removedBytes: 20, totalBytes: 20 });
  });

  test('over the limit: least recently used first, the files of this render last', async () => {
    const fake = fakeFs({
      [`/c/render/v-${key(1)}.mp4`]: { size: 40, mtimeMs: 1 },
      [`/c/render/v-${key(2)}.mp4`]: { size: 40, mtimeMs: 2 },
      [`/c/preview-640x360/v-${key(3)}.mp4`]: { size: 10, mtimeMs: 5 },
      [`/c/preview-640x360/v-${key(4)}.mp4`]: { size: 10, mtimeMs: 3 },
    });
    const keep = [`v-${key(1)}.mp4`, `v-${key(2)}.mp4`];
    const r1 = await pruneRenderCache({ root: '/c', dir: '/c/render', keep, maxBytes: 90, now, deps: fake.deps, join: posix.join });
    expect(fake.removed).toEqual([`/c/preview-640x360/v-${key(4)}.mp4`]);
    expect(r1.totalBytes).toBe(90);
    // a render bigger than the limit keeps what fits
    await pruneRenderCache({ root: '/c', dir: '/c/render', keep, maxBytes: 45, now, deps: fake.deps, join: posix.join });
    expect([...fake.files.keys()]).toEqual([`/c/render/v-${key(2)}.mp4`]);
  });

  test('missing cache dir: nothing to do', async () => {
    const fake = fakeFs({});
    expect(await pruneRenderCache({ root: '/c', dir: '/c/render', keep: [], maxBytes: 0, now, deps: fake.deps, join: posix.join })).toEqual({ removedFiles: 0, removedBytes: 0, totalBytes: 0 });
  });

  test('stale unsaved caches', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(getStaleUnsavedCaches([
      { name: 'old', size: 0, mtimeMs: 0, isDirectory: true },
      { name: 'new', size: 0, mtimeMs: 9 * day, isDirectory: true },
      { name: 'file', size: 0, mtimeMs: 0, isDirectory: false },
    ], 10 * day)).toEqual(['old']);
  });
});
