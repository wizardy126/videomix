import { describe, test, expect } from 'vitest';

import { getAspectRange } from '../geometry';
import type { PlanMixInput } from '../planner/types';
import { applyPlannerOrder, countMovedClips, getMixOrderMetrics } from './optimizeMix';

// I2 (T61)

describe('applyPlannerOrder', () => {
  test('the planned clips take their positions in the new order; the others stay put', () => {
    expect(applyPlannerOrder(['a', 'b', 'x', 'c', 'd'], ['c', 'a', 'd', 'b'])).toEqual(['c', 'a', 'x', 'd', 'b']);
    expect(applyPlannerOrder(['a', 'b'], ['a', 'b'])).toEqual(['a', 'b']);
    expect(() => applyPlannerOrder(['a', 'b'], ['a', 'b', 'z'])).toThrow();
  });

  test('countMovedClips', () => {
    expect(countMovedClips(['a', 'b', 'c', 'd'], ['a', 'c', 'b', 'd'])).toBe(2);
    expect(countMovedClips(['a', 'b'], ['a', 'b'])).toBe(0);
  });
});

describe('getMixOrderMetrics', () => {
  const third = (id: string, duration: number) => ({ id, duration, aspectRange: getAspectRange({ x: 0, y: 0, width: 640, height: 1080 }) });
  const twoThirds = (id: string, duration: number) => ({ id, duration, aspectRange: getAspectRange({ x: 0, y: 0, width: 1280, height: 1080 }) });
  const input: PlanMixInput = {
    clips: [third('a', 10), third('b', 10), third('c', 10), twoThirds('d', 20)],
    settings: { width: 1920, height: 1080, maxColumns: 3, gap: 0, reorderWindow: 0, order: { mode: 'list', seed: 0 }, transitionDuration: 0.5 },
  };

  test('duration, fill and time with empty columns of the plan, in the given order', () => {
    // three 1/3 first, then the 2/3 alone with fill
    const before = getMixOrderMetrics(input);
    expect(before.duration).toBeCloseTo(29.5);
    expect(before.fill).toBeGreaterThan(6);
    expect(before.emptyColumnTime).toBeGreaterThan(9);
    // the 2/3 with the 1/3 one after the other: shorter, with less fill and fewer empty columns
    const after = getMixOrderMetrics(input, ['d', 'a', 'b', 'c']);
    expect(after.duration).toBeLessThan(before.duration);
    expect(after.fill).toBeLessThan(before.fill);
    expect(after.emptyColumnTime).toBeLessThan(before.emptyColumnTime);
  });
});
