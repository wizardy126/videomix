import { describe, test, expect } from 'vitest';

import { getAspectRange, transposeAspectRange, transposeRect } from '../geometry';
import type { AspectRange } from '../geometry';
import { formatPlan } from './formatPlan';
import { planMix } from './planMix';
import { createRandom } from './random';
import type { MixPlan, PlanMixInput, PlannerClip, PlannerSettings } from './types';
import { getEffectivePins, getPlanUnits } from './units';
import { validatePlan } from './validatePlan';

// A4 (T30): pinned clips and groups.

const range = (min: number, max: number, preferred = max): AspectRange => ({ min, max, preferred });
const rigid = (aspect: number) => range(aspect, aspect, aspect);
const H169 = rigid(16 / 9);
/** Vertical 9:16 whose min rect lets it widen up to 1:1: three of them fill a 16:9 frame. */
const V916_WIDE = range(9 / 16, 1, 9 / 16);

const settings = (overrides: Partial<PlannerSettings> = {}): PlannerSettings => ({
  width: 1920,
  height: 1080,
  maxColumns: 3,
  gap: 0,
  reorderWindow: 3,
  order: { mode: 'list', seed: 0 },
  transitionDuration: 0.5,
  // T52: the planner with this one window (the safety net over several windows is tested in safetyNet.test.ts)
  bestOfWindows: false,
  ...overrides,
});

const clip = (id: string, duration: number, aspectRange: AspectRange, extra: Partial<PlannerClip> = {}): PlannerClip => ({ id, duration, aspectRange, ...extra });

function plan(input: PlanMixInput) {
  const result = planMix(input);
  expect(validatePlan(result, input)).toEqual([]);
  return result;
}

const byClip = (p: MixPlan, id: string) => p.placements.find((pl) => pl.clipId === id)!;
const warningsOf = (p: MixPlan, type: string) => p.warnings.filter((w) => w.type === type);

/** Seven flexible verticals: three columns that always fill the frame. */
const verticals = [10, 12, 14, 10, 11, 9, 10].map((d, i) => clip(`v${i}`, d, V916_WIDE));
const withClips = (clips: PlannerClip[], patch: Record<string, Partial<PlannerClip>>) => clips.map((c) => ({ ...c, ...patch[c.id] }));

describe('units', () => {
  const listOrder = { mode: 'list', seed: 0 } as const;

  test('a group takes the place of its first clip; pinned clips are out of the order', () => {
    const clips = [{ id: 'a' }, { id: 'b', groupId: 'g' }, { id: 'c', pinTime: 5 }, { id: 'd' }, { id: 'e', groupId: 'g' }];
    const { ordered, pinned } = getPlanUnits(clips, { order: listOrder, maxColumns: 3 });
    expect(ordered.map((u) => [u.clips.map((c) => c.id).join('+'), u.unitBase, u.singleBase])).toEqual([['a', 0, 0], ['b+e', 1, -1], ['d', 2, 1]]);
    expect(pinned.map((u) => [u.clips.map((c) => c.id).join('+'), u.pinTime])).toEqual([['c', 5]]);
  });

  test('a group larger than maxColumns is cut into chunks, one after the other', () => {
    const clips = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, groupId: 'g' }));
    const { ordered } = getPlanUnits([...clips, { id: 'x' }], { order: listOrder, maxColumns: 2 });
    expect(ordered.map((u) => u.clips.map((c) => c.id).join('+'))).toEqual(['a+b', 'c+d', 'e', 'x']);
    expect(ordered.map((u) => u.singleBase)).toEqual([-1, -1, -1, 0]);
  });

  test('a group inherits the earliest pin of its clips; a group of one and invalid pins are ignored', () => {
    const clips = [
      { id: 'a', groupId: 'g', pinTime: 9 }, { id: 'b', groupId: 'g', pinTime: 4 }, { id: 'c', groupId: 'g' },
      { id: 'd', groupId: 'lonely' }, { id: 'e', pinTime: -1 }, { id: 'f', pinTime: Number.NaN },
    ];
    expect(getEffectivePins(clips)).toEqual(new Map([['a', 4], ['b', 4], ['c', 4]]));
    const { ordered, pinned } = getPlanUnits(clips, { order: listOrder, maxColumns: 3 });
    expect(pinned.map((u) => [u.clips.map((c) => c.id).join('+'), u.pinTime])).toEqual([['a+b+c', 4]]);
    expect(ordered.map((u) => [u.clips.map((c) => c.id).join('+'), u.singleBase])).toEqual([['d', 0], ['e', 1], ['f', 2]]);
  });

  test('random mode: groups and singles follow the shuffled list', () => {
    const clips = Array.from({ length: 10 }, (_v, i) => ({ id: `c${i}`, ...(i % 4 === 1 && { groupId: 'g' }) }));
    const { ordered } = getPlanUnits(clips, { order: { mode: 'random', seed: 3 }, maxColumns: 3 });
    expect(ordered.flatMap((u) => u.clips).map((c) => c.id).toSorted()).toEqual(clips.map((c) => c.id).toSorted());
    expect(ordered.filter((u) => u.groupId === 'g')).toHaveLength(1);
  });
});

