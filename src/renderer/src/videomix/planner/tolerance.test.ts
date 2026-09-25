import { describe, test, expect } from 'vitest';

import { fitMaxRectToFraction } from '../fitFractions';
import type { FitLayout } from '../fitFractions';
import { getAspectRange, getAxisLengths, getCellRect, getExtendedCropForAspect, getMainAspectRange, getWidthRange, rectAspect } from '../geometry';
import type { Rect } from '../types';
import { formatPlan } from './formatPlan';
import { planMix } from './planMix';
import { getPlanAxis } from './types';
import type { MixPlan, PlanMixInput, PlannerClip } from './types';
import { validatePlan } from './validatePlan';

// T44b: the 1 % aspect tolerance. Clips fitted to a fraction whose cell isn't a whole even number of px (1/3 of
// 1280, or depending on the gap) leave no fill: the planner takes widths up to 1 % off their range, and the crop absorbs
// the mismatch (cut inside the max without min, a few px of E7 with min, or a ≤ 1 % stretch).

interface Output { width: number, height: number, gap: number }

const outputs: Output[] = [
  { width: 1280, height: 720, gap: 0 },
  { width: 1280, height: 720, gap: 4 },
  { width: 1280, height: 720, gap: 10 },
  { width: 1920, height: 1080, gap: 0 },
  { width: 1920, height: 1080, gap: 8 },
  { width: 1920, height: 1080, gap: 5 },
];

/** Sources of the clips: a 16:9 and a 9:16 video (display px). */
const sources = [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 1280, height: 720 }, { width: 720, height: 1280 }];

const fitLayout = (o: Output): FitLayout => ({ ...o, axis: o.width >= o.height ? 'columns' : 'rows' });

/** The source's whole frame, "Fit to 1/3" (F2) and no min. */
function thirdOf(frame: { width: number, height: number }, o: Output): Rect {
  const res = fitMaxRectToFraction({ maxRect: { x: 0, y: 0, ...frame }, frame, fraction: '1/3', layout: fitLayout(o) });
  expect(res.ok).toBe(true);
  return res.ok ? res.maxRect : { x: 0, y: 0, ...frame };
}

function plan(input: PlanMixInput) {
  const result = planMix(input);
  expect(validatePlan(result, input)).toEqual([]);
  return result;
}

const settingsOf = (o: Output) => ({ ...o, maxColumns: 3, reorderWindow: 0, order: { mode: 'list' as const, seed: 0 }, transitionDuration: 0.5 });

const clipOf = (id: string, maxRect: Rect, minRect?: Rect, frame?: { width: number, height: number }): PlannerClip => ({
  id,
  duration: 10,
  aspectRange: getAspectRange(maxRect, minRect),
  rects: { maxRect, minRect },
  ...(frame != null && { extendBeyondMax: { frame } }),
});

const fillOf = (p: MixPlan) => p.layouts[0]!.fills.reduce((acc, f) => acc + f.width, 0);

/** Each cell of the first layout with its clip's crop (as render and preview compute it). */
function cellsOf(p: MixPlan, clips: PlannerClip[]) {
  const axis = getPlanAxis(p);
  return p.layouts[0]!.columns.map((col) => {
    const placement = p.placements.find((pl) => pl.column === col.column && pl.startTime === 0)!;
    const clip = clips.find((c) => c.id === placement.clipId)!;
    const cell = getCellRect(axis, { offset: col.x, length: col.width }, p);
    return { cell, placement, ...getExtendedCropForAspect(clip.rects!.maxRect, clip.rects!.minRect, placement.extendedMaxRect, cell.width / cell.height) };
  });
}

