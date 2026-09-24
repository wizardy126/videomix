import { describe, test, expect } from 'vitest';

import type { EtaSample, RenderEtaState } from './renderEta';
import { ETA_WINDOW_MS, addRenderEtaSample, createRenderEta, getRenderEtaRemainingMs, rebaseRenderEta } from './renderEta';

/** Feeds `samples` in order and returns the state. */
const feed = (samples: EtaSample[], state: RenderEtaState = createRenderEta()) => samples.reduce((acc, sample) => addRenderEtaSample(acc, sample), state);

/** A sample every `stepMs` from `from` to `to` (ms), with `progressAt(time)`. */
function samplesOver({ from, to, stepMs = 500, progressAt }: { from: number, to: number, stepMs?: number, progressAt: (time: number) => number }) {
  const samples: EtaSample[] = [];
  for (let time = from; time <= to; time += stepMs) samples.push({ time, progress: progressAt(time) });
  return samples;
}

describe('render ETA', () => {
  test('nothing until 3 s and 2 % since the baseline', () => {
    // 1 %/s: 2 % only at 2 s, 3 s at 3 %
    let state = feed(samplesOver({ from: 0, to: 2500, progressAt: (t) => t / 100_000 }));
    expect(getRenderEtaRemainingMs(state, 2500)).toBeUndefined();
    state = addRenderEtaSample(state, { time: 3000, progress: 0.03 });
    expect(getRenderEtaRemainingMs(state, 3000)).toBeCloseTo(97_000, -2);

    // 3 s but very slow (1 % in 3 s): still calculating
    const slow = feed(samplesOver({ from: 0, to: 3000, progressAt: (t) => t / 300_000 }));
    expect(getRenderEtaRemainingMs(slow, 3000)).toBeUndefined();
  });

  test('a steady render gets the exact remaining time, which counts down between events', () => {
    // 100 s render at 1 %/s
    const state = feed(samplesOver({ from: 0, to: 50_000, progressAt: (t) => t / 100_000 }));
    expect(getRenderEtaRemainingMs(state, 50_000)).toBeCloseTo(50_000, -2);
    expect(getRenderEtaRemainingMs(state, 50_400)).toBeCloseTo(49_600, -2);
    // never below 0
    expect(getRenderEtaRemainingMs(state, 500_000)).toBe(0);
  });

  test('irregular events (several ffmpegs, IPC bursts) keep it steady', () => {
    // 1 %/s, but the events come in bursts: several at once, then nothing for up to 1.5 s
    const times = [0, 10, 20, 1500, 1510, 2000, 3500, 3505, 3510, 4000, 5500, 6000, 6010, 7500, 8000, 8005, 9500, 10_000, 11_500, 11_505];
    let state = createRenderEta();
    const estimates: number[] = [];
    for (const time of times) {
      state = addRenderEtaSample(state, { time, progress: time / 100_000 });
      const remaining = getRenderEtaRemainingMs(state, time);
      if (remaining != null) estimates.push(remaining + time);
    }
    // the estimated end stays at ≈ 100 s
    expect(estimates.length).toBeGreaterThan(5);
    for (const end of estimates) expect(Math.abs(end - 100_000)).toBeLessThan(5000);
  });

  test('is smoothed: a change of speed moves it gradually', () => {
    // 1 %/s for 30 s, then 4× slower
    const fast = samplesOver({ from: 0, to: 30_000, progressAt: (t) => t / 100_000 });
    const slow = samplesOver({ from: 30_500, to: 80_000, progressAt: (t) => 0.3 + (t - 30_000) / 400_000 });
    let state = feed(fast);
    let previousEnd = getRenderEtaRemainingMs(state, 30_000)! + 30_000;
    expect(previousEnd).toBeCloseTo(100_000, -3);
    let maxJump = 0;
    for (const sample of slow) {
      state = addRenderEtaSample(state, sample);
      const end = getRenderEtaRemainingMs(state, sample.time)! + sample.time;
      maxJump = Math.max(maxJump, Math.abs(end - previousEnd));
      previousEnd = end;
    }
    // no single event moves the estimated end by more than a small part of the whole change…
    expect(maxJump).toBeLessThan((previousEnd - 100_000) / 10);
    // …and once the window only has the slow part, it's right: 0.3 + 50 s / 400 s = 42.5 %, 57.5 % left at 0.25 %/s
    expect(getRenderEtaRemainingMs(state, 80_000)).toBeCloseTo(230_000, -4);
  });

  test('cached blocks done at once before the baseline don\'t make it optimistic', () => {
    // Checking the cache takes 5 s, then 60 % is done at once (the cached blocks) and the remaining 40 % take 40 s
    const jump = [{ time: 0, progress: 0 }, { time: 5000, progress: 0.3 }, { time: 5000, progress: 0.6 }];
    const rendering = samplesOver({ from: 5500, to: 10_000, progressAt: (t) => 0.6 + (t - 5000) / 100_000 });

    // the render rebases when the first ffmpeg starts, after the cached blocks: 5 % done in 5 s, 35 % left
    const rebased = feed(rendering, rebaseRenderEta({ time: 5000, progress: 0.6 }));
    expect(getRenderEtaRemainingMs(rebased, 10_000)).toBeCloseTo(35_000, -3);
    // not enough data right after the baseline, even with 60 % done
    expect(getRenderEtaRemainingMs(feed(rendering.slice(0, 3), rebaseRenderEta({ time: 5000, progress: 0.6 })), 6500)).toBeUndefined();

    // not rebased, the jump would count as speed
    const naive = feed([...jump, ...rendering]);
    expect(getRenderEtaRemainingMs(naive, 10_000)).toBeLessThan(10_000);
  });

  test('the start-up of the first ffmpegs doesn\'t weigh on it for long', () => {
    // ≈ 3 s of start-up with little progress, then 9 %/s up to the end at 14 s
    const samples = samplesOver({ from: 0, to: 14_000, stepMs: 250, progressAt: (t) => (t < 1200 ? 0 : Math.min(1, 0.01 + Math.max(0, t - 3000) * 0.00009)) });
    let state = createRenderEta();
    for (const sample of samples) {
      state = addRenderEtaSample(state, sample);
      const remaining = getRenderEtaRemainingMs(state, sample.time);
      // 5 s into the actual work (8 s in), within 20 % (or 1 s) of the real remaining time
      if (sample.time >= 8000) expect(Math.abs(remaining! - (14_000 - sample.time))).toBeLessThan(Math.max(1000, (14_000 - sample.time) * 0.2));
    }
  });

  test('only the last window counts for the rate', () => {
    // slow for 60 s, then 2 %/s: after a full window of the fast part, the slow start doesn't matter any more
    const slow = samplesOver({ from: 0, to: 60_000, progressAt: (t) => t / 600_000 });
    const fast = samplesOver({ from: 60_500, to: 60_000 + ETA_WINDOW_MS + 15_000, progressAt: (t) => 0.1 + (t - 60_000) / 50_000 });
    const state = feed([...slow, ...fast]);
    const now = fast.at(-1)!.time;
    const left = 1 - fast.at(-1)!.progress;
    // smoothed, so within a few % of the exact value
    expect(getRenderEtaRemainingMs(state, now)! / (left * 50_000)).toBeCloseTo(1, 1);
    // the window's samples are all that's kept
    expect(state.samples.length).toBeLessThanOrEqual(ETA_WINDOW_MS / 500 + 2);
  });

  test('progress going backwards starts over', () => {
    const state = feed([
      ...samplesOver({ from: 0, to: 10_000, progressAt: (t) => t / 100_000 }),
      // e.g. the hardware encoder failed and it starts again with software
      { time: 11_000, progress: 0 },
    ]);
    expect(state.baseline).toEqual({ time: 11_000, progress: 0 });
    expect(getRenderEtaRemainingMs(state, 11_000)).toBeUndefined();
  });

  test('done means nothing left', () => {
    const state = feed([{ time: 0, progress: 0 }, { time: 100, progress: 1 }]);
    expect(getRenderEtaRemainingMs(state, 100)).toBe(0);
  });
});
