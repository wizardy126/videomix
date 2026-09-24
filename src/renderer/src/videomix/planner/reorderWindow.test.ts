import { describe, test, expect } from 'vitest';

import { getAspectRange, transposeAspectRange, transposeRect } from '../geometry';
import type { AspectRange } from '../geometry';
import { formatPlan } from './formatPlan';
import { planMix } from './planMix';
import { createRandom } from './random';
import { truncatePlan } from './truncatePlan';
import { getReorderWindowSize } from './types';
import type { MixPlan, PlanMixInput, PlannerClip, PlannerSettings } from './types';
import { validatePlan } from './validatePlan';

// E8 (T38c): reorder window without practical limit, or unlimited.

const range = (min: number, max: number, preferred = max): AspectRange => ({ min, max, preferred });
const rigid = (aspect: number) => range(aspect, aspect, aspect);

const settings = (overrides: Partial<PlannerSettings> = {}): PlannerSettings => ({
  width: 1920,
  height: 1080,
  maxColumns: 3,
  gap: 0,
  reorderWindow: 3,
  order: { mode: 'list', seed: 0 },
  transitionDuration: 0.5,
  ...overrides,
});

const clip = (id: string, duration: number, aspectRange: AspectRange, extra: Partial<PlannerClip> = {}): PlannerClip => ({ id, duration, aspectRange, ...extra });

function plan(input: PlanMixInput) {
  const result = planMix(input);
  expect(validatePlan(result, input)).toEqual([]);
  return result;
}

const fillOf = (p: MixPlan, i: number) => p.layouts[i]!.fills.reduce((acc, f) => acc + f.width, 0);
const startOrder = (p: MixPlan) => p.placements.map((pl) => pl.clipId);

describe('reorder window size', () => {
  test('unlimited is an infinite window', () => {
    expect(getReorderWindowSize('unlimited')).toBe(Infinity);
    expect(getReorderWindowSize(0)).toBe(0);
    expect(getReorderWindowSize(250)).toBe(250);
  });
});

describe('a clip that fits far away in the list', () => {
  // 40 rigid 9:16 clips: three of them leave 96 px of fill (3 × 608 of 1920). Only c35 (704 px wide) fills the frame
  // next to two of them, and it is far beyond the window and the pruned candidates (18 with 3 columns).
  const FAR = 'c35';
  const fitting = rigid(704 / 1080);
  const clips = Array.from({ length: 40 }, (_v, i) => clip(`c${i}`, 6 + (i % 5), i === 35 ? fitting : rigid(9 / 16)));

  test('16:9: it removes the fill of the first row only with a big or unlimited window', () => {
    for (const reorderWindow of [0, 3, 10, 20] as const) {
      const p = plan({ clips, settings: settings({ reorderWindow }) });
      expect(fillOf(p, 0)).toBe(96);
      expect(p.placements.find((pl) => pl.clipId === FAR)!.startTime).toBeGreaterThan(0);
    }
    for (const reorderWindow of [40, 1000, 'unlimited'] as const) {
      const p = plan({ clips, settings: settings({ reorderWindow }) });
      expect(p.layouts[0]!.columns.map((c) => c.width)).toEqual([608, 608, 704]);
      expect(fillOf(p, 0)).toBe(0);
      expect(startOrder(p).slice(0, 3)).toEqual(['c0', 'c1', FAR]);
      // the other clips keep the list order (they are all alike)
      expect(startOrder(p).filter((id) => id !== FAR)).toEqual(clips.map((c) => c.id).filter((id) => id !== FAR));
    }
  });

  test('9:16: the same with rows', () => {
    const transposed = clips.map((c) => ({ ...c, aspectRange: transposeAspectRange(c.aspectRange) }));
    const small = plan({ clips: transposed, settings: settings({ width: 1080, height: 1920 }) });
    expect(fillOf(small, 0)).toBe(96);
    const unlimited = plan({ clips: transposed, settings: settings({ width: 1080, height: 1920, reorderWindow: 'unlimited' }) });
    expect(unlimited.axis).toBe('rows');
    expect(unlimited.layouts[0]!.columns.map((c) => c.width)).toEqual([608, 608, 704]);
    expect(startOrder(unlimited).slice(0, 3)).toEqual(['c0', 'c1', FAR]);
  });

  test('the plan breaks a smaller window (validatePlan still checks it)', () => {
    const input = { clips, settings: settings({ reorderWindow: 'unlimited' }) };
    const p = plan(input);
    const issues = validatePlan(p, { ...input, settings: settings({ reorderWindow: 10 }) });
    expect(issues.some((issue) => issue.includes(`Clip ${FAR}`) && issue.includes('window 10'))).toBe(true);
  });
});

