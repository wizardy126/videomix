import { describe, test, expect } from 'vitest';

import { getAspectRange, transposeAspectRange, transposeRect } from '../geometry';
import type { AspectRange } from '../geometry';
import type { Rect } from '../types';
import { formatPlan } from './formatPlan';
import { planMix, planMixAxis } from './planMix';
import { getPlanWarnings } from './planWarnings';
import { createRandom } from './random';
import type { MixPlan, PlanMixInput, PlannerClip, PlannerSettings } from './types';
import { getAnimatedColumn, validatePlan } from './validatePlan';

const range = (min: number, max: number, preferred = max): AspectRange => ({ min, max, preferred });
const rigid = (aspect: number) => range(aspect, aspect, aspect);

const H169 = rigid(16 / 9);
const V916 = rigid(9 / 16);
/** Vertical 9:16 whose min rect lets it widen up to 1:1. */
const V916_WIDE = range(9 / 16, 1, 9 / 16);
/** Horizontal 16:9 whose min rect lets it narrow down to 3:4. */
const H169_NARROW = range(3 / 4, 16 / 9);

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

const clip = (id: string, duration: number, aspectRange: AspectRange): PlannerClip => ({ id, duration, aspectRange });

function plan(input: PlanMixInput) {
  const result = planMix(input);
  expect(validatePlan(result, input)).toEqual([]);
  return result;
}

const byClip = (p: MixPlan, id: string) => p.placements.find((pl) => pl.clipId === id)!;
const columnsOf = (p: MixPlan) => new Set(p.placements.map((pl) => pl.column));
const relayouts = (p: MixPlan) => p.layouts.filter((l) => l.transitionDuration > 0);
const warningsOf = (p: MixPlan, type: string) => p.warnings.filter((w) => w.type === type);

