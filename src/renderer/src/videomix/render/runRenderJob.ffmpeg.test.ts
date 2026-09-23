// The job runner with the real ffmpeg (a Node-side stand-in for main's runFfmpegWithProgress/abortFfmpegs): a full
// render at 320x180, and a cancelled one that must leave nothing behind. Skipped when the dev ffmpeg
// (ffmpeg/<platform>-<arch>) or the T02 media (`yarn generate-test-media`) are missing.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test, expect, afterAll } from 'vitest';

import { buildRenderJob } from './buildRenderJob';
import { getPartialOutputPath } from './renderOutput';
import { RenderAbortedError, runRenderJob } from './runRenderJob';
import type { RenderRunnerDeps } from './runRenderJob';
import { scalePlan, testClips, testPlans, testSettings, testSourcePaths, testSources } from './renderTestFixtures';

const ffDir = path.resolve('ffmpeg', `${os.platform()}-${os.arch()}`, ...(os.platform() === 'darwin' ? [] : ['lib']));
const ffmpegPath = path.join(ffDir, `ffmpeg${os.platform() === 'win32' ? '.exe' : ''}`);
const mediaDir = path.resolve('test-media');
const available = existsSync(ffmpegPath) && Object.values(testSources).every((s) => existsSync(path.join(mediaDir, s.file)));

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })));
});

// Progress from stderr `time=` like src/main/progress.ts (enough for the test: seconds only)
function nodeDeps() {
  const running = new Set<ChildProcess>();
  const deps: RenderRunnerDeps = {
    mkdir: async (dir) => { await mkdir(dir, { recursive: true }); },
    writeFile: async (filePath, content) => writeFile(filePath, content),
    rm: async (filePath) => rm(filePath, { recursive: true, force: true }),
    rename: async (from, to) => rename(from, to),
    runFfmpeg: async ({ args, duration, onProgress }) => new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath, args, { env: { ...process.env, LD_LIBRARY_PATH: ffDir } });
      running.add(child);
      let stderr = '';
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
        const match = [...d.toString().matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)].at(-1);
        if (match != null) onProgress((Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) / duration);
      });
      child.on('error', reject);
      child.on('close', (code, signal) => {
        running.delete(child);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with ${code ?? signal}\n${stderr.slice(-2000)}`));
      });
    }),
    abortAll: () => running.forEach((child) => child.kill()),
  };
  return deps;
}

async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'videomix-runner-test-'));
  tempDirs.push(dir);
  const workDir = path.join(dir, 'work');
  const outPath = path.join(dir, 'out.mp4');
  const settings = testSettings({ gap: { width: 4, color: '#303030' } });
  const job = buildRenderJob({
    plan: scalePlan(testPlans.substitutions, 320, 180),
    clips: testClips,
    sourcePaths: testSourcePaths(mediaDir),
    settings,
    encoding: { preset: 'ultrafast', crf: 30 },
    workDir,
    outPath: getPartialOutputPath(path, outPath, 'test'),
    // short chunks, so there are several to run in parallel
    maxChunkSeconds: 2,
    join: path.join,
  });
  return { dir, workDir, outPath, job };
}

describe.skipIf(!available)('runRenderJob with ffmpeg', () => {
  test('renders, reports progress up to 1 and leaves only the output', async () => {
    const { dir, workDir, outPath, job } = await setup();
    expect(job.chunks.length).toBeGreaterThan(2);
    const progress: number[] = [];
    const commands: string[][] = [];
    await runRenderJob({ job, workDir, outPath, concurrency: 2, deps: nodeDeps(), onProgress: (p) => progress.push(p), onCommand: (a) => commands.push(a) });

    expect(await readdir(dir)).toEqual(['out.mp4']);
    expect(existsSync(outPath)).toBe(true);
    expect(commands).toHaveLength(job.chunks.length + 2);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  }, 60_000);

  test('cancelling kills ffmpeg and removes the temp files and the partial output', async () => {
    const { dir, workDir, outPath, job } = await setup();
    const abortController = new AbortController();
    const promise = runRenderJob({
      job,
      workDir,
      outPath,
      concurrency: 2,
      deps: nodeDeps(),
      abortSignal: abortController.signal,
      // cancel as soon as the first chunk is under way
      onProgress: (p) => { if (p > 0) abortController.abort(); },
    });
    await expect(promise).rejects.toBeInstanceOf(RenderAbortedError);
    expect(await readdir(dir)).toEqual([]);
  }, 60_000);
});
