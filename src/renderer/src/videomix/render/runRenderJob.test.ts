import { describe, test, expect } from 'vitest';

import { RenderAbortedError, runRenderJob } from './runRenderJob';
import type { RenderRunnerDeps } from './runRenderJob';
import type { RenderJob } from './buildRenderJob';

// The job runner with a fake file system and ffmpeg: order, concurrency, progress, cleanup and cancellation.
// runRenderJob.ffmpeg.test.ts runs it with the real ffmpeg.

function fakeJob(numChunks: number): RenderJob {
  const chunks = Array.from({ length: numChunks }, (_, i) => ({
    chunk: { index: i, f0: i * 30, f1: (i + 1) * 30, animated: false },
    fileName: `chunk-${i}.mp4`,
    frames: 30,
    graphPath: `/work/chunk-${i}.graph.txt`,
    outPath: `/work/chunk-${i}.mp4`,
    duration: 1,
    args: ['chunk', String(i)],
  }));
  return {
    totalFrames: numChunks * 30,
    duration: numChunks,
    files: [...chunks.map((c) => ({ path: c.graphPath, content: 'graph' })), { path: '/work/chunks.txt', content: 'list' }],
    chunks,
    audio: { args: ['audio'], outPath: '/work/audio.m4a', duration: numChunks },
    concat: { args: ['concat'], outPath: '/out/mix.id.part.mp4', duration: numChunks },
    tempPaths: [],
  };
}

function fakeDeps({ failOn, delay = 5 }: { failOn?: string, delay?: number } = {}) {
  const files = new Map<string, string>();
  const log: string[] = [];
  let running = 0;
  let maxRunning = 0;
  let killed = 0;
  const pending = new Set<(err: Error) => void>();

  const deps: RenderRunnerDeps = {
    mkdir: async (dir) => { log.push(`mkdir ${dir}`); },
    writeFile: async (filePath, content) => { files.set(filePath, content); },
    rm: async (filePath) => {
      log.push(`rm ${filePath}`);
      [...files.keys()].filter((f) => f === filePath || f.startsWith(`${filePath}/`)).forEach((f) => files.delete(f));
    },
    rename: async (from, to) => {
      log.push(`rename ${from} ${to}`);
      const content = files.get(from);
      if (content == null) throw new Error('missing');
      files.delete(from);
      files.set(to, content);
    },
    runFfmpeg: async ({ args, onProgress }) => {
      const name = args.join(' ');
      log.push(`run ${name}`);
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      try {
        await new Promise<void>((resolve, reject) => {
          const kill = (err: Error) => reject(err);
          pending.add(kill);
          setTimeout(() => {
            pending.delete(kill);
            if (name === failOn) reject(new Error(`${name} failed`));
            else resolve();
          }, delay);
        });
        onProgress(0.5);
        // ffmpeg writes its output
        if (name === 'concat') files.set('/out/mix.id.part.mp4', 'video');
        else if (name === 'audio') files.set('/work/audio.m4a', 'audio');
        else files.set(`/work/chunk-${args[1]}.mp4`, 'chunk');
      } finally {
        running -= 1;
      }
    },
    abortAll: () => {
      killed += 1;
      pending.forEach((kill) => kill(new Error('killed')));
      pending.clear();
    },
  };
  return { deps, files, log, get maxRunning() { return maxRunning; }, get killed() { return killed; } };
}

describe('runRenderJob', () => {
  test('writes the files, runs audio + chunks with limited concurrency, concat last, renames, cleans up', async () => {
    const fake = fakeDeps();
    const progress: number[] = [];
    const commands: string[][] = [];
    await runRenderJob({ job: fakeJob(5), workDir: '/work', outPath: '/out/mix.mp4', concurrency: 2, deps: fake.deps, onProgress: (p) => progress.push(p), onCommand: (a) => commands.push(a) });

    expect(fake.maxRunning).toBe(2);
    expect(commands[0]).toEqual(['audio']);
    expect(commands.at(-1)).toEqual(['concat']);
    expect(commands).toHaveLength(7);
    const runs = fake.log.filter((l) => l.startsWith('run'));
    expect(runs.at(-1)).toBe('run concat');
    expect(fake.log.indexOf('rename /out/mix.id.part.mp4 /out/mix.mp4')).toBeGreaterThan(fake.log.indexOf('run concat'));
    expect(fake.log).toContain('rm /work');
    expect(fake.log).not.toContain('rm /out/mix.id.part.mp4');
    // only the final file is left
    expect([...fake.files.keys()]).toEqual(['/out/mix.mp4']);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  test('a failing chunk stops the render (the running steps finish), removes the temp files and the partial output, and rethrows', async () => {
    const fake = fakeDeps({ failOn: 'chunk 1' });
    await expect(runRenderJob({ job: fakeJob(6), workDir: '/work', outPath: '/out/mix.mp4', concurrency: 2, deps: fake.deps }))
      .rejects.toThrow('chunk 1 failed');
    expect(fake.killed).toBe(0);
    expect(fake.log).not.toContain('run concat');
    expect(fake.log).not.toContain('run chunk 5');
    expect(fake.log).toContain('rm /work');
    expect(fake.log).toContain('rm /out/mix.id.part.mp4');
    expect(fake.files.size).toBe(0);
  });

  test('cancelling kills the running steps and throws an AbortError', async () => {
    const fake = fakeDeps({ delay: 50 });
    const abortController = new AbortController();
    const promise = runRenderJob({ job: fakeJob(6), workDir: '/work', outPath: '/out/mix.mp4', concurrency: 2, deps: fake.deps, abortSignal: abortController.signal });
    setTimeout(() => abortController.abort(), 10);
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderAbortedError);
    expect((err as Error).name).toBe('AbortError');
    expect(fake.killed).toBe(1);
    expect(fake.log.filter((l) => l.startsWith('run'))).toEqual(['run audio', 'run chunk 0']);
    expect(fake.files.size).toBe(0);
  });

  test('already aborted: nothing runs', async () => {
    const fake = fakeDeps();
    const abortController = new AbortController();
    abortController.abort();
    await expect(runRenderJob({ job: fakeJob(2), workDir: '/work', outPath: '/out/mix.mp4', concurrency: 2, deps: fake.deps, abortSignal: abortController.signal }))
      .rejects.toBeInstanceOf(RenderAbortedError);
    expect(fake.log.filter((l) => l.startsWith('run') || l.startsWith('mkdir'))).toEqual([]);
  });

  test('without a partial name (preview) there is no rename', async () => {
    const fake = fakeDeps();
    await runRenderJob({ job: fakeJob(1), workDir: '/work', outPath: '/out/mix.id.part.mp4', concurrency: 1, deps: fake.deps });
    expect(fake.log.some((l) => l.startsWith('rename'))).toBe(false);
    expect([...fake.files.keys()]).toEqual(['/out/mix.id.part.mp4']);
  });
});
