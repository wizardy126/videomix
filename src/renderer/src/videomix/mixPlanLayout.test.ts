import { describe, expect, test } from 'vitest';

import { getColumnExistenceSpans, getColumnFillSpans, getMixLanes, getPlacementAt, getPlacementWarnings, timeToPercent } from './mixPlanLayout';
import { planMix } from './planner/planMix';
import { createRandom } from './planner/random';
import type { LayoutKeyframe, MixPlan, PlannerClip, PlanWarning } from './planner/types';

/** Hand-built plan: 2 columns, a re-layout at t=5 that drops column 1 into fill for a while, then a new clip. */
const plan: MixPlan = {
  width: 1000,
  height: 500,
  duration: 12,
  placements: [
    { clipId: 'a', column: 0, startTime: 0, endTime: 12, transitionIn: 0 },
    { clipId: 'b', column: 1, startTime: 0, endTime: 5, transitionIn: 0 },
    { clipId: 'c', column: 1, startTime: 8, endTime: 12, transitionIn: 0 },
  ],
  layouts: [
    { time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 500 }, { column: 1, x: 500, width: 500 }], fills: [] },
  ],
  warnings: [
    { type: 'upscale', clipId: 'a', factor: 2.5 },
    { type: 'pillarbox', clipId: 'c', time: 9 },
    { type: 'fill', time: 5, width: 500 },
  ],
};

const cols = (...xs: [column: number, x: number][]) => xs.map(([column, x]) => ({ column, x, width: 100 }));
const kf = (time: number, columns: LayoutKeyframe['columns'], transitionDuration = 0.5): LayoutKeyframe => ({ time, transitionDuration, columns, fills: [] });
const at = (clipId: string, column: number, startTime: number, endTime: number) => ({ clipId, column, startTime, endTime, transitionIn: 0 });

