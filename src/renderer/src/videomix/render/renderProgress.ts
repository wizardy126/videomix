// Global progress of a render job (ADR-001 "Progreso"): frames of the video chunks, the finished ones plus the frames
// done by the running ones, over the total. The audio pass and the final concat are fast (< 2 % of the time
// together), so they only get a small fixed weight each, so the bar doesn't sit at 100 % while they run.

/** Weight of the audio pass and of the concat step, each as a fraction of the video frames. */
export const AUDIO_PROGRESS_WEIGHT = 0.01;
export const CONCAT_PROGRESS_WEIGHT = 0.01;

export interface RenderProgress {
  /** `ratio` (0–1) of chunk `index`: what runFfmpegWithProgress reports (time / duration), turned into frames. */
  setChunk: (index: number, ratio: number) => void,
  setAudio: (ratio: number) => void,
  setConcat: (ratio: number) => void,
  /** Current overall progress (0–1). */
  get: () => number,
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * Tracks the progress of the steps of a job and calls `onProgress` with the overall value (0–1) when it changes.
 * Each step's progress only goes forward: ffmpeg's `time=` can go back a little at the start of a stream.
 */
export function createRenderProgress({ chunkFrames, onProgress }: {
  /** `frames` of each chunk step, in job order. */
  chunkFrames: number[],
  onProgress: (progress: number) => void,
}): RenderProgress {
  const totalFrames = chunkFrames.reduce((acc, f) => acc + f, 0);
  const audioWeight = Math.max(1, totalFrames * AUDIO_PROGRESS_WEIGHT);
  const concatWeight = Math.max(1, totalFrames * CONCAT_PROGRESS_WEIGHT);
  const total = totalFrames + audioWeight + concatWeight;

  const chunkDone = chunkFrames.map(() => 0);
  let audioDone = 0;
  let concatDone = 0;
  let last = -1;

  const get = () => (chunkDone.reduce((acc, f) => acc + f, 0) + audioDone + concatDone) / total;

  const emit = () => {
    const value = get();
    if (value === last) return;
    last = value;
    onProgress(value);
  };

  return {
    setChunk: (index, ratio) => {
      const frames = chunkFrames[index];
      if (frames == null) return;
      // whole frames: that's what ffmpeg has written (the ratio comes from `time=` of the frames written)
      chunkDone[index] = Math.max(chunkDone[index] ?? 0, Math.round(clamp01(ratio) * frames));
      emit();
    },
    setAudio: (ratio) => {
      audioDone = Math.max(audioDone, clamp01(ratio) * audioWeight);
      emit();
    },
    setConcat: (ratio) => {
      concatDone = Math.max(concatDone, clamp01(ratio) * concatWeight);
      emit();
    },
    get,
  };
}
