import { describe, test, expect } from 'vitest';

import { getAspectRange, getCellRect, getExtendedCropForAspect, rectContains } from '../geometry';
import type { Rect } from '../types';
import { extendPlan, shareEven } from './extendPlan';
import { formatPlan } from './formatPlan';
import { planMix } from './planMix';
import { getPlanWarnings } from './planWarnings';
import { createRandom } from './random';
import { truncatePlan } from './truncatePlan';
import { getPlanAxis, getPlanAxisLengths } from './types';
import type { MixPlan, PlanMixInput, PlannerClip, PlannerSettings } from './types';
import { validatePlan } from './validatePlan';

// E7 (T38b): extending clips beyond their max rect to cover fill, as a last resort after the normal planning.

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

const FRAME_169 = { width: 1920, height: 1080 };

/** A clip with its rects; `frame` makes it extendable (flag on, source size known). */
function clip(id: string, duration: number, maxRect: Rect, frame?: { width: number, height: number }, minRect?: Rect): PlannerClip {
  return {
    id,
    duration,
    aspectRange: getAspectRange(maxRect, minRect),
    rects: { maxRect, minRect },
    ...(frame != null && { extendBeyondMax: { frame } }),
  };
}

/** 9:16 max rect of a 16:9 source, at `x`. */
const vertical = (x = 656): Rect => ({ x, y: 0, width: 608, height: 1080 });

/** The same input without extension (flag off). */
const withoutExtension = (input: PlanMixInput): PlanMixInput => ({
  ...input,
  clips: input.clips.map((c) => {
    const copy = { ...c };
    delete copy.extendBeyondMax;
    return copy;
  }),
});

function plan(input: PlanMixInput) {
  const result = planMix(input);
  expect(validatePlan(result, input)).toEqual([]);
  return result;
}

const fillOf = (layout: MixPlan['layouts'][number]) => layout.fills.reduce((acc, f) => acc + f.width, 0);
const byClip = (p: MixPlan, id: string) => p.placements.find((pl) => pl.clipId === id)!;
const timing = (p: MixPlan) => p.placements.map(({ clipId, column, startTime, endTime, transitionIn, transitionOut }) => ({ clipId, column, startTime, endTime, transitionIn, transitionOut }));

