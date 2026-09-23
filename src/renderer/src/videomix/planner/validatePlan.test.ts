/* eslint-disable no-param-reassign */ // the tests break plans on purpose
import { describe, test, expect } from 'vitest';

import { planMix } from './planMix';
import type { MixPlan, PlanMixInput } from './types';
import { validatePlan } from './validatePlan';

const rigid = (aspect: number) => ({ min: aspect, max: aspect, preferred: aspect });
const V916 = rigid(9 / 16);
const WIDE = rigid(1.2);

// No window: v0/v1 end close together and w0 forces a merged re-layout that removes a column.
const input: PlanMixInput = {
  clips: [
    { id: 'v0', duration: 10, aspectRange: V916 },
    { id: 'v1', duration: 10.2, aspectRange: V916 },
    { id: 'v2', duration: 30, aspectRange: V916 },
    { id: 'w0', duration: 8, aspectRange: WIDE },
    { id: 'v3', duration: 6, aspectRange: V916 },
  ],
  settings: {
    width: 1920, height: 1080, maxColumns: 3, gap: 0, reorderWindow: 0, order: { mode: 'list', seed: 0 }, transitionDuration: 0.5,
  },
};

const base = planMix(input);

function mutate(fn: (plan: MixPlan) => void) {
  const plan = structuredClone(base);
  fn(plan);
  return validatePlan(plan, input);
}

const placement = (plan: MixPlan, id: string) => plan.placements.find((p) => p.clipId === id)!;

describe('validatePlan', () => {
  test('the base plan is valid and has a re-layout that removes a column', () => {
    expect(validatePlan(base, input)).toEqual([]);
    expect(base.layouts.length).toBeGreaterThan(1);
    expect(base.layouts.some((l, i) => i > 0 && l.columns.length < base.layouts[i - 1]!.columns.length)).toBe(true);
  });

  test('detects a missing, duplicated or cut clip', () => {
    expect(mutate((p) => { p.placements.pop(); })).not.toEqual([]);
    expect(mutate((p) => { p.placements.push({ ...p.placements[0]! }); })).not.toEqual([]);
    expect(mutate((p) => { placement(p, 'v2').endTime -= 1; })).not.toEqual([]);
  });

  test('detects too many columns', () => {
    expect(validatePlan(base, { ...input, settings: { ...input.settings, maxColumns: 2 } })).not.toEqual([]);
  });

  test('detects a row that does not add up to the width', () => {
    expect(mutate((p) => { p.layouts[0]!.columns[0]!.width -= 2; })).not.toEqual([]);
    expect(mutate((p) => { p.layouts[0]!.fills = []; })).not.toEqual([]);
  });

  test('detects a gap mismatch', () => {
    expect(validatePlan(base, { ...input, settings: { ...input.settings, gap: 4 } })).not.toEqual([]);
  });

  test('detects a substitution without the crossfade overlap', () => {
    expect(mutate((p) => {
      const pl = placement(p, 'v3');
      pl.startTime += 0.1;
      pl.endTime += 0.1;
    })).not.toEqual([]);
    expect(mutate((p) => { placement(p, 'v3').transitionIn = 0.7; })).not.toEqual([]);
  });

  test('detects an initial column that does not start at 0', () => {
    expect(mutate((p) => {
      const pl = placement(p, 'v0');
      pl.startTime += 1;
      pl.endTime += 1;
    })).not.toEqual([]);
  });

  test('detects a removed column whose clip is cut', () => {
    const removal = base.layouts.findIndex((l, i) => i > 0 && l.columns.length < base.layouts[i - 1]!.columns.length);
    expect(mutate((p) => { p.layouts[removal]!.time -= 0.2; })).not.toEqual([]);
  });

  test('detects overlapping animations', () => {
    expect(mutate((p) => {
      const last = p.layouts.at(-1)!;
      p.layouts.push({ ...structuredClone(last), time: last.time + last.transitionDuration / 2 });
    })).not.toEqual([]);
  });

  test('detects a column left empty while clips are pending', () => {
    // v3 moved to a new, later column: v3's old column ends empty while v3 is still to come
    expect(mutate((p) => {
      const pl = placement(p, 'v3');
      pl.column = 99;
    })).not.toEqual([]);
  });

  test('detects order outside the reorder window', () => {
    const swapped = { ...input, clips: [input.clips[1]!, input.clips[0]!, ...input.clips.slice(2)] };
    expect(validatePlan(base, swapped)).toEqual([]); // v0/v1 start together, so their swap is allowed
    const reversed = { ...input, clips: [...input.clips].reverse() };
    expect(validatePlan(base, reversed)).not.toEqual([]);
  });

  test('detects a wrong duration', () => {
    expect(mutate((p) => { p.duration += 1; })).not.toEqual([]);
  });

  test('detects a column order change during an animation (ADR-001)', () => {
    const k = base.layouts.findIndex((l, i) => i > 0 && l.columns.filter((c) => base.layouts[i - 1]!.columns.some((pc) => pc.column === c.column)).length >= 2);
    expect(k).toBeGreaterThan(0);
    const issues = mutate((p) => {
      const [a, b] = p.layouts[k]!.columns;
      [a!.column, b!.column] = [b!.column, a!.column];
    });
    expect(issues.some((m) => m.includes('changes the column order'))).toBe(true);
    expect(issues.some((m) => m.includes('overlap during the animation'))).toBe(true);
  });

  test('detects a fade out missing at the end of the video, or where the clip is followed', () => {
    const fading = base.placements.find((p) => (p.transitionOut ?? 0) > 0)!;
    expect(fading).toBeDefined();
    expect(mutate((p) => { delete placement(p, fading.clipId).transitionOut; })).not.toEqual([]);
    expect(mutate((p) => { placement(p, fading.clipId).transitionOut = 0.2; })).not.toEqual([]);
    expect(mutate((p) => { placement(p, 'v0').transitionOut = 0.5; })).not.toEqual([]); // followed by w0 or removed
    expect(mutate((p) => { placement(p, 'v2').transitionOut = 0.5; })).not.toEqual([]); // ends the video
  });
});

