import { describe, test, expect } from 'vitest';

import { getAspectRange } from '../geometry';
import type { AspectRange } from '../geometry';
import { formatPlan } from './formatPlan';
import { comparePlanQuality, planMix, planMixBest } from './planMix';
import { createRandom } from './random';
import type { MixPlan, PlanMixInput, PlanPriority, PlannerClip, PlannerSettings } from './types';
import { validatePlan } from './validatePlan';

// I1 (T60): the planner weighs the complements the pending clips will need (04-diseno §3.11).

const settings = (overrides: Partial<PlannerSettings> = {}): PlannerSettings => ({
  width: 1920,
  height: 1080,
  maxColumns: 3,
  gap: 0,
  reorderWindow: 'unlimited',
  order: { mode: 'list', seed: 0 },
  transitionDuration: 0.5,
  // the planner with this one window (the safety net is tested in safetyNet.test.ts)
  bestOfWindows: false,
  ...overrides,
});

const range = (min: number, max: number, preferred = max): AspectRange => ({ min, max, preferred });
const rigid = (aspect: number) => range(aspect, aspect, aspect);
const clip = (id: string, duration: number, aspectRange: AspectRange, extra: Partial<PlannerClip> = {}): PlannerClip => ({ id, duration, aspectRange, ...extra });

/** "Fit to" a fraction of the 16:9 output (F2): 1/3, 1/2 or 2/3 of its width. */
const fraction = (f: number) => rigid((1920 * f) / 1080);
const THIRD = fraction(1 / 3);
const HALF = fraction(1 / 2);
const TWO_THIRDS = fraction(2 / 3);
const H169_NARROW = range(3 / 4, 16 / 9);
const range0 = (n: number) => Array.from({ length: n }, (_v, i) => i);

function plan(input: PlanMixInput) {
  const result = planMix(input);
  const issues = validatePlan(result, input);
  if (issues.length > 0) throw new Error(`${issues.join('; ')}\n${formatPlan(result)}`);
  return result;
}

const firstRow = (p: MixPlan) => p.placements.filter((pl) => pl.startTime === 0).map((pl) => pl.clipId);

/** 2/3 clips (ids starting with `c`) that play alone (nothing else on screen) more than half of their time. */
function lonelyTwoThirds(p: MixPlan) {
  return p.placements.filter((pl) => pl.clipId.startsWith('c')).filter((pl) => {
    const others = p.placements
      .filter((o) => o !== pl && o.startTime < pl.endTime && o.endTime > pl.startTime)
      .map((o) => [Math.max(o.startTime, pl.startTime), Math.min(o.endTime, pl.endTime)] as const)
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let reached = pl.startTime;
    others.forEach(([a, b]) => {
      const from = Math.max(a, reached);
      if (b > from) {
        covered += b - from;
        reached = b;
      }
    });
    return covered < (pl.endTime - pl.startTime) / 2;
  }).length;
}

