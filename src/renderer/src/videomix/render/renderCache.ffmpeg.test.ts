// Incremental render (T28) with the real ffmpeg at 320x180: a second render without changes encodes no chunk, a
// change in one clip re-encodes only the chunks that show it, and the result is the same picture as a render without
// the cache. Skipped when the dev ffmpeg (ffmpeg/<platform>-<arch>) or the T02 media (`yarn generate-test-media`) are
// missing.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rename, rm, stat, truncate, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, test, expect, afterAll } from 'vitest';

import { buildRenderJob } from './buildRenderJob';
import type { RenderClip } from './buildVideoGraph';
import { applyRenderCache, getFileIdentity, getRenderCacheFileNames, getRenderCacheKeys, pruneRenderCache } from './renderCache';
import type { RenderCacheFsDeps } from './renderCache';
import { runRenderJob } from './runRenderJob';
import type { RenderRunnerDeps } from './runRenderJob';
import { scalePlan, testClips, testPlans, testSettings, testSourcePaths, testSources } from './renderTestFixtures';

const execFileAsync = promisify(execFile);

const ffDir = path.resolve('ffmpeg', `${os.platform()}-${os.arch()}`, ...(os.platform() === 'darwin' ? [] : ['lib']));
const exe = os.platform() === 'win32' ? '.exe' : '';
const ffmpegPath = path.join(ffDir, `ffmpeg${exe}`);
const ffprobePath = path.join(ffDir, `ffprobe${exe}`);
const mediaDir = path.resolve('test-media');
const available = existsSync(ffmpegPath) && existsSync(ffprobePath) && Object.values(testSources).every((s) => existsSync(path.join(mediaDir, s.file)));
const env = { ...process.env, LD_LIBRARY_PATH: ffDir };
const run = async (bin: string, args: string[]) => (await execFileAsync(bin, args, { env, maxBuffer: 1e8 })).stdout;

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })));
});

const deps: RenderRunnerDeps = {
  mkdir: async (dir) => { await mkdir(dir, { recursive: true }); },
  writeFile: async (filePath, content) => writeFile(filePath, content),
  rm: async (filePath) => rm(filePath, { recursive: true, force: true }),
  rename: async (from, to) => rename(from, to),
  runFfmpeg: async ({ args }) => new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-loglevel', 'error', ...args], { env });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}\n${stderr}`))));
  }),
  // nothing is cancelled here
  abortAll: () => undefined,
  // like the app: not empty, and the duration ffprobe reads from the header
  verifyCached: async (filePath, { duration, tolerance }) => {
    try {
      if ((await stat(filePath)).size === 0) return false;
      const probed = Number((await run(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath])).trim());
      if (!(Math.abs(probed - duration) <= tolerance)) return false;
    } catch {
      return false;
    }
    const now = new Date();
    await utimes(filePath, now, now);
    return true;
  },
};

const cacheFsDeps: RenderCacheFsDeps = {
  list: async (dir) => {
    const names = await readdir(dir).catch(() => [] as string[]);
    return Promise.all(names.map(async (name) => {
      const s = await stat(path.join(dir, name));
      return { name, size: s.size, mtimeMs: s.mtimeMs, isDirectory: s.isDirectory() };
    }));
  },
  rm: async (filePath) => rm(filePath, { recursive: true, force: true }),
};

const sourcePaths = testSourcePaths(mediaDir);
const plan = scalePlan(testPlans.substitutions, 320, 180);
const settings = testSettings({ gap: { width: 4, color: '#303030' } });