describe('getMixLanes (G3)', () => {
  test('a lane per column while they all play at once, by first x', () => {
    expect(getMixLanes(plan)).toEqual([[0], [1]]);
  });

  test('orders a column that appears later by its own first x', () => {
    const later: MixPlan = {
      ...plan,
      layouts: [
        { time: 0, transitionDuration: 0, columns: [{ column: 1, x: 0, width: 500 }], fills: [{ x: 500, width: 500 }] },
        { time: 5, transitionDuration: 0, columns: [{ column: 1, x: 0, width: 500 }, { column: 0, x: 500, width: 500 }], fills: [] },
      ],
    };
    expect(getMixLanes(later)).toEqual([[1], [0]]);
  });

  test('columns that don\'t coincide in time share a lane', () => {
    // column 1 is removed at 5 (its clip ends with the animation, 5.5); column 2 opens at 8
    const p: MixPlan = {
      ...plan,
      placements: [at('a', 0, 0, 12), at('b', 1, 0, 5.5), at('c', 2, 8, 12)],
      layouts: [kf(0, cols([0, 0], [1, 500]), 0), kf(5, cols([0, 0])), kf(8, cols([0, 0], [2, 500]))],
    };
    expect(getMixLanes(p)).toEqual([[0], [1, 2]]);
  });

  test('a column removed by a re-layout still takes its lane while it shrinks', () => {
    // column 2 opens at 5 while column 1 shrinks until 5.5: three at once
    const p: MixPlan = {
      ...plan,
      placements: [at('a', 0, 0, 12), at('b', 1, 0, 5.5), at('c', 2, 5, 12)],
      layouts: [kf(0, cols([0, 0], [1, 500]), 0), kf(5, cols([0, 0], [2, 500]))],
    };
    expect(getMixLanes(p)).toEqual([[0], [1], [2]]);
  });

  test('a new column takes a free lane between its neighbours, the topmost one if several', () => {
    // three columns; 0 and 1 end at 5; column 3 opens left of 2 at 8 (lanes 0 and 1 free: the top one), column 4
    // opens between 3 and 2 at 10 (lane 1)
    const p: MixPlan = {
      ...plan,
      duration: 20,
      placements: [at('a', 0, 0, 5.5), at('b', 1, 0, 5.5), at('c', 2, 0, 20), at('d', 3, 8, 20), at('e', 4, 10, 20)],
      layouts: [
        kf(0, cols([0, 0], [1, 300], [2, 600]), 0),
        kf(5, cols([2, 0])),
        kf(8, cols([3, 0], [2, 500])),
        kf(10, cols([3, 0], [4, 300], [2, 600])),
      ],
    };
    expect(getMixLanes(p)).toEqual([[0, 3], [1, 4], [2]]);
  });

  test('a new column right of the others takes the free lane nearest to its place', () => {
    const p: MixPlan = {
      ...plan,
      duration: 20,
      placements: [at('a', 0, 0, 5.5), at('b', 1, 0, 5.5), at('c', 2, 0, 20), at('d', 3, 8, 20)],
      layouts: [kf(0, cols([0, 0], [1, 300], [2, 600]), 0), kf(5, cols([2, 0])), kf(8, cols([2, 0], [3, 500]))],
    };
    expect(getMixLanes(p)).toEqual([[0], [1, 3], [2]]);
  });

  test('when every lane is busy, a new one is inserted where the column goes', () => {
    const p: MixPlan = {
      ...plan,
      duration: 20,
      placements: [at('a', 0, 0, 20), at('b', 1, 0, 20), at('c', 2, 8, 20)],
      layouts: [kf(0, cols([0, 0], [1, 500]), 0), kf(8, cols([0, 0], [2, 300], [1, 600]))],
    };
    expect(getMixLanes(p)).toEqual([[0], [2], [1]]);
  });

  test('no clips, no lanes', () => {
    expect(getMixLanes({ layouts: [kf(0, [], 0)], placements: [], duration: 0 })).toEqual([]);
  });

  describe('with the real planner', () => {
    const r = (min: number, max: number) => ({ min, max, preferred: max });
    const aspects = [r(16 / 9, 16 / 9), r(9 / 16, 9 / 16), r(1, 1), r(9 / 16, 1), r(3 / 4, 16 / 9)];

    const plans = Array.from({ length: 150 }, (_, seed) => {
      const random = createRandom(seed + 1);
      const clips: PlannerClip[] = Array.from({ length: 6 + Math.floor(random() * 14) }, (__, i) => ({ id: `c${i}`, duration: 2 + Math.floor(random() * 80) / 10, aspectRange: aspects[Math.floor(random() * aspects.length)]! }));
      const vertical = seed % 5 === 0;
      return planMix({ clips, settings: { width: vertical ? 1080 : 1920, height: vertical ? 1920 : 1080, maxColumns: 2 + (seed % 3), gap: 8, reorderWindow: 3, order: { mode: 'list', seed: 0 }, transitionDuration: 0.5 } });
    });

    /** The time a column is on screen: in the layout, or with a clip playing (while it shrinks). */
    const spanOf = (p: MixPlan, column: number) => {
      const spans = [...getColumnExistenceSpans(p, column), ...p.placements.filter((pl) => pl.column === column).map((pl) => ({ from: pl.startTime, to: pl.endTime }))];
      return { from: Math.min(...spans.map((s) => s.from)), to: Math.max(...spans.map((s) => s.to)) };
    };

    test('as many lanes as columns at once, every column in one lane, no overlap within a lane', () => {
      let ids = 0;
      let lanesTotal = 0;
      plans.forEach((p) => {
        const lanes = getMixLanes(p);
        const columns = [...new Set(p.placements.map((pl) => pl.column))];
        expect(lanes.flat().sort((a, b) => a - b)).toEqual(columns.sort((a, b) => a - b));
        const spans = columns.map((c) => spanOf(p, c));
        const maxAtOnce = Math.max(...spans.map((s) => spans.filter((o) => o.from <= s.from + 1e-6 && o.to > s.from + 1e-6).length));
        expect(lanes).toHaveLength(maxAtOnce);
        lanes.forEach((lane) => {
          const laneSpans = lane.map((c) => spanOf(p, c)).sort((a, b) => a.from - b.from);
          laneSpans.slice(1).forEach((s, i) => expect(s.from).toBeGreaterThanOrEqual(laneSpans[i]!.to - 1e-6));
        });
        ids += columns.length;
        lanesTotal += lanes.length;
      });
      // the planner opens many more columns than it shows at once
      expect(ids).toBeGreaterThan(lanesTotal * 1.2);
    });

    test('top to bottom follows left to right (top to bottom in rows) in most stable layouts', () => {
      let ordered = 0;
      let total = 0;
      plans.forEach((p) => {
        const lanes = getMixLanes(p);
        const laneOf = new Map(lanes.flatMap((lane, i) => lane.map((c) => [c, i] as const)));
        p.layouts.forEach((layout) => {
          const laneIndexes = layout.columns.map((c) => laneOf.get(c.column)!);
          total += 1;
          if (laneIndexes.every((l, i) => i === 0 || l > laneIndexes[i - 1]!)) ordered += 1;
        });
      });
      // (≈ 91 %: the rest can't be ordered with a column in a single lane, e.g. the second column goes on alone and new
      // ones open to its right, while the lane above it is the only free one)
      expect(ordered / total).toBeGreaterThan(0.85);
    });

    test('deterministic', () => {
      expect(getMixLanes(plans[7]!)).toEqual(getMixLanes(plans[7]!));
    });
  });
});

