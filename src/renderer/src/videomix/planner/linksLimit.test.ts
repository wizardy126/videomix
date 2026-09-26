/* eslint-disable no-param-reassign */ // the mutation tests break plans on purpose
import { describe, test, expect } from 'vitest';

import { getAspectRange, transposeAspectRange, transposeRect } from '../geometry';
import type { AspectRange } from '../geometry';
import { resolveOverlayTimes } from '../overlays/resolveOverlayTimes';
import type { MixClip, MixOverlay } from '../types';
import { formatPlan } from './formatPlan';
import { planMix } from './planMix';
import { createRandom } from './random';
import { truncatePlan } from './truncatePlan';
import type { MixPlan, PlanMixInput, PlannerClip, PlannerSettings } from './types';
import { getPlanLinks, getPlanUnits } from './units';
import { validatePlan } from './validatePlan';

// E2 chains, E5 always-visible sequence and E4 maximum duration (T38).

const range = (min: number, max: number, preferred = max): AspectRange => ({ min, max, preferred });
const rigid = (aspect: number) => range(aspect, aspect, aspect);
/** Horizontal 16:9 whose min rect allows down to 4:5. */
const H_FLEX = range(0.8, 16 / 9);
/** Vertical 9:16 whose min rect lets it widen up to 1:1. */
const V_FLEX = range(9 / 16, 1, 9 / 16);
const V916 = rigid(9 / 16);

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
const columnOf = (p: MixPlan, id: string) => byClip(p, id).column;

function withPatch(list: PlannerClip[], patch: Record<string, Partial<PlannerClip>>) {
  return list.map((c) => ({ ...c, ...patch[c.id] }));
}

/** A horizontal clip chained to a rigid vertical one, among flexible clips. */
const clips = [
  clip('a1', 10, H_FLEX),
  clip('b', 12, V_FLEX),
  clip('a2', 8, V916),
  clip('c', 14, V_FLEX),
  clip('d', 9, H_FLEX),
  clip('e', 9, V_FLEX),
];

describe('links as the planner reads them', () => {
  test('getPlanLinks drops unknown, repeated, pinned and grouped chain clips and short chains; the sequence wins', () => {
    const input = [{ id: 'a' }, { id: 'b', pinTime: 3 }, { id: 'c', groupId: 'g' }, { id: 'd' }, { id: 'e' }, { id: 's', pinTime: 1, groupId: 'g' }];
    const links = getPlanLinks(input, { chains: [['a', 'x', 'd'], ['d', 'e'], ['b', 'e'], ['c', 's']], sequence: ['s', 'x', 's'] });
    expect(links.chains.map((chain) => chain.map((c) => c.id))).toEqual([['a', 'd']]);
    expect(links.sequence.map((c) => c.id)).toEqual(['s']);
    expect(links.clips.find((c) => c.id === 's')).toMatchObject({ pinTime: undefined, groupId: undefined });
    // without links, the clips are the input itself (nothing changes)
    expect(getPlanLinks(input, {}).clips).toBe(input);
  });

  test('a chain is one single unit at the place of its earliest clip; sequence clips are out of the order', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 's'].map((id) => ({ id }));
    const { ordered } = getPlanUnits(input, { order: { mode: 'list', seed: 0 }, maxColumns: 3 }, {
      chains: [[input[3]!, input[1]!]],
      sequence: [input[5]!],
    });
    expect(ordered.map((u) => [u.clips.map((c) => c.id).join('+'), u.continuation?.map((c) => c.id).join('+'), u.singleBase])).toEqual([
      ['a', undefined, 0], ['d', 'b', 1], ['c', undefined, 2], ['e', undefined, 3],
    ]);
  });

  test('empty chains and sequence change nothing', () => {
    const input = { clips, settings: settings() };
    expect(planMix({ ...input, chains: [], sequence: [] })).toEqual(planMix(input));
    expect(planMix({ ...input, chains: [['a1'], ['zz', 'b']], sequence: ['zz'] })).toEqual(planMix(input));
  });
});