describe('three clips without min fitted to 1/3 (T44b)', () => {
  test.each(outputs)('$width×$height, gap $gap: no fill, cut ≤ 1 % inside the max, no stretch', (o) => {
    let neededTolerance = 0;
    for (const frame of sources) {
      const maxRect = thirdOf(frame, o);
      for (const extend of [false, true]) {
        const clips = ['a', 'b', 'c'].map((id) => clipOf(id, maxRect, undefined, extend ? frame : undefined));
        const p = plan({ clips, settings: settingsOf(o) });
        const ctx = `${JSON.stringify({ frame, maxRect, extend })}\n${formatPlan(p)}`;
        expect(p.layouts[0]!.columns, ctx).toHaveLength(3);
        // at most the 1 px of an odd usable width
        expect(fillOf(p), ctx).toBeLessThanOrEqual(1);
        expect(p.warnings.filter((w) => w.type !== 'upscale'), ctx).toEqual([]);
        for (const { cell, fit, strategy, crop, placement } of cellsOf(p, clips)) {
          expect(fit, ctx).toBe('fill');
          // a clip without min is cut inside its max first: never extended nor stretched
          expect(placement.extendedMaxRect, ctx).toBeUndefined();
          expect(['none', 'crop'], ctx).toContain(strategy);
          // the crop has the cell's proportion (up to the even rounding of its size): scaled uniformly
          expect(Math.abs(rectAspect(crop) / (cell.width / cell.height) - 1), ctx).toBeLessThan(0.002);
          expect(crop.width * crop.height, ctx).toBeGreaterThanOrEqual(maxRect.width * maxRect.height * (1 - 0.012));
        }
      }
      // without the tolerance, these clips left fill or didn't fit three in a row
      const { main, cross } = getAxisLengths('columns', o);
      const exact = getWidthRange(getMainAspectRange(getAspectRange(maxRect), 'columns'), cross);
      const usable = 2 * Math.floor((main - 2 * o.gap) / 2);
      if (3 * exact.max < usable || 3 * exact.min > usable) neededTolerance += 1;
    }
    // 1/3 of these outputs isn't a whole even number of px, except 1920 without gap and 1280 with 10 px (420)
    const exactThird = (2 * Math.floor((o.width - 2 * o.gap) / 2)) / 3;
    if (exactThird % 2 !== 0) expect(neededTolerance).toBeGreaterThan(0);
  });

  test('rows (9:16 output): three horizontals fitted to 1/3 of 1280 px of height', () => {
    const o = { width: 720, height: 1280, gap: 0 };
    for (const frame of sources) {
      const maxRect = thirdOf(frame, o);
      const clips = ['a', 'b', 'c'].map((id) => clipOf(id, maxRect));
      const p = plan({ clips, settings: settingsOf(o) });
      expect(getPlanAxis(p)).toBe('rows');
      expect(fillOf(p), formatPlan(p)).toBe(0);
      for (const { fit, strategy } of cellsOf(p, clips)) {
        expect(fit).toBe('fill');
        expect(['none', 'crop']).toContain(strategy);
      }
    }
  });
});

describe('clips with min within the tolerance (T44b)', () => {
  // a 426x720 max with a min as tall as it (it can only narrow): a third of 1280 is 426.67 px, so the row is 2 px short
  const frame = { width: 1280, height: 720 };
  const maxRect: Rect = { x: 426, y: 0, width: 426, height: 720 };
  const minRect: Rect = { x: 526, y: 0, width: 226, height: 720 };
  const o = { width: 1280, height: 720, gap: 0 };

  test('with E7 and material: a few px beyond the max instead of stretching (not warned)', () => {
    const clips = ['a', 'b', 'c'].map((id) => clipOf(id, maxRect, minRect, frame));
    const p = plan({ clips, settings: settingsOf(o) });
    expect(fillOf(p), formatPlan(p)).toBe(0);
    const cells = cellsOf(p, clips);
    // the widened one (428 px) shows 2 more px of its source; the other ones fit exactly
    expect(cells.map((c) => c.cell.width)).toEqual([428, 426, 426]);
    expect(cells.map((c) => c.strategy)).toEqual(['extend', 'none', 'none']);
    const widened = cells[0]!;
    // 2 px can't be split in even halves: they go to one side
    expect(widened.placement.extendedMaxRect).toEqual({ x: 426, y: 0, width: 428, height: 720 });
    expect(widened.crop).toEqual({ x: 426, y: 0, width: 428, height: 720 });
    expect(widened.fit).toBe('fill');
    // the few px of the tolerance stand in for a ≤ 1 % stretch: no `extended` warning
    expect(p.warnings).toEqual([]);
  });

  test('a real E7 extension beyond the tolerance is still warned', () => {
    // two of them in 1280 px: 640 px cells, far beyond the 426 px of the max (+1 %)
    const clips = ['a', 'b'].map((id) => clipOf(id, maxRect, minRect, frame));
    const p = plan({ clips, settings: { ...settingsOf(o), maxColumns: 2 } });
    expect(fillOf(p), formatPlan(p)).toBe(0);
    const extended = p.warnings.filter((w) => w.type === 'extended');
    expect(extended.map((w) => w.clipId).sort(), formatPlan(p)).toEqual(['a', 'b']);
    expect(extended.every((w) => w.type === 'extended' && w.pixels > 100)).toBe(true);
  });

  test('without E7: stretched ≤ 1 %, still no fill', () => {
    const clips = ['a', 'b', 'c'].map((id) => clipOf(id, maxRect, minRect));
    const p = plan({ clips, settings: settingsOf(o) });
    expect(fillOf(p)).toBe(0);
    const cells = cellsOf(p, clips);
    expect(cells.map((c) => c.strategy)).toEqual(['stretch', 'none', 'none']);
    expect(cells[0]!.crop).toEqual(maxRect);
    expect(p.warnings).toEqual([]);
  });
});