describe('edge cases', () => {
  test('no clips', () => {
    const input = { clips: [], settings: settings() };
    const p = plan(input);
    expect(p.duration).toBe(0);
    expect(p.layouts).toEqual([{ time: 0, transitionDuration: 0, columns: [], fills: [{ x: 0, width: 1920 }] }]);
  });

  test('single clip fills the frame', () => {
    const p = plan({ clips: [clip('a', 10, H169)], settings: settings() });
    expect(p.duration).toBe(10);
    expect(p.layouts).toHaveLength(1);
    expect(p.layouts[0]!.columns).toEqual([{ column: 0, x: 0, width: 1920 }]);
    expect(p.warnings).toEqual([]);
  });

  test('single vertical clip: centered with fill', () => {
    const p = plan({ clips: [clip('a', 10, V916)], settings: settings() });
    expect(p.layouts[0]!.columns).toEqual([{ column: 0, x: 656, width: 608 }]);
    expect(p.layouts[0]!.fills).toEqual([{ x: 0, width: 656 }, { x: 1264, width: 656 }]);
    expect(warningsOf(p, 'fill')).toHaveLength(1);
  });

  test('all horizontal 16:9 without min: one column, direct substitutions', () => {
    const clips = [8, 12, 5, 9, 7].map((d, i) => clip(`h${i}`, d, H169));
    const p = plan({ clips, settings: settings() });
    expect(columnsOf(p).size).toBe(1);
    expect(p.layouts).toHaveLength(1);
    expect(p.placements.map((pl) => pl.clipId)).toEqual(['h0', 'h1', 'h2', 'h3', 'h4']);
    // each clip starts D before the previous one ends
    expect(p.placements.map((pl) => pl.startTime)).toEqual([0, 7.5, 19, 23.5, 32]);
    expect(p.duration).toBe(39);
    expect(p.warnings).toEqual([]);
  });

  test('all vertical 9:16 without margin: 3 columns with fill', () => {
    const clips = [10, 11, 12, 9, 8, 13].map((d, i) => clip(`v${i}`, d, V916));
    const p = plan({ clips, settings: settings() });
    expect(p.layouts).toHaveLength(1);
    expect(p.layouts[0]!.columns.map((c) => c.width)).toEqual([608, 608, 608]);
    expect(p.layouts[0]!.fills).toEqual([{ x: 0, width: 48 }, { x: 1872, width: 48 }]);
    expect(p.placements.map((pl) => pl.clipId)).toEqual(['v0', 'v1', 'v2', 'v3', 'v4', 'v5']);
  });

  test('all vertical 9:16 that can widen: 3 columns fill the frame', () => {
    const clips = [10, 11, 12, 9, 8, 13].map((d, i) => clip(`v${i}`, d, V916_WIDE));
    const p = plan({ clips, settings: settings() });
    expect(p.layouts).toHaveLength(1);
    expect(p.layouts[0]!.columns.map((c) => c.width)).toEqual([640, 640, 640]);
    expect(p.layouts[0]!.fills).toEqual([]);
    expect(p.warnings).toEqual([]);
  });

  test('clips shorter than 2 × D get shorter transitions', () => {
    const clips = [clip('a', 5, H169), clip('b', 0.6, H169), clip('c', 0.2, H169), clip('d', 5, H169)];
    const p = plan({ clips, settings: settings() });
    expect(p.placements.map((pl) => pl.transitionIn)).toEqual([0, 0.3, 0.1, 0.1]);
    expect(warningsOf(p, 'transition-shortened').map((w) => w.type === 'transition-shortened' && w.clipId)).toEqual(['b', 'c', 'd']);
  });

  test('clips ending less than D apart are resolved in one re-layout', () => {
    // v0 and v1 end 0.2 s apart and no pending clip fits their 608 px columns (no window, so no way around it)
    const wide = rigid(1.2);
    const clips = [clip('v0', 10, V916), clip('v1', 10.2, V916), clip('v2', 30, V916), clip('w0', 8, wide), clip('w1', 8, wide)];
    const p = plan({ clips, settings: settings({ reorderWindow: 0 }) });
    const animated = relayouts(p).filter((l) => l.time > 9 && l.time < 11);
    expect(animated).toHaveLength(1);
    // one column goes away and the other takes w0, in the same animation
    expect(animated[0]!.columns.map((c) => c.width).sort()).toEqual([1296, 608].sort());
    expect(byClip(p, 'w0').startTime).toBeGreaterThanOrEqual(9.5);
  });

  test('maxColumns = 1', () => {
    const clips = [clip('a', 5, V916), clip('b', 6, H169), clip('c', 4, V916_WIDE), clip('d', 7, H169_NARROW)];
    const p = plan({ clips, settings: settings({ maxColumns: 1 }) });
    expect(p.layouts.every((l) => l.columns.length === 1)).toBe(true);
    // a lone vertical leaves most of the frame as fill, so the horizontals go first where the window allows
    expect(p.placements.map((pl) => pl.clipId)).toEqual(['b', 'd', 'c', 'a']);
  });

  test('reorderWindow = 0 keeps the list order', () => {
    const aspects = [V916, H169, V916, H169_NARROW, V916_WIDE, H169, V916, V916];
    const clips = aspects.map((a, i) => clip(`c${i}`, 5 + (i % 3), a));
    const p = plan({ clips, settings: settings({ reorderWindow: 0 }) });
    const started = [...p.placements].sort((a, b) => a.startTime - b.startTime).map((pl) => pl.clipId);
    expect(started).toEqual(clips.map((c) => c.id));
  });

  test('reorder window lets a fitting clip go first', () => {
    // h2 fits the freed full-width column, v1 doesn't: with a window, h2 goes before v1 (direct substitution)
    const clips = [clip('h0', 5, H169), clip('v1', 5, V916), clip('h2', 5, H169)];
    const p = plan({ clips, settings: settings({ maxColumns: 1 }) });
    expect(p.placements.map((pl) => pl.clipId)).toEqual(['h0', 'h2', 'v1']);
    // a single column can only show the vertical centered with fill: same picture as a re-layout, without animating
    expect(p.layouts).toHaveLength(1);
    expect(warningsOf(p, 'pillarbox')).toEqual([{ type: 'pillarbox', clipId: 'v1', time: 9 }]);
    // without a window the order is kept
    const strict = plan({ clips, settings: settings({ maxColumns: 1, reorderWindow: 0 }) });
    expect(strict.placements.map((pl) => pl.clipId)).toEqual(['h0', 'v1', 'h2']);
  });

  test('random mode is deterministic per seed and differs between seeds', () => {
    const clips = Array.from({ length: 12 }, (_v, i) => clip(`c${i}`, 4 + i, [V916, H169_NARROW, V916_WIDE][i % 3]!));
    const input = (seed: number): PlanMixInput => ({ clips, settings: settings({ order: { mode: 'random', seed } }) });
    const a = plan(input(1));
    expect(plan(input(1))).toEqual(a);
    const b = plan(input(2));
    expect(b.placements.map((pl) => pl.clipId)).not.toEqual(a.placements.map((pl) => pl.clipId));
  });

  test('transition 0: hard cuts and instant re-layouts', () => {
    const clips = [clip('v0', 5, V916), clip('v1', 6, V916), clip('h', 5, H169), clip('v2', 4, V916)];
    const p = plan({ clips, settings: settings({ transitionDuration: 0 }) });
    expect(p.placements.every((pl) => pl.transitionIn === 0)).toBe(true);
    expect(p.layouts.every((l) => l.transitionDuration === 0)).toBe(true);
  });

  test('gap between columns', () => {
    const clips = [10, 11, 12].map((d, i) => clip(`v${i}`, d, V916_WIDE));
    const p = plan({ clips, settings: settings({ gap: 10 }) });
    const { columns } = p.layouts[0]!;
    expect(columns[1]!.x - (columns[0]!.x + columns[0]!.width)).toBe(10);
  });

  test('upscale warning needs rects', () => {
    const maxRect: Rect = { x: 0, y: 0, width: 400, height: 300 };
    const small: PlannerClip = { id: 's', duration: 5, aspectRange: getAspectRange(maxRect), rects: { maxRect } };
    const p = plan({ clips: [small], settings: settings() });
    expect(warningsOf(p, 'upscale')).toEqual([{ type: 'upscale', clipId: 's', factor: 3.6 }]);
  });

  test('a wide clip that must go into a narrow column is letterboxed with a warning', () => {
    // window 0 forces the horizontal in while the verticals keep playing
    const clips = [clip('v0', 5, V916), clip('v1', 20, V916), clip('v2', 20, V916), clip('h', 5, H169)];
    const p = plan({ clips, settings: settings({ reorderWindow: 0 }) });
    expect(p.warnings.some((w) => (w.type === 'letterbox' && w.clipId === 'h') || w.type === 'fill')).toBe(true);
  });
});