describe('list order among equally good options', () => {
  test('alike clips play in list order with an unlimited window', () => {
    for (const aspectRange of [rigid(16 / 9), rigid(9 / 16), range(9 / 16, 1, 9 / 16)]) {
      const clips = Array.from({ length: 60 }, (_v, i) => clip(`c${i}`, 4 + ((i * 7) % 9), aspectRange));
      for (const maxColumns of [1, 3, 6]) {
        const input = { clips, settings: settings({ maxColumns, reorderWindow: 'unlimited' }) };
        const p = plan(input);
        // as if the window were 0
        expect(validatePlan(p, { ...input, settings: settings({ maxColumns, reorderWindow: 0 }) })).toEqual([]);
      }
    }
  });

  test('a clip that fits nowhere waits for its place without disturbing the order of the others', () => {
    // a 16:9 clip first in the list, then verticals that fill the frame three at a time (3 × 640): with window 3 the
    // 16:9 clip is forced in early (re-layouts and fill around it); unlimited, it waits until the verticals run out
    const verticals = range(9 / 16, 640 / 1080, 640 / 1080);
    const clips = [clip('h', 10, rigid(16 / 9)), ...Array.from({ length: 12 }, (_v, i) => clip(`v${i}`, 8 + (i % 3), verticals))];
    const small = plan({ clips, settings: settings({ reorderWindow: 3 }) });
    expect(startOrder(small).indexOf('h')).toBe(3);
    const p = plan({ clips, settings: settings({ reorderWindow: 'unlimited' }) });
    expect(startOrder(p)).toEqual([...clips.slice(1).map((c) => c.id), 'h']);
    expect(p.layouts.filter((l) => l.time > 0 && l.time < 30)).toEqual([]);
  });
});

