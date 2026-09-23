import type { RenderJob, RenderStep } from './buildRenderJob';
import { createRenderProgress } from './renderProgress';

// Runs a RenderJob (T13, ADR-001): writes its files, runs the video chunks and the audio pass with limited concurrency,
// then the concat, and moves the result to its final name. No React/Electron: file system and ffmpeg are injected
// (the app passes node:fs and main's runFfmpegWithProgress/abortFfmpegs; the ffmpeg test passes child_process).

export interface RenderRunnerDeps {
  /** Recursive. */
  mkdir: (dir: string) => Promise<void>,
  writeFile: (filePath: string, content: string) => Promise<void>,
  /** Recursive, and no error if missing. */
  rm: (filePath: string) => Promise<void>,
  rename: (from: string, to: string) => Promise<void>,
  /** Runs ffmpeg (args without the binary) until it exits; rejects if it fails or is killed. `ratio` is 0–1. */
  runFfmpeg: (params: { args: string[], duration: number, onProgress: (ratio: number) => void }) => Promise<void>,
  /** Kills the running ffmpeg processes of the job, on cancel (the app kills them all, like the Working dialog's abort). */
  abortAll: () => void,
}

export class RenderAbortedError extends Error {
  constructor() {
    super('Render aborted');
    // what isAbortedError (util.ts) and withErrorHandling look for: no error dialog
    // eslint-disable-next-line unicorn/custom-error-definition
    this.name = 'AbortError';
  }
}

/**
 * Runs `job` in `workDir` (created here and always removed at the end) and leaves the result in `outPath`.
 *
 * - The job's concat writes to `job.concat.outPath`: pass a partial name (getPartialOutputPath) and it's renamed to
 *   `outPath` only on success, so a cancelled or failed render leaves nothing behind (the partial file is removed).
 * - Chunks and the audio pass run `concurrency` at a time. On the first failure or on `abortSignal` no more steps
 *   start; on abort the running ones are also killed. Either way they're awaited, so nothing is still writing when the
 *   temp files are removed.
 * - `onCommand` is called with the args of each step before it runs ("Last commands").
 */
export async function runRenderJob({ job, workDir, outPath, concurrency, deps, onProgress, onCommand, abortSignal }: {
  job: RenderJob,
  workDir: string,
  outPath: string,
  concurrency: number,
  deps: RenderRunnerDeps,
  onProgress?: ((progress: number) => void) | undefined,
  onCommand?: ((args: string[]) => void) | undefined,
  abortSignal?: AbortSignal | undefined,
}) {
  const partialPath = job.concat.outPath;
  const progress = createRenderProgress({ chunkFrames: job.chunks.map((c) => c.frames), onProgress: (p) => onProgress?.(p) });

  let failure: { error: unknown } | undefined;
  const fail = (error: unknown) => {
    if (failure == null) failure = { error };
  };
  // Only a cancel kills the running steps: after a failure they're left to finish (chunks are short), because the app
  // can only kill every ffmpeg at once, including e.g. the compat player's
  const onAbort = () => {
    fail(new RenderAbortedError());
    deps.abortAll();
  };
  abortSignal?.addEventListener('abort', onAbort);

  const throwIfFailed = () => {
    if (abortSignal?.aborted) throw new RenderAbortedError();
    if (failure != null) throw failure.error;
  };

  const runStep = async (step: RenderStep, onStepProgress: (ratio: number) => void) => {
    throwIfFailed();
    onCommand?.(step.args);
    await deps.runFfmpeg({ args: step.args, duration: step.duration, onProgress: onStepProgress });
    onStepProgress(1);
  };

  let succeeded = false;
  try {
    throwIfFailed();
    await deps.mkdir(workDir);
    await Promise.all(job.files.map(async (file) => deps.writeFile(file.path, file.content)));

    // The audio pass first: it's short, and an error in it (e.g. an unreadable music file) shows up without waiting
    // for the video.
    const tasks = [
      async () => runStep(job.audio, progress.setAudio),
      ...job.chunks.map((chunk, index) => async () => runStep(chunk, (ratio) => progress.setChunk(index, ratio))),
    ];
    let next = 0;
    const worker = async () => {
      while (failure == null && next < tasks.length) {
        const task = tasks[next]!;
        next += 1;
        try {
          // eslint-disable-next-line no-await-in-loop
          await task();
        } catch (err) {
          fail(err);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, worker));
    throwIfFailed();

    await runStep(job.concat, progress.setConcat);
    throwIfFailed();
    if (partialPath !== outPath) await deps.rename(partialPath, outPath);
    succeeded = true;
  } catch (err) {
    // A step killed because of the abort fails with its own error: report the abort instead
    if (abortSignal?.aborted) throw new RenderAbortedError();
    throw failure?.error ?? err;
  } finally {
    abortSignal?.removeEventListener('abort', onAbort);
    const cleanup = [deps.rm(workDir), ...(succeeded ? [] : [deps.rm(partialPath)])];
    // cleanup errors must not hide the render's result
    (await Promise.allSettled(cleanup)).forEach((r) => {
      if (r.status === 'rejected') console.warn('Failed to remove render temp files', r.reason);
    });
  }
}