describe('decisions after T10 (T10b)', () => {
  test('fill before direct substitution: a re-layout that removes the fill beats a clip that fits', () => {
    // window 1 keeps the flexible f4 out of the initial row, so it starts with three rigid verticals and 96 px of fill
    const clips = [clip('v0', 5, V916), clip('v1', 10, V916), clip('v2', 12, V916), clip('v3', 8, V916), clip('f4', 8, V916_WIDE)];
    const p = plan({ clips, settings: settings({ reorderWindow: 1 }) });
    expect(p.layouts[0]!.fills.reduce((acc, f) => acc + f.width, 0)).toBe(96);
    // v3 fits the freed 608 px column exactly, but f4 widens to 704 px and the fill goes away
    expect(byClip(p, 'f4')).toMatchObject({ column: 0, startTime: 4.5 });
    expect(p.layouts[1]).toEqual({ time: 4.5, transitionDuration: 0.5, columns: [{ column: 0, x: 0, width: 704 }, { column: 1, x: 704, width: 608 }, { column: 2, x: 1312, width: 608 }], fills: [] });
  });

  test('fill before direct substitution only when the fill clearly goes down', () => {
    // no flexible clip in the window: nothing reduces the fill, so v3 goes in directly without animating
    const clips = [clip('v0', 5, V916), clip('v1', 10, V916), clip('v2', 12, V916), clip('v3', 8, V916), clip('v4', 8, V916)];
    const p = plan({ clips, settings: settings({ reorderWindow: 1 }) });
    expect(p.layouts).toHaveLength(1);
    expect(byClip(p, 'v3')).toMatchObject({ column: 0, startTime: 4.5 });
  });

  test('without fill, direct substitution keeps its priority', () => {
    const clips = [clip('f0', 5, V916_WIDE), clip('f1', 10, V916_WIDE), clip('f2', 12, V916_WIDE), clip('f3', 8, V916_WIDE), clip('h4', 8, H169_NARROW)];
    const p = plan({ clips, settings: settings() });
    expect(byClip(p, 'f3')).toMatchObject({ column: 0, startTime: 4.5 });
    expect(p.layouts.map((l) => l.time)).not.toContain(4.5);
  });

  test('balanced columns: a flexible horizontal is narrowed to sit next to a vertical', () => {
    // the 16:9 clip keeps 1312 px (68 % of its max) instead of taking the whole frame alone
    const clips = [clip('h0', 10, H169_NARROW), clip('v1', 10, V916), clip('h2', 10, H169_NARROW), clip('v3', 10, V916)];
    const p = plan({ clips, settings: settings() });
    expect(p.layouts[0]!.columns.map((c) => c.width)).toEqual([1312, 608]);
  });

  test('balanced columns: full screen when sharing would crop more than ~40 % of the max', () => {
    // next to a square clip the 16:9 one would keep 840 px (44 % of its max): it goes alone, full screen
    const p = plan({ clips: [clip('h0', 10, H169_NARROW), clip('s1', 10, rigid(1))], settings: settings() });
    expect(p.layouts[0]!.columns.map((c) => c.width)).toEqual([1920]);
    // two 16:9 clips side by side would keep 50 % each
    const pair = plan({ clips: [clip('a', 10, H169_NARROW), clip('b', 10, H169_NARROW)], settings: settings() });
    expect(columnsOf(pair).size).toBe(1);
  });

  test('a new column grows from width 0 next to its right neighbour and its clip starts without crossfade', () => {
    // no fitting clip for the full-width column: h0 is replaced by three flexible verticals at once
    const clips = [clip('h0', 6, H169), clip('f1', 10, V916_WIDE), clip('f2', 10, V916_WIDE), clip('f3', 10, V916_WIDE)];
    const p = plan({ clips, settings: settings({ reorderWindow: 0 }) });
    const [before, after] = p.layouts;
    expect(after).toMatchObject({ time: 5.5, transitionDuration: 0.5 });
    expect(after!.columns).toEqual([{ column: 0, x: 0, width: 640 }, { column: 1, x: 640, width: 640 }, { column: 2, x: 1280, width: 640 }]);
    expect(p.placements.filter((pl) => pl.column !== 0).map((pl) => [pl.clipId, pl.startTime, pl.transitionIn])).toEqual([['f2', 5.5, 0], ['f3', 5.5, 0]]);
    expect(byClip(p, 'f1')).toMatchObject({ column: 0, startTime: 5.5, transitionIn: 0.5 });
    // at the start of the animation the new columns are 0 px wide at the right edge of the freed column
    expect(getAnimatedColumn(before!, after!, 1, 1920, 0)).toEqual({ x: 1920, width: 0 });
    expect(getAnimatedColumn(before!, after!, 2, 1920, 0)).toEqual({ x: 1920, width: 0 });
    // with a gap and no right neighbour it sits past the edge with its gap (T16: no gap bar popping up next to a right fill)
    expect(getAnimatedColumn(before!, after!, 2, 1920, 16)).toEqual({ x: 1936, width: 0 });
    // column 1 still has column 2 as right neighbour in `after`, but column 2 isn't in `before`: same rule
    expect(getAnimatedColumn(before!, after!, 1, 1920, 16)).toEqual({ x: 1936, width: 0 });
  });

  test('end of the video: a clip without successor fades out to the fill', () => {
    const clips = [clip('v0', 5, V916), clip('v1', 0.6, V916), clip('v2', 12, V916), clip('v3', 8, V916)];
    const p = plan({ clips, settings: settings() });
    // v0 and v3 end before the video (v2) does: they fade out; v1 is followed by v3; v2 ends the video
    expect(p.placements.map((pl) => [pl.clipId, pl.transitionOut ?? 0])).toEqual([['v0', 0.5], ['v1', 0], ['v2', 0], ['v3', 0.5]]);
    // like a crossfade, at most half the clip
    const short = plan({ clips: [clip('v0', 0.6, V916), clip('v1', 12, V916), clip('v2', 12, V916)], settings: settings() });
    expect(byClip(short, 'v0').transitionOut).toBe(0.3);
  });

  test('end of the video: a column removed by a re-layout does not fade out', () => {
    // see the merged-event test: one column is removed while w0 comes in
    const wide = rigid(1.2);
    const clips = [clip('v0', 10, V916), clip('v1', 10.2, V916), clip('v2', 30, V916), clip('w0', 8, wide), clip('w1', 8, wide)];
    const p = plan({ clips, settings: settings({ reorderWindow: 0 }) });
    const lastColumns = new Set(p.layouts.at(-1)!.columns.map((c) => c.column));
    const removed = p.placements.filter((pl) => !lastColumns.has(pl.column));
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.every((pl) => pl.transitionOut == null)).toBe(true);
  });
});

