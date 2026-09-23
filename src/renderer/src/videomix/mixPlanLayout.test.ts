import { describe, expect, test } from 'vitest';

import { getColumnFillSpans, getLaneColumns, getPlacementAt, getPlacementWarnings, timeToPercent } from './mixPlanLayout';
import type { MixPlan, PlanWarning } from './planner/types';

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

describe('getLaneColumns', () => {
  test('orders columns by first x', () => {
    expect(getLaneColumns(plan)).toEqual([0, 1]);
  });

  test('orders a column that appears later by its own first x', () => {
    const later: MixPlan = {
      ...plan,
      layouts: [
        { time: 0, transitionDuration: 0, columns: [{ column: 1, x: 0, width: 500 }], fills: [{ x: 500, width: 500 }] },
        { time: 5, transitionDuration: 0, columns: [{ column: 1, x: 0, width: 500 }, { column: 0, x: 500, width: 500 }], fills: [] },
      ],
    };
    expect(getLaneColumns(later)).toEqual([1, 0]);
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
  const laneColumns = getLaneColumns(plan);

  test('finds the placement of a lane at a given time', () => {
    expect(getPlacementAt(plan, laneColumns, 1, 2)?.clipId).toBe('b');
    expect(getPlacementAt(plan, laneColumns, 1, 9)?.clipId).toBe('c');
  });

  test('undefined during a fill gap or out of range', () => {
    expect(getPlacementAt(plan, laneColumns, 1, 6)).toBeUndefined();
    expect(getPlacementAt(plan, laneColumns, 1, 20)).toBeUndefined();
    expect(getPlacementAt(plan, laneColumns, 5, 2)).toBeUndefined();
  });
});