describe('properties with large and unlimited windows', () => {
  const presets = [rigid(16 / 9), rigid(9 / 16), range(9 / 16, 1, 9 / 16), range(0.8, 16 / 9), rigid(4 / 3), rigid(1), rigid(4 / 5), range(0.3, 3, 1), rigid(2.39)];

  function randomInput(seed: number, [width, height]: readonly [number, number]): PlanMixInput {
    const rnd = createRandom(seed);
    const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
    const pickOne = <T, >(items: readonly T[]) => items[int(0, items.length - 1)]!;
    const count = int(1, 60);
    const list = Array.from({ length: count }, (_v, i): PlannerClip => {
      const duration = rnd() < 0.15 ? 0.1 + rnd() * 1.2 : 1 + rnd() * 25;
      if (rnd() < 0.3) {
        const maxRect = { x: 0, y: 0, width: 2 * int(8, 1000), height: 2 * int(8, 1000) };
        const minRect = rnd() < 0.5 ? undefined : { x: 0, y: 0, width: 2 * int(8, maxRect.width / 2), height: 2 * int(8, maxRect.height / 2) };
        return { id: `c${i}`, duration, aspectRange: getAspectRange(maxRect, minRect), rects: { maxRect, minRect } };
      }
      return { id: `c${i}`, duration, aspectRange: pickOne(presets) };
    });
    const total = list.reduce((acc, c) => acc + c.duration, 0);
    // groups, pins, chains and a sequence (as in linksLimit.test.ts)
    for (let g = int(0, 3); g > 0; g -= 1) {
      for (let k = int(2, 3); k > 0; k -= 1) list[int(0, count - 1)]!.groupId = `g${g}`;
    }
    for (let p = int(0, 3); p > 0; p -= 1) list[int(0, count - 1)]!.pinTime = rnd() < 0.2 ? 0 : rnd() * total * 0.3;
    const ids = list.map((c) => c.id);
    const chains = Array.from({ length: int(0, 5) }, () => Array.from({ length: int(2, 5) }, () => pickOne(ids)));
    const sequence = rnd() < 0.5 ? [] : Array.from({ length: int(1, 4) }, () => pickOne(ids));
    const windowKind = rnd();
    return {
      clips: list,
      chains,
      sequence,
      settings: {
        width,
        height,
        maxColumns: int(1, 6),
        gap: pickOne([0, 0, 2, 4, 10, 3]),
        reorderWindow: windowKind < 0.6 ? 'unlimited' : int(11, 80),
        order: { mode: rnd() < 0.3 ? 'random' : 'list', seed: int(0, 1000) },
        transitionDuration: pickOne([0, 0.25, 0.5, 0.5, 1, 2]),
        linkTransition: rnd() < 0.5 ? 'cut' : 'global',
        ...(rnd() < 0.4 && { maxDuration: 1 + rnd() * total * 0.5 }),
      },
    };
  }

  test('random projects satisfy every invariant in the three output shapes, also cut at their limit', () => {
    for (const shape of [[1920, 1080], [1080, 1920], [1080, 1080]] as const) {
      for (let seed = 1; seed <= 80; seed += 1) {
        const input = randomInput(seed, shape);
        const result = planMix(input);
        const check = (p: MixPlan, what: string) => {
          const issues = validatePlan(p, input);
          if (issues.length > 0) throw new Error(`${shape.join('x')} seed ${seed} ${what}: ${issues.join('; ')}\n${formatPlan(p)}`);
        };
        check(result, 'plan');
        expect(planMix(input)).toEqual(result); // deterministic
        const { maxDuration } = input.settings;
        if (maxDuration != null) check(truncatePlan(result, maxDuration), `cut at ${maxDuration}`);
      }
    }
  }, 60_000);

  test('9:16: a rows plan is the columns plan of the transposed clips', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const input = randomInput(500 + seed, [1080, 1920]);
      const rows = planMix(input);
      const transposed = input.clips.map((c): PlannerClip => ({
        ...c,
        aspectRange: transposeAspectRange(c.aspectRange),
        ...(c.rects != null && { rects: { maxRect: transposeRect(c.rects.maxRect), minRect: c.rects.minRect && transposeRect(c.rects.minRect) } }),
      }));
      const columns = planMix({ ...input, clips: transposed, settings: { ...input.settings, width: 1920, height: 1080 } });
      expect(rows.placements).toEqual(columns.placements);
      expect(rows.layouts).toEqual(columns.layouts);
    }
  });

  test('200 clips with an unlimited window are planned in well under a second, also with pins, groups, chains and a limit', () => {
    const clips = Array.from({ length: 200 }, (_v, i) => clip(`c${i}`, 3 + (i % 11), presets[(i * 7) % presets.length]!));
    const busy = clips.map((c, i) => ({
      ...c,
      ...(i % 20 === 10 || i % 20 === 13 ? { groupId: `g${Math.floor(i / 20)}` } : {}),
      ...(i % 9 === 5 && i < 180 ? { pinTime: 15 + 40 * Math.floor(i / 9) } : {}),
    }));
    const chains = Array.from({ length: 20 }, (_v, k) => [`c${9 * k + 1}`, `c${9 * k + 2}`, `c${9 * k + 3}`]);
    for (const [width, height] of [[1920, 1080], [1080, 1920], [1080, 1080]] as const) {
      for (const maxColumns of [3, 6]) {
        const inputs: PlanMixInput[] = [
          { clips, settings: settings({ width, height, maxColumns, reorderWindow: 'unlimited' }) },
          { clips: busy, chains, sequence: ['c0', 'c100', 'c199'], settings: settings({ width, height, maxColumns, reorderWindow: 'unlimited', maxDuration: 400 }) },
        ];
        for (const input of inputs) {
          // best of 3: a single wall-clock sample is noisy when the whole suite runs in parallel
          let best = Infinity;
          let result = planMix(input);
          for (let attempt = 0; attempt < 3 && best >= 1000; attempt += 1) {
            const start = performance.now();
            result = planMix(input);
            best = Math.min(best, performance.now() - start);
          }
          expect(best).toBeLessThan(1000);
          expect(validatePlan(result, input)).toEqual([]);
        }
      }
    }
  }, 90_000);
});