describe('validatePlan: appearing and disappearing columns (ADR-001)', () => {
  // c0 is removed while c2 appears: each collapses to width 0 just left of its right neighbour
  const clips = [{ id: 'a', duration: 5.5, aspectRange: WIDE }, { id: 'b', duration: 20, aspectRange: WIDE }, { id: 'c', duration: 10, aspectRange: WIDE }];
  const handInput: PlanMixInput = { clips, settings: { ...input.settings, reorderWindow: 3 } };
  const handPlan = (second: MixPlan['layouts'][number]['columns']): MixPlan => ({
    width: 1920,
    height: 1080,
    duration: 20,
    placements: [
      { clipId: 'a', column: 0, startTime: 0, endTime: 5.5, transitionIn: 0 },
      { clipId: 'b', column: 1, startTime: 0, endTime: 20, transitionIn: 0 },
      { clipId: 'c', column: 2, startTime: 5, endTime: 15, transitionIn: 0, transitionOut: 0.5 },
    ],
    layouts: [
      { time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 960 }, { column: 1, x: 960, width: 960 }], fills: [] },
      { time: 5, transitionDuration: 0.5, columns: second, fills: [] },
    ],
    warnings: [],
  });

  test('removed on the left, new on the right: valid', () => {
    expect(validatePlan(handPlan([{ column: 1, x: 0, width: 960 }, { column: 2, x: 960, width: 960 }]), handInput)).toEqual([]);
  });

  test('a new column where a removed one was: they would cross', () => {
    const issues = validatePlan(handPlan([{ column: 2, x: 0, width: 960 }, { column: 1, x: 960, width: 960 }]), handInput);
    expect(issues).toEqual(['Layout 1 (t=5) columns 0 and 2 overlap during the animation']);
  });
});