describe('pinned clips', () => {
  test('a pinned clip starts exactly at its time: a column is freed before it and it comes in as a new column', () => {
    // without the pin: three full columns until the end; v6 pinned at 15 s: the column of v2 (ends at 14 s) goes away
    const p = plan({ clips: withClips(verticals, { v6: { pinTime: 15 } }), settings: settings() });
    expect(formatPlan(p)).toBe([
      'plan 1920x1080, 28.00s',
      'layout 0.00: c0=640 | c1=640 | c2=640',
      'layout 13.50+0.50: c0=960 | c1=960',
      'layout 15.00+0.50: c0=640 | c1=640 | c3=640',
      'c0: v0 0.00-10.00 > v3 9.50-19.50 > v5 19.00-28.00',
      'c1: v1 0.00-12.00 > v4 11.50-22.50 ~fade 0.50',
      'c2: v2 0.00-14.00',
      'c3: v6 15.00-25.00 ~fade 0.50',
    ].join('\n'));
  });

  test('a clip pinned at 0 is in the initial row', () => {
    const p = plan({ clips: withClips(verticals, { v6: { pinTime: 0 } }), settings: settings() });
    expect(byClip(p, 'v6').startTime).toBe(0);
    expect(p.layouts[0]!.columns).toHaveLength(3);
  });

  test('pinned clips are outside the reorder window: the others keep the list order', () => {
    const p = plan({ clips: withClips(verticals, { v0: { pinTime: 20 } }), settings: settings({ reorderWindow: 0 }) });
    expect(byClip(p, 'v0').startTime).toBe(20);
    const others = p.placements.filter((pl) => pl.clipId !== 'v0').map((pl) => pl.clipId);
    expect(others).toEqual(['v1', 'v2', 'v3', 'v4', 'v5', 'v6']);
  });

  test('pins that need more columns than there are at once: the later one is shifted and warned', () => {
    const p = plan({ clips: withClips(verticals, { v5: { pinTime: 15 }, v6: { pinTime: 15 } }), settings: settings({ maxColumns: 2 }) });
    expect(byClip(p, 'v5').startTime).toBe(15);
    // v6 goes in as soon as v5's column frees (crossfade)
    expect(byClip(p, 'v6')).toMatchObject({ column: byClip(p, 'v5').column, startTime: 23.5 });
    expect(warningsOf(p, 'pin-shifted')).toEqual([{ type: 'pin-shifted', clipId: 'v6', pinTime: 15, time: 23.5 }]);
  });

  test('pins at the same time start together when there are columns for them', () => {
    const p = plan({ clips: withClips(verticals, { v5: { pinTime: 15 }, v6: { pinTime: 15 } }), settings: settings() });
    expect([byClip(p, 'v5').startTime, byClip(p, 'v6').startTime]).toEqual([15, 15]);
    expect(p.layouts.filter((l) => l.time === 15)).toHaveLength(1);
  });

  test('a pin after the other clips run out comes earlier (no hole in the video) and is warned', () => {
    const p = plan({ clips: withClips(verticals, { v0: { pinTime: 100 } }), settings: settings() });
    expect(warningsOf(p, 'pin-shifted')).toEqual([{ type: 'pin-shifted', clipId: 'v0', pinTime: 100, time: byClip(p, 'v0').startTime }]);
    expect(byClip(p, 'v0').startTime).toBeLessThan(p.duration);
  });

  test('a single column: the pin takes the first cut after its time, or exactly its time within a crossfade', () => {
    const clips = [clip('h0', 10, H169), clip('h1', 10, H169), clip('h2', 10, H169), clip('h3', 10, H169)];
    const late = plan({ clips: withClips(clips, { h2: { pinTime: 12 } }), settings: settings({ maxColumns: 1 }) });
    expect(late.placements.map((pl) => [pl.clipId, pl.startTime])).toEqual([['h0', 0], ['h1', 9.5], ['h2', 19], ['h3', 28.5]]);
    expect(warningsOf(late, 'pin-shifted')).toEqual([{ type: 'pin-shifted', clipId: 'h2', pinTime: 12, time: 19 }]);
    // h0 ends at 10 s: h2 pinned at 9.7 s crossfades into it with a shorter transition
    const exact = plan({ clips: withClips(clips, { h2: { pinTime: 9.7 } }), settings: settings({ maxColumns: 1 }) });
    expect(byClip(exact, 'h2')).toMatchObject({ startTime: 9.7, transitionIn: expect.closeTo(0.3) });
    expect(warningsOf(exact, 'pin-shifted')).toEqual([]);
  });

  test('only pinned clips: the first one starts the video', () => {
    const p = plan({ clips: [clip('a', 5, H169, { pinTime: 3 }), clip('b', 5, H169, { pinTime: 20 })], settings: settings() });
    expect(byClip(p, 'a').startTime).toBe(0);
    expect(warningsOf(p, 'pin-shifted').map((w) => w.type === 'pin-shifted' && w.clipId)).toEqual(['a', 'b']);
  });
});