describe('snapshots', () => {
  test('mixed verticals and horizontals', () => {
    const clips = [
      clip('v1', 12, V916), clip('v2', 9, V916), clip('v3', 14, V916_WIDE),
      clip('h1', 10, H169_NARROW), clip('v4', 8, V916), clip('h2', 11, H169),
      clip('v5', 7, V916_WIDE), clip('v6', 10, V916), clip('h3', 6, H169_NARROW),
    ];
    expect(formatPlan(plan({ clips, settings: settings() }))).toMatchSnapshot();
  });

  test('flexible clips with a gap, 2 columns max', () => {
    const clips = [
      clip('a', 9, range(0.5, 1.2, 0.8)), clip('b', 7, range(0.6, 1.78)), clip('c', 12, range(0.5, 0.9, 0.5625)),
      clip('d', 5, range(1, 2.4, 1.78)), clip('e', 8, range(0.56, 0.56, 0.56)), clip('f', 10, range(0.75, 1.33, 1)),
    ];
    expect(formatPlan(plan({ clips, settings: settings({ maxColumns: 2, gap: 8 }) }))).toMatchSnapshot();
  });

  test('random order', () => {
    const clips = Array.from({ length: 8 }, (_v, i) => clip(`c${i}`, 5 + ((i * 7) % 6), [V916, H169_NARROW, V916_WIDE, H169][i % 4]!));
    expect(formatPlan(plan({ clips, settings: settings({ order: { mode: 'random', seed: 42 } }) }))).toMatchSnapshot();
  });
});

