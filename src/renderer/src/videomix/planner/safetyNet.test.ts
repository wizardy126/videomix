import { describe, test, expect } from 'vitest';

import { getAspectRange } from '../geometry';
import type { Rect } from '../types';
import { formatPlan } from './formatPlan';
import { comparePlanQuality, getSafetyNetWindows, planMix, planMixAxis, planMixBest } from './planMix';
import type { PlanQuality } from './planMix';
import { createRandom } from './random';
import type { PlanMixInput, PlanPriority, PlannerClip, PlannerSettings } from './types';
import { validatePlan } from './validatePlan';

// G1/G2 (T52): due clips with a large window, and the safety net over several reorder windows.

const settings = (overrides: Partial<PlannerSettings> = {}): PlannerSettings => ({
  width: 1920,
  height: 1080,
  maxColumns: 3,
  gap: 0,
  reorderWindow: 'unlimited',
  order: { mode: 'list', seed: 0 },
  transitionDuration: 0.5,
  ...overrides,
});

const clipOf = (id: string, duration: number, maxRect: Rect, minRect?: Rect): PlannerClip => ({
  id, duration, aspectRange: getAspectRange(maxRect, minRect), rects: { maxRect, minRect },
});

const quality = (duration: number, fill: number, order = 0, relayouts = 0): PlanQuality => ({ duration, fill, order, relayouts });

describe('comparePlanQuality', () => {
  test('duration priority: duration, then fill, list order and re-layouts', () => {
    expect(comparePlanQuality(quality(50, 9), quality(51, 0))).toBeLessThan(0);
    expect(comparePlanQuality(quality(50, 1), quality(50, 2))).toBeLessThan(0);
    expect(comparePlanQuality(quality(50, 1, 3), quality(50, 1, 4, 0))).toBeLessThan(0);
    expect(comparePlanQuality(quality(50, 1, 3, 2), quality(50, 1, 3, 1))).toBeGreaterThan(0);
    expect(comparePlanQuality(quality(50, 1, 3, 2), quality(50, 1, 3, 2))).toBe(0);
    // almost the same duration (under two frames): the fill decides
    expect(comparePlanQuality(quality(50.01, 1), quality(50, 2), 'duration')).toBeLessThan(0);
  });

  test('fill priority: fill, then duration, list order and re-layouts', () => {
    expect(comparePlanQuality(quality(60, 1), quality(50, 2), 'fill')).toBeLessThan(0);
    expect(comparePlanQuality(quality(49, 2), quality(50, 2), 'fill')).toBeLessThan(0);
    expect(comparePlanQuality(quality(50, 2.001, 1), quality(50, 2, 2), 'fill')).toBeLessThan(0);
  });
});

describe('safety net windows', () => {
  test('the settings\' window first, then the smaller ones of 10, 3 and 0', () => {
    expect(getSafetyNetWindows({ reorderWindow: 'unlimited' })).toEqual(['unlimited', 10, 3, 0]);
    expect(getSafetyNetWindows({ reorderWindow: 40 })).toEqual([40, 10, 3, 0]);
    expect(getSafetyNetWindows({ reorderWindow: 10 })).toEqual([10, 3, 0]);
    expect(getSafetyNetWindows({ reorderWindow: 5 })).toEqual([5, 3, 0]);
    expect(getSafetyNetWindows({ reorderWindow: 3 })).toEqual([3, 0]);
    expect(getSafetyNetWindows({ reorderWindow: 0 })).toEqual([0]);
    expect(getSafetyNetWindows({ reorderWindow: 'unlimited', bestOfWindows: false })).toEqual(['unlimited']);
  });
});