describe('chains (E2)', () => {
  test('a chain plays in one column, cut, with a re-layout that starts at the change when the next clip does not fit', () => {
    const input = { clips, settings: settings(), chains: [['a1', 'a2']] };
    const result = plan(input);
    expect(formatPlan(result)).toMatchInlineSnapshot(`
      "plan 1920x1080, 29.00s
      layout 0.00: c0=1312 | c1=608
      layout 10.00+0.50: c0=608 | c2=656 | c1=656
      layout 17.50+0.50: c2=960 | c1=960
      c0: a1 0.00-10.00 > a2 10.00-18.00
      c1: b 0.00-12.00 > e 11.50-20.50 > d 20.00-29.00
      c2: c 10.00-24.00 ~fade 0.50"
    `);
    expect(byClip(result, 'a2')).toMatchObject({ column: columnOf(result, 'a1'), startTime: 10, transitionIn: 0 });
    // the re-layout starts at the change, and no shortened-transition warning for the cut
    expect(result.layouts.some((l) => l.time === 10)).toBe(true);
    expect(result.warnings.filter((w) => w.type === 'transition-shortened')).toEqual([]);
  });

  test('with the global transition the chain crossfades, and the video gets shorter', () => {
    const cut = plan({ clips, settings: settings(), chains: [['a1', 'a2']] });
    const input = { clips, settings: settings({ linkTransition: 'global' }), chains: [['a1', 'a2']] };
    const result = plan(input);
    expect(byClip(result, 'a2')).toMatchObject({ column: columnOf(result, 'a1'), startTime: 9.5, transitionIn: 0.5 });
    expect(result.duration).toBeLessThanOrEqual(cut.duration);
  });

  test('a clip that fits the column follows without a re-layout', () => {
    const input = { clips: [clip('a1', 10, V_FLEX), clip('b', 12, V_FLEX), clip('c', 9, V_FLEX), clip('a2', 6, V_FLEX), clip('d', 7, V_FLEX)], settings: settings(), chains: [['a1', 'a2']] };
    const result = plan(input);
    expect(result.layouts).toHaveLength(1);
    expect(byClip(result, 'a2')).toMatchObject({ column: columnOf(result, 'a1'), startTime: 10, transitionIn: 0 });
  });

  test('a chain takes the list position of its earliest clip, and nothing plays between its clips', () => {
    const verticals = Array.from({ length: 9 }, (_v, i) => clip(`v${i}`, 5 + (i % 4), V_FLEX));
    const input = { clips: verticals, settings: settings({ reorderWindow: 0 }), chains: [['v7', 'v1', 'v8']] };
    const result = plan(input);
    // v7 (the chain's first clip) starts at the place of v1, the earliest in the list
    expect(byClip(result, 'v7').startTime).toBe(0);
    const column = result.placements.filter((p) => p.column === columnOf(result, 'v7')).map((p) => p.clipId);
    expect(column.slice(0, 3)).toEqual(['v7', 'v1', 'v8']);
  });

  test('a chain longer than the other clips keeps playing alone at the end', () => {
    const input = { clips: [clip('a', 10, V_FLEX), clip('b', 10, V_FLEX), clip('c', 10, V_FLEX), clip('x', 4, V_FLEX)], settings: settings(), chains: [['a', 'b', 'c']] };
    const result = plan(input);
    expect(result.duration).toBe(30);
    expect(byClip(result, 'c').endTime).toBe(30);
  });
});