describe('vertical and square output (T29)', () => {
  const portrait = (overrides: Partial<PlannerSettings> = {}) => settings({ width: 1080, height: 1920, ...overrides });
  const square = (overrides: Partial<PlannerSettings> = {}) => settings({ width: 1080, height: 1080, ...overrides });
  const transposed = (clips: PlannerClip[]) => clips.map((c): PlannerClip => ({
    ...c,
    aspectRange: transposeAspectRange(c.aspectRange),
    ...(c.rects != null && { rects: { maxRect: transposeRect(c.rects.maxRect), minRect: c.rects.minRect && transposeRect(c.rects.minRect) } }),
  }));

  test('9:16: a rows plan is the columns plan of the transposed clips', () => {
    const clips = [
      clip('h1', 12, H169), clip('h2', 9, H169_NARROW), clip('v1', 14, V916),
      clip('h3', 10, H169), clip('s1', 8, rigid(1)), clip('h4', 11, range(1.2, 2.4, 16 / 9)),
      clip('w1', 7, rigid(4 / 3)), clip('h5', 10, H169_NARROW),
    ];
    for (const overrides of [{}, { gap: 8 }, { maxColumns: 2, reorderWindow: 1 }, { transitionDuration: 0 }]) {
      const rows = plan({ clips, settings: portrait(overrides) });
      const columns = plan({ clips: transposed(clips), settings: settings(overrides) });
      expect(rows).toMatchObject({ width: 1080, height: 1920, axis: 'rows' });
      expect(columns.axis).toBe('columns');
      expect(rows.placements).toEqual(columns.placements);
      expect(rows.layouts).toEqual(columns.layouts);
      // warnings are in output terms: a transposed pillarbox is a letterbox
      const swap = { pillarbox: 'letterbox', letterbox: 'pillarbox' } as const;
      expect(rows.warnings).toEqual(columns.warnings.map((w) => (w.type === 'pillarbox' || w.type === 'letterbox' ? { ...w, type: swap[w.type] } : w)));
    }
  });

  test('9:16: horizontals are stacked as full-width rows, never side by side', () => {
    const clips = [10, 11, 12, 9, 8].map((d, i) => clip(`h${i}`, d, H169));
    const p = plan({ clips, settings: portrait() });
    expect(p.axis).toBe('rows');
    // 1920 / 607.5: three rows of 608 px and 96 px of fill (48 above, 48 below)
    expect(p.layouts[0]).toEqual({ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 48, width: 608 }, { column: 1, x: 656, width: 608 }, { column: 2, x: 1264, width: 608 }], fills: [{ x: 0, width: 48 }, { x: 1872, width: 48 }] });
    expect(formatPlan(p).split('\n')[0]).toBe('plan 1080x1920 rows, 18.50s');
  });

  test('9:16: a vertical clip fills the frame alone; a square one leaves fill above and below', () => {
    expect(plan({ clips: [clip('v', 10, V916)], settings: portrait() }).layouts[0]!.columns).toEqual([{ column: 0, x: 0, width: 1920 }]);
    const sq = plan({ clips: [clip('s', 10, rigid(1))], settings: portrait() });
    expect(sq.layouts[0]).toMatchObject({ columns: [{ column: 0, x: 420, width: 1080 }], fills: [{ x: 0, width: 420 }, { x: 1500, width: 420 }] });
  });

  test('9:16: animated re-layouts between rows', () => {
    // a lone vertical row is replaced by three flexible horizontals that share the height (new rows grow from 0)
    const clips = [clip('v0', 6, V916), clip('f1', 10, H169_NARROW), clip('f2', 10, H169_NARROW), clip('f3', 10, H169_NARROW)];
    const p = plan({ clips, settings: portrait({ reorderWindow: 0 }) });
    expect(relayouts(p).length).toBeGreaterThan(0);
    expect(p.layouts.at(-1)!.columns.map((c) => c.width).reduce((a, b) => a + b, 0) + p.layouts.at(-1)!.fills.reduce((a, f) => a + f.width, 0)).toBe(1920);
  });

  test('warnings are in output terms: upscale by the row width, letterbox for a row too tall', () => {
    // a 400x300 source stretched to the full 1080 px width
    const maxRect: Rect = { x: 0, y: 0, width: 400, height: 300 };
    const p = plan({ clips: [{ id: 's', duration: 5, aspectRange: getAspectRange(maxRect), rects: { maxRect } }], settings: portrait() });
    expect(warningsOf(p, 'upscale')).toEqual([{ type: 'upscale', clipId: 's', factor: 2.7 }]);
    // a rigid 16:9 clip in a full-height row: fill above and below
    const handPlan: MixPlan = {
      width: 1080,
      height: 1920,
      axis: 'rows',
      duration: 5,
      placements: [{ clipId: 'h', column: 0, startTime: 0, endTime: 5, transitionIn: 0 }],
      layouts: [{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 1920 }], fills: [] }],
      warnings: [],
    };
    expect(getPlanWarnings(handPlan, [clip('h', 5, H169)], 0.5)).toEqual([{ type: 'letterbox', clipId: 'h', time: 0 }]);
  });

  test('1:1: rows for horizontals, columns for verticals, decided once for the whole project', () => {
    // 16:9 clips whose min rect allows a wider (shorter) crop stack as two 1080x540 rows; side by side they would
    // need 540 px wide columns (letterbox). The transposed case (verticals) goes side by side.
    const horizontals = [10, 11, 12, 9].map((d, i) => clip(`h${i}`, d, range(16 / 9, 2.4, 16 / 9)));
    const verticals = [10, 11, 12, 9].map((d, i) => clip(`v${i}`, d, range(1 / 2.4, 9 / 16, 9 / 16)));
    const stacked = plan({ clips: horizontals, settings: square() });
    expect(stacked.axis).toBe('rows');
    expect(stacked.layouts[0]!.columns.map((c) => c.width)).toEqual([540, 540]);
    const sideBySide = plan({ clips: verticals, settings: square() });
    expect(sideBySide.axis).toBe('columns');
    expect(sideBySide.layouts[0]!.columns.map((c) => c.width)).toEqual([540, 540]);
    // the chosen plan is the one with the lower score
    const input = { clips: [...horizontals.slice(0, 2), ...verticals.slice(0, 2)], settings: square() };
    const byAxis = { columns: planMixAxis(input, 'columns'), rows: planMixAxis(input, 'rows') };
    const best = byAxis.rows.score.total < byAxis.columns.score.total ? 'rows' : 'columns';
    expect(plan(input).axis).toBe(best);
    // ties (nothing to compare) keep columns
    expect(plan({ clips: [], settings: square() }).axis).toBe('columns');
  });

  test('the score adds up its terms and counts fill, crops and re-layouts', () => {
    const { score } = planMixAxis({ clips: [clip('v', 10, V916)], settings: settings() }, 'columns');
    expect(score.total).toBeCloseTo(score.fill + score.clips + score.relayouts + score.order);
    // 1312 of 1920 px of fill for 10 s, one column (+4)
    expect(score.fill).toBeCloseTo(60 * (1312 / 1920) * 10);
    expect(score.clips).toBeCloseTo(4);
    expect(score.relayouts).toBe(0);
    const stacked = planMixAxis({ clips: [clip('v', 10, V916)], settings: square() }, 'rows');
    // a 9:16 clip in a 1080x1080 square: a row of 1080 px can only show it with fill on its sides
    expect(stacked.plan.warnings.some((w) => w.type === 'pillarbox')).toBe(true);
    expect(stacked.score.total).toBeGreaterThan(planMixAxis({ clips: [clip('v', 10, V916)], settings: square() }, 'columns').score.total);
  });

  test('a forced axis is honoured, and validatePlan checks the axis of the output', () => {
    const clips = [clip('a', 5, H169), clip('b', 6, V916)];
    expect(plan({ clips, settings: square({ axis: 'rows' }) }).axis).toBe('rows');
    const input = { clips, settings: portrait() };
    const sideBySide = planMixAxis(input, 'columns').plan;
    expect(validatePlan(sideBySide, input)).toContain('Plan axis columns, expected rows');
  });
});

