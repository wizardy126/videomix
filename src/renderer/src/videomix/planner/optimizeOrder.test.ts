import { describe, test, expect } from 'vitest';

import { getAspectRange } from '../geometry';
import { comparePlanQuality, planMixBest } from './planMix';
import { createOrderOptimizer, getEmptyColumnTime, getFixedClipIds, getOptimizeOrderBlocker, optimizeOrder } from './optimizeOrder';
import { createRandom } from './random';
import type { MixPlan, PlanMixInput, PlannerClip, PlannerSettings } from './types';
import { validatePlan } from './validatePlan';

// I2 (T61): "Optimize mix", a search over the list order with the real planner.

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

/** A clip whose max is exactly a fraction of a 1920×1080 frame ("Fit to 1/3", "1/2", "2/3"), without a min. */
const fraction = (id: string, width: number, duration: number): PlannerClip => {
  const maxRect = { x: 0, y: 0, width, height: 1080 };
  return { id, duration, aspectRange: getAspectRange(maxRect), rects: { maxRect } };
};

/**
 * The user's case (01-requisitos §15): 40 clips, 16 of 1/3, 6 of 1/2 and 18 of 2/3, with the list grouped by type.
 * The 1/3 clips are the only partners of the 2/3 ones, but the planner pairs them among themselves.
 */
function userCase(reorderWindow: PlannerSettings['reorderWindow'] = 'unlimited'): PlanMixInput {
  const random = createRandom(7);
  const duration = () => Math.round((4 + random() * 12) * 10) / 10;
  return {
    clips: [
      ...Array.from({ length: 16 }, (_, i) => fraction(`third${i}`, 640, duration())),
      ...Array.from({ length: 6 }, (_, i) => fraction(`half${i}`, 960, duration())),
      ...Array.from({ length: 18 }, (_, i) => fraction(`twoThirds${i}`, 1280, duration())),
    ],
    settings: settings({ reorderWindow }),
  };
}

const reordered = (input: PlanMixInput, order: string[]): PlanMixInput => ({ ...input, clips: order.map((id) => input.clips.find((clip) => clip.id === id)!) });