describe('always-visible sequence (E5)', () => {
  test('the sequence has a slot from 0 until it runs out; then the slot is used as usual', () => {
    const input = { clips, settings: settings(), sequence: ['a1', 'a2'] };
    const result = plan(input);
    expect(formatPlan(result)).toMatchInlineSnapshot(`
      "plan 1920x1080, 29.00s
      layout 0.00: c0=608 | c1=1312
      layout 10.00+0.50: c0=656 | c1=608 | c2=656
      layout 17.50+0.50: c0=960 | c2=960
      c0: b 0.00-12.00 > e 11.50-20.50 > d 20.00-29.00
      c1: a1 0.00-10.00 > a2 10.00-18.00
      c2: c 10.00-24.00 ~fade 0.50"
    `);
  });

  test('a sequence longer than the rest goes on alone; the other columns become fill', () => {
    const input = { clips: [...clips, clip('s0', 40, V_FLEX), clip('s1', 40, V_FLEX)], settings: settings(), sequence: ['s0', 's1'] };
    const result = plan(input);
    expect(result.duration).toBe(80);
    expect(byClip(result, 's0')).toMatchObject({ startTime: 0 });
    expect(byClip(result, 's1')).toMatchObject({ startTime: 40, column: columnOf(result, 's0') });
    // the others run out before: no re-layout at the end
    expect(result.layouts.at(-1)!.time).toBeLessThan(40);
  });

  test('the sequence counts towards maxColumns; with a single column the others wait for it', () => {
    const one = plan({ clips, settings: settings({ maxColumns: 1 }), sequence: ['b', 'a2'] });
    expect(one.placements.slice(0, 2).map((p) => [p.clipId, p.startTime])).toEqual([['b', 0], ['a2', 12]]);
    const two = plan({ clips, settings: settings({ maxColumns: 2 }), sequence: ['b'] });
    expect(two.layouts.every((l) => l.columns.length <= 2)).toBe(true);
  });

  test('pins and groups of sequence clips are ignored; the sequence starts at 0 before the pins at 0', () => {
    const input = {
      clips: withPatch(clips, { b: { pinTime: 7 }, c: { pinTime: 0 }, d: { groupId: 'g' }, e: { groupId: 'g' } }),
      settings: settings(),
      sequence: ['b', 'd'],
    };
    const result = plan(input);
    expect(byClip(result, 'b').startTime).toBe(0);
    expect(byClip(result, 'c').startTime).toBe(0);
    expect(result.warnings.filter((w) => w.type === 'pin-shifted' || w.type === 'group-split')).toEqual([]);
  });

  test('9:16: the sequence takes a row', () => {
    const input = { clips, settings: settings({ width: 1080, height: 1920 }), sequence: ['b', 'a2'] };
    const result = plan(input);
    expect(result.axis).toBe('rows');
    expect(byClip(result, 'a2')).toMatchObject({ column: columnOf(result, 'b'), startTime: 12 });
  });
});

describe('maximum duration (E4)', () => {
  const contentBefore = (p: MixPlan, limit: number) => p.placements.reduce((acc, pl) => acc + Math.max(0, Math.min(pl.endTime, limit) - pl.startTime), 0);

  test('without pressure (the content fits) the plan does not change', () => {
    const input = { clips, settings: settings() };
    expect(planMix({ ...input, settings: settings({ maxDuration: 100 }) })).toEqual(planMix(input));
  });

  test('horizontals share the row instead of playing full screen, so more fits before the limit', () => {
    const horizontals = Array.from({ length: 16 }, (_v, i) => clip(`h${i}`, 8 + (i % 5), H_FLEX));
    const free = plan({ clips: horizontals, settings: settings() });
    const limited = plan({ clips: horizontals, settings: settings({ maxDuration: 40 }) });
    expect(free.layouts.map((l) => l.columns.length)).toEqual([1]);
    expect(limited.layouts[0]!.columns.length).toBe(2);
    expect(contentBefore(limited, 40)).toBeGreaterThan(1.8 * contentBefore(free, 40));
  });

  test('verticals take a fourth column when the limit presses', () => {
    const verticals = Array.from({ length: 16 }, (_v, i) => clip(`v${i}`, 8 + (i % 5), range(0.44, 1, 9 / 16)));
    const free = plan({ clips: verticals, settings: settings({ maxColumns: 4 }) });
    const limited = plan({ clips: verticals, settings: settings({ maxColumns: 4, maxDuration: 30 }) });
    expect(free.layouts[0]!.columns).toHaveLength(3);
    expect(limited.layouts[0]!.columns).toHaveLength(4);
    expect(contentBefore(limited, 30)).toBeGreaterThan(contentBefore(free, 30));
  });
});