describe('groups', () => {
  test('a group starts together, with a re-layout that opens room for it', () => {
    const p = plan({ clips: withClips(verticals, { v4: { groupId: 'g' }, v5: { groupId: 'g' } }), settings: settings() });
    expect(formatPlan(p)).toBe([
      'plan 1920x1080, 30.00s',
      'layout 0.00: c0=640 | c1=640 | c2=640',
      'layout 13.50+0.50: c0=960 | c1=960',
      'layout 19.00+0.50: c0=640 | c3=640 | c1=640',
      'c0: v0 0.00-10.00 > v3 9.50-19.50 > v4 19.00-30.00',
      'c1: v1 0.00-12.00 > v6 11.50-21.50 ~fade 0.50',
      'c2: v2 0.00-14.00',
      'c3: v5 19.00-28.00 ~fade 0.50',
    ].join('\n'));
  });

  test('a group takes the list position of its first clip', () => {
    // window 0: v1+v5 start with v0 (v5 alone would be sixth); the others keep their order
    const p = plan({ clips: withClips(verticals, { v1: { groupId: 'g' }, v5: { groupId: 'g' } }), settings: settings({ reorderWindow: 0 }) });
    expect(['v0', 'v1', 'v5'].map((id) => byClip(p, id).startTime)).toEqual([0, 0, 0]);
    const singles = p.placements.filter((pl) => !['v1', 'v5'].includes(pl.clipId)).map((pl) => pl.clipId);
    expect(singles).toEqual(['v0', 'v2', 'v3', 'v4', 'v6']);
  });

  test('a group with more clips than columns is split in order and warned', () => {
    const p = plan({ clips: withClips(verticals, { v1: { groupId: 'g' }, v2: { groupId: 'g' }, v3: { groupId: 'g' }, v4: { groupId: 'g' } }), settings: settings() });
    expect(new Set(['v1', 'v2', 'v3'].map((id) => byClip(p, id).startTime)).size).toBe(1);
    expect(byClip(p, 'v4').startTime).toBeGreaterThan(byClip(p, 'v1').startTime);
    expect(warningsOf(p, 'group-split')).toEqual([{ type: 'group-split', groupId: 'g', clipIds: ['v1', 'v2', 'v3', 'v4'] }]);
  });

  test('a pinned clip pins its group (at the earliest pin of its clips)', () => {
    const p = plan({ clips: withClips(verticals, { v5: { groupId: 'g', pinTime: 20 }, v6: { groupId: 'g', pinTime: 25 } }), settings: settings() });
    expect([byClip(p, 'v5').startTime, byClip(p, 'v6').startTime]).toEqual([20, 20]);
    expect(warningsOf(p, 'pin-shifted')).toEqual([]);
  });

  test('rigid clips that can\'t share the row still start together, squeezed (letterboxed)', () => {
    const clips = [clip('a', 10, H169), clip('b', 8, H169, { groupId: 'g' }), clip('c', 8, H169, { groupId: 'g' })];
    const p = plan({ clips, settings: settings() });
    expect(byClip(p, 'b').startTime).toBe(byClip(p, 'c').startTime);
    expect(warningsOf(p, 'letterbox').length).toBeGreaterThan(0);
  });
});