describe('the cause (G1): a large window left the clips that fit badly for the end', () => {
  // A real case from the benchmark (T52's notes): 11 clips of 16:9 and 9:16 sources, some with a min. With window 3
  // the plan lasts 54.5 s. With an unlimited window, before T52, the rigid c4 (23.9 s) was skipped again and again for
  // clips that fit the freed column better, from anywhere in the list, until it was the last one: it then played alone
  // for 20 s at the end (58.3 s). Now it becomes due while the others can still keep it company.
  const V = { x: 0, y: 0, width: 1080, height: 1920 };
  const clips = [
    clipOf('c0', 8.91, { x: 0, y: 0, width: 1080, height: 912 }, { x: 364, y: 184, width: 354, height: 544 }),
    clipOf('c1', 16.74, { x: 166, y: 364, width: 750, height: 1194 }),
    clipOf('c2', 22.9, V, { x: 318, y: 100, width: 446, height: 1720 }),
    clipOf('c3', 17.51, V, { x: 60, y: 448, width: 960, height: 1024 }),
    clipOf('c4', 23.93, { x: 52, y: 168, width: 976, height: 1584 }),
    clipOf('c5', 8.23, V),
    clipOf('c6', 5.47, V, { x: 318, y: 394, width: 444, height: 1134 }),
    clipOf('c7', 13.65, V, { x: 100, y: 476, width: 882, height: 970 }),
    clipOf('c8', 5.66, { x: 0, y: 0, width: 1080, height: 1822 }, { x: 192, y: 134, width: 698, height: 1556 }),
    clipOf('c9', 8.86, V, { x: 90, y: 408, width: 902, height: 1106 }),
    clipOf('c10', 9.85, { x: 204, y: 382, width: 672, height: 1156 }),
  ];
  const endOf = (p: ReturnType<typeof planMix>, id: string) => p.placements.find((pl) => pl.clipId === id)!.endTime;

  test('the long clip starts before the others run out, and the video is shorter than with window 3', () => {
    const small = planMix({ clips, settings: settings({ reorderWindow: 3, bestOfWindows: false }) });
    const input = { clips, settings: settings({ bestOfWindows: false }) };
    const p = planMix(input);
    expect(validatePlan(p, input)).toEqual([]);
    expect(p.duration).toBeLessThan(small.duration - 4);
    // no clip plays alone for long at the end
    const lastButOne = Math.max(...p.placements.filter((pl) => pl.endTime < p.duration - 1e-6).map((pl) => pl.endTime));
    expect(p.duration - lastButOne).toBeLessThan(3);
    expect(endOf(p, 'c4')).toBeGreaterThan(p.duration - 1);
  });

  test('windows up to 10 plan as before (no due clips): there c4 still plays alone at the end', () => {
    const p = planMix({ clips, settings: settings({ reorderWindow: 10, bestOfWindows: false }) });
    expect(p.duration).toBeCloseTo(62.47, 2);
    expect(endOf(p, 'c4')).toBe(p.duration);
    // the safety net of an unlimited window doesn't pick it
    expect(planMixBest({ clips, settings: settings() }).reorderWindow).toBe('unlimited');
  });
});

// Realistic projects (as in the benchmark of T52's notes): 16:9 and 9:16 sources, the max the whole frame, a free crop
// or "fit to" a fraction, a min on some, durations from 1.5 to 25 s, chains and a sequence on some.
function realisticInput(seed: number, [width, height]: readonly [number, number]): PlanMixInput {
  const rnd = createRandom(seed);
  const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
  const even = (v: number) => 2 * Math.round(v / 2);
  const count = int(10, 40);
  const verticalShare = rnd();
  const clips = Array.from({ length: count }, (_v, i): PlannerClip => {
    const frame = rnd() < verticalShare ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
    let maxRect: Rect = { x: 0, y: 0, ...frame };
    const kind = rnd();
    if (kind < 0.3) {
      const w = even(frame.width * (0.4 + 0.6 * rnd()));
      const h = even(frame.height * (0.5 + 0.5 * rnd()));
      maxRect = { x: even((frame.width - w) / 2), y: even((frame.height - h) / 2), width: w, height: h };
    } else if (kind < 0.45) {
      const aspect = (1920 * [1 / 3, 1 / 2, 2 / 3][int(0, 2)]!) / 1080;
      const w = Math.min(frame.width, even(frame.height * aspect));
      maxRect = { x: even((frame.width - w) / 2), y: 0, width: w, height: w === frame.width ? even(w / aspect) : frame.height };
    }
    let minRect: Rect | undefined;
    if (rnd() < 0.4) {
      const w = even(maxRect.width * (0.3 + 0.6 * rnd()));
      const h = even(maxRect.height * (0.5 + 0.5 * rnd()));
      minRect = { x: maxRect.x + even((maxRect.width - w) / 2), y: maxRect.y + even((maxRect.height - h) / 2), width: w, height: h };
    }
    const duration = rnd() < 0.1 ? 1.5 + rnd() * 2 : 3 + rnd() * 22;
    return { ...clipOf(`c${i}`, duration, maxRect, minRect), extendBeyondMax: { frame } };
  });
  const chains: string[][] = [];
  if (rnd() < 0.5) {
    for (let i = 0; i < count - 3; i += 1) {
      if (rnd() < 0.12) {
        chains.push(clips.slice(i, i + 2).map((c) => c.id));
        i += 2;
      }
    }
  }
  const sequence = rnd() < 0.3 ? [clips[1]!.id, clips[count - 2]!.id] : [];
  return { clips, chains, sequence, settings: settings({ width, height, gap: rnd() < 0.5 ? 0 : 4 }) };
}