describe('structural fill becomes material beyond the max', () => {
  test('a lone 9:16 clip of a 16:9 source fills the frame with its whole source', () => {
    const input = { clips: [clip('v', 10, vertical(), FRAME_169)], settings: settings() };
    const before = plan(withoutExtension(input));
    expect(before.layouts[0]).toMatchObject({ columns: [{ column: 0, x: 656, width: 608 }], fills: [{ x: 0, width: 656 }, { x: 1264, width: 656 }] });

    const p = plan(input);
    expect(p.layouts).toEqual([{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 1920 }], fills: [] }]);
    expect(byClip(p, 'v').extendedMaxRect).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(p.warnings).toEqual([{ type: 'extended', clipId: 'v', pixels: 1312, time: 0, endTime: 10 }]);
    // same decisions, only the geometry changes
    expect(timing(p)).toEqual(timing(before));
  });

  test('asymmetric: a max near the frame edge extends more on the other side; the room limits it', () => {
    // a 1400 px wide source with the max 100 px from its left edge: 100 px on the left, 692 px on the right
    const p = plan({ clips: [clip('v', 10, vertical(100), { width: 1400, height: 1080 })], settings: settings() });
    expect(p.layouts[0]).toEqual({ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 260, width: 1400 }], fills: [{ x: 0, width: 260 }, { x: 1660, width: 260 }] });
    expect(byClip(p, 'v').extendedMaxRect).toEqual({ x: 0, y: 0, width: 1400, height: 1080 });
    // the rest stays fill, and is still warned
    expect(p.warnings).toEqual([{ type: 'fill', time: 0, width: 520 }, { type: 'extended', clipId: 'v', pixels: 792, time: 0, endTime: 10 }]);
  });

  test('the extra length is shared in proportion to the material of each clip', () => {
    // two 9:16 columns (1216 px, 704 px of fill): one from a 1920 px wide source (1312 px of room), one from a 912 px wide one (304)
    const input = { clips: [clip('a', 10, vertical(), FRAME_169), clip('b', 10, vertical(152), { width: 912, height: 1080 })], settings: settings() };
    const before = plan(withoutExtension(input));
    expect(before.layouts[0]!.columns.map((c) => c.width)).toEqual([608, 608]);
    const p = plan(input);
    // 704 × 1312 / 1616 ≈ 571.6 → 572 and 704 × 304 / 1616 ≈ 132.4 → 132 (even, largest remainder)
    expect(p.layouts[0]).toEqual({ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 1180 }, { column: 1, x: 1180, width: 740 }], fills: [] });
    expect(byClip(p, 'a').extendedMaxRect).toEqual({ x: 370, y: 0, width: 1180, height: 1080 });
    expect(byClip(p, 'b').extendedMaxRect).toEqual({ x: 86, y: 0, width: 740, height: 1080 });
    expect(p.warnings.filter((w) => w.type === 'fill')).toEqual([]);
  });

  test('saturates: with little material, each clip takes all of it and the rest stays fill', () => {
    const input = { clips: [clip('a', 10, vertical(50), { width: 708, height: 1080 }), clip('b', 10, vertical(0), { width: 648, height: 1080 })], settings: settings({ gap: 8 }) };
    const p = plan(input);
    // rooms 100 and 40 px: 1216 + 8 + 140 = 1364, 556 px of fill around
    expect(p.layouts[0]!.columns.map((c) => c.width)).toEqual([708, 648]);
    expect(fillOf(p.layouts[0]!)).toBe(556);
    expect(p.layouts[0]!.columns[1]!.x - p.layouts[0]!.columns[0]!.x - 708).toBe(8);
  });

  test('a column also showing a clip that can\'t extend stays as it is', () => {
    // 'a' is replaced in its column by 'x' (no extension): only the column of 'b' may take the fill
    const input = {
      clips: [clip('a', 6, vertical(), FRAME_169), clip('b', 12, vertical(), FRAME_169), clip('x', 6, vertical())],
      settings: settings({ maxColumns: 2 }),
    };
    const before = plan(withoutExtension(input));
    const p = plan(input);
    expect(timing(p)).toEqual(timing(before));
    const columnOf = (id: string) => byClip(p, id).column;
    expect(columnOf('x')).toBe(columnOf('a'));
    p.layouts.forEach((layout, i) => {
      expect(layout.columns.find((c) => c.column === columnOf('a'))?.width).toBe(before.layouts[i]!.columns.find((c) => c.column === columnOf('a'))?.width);
    });
    expect(byClip(p, 'b').extendedMaxRect).toBeDefined();
    expect(byClip(p, 'a').extendedMaxRect).toBeUndefined();
  });

  test('without extendable clips (flag off, unknown source size, no room) the plan is identical', () => {
    const clips = [clip('a', 6, vertical()), clip('b', 12, vertical()), clip('c', 7, { x: 0, y: 0, width: 1080, height: 1080 }, { width: 1080, height: 1080 })];
    const input = { clips, settings: settings() };
    expect(planMix(input)).toEqual(planMix(withoutExtension(input)));
    const unchanged = planMix(withoutExtension(input));
    expect(extendPlan({ ...unchanged, warnings: [] }, input.clips, 0)).toEqual({ ...unchanged, warnings: [] });
  });

  test('the end of the video is not re-expanded: a column that runs out stays fill', () => {
    const input = { clips: [clip('a', 4, vertical(), FRAME_169), clip('b', 10, vertical(), FRAME_169)], settings: settings() };
    const before = plan(withoutExtension(input));
    const p = plan(input);
    expect(p.layouts).toHaveLength(before.layouts.length);
    expect(timing(p)).toEqual(timing(before));
    // 'a' ends at 4 s with the video still going: its area becomes fill (fade out), no keyframe widens 'b'
    expect(byClip(p, 'a').transitionOut).toBeGreaterThan(0);
    expect(p.layouts.every((l) => l.time <= 0)).toBe(true);
  });
});