describe('properties', () => {
  const presets = [H169, V916, V916_WIDE, H169_NARROW, rigid(4 / 3), rigid(1), rigid(4 / 5), range(0.3, 3, 1), rigid(2.39)];

  function randomInput(seed: number): PlanMixInput {
    const rnd = createRandom(seed);
    const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
    const pickOne = <T, >(items: readonly T[]) => items[int(0, items.length - 1)]!;
    const [width, height] = pickOne([[1920, 1080], [1280, 720], [640, 360], [1080, 1920], [1080, 1080]] as const);
    const clips = Array.from({ length: int(1, 30) }, (_v, i): PlannerClip => {
      const duration = rnd() < 0.15 ? 0.1 + rnd() * 1.2 : 1 + rnd() * 25;
      if (rnd() < 0.3) {
        const maxRect = { x: 0, y: 0, width: 2 * int(8, 1000), height: 2 * int(8, 1000) };
        const minRect = rnd() < 0.5 ? undefined : { x: 0, y: 0, width: 2 * int(8, maxRect.width / 2), height: 2 * int(8, maxRect.height / 2) };
        return { id: `c${i}`, duration, aspectRange: getAspectRange(maxRect, minRect), rects: { maxRect, minRect } };
      }
      return { id: `c${i}`, duration, aspectRange: pickOne(presets) };
    });
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

  test('200 random projects satisfy every invariant', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const input = randomInput(seed);
      const result = planMix(input);
      const issues = validatePlan(result, input);
      if (issues.length > 0) throw new Error(`seed ${seed}: ${issues.join('; ')}\n${formatPlan(result)}`);
      expect(planMix(input)).toEqual(result); // deterministic
    }
  });

  test('random projects in each output shape and axis satisfy every invariant (T29)', () => {
    const shapes: [number, number, PlannerSettings['axis']][] = [[1920, 1080, undefined], [1080, 1920, undefined], [1080, 1080, undefined], [1080, 1080, 'columns'], [1080, 1080, 'rows'], [360, 640, undefined]];
    for (const [width, height, axis] of shapes) {
      for (let seed = 1; seed <= 60; seed += 1) {
        const base = randomInput(1000 + seed);
        const input: PlanMixInput = { clips: base.clips, settings: { ...base.settings, width, height, axis } };
        const result = planMix(input);
        const issues = validatePlan(result, input);
        if (issues.length > 0) throw new Error(`${width}x${height} ${axis ?? 'auto'} seed ${seed}: ${issues.join('; ')}\n${formatPlan(result)}`);
        expect(result.axis).toBe(axis ?? (width > height ? 'columns' : (width < height ? 'rows' : result.axis)));
        expect(planMix(input)).toEqual(result); // deterministic
      }
    }
  });

  test('200 clips are planned in well under a second', () => {
    const clips = Array.from({ length: 200 }, (_v, i) => clip(`c${i}`, 3 + (i % 11), presets[i % presets.length]!));
    for (const maxColumns of [3, 6]) {
      const input = { clips, settings: settings({ maxColumns, reorderWindow: maxColumns === 6 ? 10 : 3 }) };
      const start = performance.now();
      const result = planMix(input);
      expect(performance.now() - start).toBeLessThan(1000);
      expect(validatePlan(result, input)).toEqual([]);
    }
  });
});