describe('dependents and scarce partners', () => {
  test('a 2/3 clip gets a 1/3 partner instead of three 1/3 clips sharing the row', () => {
    // 1/3 clips first in the list, as many 2/3 ones as 1/3 ones: before T60 the three 1/3 clips took the first row
    // (it has no fill, and list order broke the tie with 2/3 + 1/3)
    const clips = [...['a0', 'a1', 'a2', 'a3'].map((id) => clip(id, 8, THIRD)), ...['c4', 'c5', 'c6', 'c7'].map((id) => clip(id, 8, TWO_THIRDS))];
    const p = plan({ clips, settings: settings() });
    expect(firstRow(p).sort()).toEqual(['a0', 'c4']);
    expect(lonelyTwoThirds(p)).toBe(0);
  });

  test('with partners to spare (many more 1/3 clips than 2/3 ones), the list order still decides', () => {
    const clips = [...range0(9).map((i) => clip(`a${i}`, 8, THIRD)), clip('c9', 8, TWO_THIRDS)];
    const p = plan({ clips, settings: settings() });
    expect(firstRow(p)).toEqual(['a0', 'a1', 'a2']);
  });

  test('clips that pair among themselves (1/2 + 1/2) are not taken away from each other', () => {
    // two 1/2 clips (only partners of each other) and 1/3 clips: the halves share the row
    const clips = [clip('a0', 8, THIRD), clip('b1', 8, HALF), clip('a2', 8, THIRD), clip('b3', 8, HALF), clip('a4', 8, THIRD)];
    const p = plan({ clips, settings: settings() });
    const b1 = p.placements.find((pl) => pl.clipId === 'b1')!;
    const b3 = p.placements.find((pl) => pl.clipId === 'b3')!;
    expect(b1.startTime).toBe(b3.startTime);
  });

  test('a full-screen clip that is the only partner of another shares the row (the balanced columns give way)', () => {
    // T10b alone puts h0 at full screen (sharing would crop 56 % of it) and then the square plays alone with 840 px
    // of fill; h0 is the square's only partner, so now they share the row (see planMix.test.ts for the other case)
    const p = plan({ clips: [clip('h0', 10, H169_NARROW), clip('s1', 10, rigid(1))], settings: settings() });
    expect(p.layouts[0]!.columns.map((c) => c.width)).toEqual([840, 1080]);
    expect(p.duration).toBe(10);
  });

  test('a small window doesn\'t save partners for dependents it can\'t reach yet', () => {
    // with window 3, twelve 1/3 clips must start before the 2/3 ones can: three of them share the row, as before
    const clips = [...range0(12).map((i) => clip(`a${i}`, 8, THIRD)), ...range0(4).map((i) => clip(`c${12 + i}`, 8, TWO_THIRDS))];
    const p = plan({ clips, settings: settings({ reorderWindow: 3 }) });
    expect(firstRow(p)).toEqual(['a0', 'a1', 'a2']);
  });
});

// The user's case (01-requisitos §15): 40 clips "fit to" 1/3 (16), 1/2 (6) and 2/3 (18) of the output, from 16:9 and
// 9:16 sources, with realistic durations. `blocks` is the order that made the 1/3 clips share the row in threes.
const FRACTIONS = { a: 1 / 3, b: 1 / 2, c: 2 / 3 } as const;
function userCase(seed: number, order: 'blocks' | 'shuffled'): PlanMixInput {
  const rnd = createRandom(seed);
  const even = (v: number) => 2 * Math.round(v / 2);
  const repeat = <T, >(item: T, n: number) => Array.from({ length: n }, () => item);
  let kinds = [...repeat('a' as const, 16), ...repeat('b' as const, 6), ...repeat('c' as const, 18)];
  if (order === 'shuffled') kinds = kinds.map((k) => ({ k, key: rnd() })).sort((x, y) => x.key - y.key).map(({ k }) => k);
  const clips = kinds.map((kind, i): PlannerClip => {
    const duration = rnd() < 0.15 ? 2 + rnd() * 3 : 4 + rnd() * 16;
    const frame = rnd() < 0.5 ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
    const aspect = (1920 * FRACTIONS[kind]) / 1080;
    let [w, h] = [even(frame.height * aspect), frame.height];
    if (w > frame.width) [w, h] = [frame.width, even(frame.width / aspect)];
    const maxRect = { x: even((frame.width - w) / 2), y: even((frame.height - h) / 2), width: w, height: h };
    return { id: `${kind}${i}`, duration, aspectRange: getAspectRange(maxRect), rects: { maxRect }, extendBeyondMax: { frame } };
  });
  return { clips, settings: settings() };
}