describe('rows (9:16) and pillarbox/letterbox', () => {
  test('9:16: rows get taller with material above and below the max', () => {
    // 2.4:1 max rects of a 16:9 source: rows of 450 px; 280 px of room above and below → up to 606 px
    const wide: Rect = { x: 0, y: 140, width: 1920, height: 800 };
    const input = { clips: ['a', 'b', 'c'].map((id, i) => clip(id, 10 + i, wide, FRAME_169)), settings: settings({ width: 1080, height: 1920 }) };
    const before = plan(withoutExtension(input));
    expect(before.axis).toBe('rows');
    const p = plan(input);
    expect(timing(p)).toEqual(timing(before));
    expect(fillOf(p.layouts[0]!)).toBeLessThan(fillOf(before.layouts[0]!));
    p.placements.forEach((placement) => {
      const ext = placement.extendedMaxRect!;
      // vertical only: same x and width as the max
      expect(ext).toMatchObject({ x: 0, width: 1920 });
      expect(ext.height).toBeGreaterThan(800);
      expect(rectContains({ x: 0, y: 0, ...FRAME_169 }, ext)).toBe(true);
    });
    expect(p.warnings.some((w) => w.type === 'extended')).toBe(true);
  });

  test('a clip with pillarbox in its own column fills it with material (hand-written plan)', () => {
    const handPlan: MixPlan = {
      width: 1920,
      height: 1080,
      duration: 5,
      placements: [{ clipId: 'v', column: 0, startTime: 0, endTime: 5, transitionIn: 0 }],
      layouts: [{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 1000 }, { column: 1, x: 1000, width: 920 }], fills: [] }],
      warnings: [],
    };
    const clips = [clip('v', 5, vertical(1000), FRAME_169)];
    expect(getPlanWarnings(handPlan, clips, 0.5)).toEqual([{ type: 'pillarbox', clipId: 'v', time: 0 }]);
    const extended = extendPlan(handPlan, clips, 0);
    expect(extended.layouts).toEqual(handPlan.layouts);
    // 392 px more, centred (196 per side) → x = 804
    expect(extended.placements[0]!.extendedMaxRect).toEqual({ x: 804, y: 0, width: 1000, height: 1080 });
    expect(getPlanWarnings(extended, clips, 0.5)).toEqual([{ type: 'extended', clipId: 'v', pixels: 392, time: 0, endTime: 5 }]);
    // a letterboxed row in a rows plan, likewise
    const rowsPlan: MixPlan = { ...handPlan, width: 1080, height: 1920, axis: 'rows', layouts: [{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 1920 }], fills: [] }] };
    const rowClip = [clip('v', 5, { x: 0, y: 140, width: 1920, height: 800 }, FRAME_169)];
    expect(extendPlan(rowsPlan, rowClip, 0).placements[0]!.extendedMaxRect).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    // a full-height row would need 3413 px of height: all 280 px of room, and the rest is still letterbox
    expect(getPlanWarnings(extendPlan(rowsPlan, rowClip, 0), rowClip, 0.5)).toEqual([
      { type: 'letterbox', clipId: 'v', time: 0 },
      { type: 'extended', clipId: 'v', pixels: 280, time: 0, endTime: 5 },
    ]);
  });
});

describe('chains, sequence and maximum duration (T38)', () => {
  test('chain members and the always-visible sequence extend like any clip', () => {
    const clips = [clip('s1', 5, vertical(), FRAME_169), clip('s2', 5, vertical(300), FRAME_169), clip('k1', 4, vertical(), FRAME_169), clip('k2', 4, vertical(), FRAME_169)];
    const input: PlanMixInput = { clips, settings: settings({ maxColumns: 2 }), sequence: ['s1', 's2'], chains: [['k1', 'k2']] };
    const before = plan(withoutExtension(input));
    const p = plan(input);
    expect(timing(p)).toEqual(timing(before));
    p.layouts.forEach((layout, i) => expect(fillOf(layout)).toBeLessThanOrEqual(fillOf(before.layouts[i]!)));
    expect(fillOf(p.layouts[0]!)).toBe(0);
    for (const id of ['s1', 's2', 'k1', 'k2']) expect(byClip(p, id).extendedMaxRect).toBeDefined();
  });

  test('a cut plan keeps the extensions up to the cut', () => {
    const input = { clips: [clip('a', 10, vertical(), FRAME_169), clip('b', 10, vertical(), FRAME_169)], settings: settings({ maxColumns: 1, maxDuration: 12 }) };
    const p = plan(input);
    const cut = truncatePlan(p, 12);
    expect(validatePlan(cut, input)).toEqual([]);
    const extended = cut.warnings.filter((w) => w.type === 'extended');
    expect(extended.map((w) => [w.clipId, w.endTime])).toEqual([['a', 10], ['b', 12]]);
    expect(truncatePlan(p, 9.5).warnings.filter((w) => w.type === 'extended').map((w) => w.clipId)).toEqual(['a']);
  });
});

describe('helpers', () => {
  test('shareEven: proportional, even, saturating, deterministic', () => {
    expect(shareEven(704, [1312, 304])).toEqual([572, 132]);
    expect(shareEven(10, [4, 100])).toEqual([0, 10]);
    expect(shareEven(104, [4, 100])).toEqual([4, 100]);
    expect(shareEven(6, [10, 10, 10])).toEqual([2, 2, 2]);
    expect(shareEven(4, [10, 10, 10])).toEqual([2, 2, 0]);
    expect(shareEven(0, [10])).toEqual([0]);
    expect(shareEven(10, [0, 0])).toEqual([0, 0]);
  });
});

