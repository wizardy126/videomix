import { describe, test, expect } from 'vitest';

import { createRenderProgress } from './renderProgress';

describe('createRenderProgress', () => {
  test('weights the chunks by their frames', () => {
    const values: number[] = [];
    const progress = createRenderProgress({ chunkFrames: [100, 300], onProgress: (p) => values.push(p) });
    // total = 400 frames + 4 (audio, 1 %) + 4 (concat, 1 %)
    progress.setChunk(1, 0.5);
    expect(progress.get()).toBeCloseTo(150 / 408);
    progress.setChunk(0, 1);
    expect(progress.get()).toBeCloseTo(250 / 408);
    progress.setAudio(1);
    progress.setChunk(1, 1);
    expect(progress.get()).toBeCloseTo(404 / 408);
    progress.setConcat(1);
    expect(progress.get()).toBe(1);
    expect(values.at(-1)).toBe(1);
  });

  test('turns the time ratio into whole frames', () => {
    const progress = createRenderProgress({ chunkFrames: [30], onProgress: () => undefined });
    progress.setChunk(0, 0.51); // 15.3 frames
    expect(progress.get() * (30 + 1 + 1)).toBeCloseTo(15);
  });

  test('never goes back, ignores bad values and only reports changes', () => {
    const values: number[] = [];
    const progress = createRenderProgress({ chunkFrames: [100], onProgress: (p) => values.push(p) });
    progress.setChunk(0, 0.5);
    progress.setChunk(0, 0.2);
    progress.setChunk(0, Number.NaN);
    progress.setChunk(0, 0.5);
    progress.setChunk(5, 1); // unknown chunk
    expect(values).toEqual([50 / 102]);
    progress.setChunk(0, 7);
    expect(progress.get()).toBeCloseTo(100 / 102);
  });

  test('without chunks, audio and concat still reach 1', () => {
    const progress = createRenderProgress({ chunkFrames: [], onProgress: () => undefined });
    progress.setAudio(1);
    expect(progress.get()).toBe(0.5);
    progress.setConcat(1);
    expect(progress.get()).toBe(1);
  });
});
