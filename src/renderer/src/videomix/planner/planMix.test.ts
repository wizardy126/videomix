import { describe, test, expect } from 'vitest';

import { getAspectRange } from '../geometry';
import type { AspectRange } from '../geometry';
import type { Rect } from '../types';
import { formatPlan } from './formatPlan';
import { planMix } from './planMix';
import { createRandom } from './random';
import type { MixPlan, PlanMixInput, PlannerClip, PlannerSettings } from './types';
import { validatePlan } from './validatePlan';

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