describe('properties with pins and groups', () => {
  const presets = [H169, rigid(9 / 16), V916_WIDE, range(3 / 4, 16 / 9), rigid(4 / 3), rigid(1), rigid(4 / 5), range(0.3, 3, 1), rigid(2.39)];

  function randomInput(seed: number, [width, height]: readonly [number, number]): PlanMixInput {
    const rnd = createRandom(seed);
    const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
    const pickOne = <T, >(items: readonly T[]) => items[int(0, items.length - 1)]!;
    const count = int(1, 30);
    const clips = Array.from({ length: count }, (_v, i): PlannerClip => {
      const duration = rnd() < 0.15 ? 0.1 + rnd() * 1.2 : 1 + rnd() * 25;
      if (rnd() < 0.3) {
        const maxRect = { x: 0, y: 0, width: 2 * int(8, 1000), height: 2 * int(8, 1000) };
        const minRect = rnd() < 0.5 ? undefined : { x: 0, y: 0, width: 2 * int(8, maxRect.width / 2), height: 2 * int(8, maxRect.height / 2) };
        return { id: `c${i}`, duration, aspectRange: getAspectRange(maxRect, minRect), rects: { maxRect, minRect } };
      }
      return { id: `c${i}`, duration, aspectRange: pickOne(presets) };
    });
    const total = clips.reduce((acc, c) => acc + c.duration, 0);
    // a few groups of 2–4 clips anywhere in the list
    for (let g = int(0, 3); g > 0; g -= 1) {
      for (let k = int(2, 4); k > 0; k -= 1) clips[int(0, count - 1)]!.groupId = `g${g}`;
    }
    // a few pins: at 0, several at 5 s, mostly inside the video, some probably after its end
    for (let p = int(0, 4); p > 0; p -= 1) {
      const r = rnd();
      clips[int(0, count - 1)]!.pinTime = r < 0.1 ? 0 : (r < 0.2 ? 5 : rnd() * total * (r < 0.9 ? 0.3 : 1));
    }
    return {
      clips,
      settings: {
        width,
        height,
        maxColumns: int(1, 5),
        gap: pickOne([0, 0, 2, 4, 10, 3]),
        reorderWindow: int(0, 5),
        order: { mode: rnd() < 0.3 ? 'random' : 'list', seed: int(0, 1000) },
        transitionDuration: pickOne([0, 0.25, 0.5, 0.5, 1, 2]),
      },
    };
  }

  test('random projects with pins and groups satisfy every invariant in the three output shapes', () => {
    const stats = { pins: 0, exactPins: 0, groups: 0, splitGroups: 0 };
    for (const shape of [[1920, 1080], [1080, 1920], [1080, 1080]] as const) {
      for (let seed = 1; seed <= 150; seed += 1) {
        const input = randomInput(seed, shape);
        const result = planMix(input);
        const issues = validatePlan(result, input);
        if (issues.length > 0) throw new Error(`${shape.join('x')} seed ${seed}: ${issues.join('; ')}\n${formatPlan(result)}`);
        expect(planMix(input)).toEqual(result); // deterministic

        // how often they are honoured where they can be: single pinned clips with 2+ columns, unpinned groups that fit
        const { maxColumns } = input.settings;
        input.clips.forEach((c) => {
          if (c.pinTime == null || c.groupId != null || maxColumns < 2) return;
          stats.pins += 1;
          if (!result.warnings.some((w) => w.type === 'pin-shifted' && w.clipId === c.id)) stats.exactPins += 1;
        });
        new Set(input.clips.flatMap((c) => (c.groupId != null ? [c.groupId] : []))).forEach((groupId) => {
          const members = input.clips.filter((c) => c.groupId === groupId);
          if (members.length < 2 || members.length > maxColumns || members.some((c) => c.pinTime != null)) return;
          stats.groups += 1;
          if (result.warnings.some((w) => w.type === 'group-split' && w.groupId === groupId)) stats.splitGroups += 1;
        });
      }
    }
    expect(stats.pins).toBeGreaterThan(200);
    expect(stats.exactPins / stats.pins).toBeGreaterThan(0.8);
    expect(stats.groups).toBeGreaterThan(200);
    expect(stats.splitGroups / stats.groups).toBeLessThan(0.02);
  }, 60_000);

  test('9:16: a rows plan with pins and groups is the columns plan of the transposed clips', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const input = randomInput(500 + seed, [1080, 1920]);
      const rows = planMix(input);
      const transposed = input.clips.map((c): PlannerClip => ({
        ...c,
        aspectRange: transposeAspectRange(c.aspectRange),
        ...(c.rects != null && { rects: { maxRect: transposeRect(c.rects.maxRect), minRect: c.rects.minRect && transposeRect(c.rects.minRect) } }),
      }));
      const columns = planMix({ clips: transposed, settings: { ...input.settings, width: 1920, height: 1080 } });
      expect(rows.placements).toEqual(columns.placements);
      expect(rows.layouts).toEqual(columns.layouts);
    }
  });

  test('200 clips with pins and groups are planned in well under a second', () => {
    const clips = Array.from({ length: 200 }, (_v, i) => clip(`c${i}`, 3 + (i % 11), presets[i % presets.length]!, {
      ...(i % 10 === 3 && { pinTime: i * 2.2 }),
      ...((i % 13 === 5 || i % 13 === 6) && { groupId: `g${Math.floor(i / 26)}` }),
    }));
    for (const maxColumns of [3, 6]) {
      const input = { clips, settings: settings({ maxColumns, reorderWindow: maxColumns === 6 ? 10 : 3 }) };
      const start = performance.now();
      const result = planMix(input);
      expect(performance.now() - start).toBeLessThan(1000);
      expect(validatePlan(result, input)).toEqual([]);
    }
  });
});
