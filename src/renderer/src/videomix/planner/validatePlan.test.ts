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

describe('validatePlan: pins and groups (A4, T30)', () => {
  // three flexible verticals at a time; v5 pinned at 15 s, v3+v4 grouped, v6 pinned where it can't be (after the end)
  const FLEX = { min: 9 / 16, max: 1, preferred: 9 / 16 };
  const pinInput: PlanMixInput = {
    clips: [
      { id: 'v0', duration: 10, aspectRange: FLEX },
      { id: 'v1', duration: 12, aspectRange: FLEX },
      { id: 'v2', duration: 14, aspectRange: FLEX },
      { id: 'v3', duration: 10, aspectRange: FLEX, groupId: 'g' },
      { id: 'v4', duration: 11, aspectRange: FLEX, groupId: 'g' },
      { id: 'v5', duration: 9, aspectRange: FLEX, pinTime: 15 },
      { id: 'v6', duration: 10, aspectRange: FLEX, pinTime: 500 },
      { id: 'v7', duration: 8, aspectRange: FLEX },
    ],
    settings: { ...input.settings, reorderWindow: 1 },
  };
  const pinPlan = planMix(pinInput);
  const mutatePin = (fn: (plan: MixPlan) => void) => {
    const plan = structuredClone(pinPlan);
    fn(plan);
    return validatePlan(plan, pinInput);
  };
  const shift = (pl: MixPlan['placements'][number], by: number) => {
    pl.startTime += by;
    pl.endTime += by;
  };

  test('the base plan is valid: v5 on its pin, the group together, v6 shifted with a warning', () => {
    expect(validatePlan(pinPlan, pinInput)).toEqual([]);
    expect(placement(pinPlan, 'v5').startTime).toBe(15);
    expect(placement(pinPlan, 'v3').startTime).toBe(placement(pinPlan, 'v4').startTime);
    expect(pinPlan.warnings).toContainEqual({ type: 'pin-shifted', clipId: 'v6', pinTime: 500, time: placement(pinPlan, 'v6').startTime });
  });

  test('detects a pinned clip off its time without warning, and a wrong warning', () => {
    expect(mutatePin((p) => { p.warnings.push({ type: 'pin-shifted', clipId: 'v5', pinTime: 15, time: 15 }); })).toContain('Clip v5: wrong pin-shifted warning');
    expect(mutatePin((p) => { p.warnings = p.warnings.filter((w) => w.type !== 'pin-shifted'); })).toContainEqual(expect.stringContaining('Clip v6 pinned at 500'));
    expect(mutatePin((p) => {
      const w = p.warnings.find((x) => x.type === 'pin-shifted');
      if (w?.type === 'pin-shifted') w.time += 1;
    })).toContain('Clip v6: wrong pin-shifted warning');
    expect(mutatePin((p) => { p.warnings.push({ type: 'pin-shifted', clipId: 'v0', pinTime: 3, time: 0 }); })).toContain('Clip v0 is not pinned but has a pin-shifted warning');
  });

  test('detects a pinned clip moved off its time (the plan being otherwise consistent)', () => {
    // same plan, but the input pins v5 elsewhere
    const moved = { ...pinInput, clips: pinInput.clips.map((c) => (c.id === 'v5' ? { ...c, pinTime: 16 } : c)) };
    expect(validatePlan(pinPlan, moved)).toContainEqual(expect.stringContaining('Clip v5 pinned at 16 starts at 15 without warning'));
  });

  test('detects a group that doesn\'t start together, and a wrong group-split warning', () => {
    const issues = mutatePin((p) => { shift(placement(p, 'v4'), 0.2); });
    expect(issues).toContain('Group g doesn\'t start together without warning');
    expect(mutatePin((p) => { p.warnings.push({ type: 'group-split', groupId: 'g', clipIds: ['v3', 'v4'] }); })).toContain('Group g: wrong group-split warning');
    expect(mutatePin((p) => { p.warnings.push({ type: 'group-split', groupId: 'nope', clipIds: [] }); })).toContain('Group nope doesn\'t exist but has a group-split warning');
  });

  test('the reorder window ignores pinned clips and counts a group as one position', () => {
    // pinned clips can go anywhere: moving v5's pin to the front of the list changes nothing
    const reordered = { ...pinInput, clips: [pinInput.clips[5]!, ...pinInput.clips.filter((c) => c.id !== 'v5')] };
    expect(validatePlan(pinPlan, reordered)).toEqual([]);
    // with v5 and v6 unpinned and the group last in the list, it starts too early for a window of 0 (5th of 7)
    const unpinned = pinInput.clips.map((c) => ({ ...c, pinTime: undefined }));
    const late = { settings: { ...pinInput.settings, reorderWindow: 0 }, clips: [...unpinned.filter((c) => c.groupId == null), ...unpinned.filter((c) => c.groupId != null)] };
    expect(validatePlan(pinPlan, late)).toContain('Group g at position 5, before its window (list position 6, window 0)');
    // without the group, its clips are single clips again and their order is checked as such
    const ungrouped = { ...late, clips: late.clips.map((c) => ({ ...c, groupId: undefined })) };
    expect(validatePlan(pinPlan, ungrouped).some((m) => m.startsWith('Clip v3 at position') || m.startsWith('Clip v4 at position'))).toBe(true);
  });
});