describe('truncatePlan', () => {
  const horizontals = Array.from({ length: 8 }, (_v, i) => clip(`h${i}`, 8 + (i % 5), H_FLEX));
  const input: PlanMixInput = { clips: horizontals, settings: settings({ maxDuration: 30 }) };
  const full = planMix(input);

  test('cuts placements and layouts at the limit, with a truncated warning', () => {
    const cut = truncatePlan(full, 30);
    expect(validatePlan(cut, input)).toEqual([]);
    expect(formatPlan(full)).toMatchInlineSnapshot(`
      "plan 1920x1080, 38.50s
      layout 0.00: c0=960 | c1=960
      c0: h0 0.00-8.00 > h2 7.50-17.50 > h4 17.00-29.00 > h7 28.50-38.50
      c1: h1 0.00-9.00 > h3 8.50-19.50 > h5 19.00-27.00 > h6 26.50-35.50 ~fade 0.50"
    `);
    expect(formatPlan(cut)).toMatchInlineSnapshot(`
      "plan 1920x1080, 30.00s
      layout 0.00: c0=960 | c1=960
      c0: h0 0.00-8.00 > h2 7.50-17.50 > h4 17.00-29.00 > h7 28.50-30.00
      c1: h1 0.00-9.00 > h3 8.50-19.50 > h5 19.00-27.00 > h6 26.50-30.00
      warning: truncated @30.00 -8.50s lost () cut (h6, h7)"
    `);
  });

  test('drops the clips after the limit and their fades', () => {
    const cut = truncatePlan(full, 20);
    expect(validatePlan(cut, input)).toEqual([]);
    expect(cut.duration).toBe(20);
    expect(cut.placements.map((p) => p.clipId)).toEqual(['h0', 'h1', 'h2', 'h3', 'h4', 'h5']);
    expect(cut.warnings).toEqual([{ type: 'truncated', time: 20, seconds: 18.5, clipIds: ['h6', 'h7'], cutClipIds: ['h4', 'h5'] }]);
    expect(cut.placements.every((p) => p.endTime <= 20 && p.transitionOut == null)).toBe(true);
  });

  test('a plan that fits is returned as it is; cutting twice adds up the losses', () => {
    expect(truncatePlan(full, 38.5)).toBe(full);
    expect(truncatePlan(full, 100)).toBe(full);
    const twice = truncatePlan(truncatePlan(full, 30), 20);
    expect(validatePlan(twice, input)).toEqual([]);
    expect(twice.warnings).toEqual([{ type: 'truncated', time: 20, seconds: 18.5, clipIds: ['h6', 'h7'], cutClipIds: ['h4', 'h5'] }]);
  });

  test('overlays and sounds after the limit are cut (resolved with the whole plan\'s placements)', () => {
    const cut = truncatePlan(full, 20);
    const base = { box: { x: 0, y: 0, width: 0.1, height: 0.1 } };
    const overlays = [
      { id: 'o1', type: 'sound', name: 'o1', anchor: { kind: 'absolute', time: 18 }, path: 's.wav', absolutePath: '/s.wav', gainDb: 0 },
      { id: 'o2', type: 'sound', name: 'o2', anchor: { kind: 'clip', clipId: 'h6', edge: 'start', offset: 0 }, path: 's.wav', absolutePath: '/s.wav', gainDb: 0 },
      { ...base, id: 'o3', type: 'image', name: 'o3', anchor: { kind: 'absolute', time: 25 }, duration: 3, path: 'i.png', absolutePath: '/i.png', opacity: 1 },
    ] as unknown as MixOverlay[];
    const times = resolveOverlayTimes({ overlays, clips: horizontals as unknown as MixClip[] }, { duration: cut.duration, placements: full.placements }, { soundDurations: { o1: 5, o2: 5 } });
    expect(times.get('o1')).toMatchObject({ start: 18, end: 20 });
    expect(times.get('o2')).toMatchObject({ start: 20, end: 20 });
    expect(times.get('o3')).toMatchObject({ start: 20, end: 20 });
  });
});