describe('getColumnFillSpans', () => {
  test('the gap between two placements of the same column is fill', () => {
    expect(getColumnFillSpans(plan, 1)).toEqual([{ from: 5, to: 8 }]);
  });

  test('a column always covered by a clip has no fill', () => {
    expect(getColumnFillSpans(plan, 0)).toEqual([]);
  });

  test('a column missing from every layout has no fill either (nothing to show)', () => {
    expect(getColumnFillSpans(plan, 9)).toEqual([]);
  });
});

describe('timeToPercent', () => {
  test('maps proportionally', () => {
    expect(timeToPercent(3, 12)).toBeCloseTo(25);
  });

  test('clamps to [0, 100]', () => {
    expect(timeToPercent(-1, 12)).toBe(0);
    expect(timeToPercent(20, 12)).toBe(100);
  });

  test('a zero duration maps everything to 0', () => {
    expect(timeToPercent(5, 0)).toBe(0);
  });
});

describe('getPlacementWarnings', () => {
  test('matches by clip id, ignoring fill warnings', () => {
    expect(getPlacementWarnings(plan, plan.placements[0]!)).toEqual([{ type: 'upscale', clipId: 'a', factor: 2.5 }]);
  });

  test('a time-anchored warning only applies within the placement range', () => {
    expect(getPlacementWarnings(plan, plan.placements[2]!)).toEqual([{ type: 'pillarbox', clipId: 'c', time: 9 }]);
    expect(getPlacementWarnings(plan, plan.placements[1]!)).toEqual([]);
  });

  test('an extended warning goes to its clip\'s block (E7)', () => {
    const extended: PlanWarning = { type: 'extended', clipId: 'c', pixels: 200, time: 8, endTime: 12 };
    expect(getPlacementWarnings({ warnings: [extended] }, plan.placements[2]!)).toEqual([extended]);
    expect(getPlacementWarnings({ warnings: [extended] }, plan.placements[0]!)).toEqual([]);
  });

  test('a group-split warning applies to every clip of the group (A4)', () => {
    const split: PlanWarning = { type: 'group-split', groupId: 'g', clipIds: ['a', 'c'] };
    const withSplit = { ...plan, warnings: [split] };
    expect(getPlacementWarnings(withSplit, plan.placements[2]!)).toEqual([split]);
    expect(getPlacementWarnings(withSplit, plan.placements[1]!)).toEqual([]);
  });

  test('no warnings for a clip without any', () => {
    expect(getPlacementWarnings(plan, plan.placements[1]!)).toEqual([]);
  });
});

describe('getPlacementAt', () => {
  const laneColumns = getMixLanes(plan);

  test('finds the placement of a lane at a given time', () => {
    expect(getPlacementAt(plan, laneColumns, 1, 2)?.clipId).toBe('b');
    expect(getPlacementAt(plan, laneColumns, 1, 9)?.clipId).toBe('c');
  });

  test('finds the placement among the columns of a shared lane', () => {
    const shared: MixPlan = { ...plan, placements: [at('a', 0, 0, 12), at('b', 1, 0, 5.5), at('c', 2, 8, 12)] };
    expect(getPlacementAt(shared, [[0], [1, 2]], 1, 9)?.clipId).toBe('c');
    expect(getPlacementAt(shared, [[0], [1, 2]], 1, 2)?.clipId).toBe('b');
  });

  test('undefined during a fill gap or out of range', () => {
    expect(getPlacementAt(plan, laneColumns, 1, 6)).toBeUndefined();
    expect(getPlacementAt(plan, laneColumns, 1, 20)).toBeUndefined();
    expect(getPlacementAt(plan, laneColumns, 5, 2)).toBeUndefined();
  });
});