async function render({ dir, clips = testClips, cacheRoot }: { dir: string, clips?: RenderClip[], cacheRoot?: string | undefined }) {
  const workDir = path.join(dir, `work-${Math.random().toString(36).slice(2)}`);
  const outPath = path.join(dir, `out-${Math.random().toString(36).slice(2)}.mp4`);
  const uncached = buildRenderJob({
    plan, clips, sourcePaths, settings, encoding: { preset: 'ultrafast', crf: 30 }, workDir, outPath, maxChunkSeconds: 1, join: path.join,
  });
  let job = uncached;
  if (cacheRoot != null) {
    const fileIdentities = Object.fromEntries(await Promise.all(Object.values(sourcePaths).map(async (p) => [p, getFileIdentity(await stat(p))] as const)));
    const keys = await getRenderCacheKeys(uncached, { fileIdentities });
    job = applyRenderCache(uncached, { dir: path.join(cacheRoot, 'render'), keys, runId: 'test', join: path.join, fps: settings.fps });
  }
  const result = await runRenderJob({ job, workDir, outPath, concurrency: 2, deps });
  if (job.cacheDir != null && cacheRoot != null) {
    await pruneRenderCache({ root: cacheRoot, dir: job.cacheDir, keep: getRenderCacheFileNames(job, path.basename), maxBytes: 1e9, now: Date.now(), deps: cacheFsDeps, join: path.join });
  }
  // decoded picture of every frame
  const frames = (await run(ffmpegPath, ['-v', 'error', '-i', outPath, '-map', '0:v', '-f', 'framemd5', '-'])).split('\n').filter((l) => /^\d/.test(l)).map((l) => l.split(',').at(-1)!.trim());
  return { job, result, frames };
}

describe.skipIf(!available)('render cache with ffmpeg', () => {
  test('re-render without changes encodes nothing; one clip change re-encodes only its chunks', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'videomix-cache-test-'));
    tempDirs.push(dir);
    const cacheRoot = path.join(dir, '.project.vmx.cache');

    const first = await render({ dir, cacheRoot });
    const numChunks = first.job.chunks.length;
    expect(numChunks).toBeGreaterThan(3);
    expect(first.result).toEqual({ renderedChunks: numChunks, reusedChunks: 0, audioReused: false });
    expect(first.frames).toHaveLength(first.job.totalFrames);
    // only cache files are left (no partials)
    expect((await readdir(path.join(cacheRoot, 'render'))).filter((n) => n.includes('.part.'))).toEqual([]);

    const second = await render({ dir, cacheRoot });
    expect(second.result).toEqual({ renderedChunks: 0, reusedChunks: numChunks, audioReused: true });
    expect(second.frames).toEqual(first.frames);

    // clip c (2.5 s to the end) starts 1 s later in its source
    const clips = testClips.map((c) => (c.id === 'c' ? { ...c, start: c.start + 1 } : c));
    const third = await render({ dir, clips, cacheRoot });
    const showingC = first.job.chunks.filter((c) => c.chunk.f1 > 2.5 * settings.fps).length;
    expect(showingC).toBeLessThan(numChunks);
    expect(third.result).toEqual({ renderedChunks: showingC, reusedChunks: numChunks - showingC, audioReused: true });
    // same picture as a render without the cache
    const reference = await render({ dir, clips });
    expect(third.frames).toEqual(reference.frames);
    expect(third.frames).not.toEqual(first.frames);
    // the chunks of the first version that aren't used any more were removed
    expect((await readdir(path.join(cacheRoot, 'render'))).sort()).toEqual(getRenderCacheFileNames(third.job, path.basename).sort().filter((n, i, a) => a.indexOf(n) === i));
  }, 120_000);

  test('a damaged cache file is rendered again', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'videomix-cache-test-'));
    tempDirs.push(dir);
    const cacheRoot = path.join(dir, '.project.vmx.cache');
    const first = await render({ dir, cacheRoot });
    await truncate(first.job.chunks[1]!.cache!.path, 1000);
    await writeFile(first.job.chunks[2]!.cache!.path, '');
    const second = await render({ dir, cacheRoot });
    expect(second.result.renderedChunks).toBe(2);
    expect(second.frames).toEqual(first.frames);
  }, 120_000);
});