describe('validatePlan: chains, sequence and truncation', () => {
  const input: PlanMixInput = { clips, settings: settings(), chains: [['a1', 'a2']], sequence: ['b', 'e'] };
  const base = planMix(input);
  const mutate = (fn: (p: MixPlan) => void, on: MixPlan = base, against: PlanMixInput = input) => {
    const p = structuredClone(on);
    fn(p);
    return validatePlan(p, against);
  };

  test('the base plan is valid', () => {
    expect(validatePlan(base, input)).toEqual([]);
  });

  test('detects a chain that changes column or has a clip in between', () => {
    expect(mutate((p) => { byClip(p, 'a2').column = columnOf(p, 'c'); })).not.toEqual([]);
    // a chain clip placed later in its column, after another clip
    const spread = { ...input, chains: [['a1', 'c']] };
    expect(validatePlan(base, spread)).not.toEqual([]);
  });

  test('detects a chain with the wrong transition', () => {
    expect(validatePlan(base, { ...input, settings: settings({ linkTransition: 'global' }) })).not.toEqual([]);
  });

  test('detects a sequence that does not start at 0 or is not on screen until it ends', () => {
    expect(validatePlan(base, { ...input, sequence: ['c'] })).not.toEqual([]);
    expect(mutate((p) => { byClip(p, 'e').column = columnOf(p, 'c'); })).not.toEqual([]);
  });

  test('detects a truncated plan that goes past its limit or hides lost clips', () => {
    const limited = { ...input, settings: settings({ maxDuration: 15 }) };
    const cut = truncatePlan(base, 15);
    expect(validatePlan(cut, limited)).toEqual([]);
    expect(cut.layouts.length).toBeLessThan(base.layouts.length);
    expect(mutate((p) => { p.placements[0]!.endTime += 1; }, cut, limited)).not.toEqual([]);
    expect(mutate((p) => { p.duration = 16; }, cut, limited)).not.toEqual([]);
    expect(mutate((p) => { p.placements.pop(); }, cut, limited)).not.toEqual([]);
    expect(mutate((p) => {
      const w = p.warnings.find((x) => x.type === 'truncated')!;
      if (w.type === 'truncated') w.clipIds = [];
    }, cut, limited)).not.toEqual([]);
    expect(mutate((p) => { p.layouts.push({ ...p.layouts.at(-1)!, time: 15 }); }, cut, limited)).not.toEqual([]);
    // cut after the maximum duration of the settings
    expect(validatePlan(truncatePlan(base, 20), limited)).not.toEqual([]);
    // an untruncated plan is not a cut one
    expect(mutate((p) => { p.placements.pop(); })).not.toEqual([]);
  });
});