describe('the user\'s case (I1)', () => {
  test('1/3 clips in a block: the 2/3 clips get them as partners', () => {
    // measured with the planner before T60 (same input): 236.1 s, 39.8 of fill, 7 lonely 2/3 clips. The reference
    // (2/3 clips always paired, halves together, ignoring durations) is about 213 s
    const input = userCase(1, 'blocks');
    const p = plan(input);
    expect(p.duration).toBeLessThan(215);
    expect(lonelyTwoThirds(p)).toBeLessThanOrEqual(1);
    const { quality } = planMixBest(input);
    expect(quality.fill).toBeLessThan(10);
  });

  test('window 10 also improves (before T60: 248.9 s, 46.3 of fill)', () => {
    const input = userCase(1, 'blocks');
    const { quality } = planMixBest({ ...input, settings: { ...input.settings, reorderWindow: 10 } });
    expect(quality.duration).toBeLessThan(240);
    expect(quality.fill).toBeLessThan(35);
  });

  test('every order, window and priority: valid, deterministic, and unlimited never worse than 10 or 3', () => {
    const priorities: PlanPriority[] = ['duration', 'fill'];
    for (const order of ['blocks', 'shuffled'] as const) {
      for (let seed = 1; seed <= 3; seed += 1) {
        const base = userCase(seed, order);
        for (const priority of priorities) {
          const at = (reorderWindow: PlannerSettings['reorderWindow']): PlanMixInput => ({ ...base, settings: { ...base.settings, reorderWindow, priority, bestOfWindows: true } });
          const best = planMixBest(at('unlimited'));
          expect(validatePlan(best.plan, at('unlimited')), `${order} ${seed} ${priority}`).toEqual([]);
          expect(planMixBest(at('unlimited'))).toEqual(best);
          for (const smaller of [10, 3]) {
            expect(comparePlanQuality(best.quality, planMixBest(at(smaller)).quality, priority)).toBeLessThanOrEqual(0);
          }
        }
      }
    }
  }, 60_000);
});

describe('constraints still hold with scarce partners', () => {
  // fraction clips (so partners run short) with pins, groups, chains, a sequence and a limit
  function randomInput(seed: number): PlanMixInput {
    const rnd = createRandom(seed);
    const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
    const count = int(4, 40);
    const shapes = [THIRD, THIRD, TWO_THIRDS, TWO_THIRDS, TWO_THIRDS, HALF, H169_NARROW, rigid(1)];
    const plain = Array.from({ length: count }, (_v, i): PlannerClip => clip(`c${i}`, rnd() < 0.1 ? 0.3 + rnd() : 2 + rnd() * 18, shapes[int(0, shapes.length - 1)]!));
    const total = plain.reduce((acc, c) => acc + c.duration, 0);
    const clips = plain.map((c, i): PlannerClip => {
      const kind = rnd();
      if (kind < 0.08) return { ...c, pinTime: rnd() * total * 0.4 };
      if (i > 0 && kind < 0.16) return { ...c, groupId: `g${int(0, 2)}` };
      return c;
    });
    const loose = clips.filter((c) => c.pinTime == null && c.groupId == null).map((c) => c.id);
    const chains = rnd() < 0.5 && loose.length > 4 ? [[loose[1]!, loose[2]!]] : [];
    const sequence = rnd() < 0.3 && loose.length > 6 ? [loose[4]!, loose[5]!] : [];
    return {
      clips,
      chains,
      sequence,
      settings: settings({
        maxColumns: int(2, 4),
        reorderWindow: [0, 1, 3, 10, 25, 'unlimited' as const][int(0, 5)]!,
        gap: [0, 4][int(0, 1)]!,
        ...(rnd() < 0.3 && { maxDuration: total / 4 }),
        bestOfWindows: rnd() < 0.5,
      }),
    };
  }

  test('random projects satisfy every invariant and are deterministic', () => {
    for (let seed = 1; seed <= 150; seed += 1) {
      const input = randomInput(seed);
      const p = planMix(input);
      const issues = validatePlan(p, input);
      if (issues.length > 0) throw new Error(`seed ${seed}: ${issues.join('; ')}\n${formatPlan(p)}`);
      expect(planMix(input)).toEqual(p);
    }
  }, 60_000);
});