describe('properties', () => {
  function randomInput(seed: number, shape: [number, number]): PlanMixInput {
    const rnd = createRandom(seed);
    const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
    const clips = Array.from({ length: int(1, 20) }, (_v, i): PlannerClip => {
      const frame = rnd() < 0.5 ? { width: 1920, height: 1080 } : (rnd() < 0.5 ? { width: 1080, height: 1920 } : { width: 2 * int(20, 1000), height: 2 * int(20, 1000) });
      const maxRect: Rect = { x: 0, y: 0, width: 2 * int(8, frame.width / 2), height: 2 * int(8, frame.height / 2) };
      maxRect.x = 2 * int(0, (frame.width - maxRect.width) / 2);
      maxRect.y = 2 * int(0, (frame.height - maxRect.height) / 2);
      const minRect = rnd() < 0.5 ? undefined : { x: maxRect.x, y: maxRect.y, width: 2 * int(8, maxRect.width / 2), height: 2 * int(8, maxRect.height / 2) };
      const duration = rnd() < 0.15 ? 0.2 + rnd() : 1 + rnd() * 20;
      return clip(`c${i}`, duration, maxRect, rnd() < 0.8 ? frame : undefined, minRect);
    });
    const ids = clips.map((c) => c.id);
    return {
      clips,
      settings: settings({ width: shape[0], height: shape[1], maxColumns: int(1, 4), gap: [0, 0, 4, 10, 3][int(0, 4)]!, reorderWindow: int(0, 4), transitionDuration: [0, 0.5, 1][int(0, 2)]! }),
      ...(rnd() < 0.3 && ids.length >= 4 && { chains: [[ids[1]!, ids[3]!]] }),
      ...(rnd() < 0.2 && ids.length >= 3 && { sequence: [ids[2]!] }),
    };
  }

  test('in 16:9, 9:16 and 1:1: valid, same decisions, never more fill, crops inside the source', () => {
    const exercised = { extended: 0, lessFill: 0 };
    for (const shape of [[1920, 1080], [1080, 1920], [1080, 1080]] as [number, number][]) {
      for (let seed = 1; seed <= 80; seed += 1) {
        const input = randomInput(seed * 7 + shape[1], shape);
        const p = planMix(input);
        const at = `${shape.join('x')} seed ${seed}`;
        const issues = validatePlan(p, input);
        if (issues.length > 0) throw new Error(`${at}: ${issues.join('; ')}\n${formatPlan(p)}`);
        const before = planMix(withoutExtension(input));
        // the extension is a last resort: the options (and the axis of a square output) are the same
        expect(p.axis, at).toBe(before.axis);
        expect(timing(p), at).toEqual(timing(before));
        expect(p.layouts.map((l) => [l.time, l.transitionDuration, l.columns.map((c) => c.column)]), at).toEqual(before.layouts.map((l) => [l.time, l.transitionDuration, l.columns.map((c) => c.column)]));
        p.layouts.forEach((layout, i) => {
          expect(fillOf(layout), at).toBeLessThanOrEqual(fillOf(before.layouts[i]!));
          if (fillOf(layout) < fillOf(before.layouts[i]!)) exercised.lessFill += 1;
          // columns only get longer
          layout.columns.forEach((c, k) => expect(c.width, at).toBeGreaterThanOrEqual(before.layouts[i]!.columns[k]!.width));
        });
        // the crop of every extended clip, in every layout it is shown in, stays inside its source frame
        const axis = getPlanAxis(p);
        const { main } = getPlanAxisLengths(p);
        p.placements.forEach((placement) => {
          const c = input.clips.find((x) => x.id === placement.clipId)!;
          if (placement.extendedMaxRect == null) return;
          exercised.extended += 1;
          const frame = { x: 0, y: 0, ...c.extendBeyondMax!.frame };
          p.layouts.forEach((layout) => {
            const col = layout.columns.find((x) => x.column === placement.column);
            if (col == null) return;
            const cell = getCellRect(axis, { offset: 0, length: Math.max(2, col.width) }, p);
            const { crop } = getExtendedCropForAspect(c.rects!.maxRect, c.rects!.minRect, placement.extendedMaxRect, cell.width / cell.height);
            expect(rectContains(frame, crop), at).toBe(true);
          });
          expect(main).toBeGreaterThan(0);
        });
        expect(planMix(input)).toEqual(p); // deterministic
      }
    }
    expect(exercised.extended).toBeGreaterThan(50);
    expect(exercised.lessFill).toBeGreaterThan(20);
  });
});