describe('the safety net (G1, G2)', () => {
  const shapes = [[1920, 1080], [1080, 1920], [1080, 1080]] as const;
  const priorities: PlanPriority[] = ['duration', 'fill'];

  test('an unlimited window is never worse than 10 or 3 by the project\'s priority, in the three output shapes', () => {
    const changed = { duration: 0, fill: 0 };
    for (const shape of shapes) {
      for (let seed = 1; seed <= 25; seed += 1) {
        const base = realisticInput(seed, shape);
        for (const priority of priorities) {
          const withWindow = (reorderWindow: PlannerSettings['reorderWindow']): PlanMixInput => ({ ...base, settings: { ...base.settings, reorderWindow, priority } });
          const input = withWindow('unlimited');
          const at = `${shape.join('x')} seed ${seed} ${priority}`;
          const best = planMixBest(input);
          const issues = validatePlan(best.plan, input);
          if (issues.length > 0) throw new Error(`${at}: ${issues.join('; ')}\n${formatPlan(best.plan)}`);
          expect(planMixBest(input), at).toEqual(best); // deterministic
          for (const smaller of [10, 3]) {
            expect(comparePlanQuality(best.quality, planMixBest(withWindow(smaller)).quality, priority), at).toBeLessThanOrEqual(0);
          }
          if (best.reorderWindow !== 'unlimited') changed[priority] += 1;
        }
      }
    }
    // the net does pick smaller windows now and then
    expect(changed.duration).toBeGreaterThan(3);
    expect(changed.fill).toBeGreaterThan(3);
  }, 60_000);

  test('the plan is the best of its candidates, and the one of the window it reports', () => {
    for (const shape of [[1920, 1080], [1080, 1920]] as const) {
      for (let seed = 100; seed < 115; seed += 1) {
        const base = realisticInput(seed, shape);
        for (const priority of priorities) {
          const input = { ...base, settings: { ...base.settings, priority } };
          const best = planMixBest(input);
          const axis = shape[0] > shape[1] ? 'columns' : 'rows';
          for (const reorderWindow of getSafetyNetWindows(input.settings)) {
            const candidate = planMixAxis({ ...input, settings: { ...input.settings, reorderWindow } }, axis);
            expect(comparePlanQuality(best.quality, candidate.quality, priority)).toBeLessThanOrEqual(0);
            if (reorderWindow === best.reorderWindow) expect(candidate.plan).toEqual(best.plan);
          }
        }
      }
    }
  }, 60_000);

  test('the priority changes the pick: shorter or with less fill', () => {
    let differ = 0;
    for (let seed = 200; seed < 230; seed += 1) {
      const base = realisticInput(seed, [1920, 1080]);
      const byDuration = planMixBest({ ...base, settings: { ...base.settings, priority: 'duration' } });
      const byFill = planMixBest({ ...base, settings: { ...base.settings, priority: 'fill' } });
      expect(byDuration.quality.duration).toBeLessThanOrEqual(byFill.quality.duration + 0.05);
      expect(byFill.quality.fill).toBeLessThanOrEqual(byDuration.quality.fill + 0.01);
      if (byDuration.reorderWindow !== byFill.reorderWindow) differ += 1;
    }
    expect(differ).toBeGreaterThan(0);
  }, 30_000);

  test('without the net (or with a window of 0) it is the plan of the settings\' window', () => {
    const base = realisticInput(7, [1920, 1080]);
    const single = planMixAxis(base, 'columns').plan;
    expect(planMix({ ...base, settings: { ...base.settings, bestOfWindows: false } })).toEqual(single);
    const zero = { ...base, settings: { ...base.settings, reorderWindow: 0 } };
    expect(planMixBest(zero)).toMatchObject({ reorderWindow: 0, plan: planMixAxis(zero, 'columns').plan });
  });
});