describe('properties with chains, sequence and limits', () => {
  const presets = [H_FLEX, V916, V_FLEX, range(3 / 4, 16 / 9), rigid(16 / 9), rigid(4 / 3), rigid(1), rigid(4 / 5), range(0.3, 3, 1), rigid(2.39)];

  function randomInput(seed: number, [width, height]: readonly [number, number]): PlanMixInput {
    const rnd = createRandom(seed);
    const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
    const pickOne = <T, >(items: readonly T[]) => items[int(0, items.length - 1)]!;
    const count = int(1, 30);
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
    // some groups and pins (their clips are dropped from the chains by getPlanLinks, as getClipChains does)
    for (let g = int(0, 2); g > 0; g -= 1) {
      for (let k = int(2, 3); k > 0; k -= 1) list[int(0, count - 1)]!.groupId = `g${g}`;
    }
    for (let p = int(0, 2); p > 0; p -= 1) list[int(0, count - 1)]!.pinTime = rnd() < 0.2 ? 0 : rnd() * total * 0.3;
    // random chains of 2–5 clips (sometimes repeating a clip) and a sequence of 0–4 clips
    const ids = list.map((c) => c.id);
    const chains = Array.from({ length: int(0, 4) }, () => Array.from({ length: int(2, 5) }, () => pickOne(ids)));
    const sequence = rnd() < 0.5 ? [] : Array.from({ length: int(1, 4) }, () => pickOne(ids));
    return {
      clips: list,
      chains,
      sequence,
      settings: {
        width,
        height,
        maxColumns: int(1, 5),
        gap: pickOne([0, 0, 2, 4, 10, 3]),
        reorderWindow: int(0, 5),
        order: { mode: rnd() < 0.3 ? 'random' : 'list', seed: int(0, 1000) },
        transitionDuration: pickOne([0, 0.25, 0.5, 0.5, 1, 2]),
        linkTransition: rnd() < 0.5 ? 'cut' : 'global',
        ...(rnd() < 0.5 && { maxDuration: 1 + rnd() * total * 0.5 }),
      },
    };
  }

  test('random projects satisfy every invariant in the three output shapes, also cut at their limit', () => {
    const stats = { chains: 0, sequences: 0, truncated: 0 };
    for (const shape of [[1920, 1080], [1080, 1920], [1080, 1080]] as const) {
      for (let seed = 1; seed <= 150; seed += 1) {
        const input = randomInput(seed, shape);
        const result = planMix(input);
        const check = (p: MixPlan, what: string) => {
          const issues = validatePlan(p, input);
          if (issues.length > 0) throw new Error(`${shape.join('x')} seed ${seed} ${what}: ${issues.join('; ')}\n${formatPlan(p)}`);
        };
        check(result, 'plan');
        expect(planMix(input)).toEqual(result); // deterministic

        const links = getPlanLinks(input.clips, input);
        stats.chains += links.chains.length;
        if (links.sequence.length > 0) stats.sequences += 1;
        const { maxDuration } = input.settings;
        if (maxDuration != null) {
          const cut = truncatePlan(result, maxDuration);
          check(cut, `cut at ${maxDuration}`);
          if (cut !== result) stats.truncated += 1;
        }
      }
    }
    expect(stats.chains).toBeGreaterThan(300);
    expect(stats.sequences).toBeGreaterThan(150);
    expect(stats.truncated).toBeGreaterThan(100);
  }, 30_000);

  test('9:16: a rows plan with chains and a sequence is the columns plan of the transposed clips', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const input = randomInput(700 + seed, [1080, 1920]);
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

  test('200 clips with chains, a sequence and a limit are planned in well under a second', () => {
    const list = Array.from({ length: 200 }, (_v, i) => clip(`c${i}`, 3 + (i % 11), presets[i % presets.length]!));
    const chains = Array.from({ length: 30 }, (_v, k) => [`c${6 * k + 1}`, `c${6 * k + 2}`, `c${6 * k + 3}`]);
    for (const maxColumns of [3, 6]) {
      const input: PlanMixInput = {
        clips: list,
        chains,
        sequence: ['c0', 'c100', 'c199'],
        settings: settings({ maxColumns, reorderWindow: maxColumns === 6 ? 10 : 3, maxDuration: 200 }),
      };
      const start = performance.now();
      const result = planMix(input);
      expect(performance.now() - start).toBeLessThan(1000);
      expect(validatePlan(result, input)).toEqual([]);
      expect(validatePlan(truncatePlan(result, 200), input)).toEqual([]);
    }
  });
});