describe('optimizeOrder', () => {
  test('the user\'s case with a window of 10: clearly better than the normal plan', () => {
    const input = userCase(10);
    const result = optimizeOrder(input, { steps: 300 });
    const before = planMixBest(input).quality;
    const after = planMixBest(reordered(input, result.order));
    expect(result.initial).toMatchObject(before);
    expect(after.quality).toMatchObject({ duration: result.quality.duration, fill: result.quality.fill });
    expect(validatePlan(after.plan, reordered(input, result.order))).toEqual([]);
    // by the project's priority (duration), and clearly: much shorter and with much less fill
    expect(comparePlanQuality(after.quality, before)).toBeLessThan(0);
    expect(after.quality.duration).toBeLessThan(before.duration * 0.9);
    expect(after.quality.fill).toBeLessThan(before.fill * 0.5);
  }, 120_000);

  test('the user\'s case with an unlimited window: never worse, in either metric', () => {
    // I1 (T60) already pairs the 1/3 and 2/3 clips with an unlimited window, so there is less left to gain here
    const input = userCase();
    const result = optimizeOrder(input, { steps: 150 });
    expect(comparePlanQuality(result.quality, result.initial)).toBeLessThanOrEqual(0);
    expect(result.quality.fill).toBeLessThanOrEqual(result.initial.fill + 0.005);
    expect(result.quality).toMatchObject(planMixBest(reordered(input, result.order)).quality);
  }, 120_000);

  test('the fill priority: less fill, never longer', () => {
    const input = userCase(10);
    input.settings.priority = 'fill';
    const result = optimizeOrder(input, { steps: 100 });
    expect(result.quality.fill).toBeLessThan(result.initial.fill);
    expect(result.quality.duration).toBeLessThanOrEqual(result.initial.duration + 0.025);
  }, 120_000);

  test('deterministic given the seed; a permutation of the clips', () => {
    const input = userCase(3);
    const a = optimizeOrder(input, { steps: 40, seed: 5 });
    const b = optimizeOrder(input, { steps: 40, seed: 5 });
    expect(a).toEqual(b);
    expect([...a.order].sort()).toEqual(input.clips.map((clip) => clip.id).sort());
  }, 60_000);

  test('respects the reorder window and keeps pinned and sequence clips in place', () => {
    const base = userCase(2);
    const clips = base.clips.map((clip, i) => {
      if (i === 5) return { ...clip, pinTime: 20 };
      if (i === 30 || i === 31) return { ...clip, groupId: 'g' };
      return clip;
    });
    const input: PlanMixInput = { ...base, clips, sequence: [clips[10]!.id], chains: [[clips[20]!.id, clips[25]!.id]] };
    expect(getFixedClipIds(input)).toEqual(new Set([clips[10]!.id, clips[5]!.id]));

    const optimizer = createOrderOptimizer(input, { seed: 3 });
    const initialIds = clips.map((clip) => clip.id);
    for (let i = 0; i < 6; i += 1) {
      optimizer.step(10);
      const { order } = optimizer.getBest();
      const chainStart = order.indexOf(clips[20]!.id);
      // the window applies to the chain as a unit (its earliest member, T63), not to each of its clips
      expect(Math.abs(chainStart - initialIds.indexOf(clips[20]!.id))).toBeLessThanOrEqual(2);
      // E2 (T63): the chain stays contiguous and in chain order wherever it moves
      expect(order[chainStart + 1]).toBe(clips[25]!.id);
      order.forEach((id, position) => {
        if (id === clips[25]!.id) return;
        expect(Math.abs(position - initialIds.indexOf(id))).toBeLessThanOrEqual(2);
      });
      expect(order[5]).toBe(clips[5]!.id);
      expect(order[10]).toBe(clips[10]!.id);
    }
    const { order, quality } = optimizer.getBest();
    expect(order).not.toEqual(initialIds);
    // with the constraints, the plan is still valid
    const best = reordered(input, order);
    expect(validatePlan(planMixBest(best).plan, best)).toEqual([]);
    expect(comparePlanQuality(quality, optimizer.initial)).toBeLessThan(0);
  }, 60_000);

  test('E2 (T63): chains scattered across the list stay contiguous, in chain order, after optimizing', () => {
    const base = userCase(10);
    const { clips } = base;
    // three chains, their members far apart in the list, like the bug report ("cadenas repartidas por la lista")
    const chains = [
      [clips[2]!.id, clips[37]!.id],
      [clips[5]!.id, clips[20]!.id, clips[33]!.id],
      [clips[15]!.id, clips[28]!.id],
    ];
    const input: PlanMixInput = { ...base, chains };

    const result = optimizeOrder(input, { steps: 80 });
    chains.forEach((chain) => {
      const start = result.order.indexOf(chain[0]!);
      expect(result.order.slice(start, start + chain.length)).toEqual(chain);
    });
    // the plan applied to the list must be the one evaluated during the search (Alcance #2)
    const best = reordered(input, result.order);
    const plan = planMixBest(best);
    expect(plan.quality).toMatchObject({ duration: result.quality.duration, fill: result.quality.fill });
    expect(validatePlan(plan.plan, best)).toEqual([]);
  }, 60_000);

  test('nothing to optimize: random order, window 0, fewer than two movable clips', () => {
    const input = userCase();
    expect(getOptimizeOrderBlocker(input)).toBeUndefined();
    expect(getOptimizeOrderBlocker({ ...input, settings: settings({ order: { mode: 'random', seed: 1 } }) })).toBe('random-order');
    expect(getOptimizeOrderBlocker({ ...input, settings: settings({ reorderWindow: 0 }) })).toBe('no-window');
    const two = input.clips.slice(0, 2);
    expect(getOptimizeOrderBlocker({ ...input, clips: two })).toBeUndefined();
    expect(getOptimizeOrderBlocker({ ...input, clips: two, sequence: [two[0]!.id] })).toBe('too-few-clips');

    const optimizer = createOrderOptimizer({ ...input, clips: two, sequence: [two[0]!.id] });
    optimizer.step(10);
    expect(optimizer.canMove).toBe(false);
    expect(optimizer.evaluations).toBe(1);
  });
});

describe('getEmptyColumnTime', () => {
  const layout = (time: number, columns: number[]) => ({ time, transitionDuration: 0, columns: columns.map((column, i) => ({ column, x: i * 640, width: 640 })), fills: [] });
  const placement = (clipId: string, column: number, startTime: number, endTime: number) => ({ clipId, column, startTime, endTime, transitionIn: 0 });

  test('the time some column of the layout has no clip, counted once', () => {
    const plan: Pick<MixPlan, 'duration' | 'layouts' | 'placements'> = {
      duration: 20,
      layouts: [layout(0, [0, 1, 2]), layout(8, [0, 1])],
      placements: [
        placement('a', 0, 0, 10),
        placement('b', 1, 0, 8), placement('c', 1, 8, 20),
        placement('d', 2, 0, 8),
        placement('e', 0, 9.5, 15),
      ],
    };
    // column 0: empty from 15 to 20; column 1 always busy
    expect(getEmptyColumnTime(plan)).toBeCloseTo(5);
    // a column that runs out at 6 while the others go on: 6 → 8 as well
    expect(getEmptyColumnTime({ ...plan, placements: plan.placements.map((p) => (p.clipId === 'd' ? { ...p, endTime: 6 } : p)) })).toBeCloseTo(7);
  });

  test('a full plan has none', () => {
    const input = userCase();
    const { plan } = planMixBest(input);
    expect(getEmptyColumnTime(plan)).toBeGreaterThanOrEqual(0);
    expect(getEmptyColumnTime({ duration: 10, layouts: [layout(0, [0])], placements: [placement('a', 0, 0, 10)] })).toBe(0);
  });
});
