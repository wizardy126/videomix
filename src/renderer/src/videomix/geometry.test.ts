import { describe, test, expect } from 'vitest';

import {
  ASPECT_TOLERANCE, clampRect, distributeWidths, getAspectRange, getAxisLengths, getCellRect, getCropForAspect, getMainAspectRange,
  getOrientation, getScaleFactor, getWidthRange, normalizeClipRects, normalizeRectEven, rectAspect, rectContains,
  transposeAspectRange, transposeRect,
} from './geometry';
import type { AspectRange } from './geometry';
import type { Rect } from './types';

// Small seeded PRNG (Park-Miller) so the property tests are deterministic.
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

type Random = ReturnType<typeof seededRandom>;
const randInt = (rnd: Random, min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));

const clampNum = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const frame: Rect = { x: 0, y: 0, width: 1920, height: 1080 };

const isEven = (n: number) => n % 2 === 0;
const isEvenRect = (r: Rect) => isEven(r.x) && isEven(r.y) && isEven(r.width) && isEven(r.height);

function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, width: Math.min(a.x + a.width, b.x + b.width) - x, height: Math.min(a.y + a.height, b.y + b.height) - y };
}

// Random integer rect of at least `minSize` inside `bounds`, any parity unless `even`.
function randomRectInside(rnd: Random, bounds: Rect, minSize: number, even = false): Rect {
  const snap = (v: number) => (even ? 2 * Math.floor(v / 2) : v);
  const width = snap(randInt(rnd, minSize, bounds.width));
  const height = snap(randInt(rnd, minSize, bounds.height));
  const x = bounds.x + snap(randInt(rnd, 0, bounds.width - width));
  const y = bounds.y + snap(randInt(rnd, 0, bounds.height - height));
  return { x, y, width, height };
}

function randomSourceFrame(rnd: Random, even: boolean): Rect {
  const w = randInt(rnd, 64, 3840);
  const h = randInt(rnd, 64, 3840);
  return { x: 0, y: 0, width: even ? 2 * Math.floor(w / 2) : w, height: even ? 2 * Math.floor(h / 2) : h };
}

describe('basic helpers', () => {
  test('rectAspect and getOrientation', () => {
    expect(rectAspect(frame)).toBeCloseTo(16 / 9);
    expect(getOrientation(frame)).toBe('horizontal');
    expect(getOrientation({ x: 0, y: 0, width: 100, height: 100 })).toBe('vertical');
    expect(getOrientation({ x: 0, y: 0, width: 1080, height: 1920 })).toBe('vertical');
  });

  test('rectContains', () => {
    expect(rectContains(frame, frame)).toBe(true);
    expect(rectContains(frame, { x: 10, y: 10, width: 100, height: 100 })).toBe(true);
    expect(rectContains(frame, { x: 1900, y: 0, width: 21, height: 100 })).toBe(false);
    expect(rectContains(frame, { x: -1, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectContains({ x: 10, y: 10, width: 10, height: 10 }, frame)).toBe(false);
  });

  test('clampRect moves inside and shrinks if needed', () => {
    expect(clampRect({ x: -10, y: 1000, width: 100, height: 100 }, frame)).toEqual({ x: 0, y: 980, width: 100, height: 100 });
    expect(clampRect({ x: 100, y: -5, width: 3000, height: 50 }, frame)).toEqual({ x: 0, y: 0, width: 1920, height: 50 });
    expect(clampRect({ x: 5, y: 5, width: 10, height: 10 }, { x: 10, y: 10, width: 100, height: 100 })).toEqual({ x: 10, y: 10, width: 10, height: 10 });
  });

  test('normalizeRectEven', () => {
    const odd = { x: 1, y: 3, width: 101, height: 50 };
    expect(normalizeRectEven(odd)).toEqual({ x: 2, y: 4, width: 100, height: 48 });
    expect(normalizeRectEven(odd, 'grow')).toEqual({ x: 0, y: 2, width: 102, height: 52 });
    expect(normalizeRectEven(frame)).toEqual(frame);
    expect(normalizeRectEven(frame, 'grow')).toEqual(frame);
  });

  test('normalizeClipRects keeps min inside max', () => {
    expect(normalizeClipRects({ x: 1, y: 1, width: 1919, height: 1079 }, { x: 1, y: 1, width: 101, height: 101 })).toEqual({
      max: { x: 2, y: 2, width: 1918, height: 1078 },
      min: { x: 2, y: 2, width: 100, height: 100 },
    });
    expect(normalizeClipRects(frame, undefined)).toEqual({ max: frame, min: frame });
  });

  test('getScaleFactor', () => {
    expect(getScaleFactor({ x: 0, y: 0, width: 960, height: 540 }, 1920, 1080)).toBe(2);
    // pillarbox: limited by height
    expect(getScaleFactor({ x: 0, y: 0, width: 400, height: 540 }, 1920, 1080)).toBe(2);
    // letterbox: limited by width
    expect(getScaleFactor({ x: 0, y: 0, width: 300, height: 540 }, 600, 1600)).toBe(2);
  });
});

describe('getAspectRange', () => {
  test('min == max', () => {
    expect(getAspectRange(frame)).toEqual({ min: 16 / 9, max: 16 / 9, preferred: 16 / 9 });
    expect(getAspectRange(frame, frame)).toEqual({ min: 16 / 9, max: 16 / 9, preferred: 16 / 9 });
  });

  test('with min', () => {
    const range = getAspectRange(frame, { x: 760, y: 340, width: 400, height: 400 });
    expect(range.min).toBeCloseTo(400 / 1080);
    expect(range.max).toBeCloseTo(1920 / 400);
    expect(range.preferred).toBeCloseTo(16 / 9);
  });
});

describe('getCropForAspect', () => {
  const centerMin = { x: 760, y: 340, width: 400, height: 400 };

  test('min == max', () => {
    expect(getCropForAspect(frame, undefined, 16 / 9)).toEqual({ crop: frame, fit: 'fill' });
    expect(getCropForAspect(frame, undefined, 32 / 9)).toEqual({ crop: frame, fit: 'pillarbox' });
    expect(getCropForAspect(frame, undefined, 8 / 9)).toEqual({ crop: frame, fit: 'letterbox' });
  });

  test('preferred aspect shows the whole max', () => {
    expect(getCropForAspect(frame, centerMin, 16 / 9)).toEqual({ crop: frame, fit: 'fill' });
  });

  test('square crop centered on min', () => {
    expect(getCropForAspect(frame, centerMin, 1)).toEqual({ crop: { x: 420, y: 0, width: 1080, height: 1080 }, fit: 'fill' });
  });

  test('wide crop is width-limited', () => {
    expect(getCropForAspect(frame, centerMin, 3)).toEqual({ crop: { x: 0, y: 220, width: 1920, height: 640 }, fit: 'fill' });
  });

  test('min at the edges of max', () => {
    expect(getCropForAspect(frame, { x: 0, y: 0, width: 400, height: 400 }, 1).crop).toEqual({ x: 0, y: 0, width: 1080, height: 1080 });
    expect(getCropForAspect(frame, { x: 1520, y: 680, width: 400, height: 400 }, 1).crop).toEqual({ x: 840, y: 0, width: 1080, height: 1080 });
    expect(getCropForAspect(frame, { x: 1520, y: 680, width: 400, height: 400 }, 3).crop).toEqual({ x: 0, y: 440, width: 1920, height: 640 });
  });

  test('extreme aspects', () => {
    expect(getCropForAspect(frame, centerMin, 10)).toEqual({ crop: { x: 0, y: 340, width: 1920, height: 400 }, fit: 'pillarbox' });
    expect(getCropForAspect(frame, centerMin, 0.05)).toEqual({ crop: { x: 760, y: 0, width: 400, height: 1080 }, fit: 'letterbox' });
  });

  test('tolerance around the range limits', () => {
    const range = getAspectRange(frame, centerMin);
    expect(getCropForAspect(frame, centerMin, range.max * (1 + ASPECT_TOLERANCE / 2)).fit).toBe('fill');
    expect(getCropForAspect(frame, centerMin, range.max * (1 + ASPECT_TOLERANCE * 2)).fit).toBe('pillarbox');
    expect(getCropForAspect(frame, centerMin, range.min * (1 - ASPECT_TOLERANCE / 2)).fit).toBe('fill');
    expect(getCropForAspect(frame, centerMin, range.min * (1 - ASPECT_TOLERANCE * 2)).fit).toBe('letterbox');
  });

  test('odd rects give even crops inside max', () => {
    const max = { x: 1, y: 1, width: 1917, height: 1077 };
    const { crop } = getCropForAspect(max, { x: 1, y: 501, width: 33, height: 33 }, 1);
    expect(isEvenRect(crop)).toBe(true);
    expect(rectContains(max, crop)).toBe(true);
    expect(crop).toEqual({ x: 2, y: 2, width: 1076, height: 1076 });
  });

  test('properties over random cases', () => {
    const rnd = seededRandom(1234);
    for (let i = 0; i < 5000; i += 1) {
      const evenInputs = i % 2 === 0;
      const sourceFrame = randomSourceFrame(rnd, evenInputs);
      const max = randomRectInside(rnd, sourceFrame, 16, evenInputs);
      const min = rnd() < 0.2 ? undefined : randomRectInside(rnd, max, 16, evenInputs);
      const range = getAspectRange(max, min);
      // log-uniform aspects well beyond both limits
      const aspect = Math.exp(Math.log(range.min / 3) + rnd() * (Math.log(range.max * 3) - Math.log(range.min / 3)));

      const { crop, fit } = getCropForAspect(max, min, aspect);
      const normalized = normalizeClipRects(max, min);
      const ctx = { i, max, min, aspect, crop, fit };

      expect(isEvenRect(crop), JSON.stringify(ctx)).toBe(true);
      expect(rectContains(max, crop), JSON.stringify(ctx)).toBe(true);
      expect(rectContains(sourceFrame, crop), JSON.stringify(ctx)).toBe(true);
      expect(rectContains(crop, normalized.min), JSON.stringify(ctx)).toBe(true);
      // with even inputs the min is fully contained; with odd ones, all of min that lies in the even max
      expect(rectContains(crop, evenInputs ? (min ?? max) : intersect(min ?? max, normalized.max)), JSON.stringify(ctx)).toBe(true);

      if (aspect >= range.min && aspect <= range.max) {
        expect(fit, JSON.stringify(ctx)).toBe('fill');
        // requested aspect within 1 px on the dimension that was rounded
        const ok = Math.abs(crop.width - aspect * crop.height) <= 1 || Math.abs(crop.height - crop.width / aspect) <= 1;
        expect(ok, JSON.stringify(ctx)).toBe(true);
      } else if (aspect > range.max * (1 + ASPECT_TOLERANCE)) {
        expect(fit, JSON.stringify(ctx)).toBe('pillarbox');
        expect(rectAspect(crop)).toBeCloseTo(range.max, 9);
      } else if (aspect < range.min * (1 - ASPECT_TOLERANCE)) {
        expect(fit, JSON.stringify(ctx)).toBe('letterbox');
        expect(rectAspect(crop)).toBeCloseTo(range.min, 9);
      } else {
        expect(fit, JSON.stringify(ctx)).toBe('fill');
      }
    }
  });
});

describe('getWidthRange', () => {
  test('even bounds inside the aspect range', () => {
    expect(getWidthRange({ min: 0.3, max: 1, preferred: 0.5 }, 1080)).toEqual({ min: 324, max: 1080, preferred: 540 });
    expect(getWidthRange({ min: 0.3001, max: 0.9999, preferred: 0.5 }, 1080)).toEqual({ min: 326, max: 1078, preferred: 540 });
  });

  test('range too narrow for an even width', () => {
    // 9:16 at 1080p is 607.5 px
    expect(getWidthRange({ min: 9 / 16, max: 9 / 16, preferred: 9 / 16 }, 1080)).toEqual({ min: 608, max: 608, preferred: 608 });
  });
});

describe('distributeWidths', () => {
  const H = 1080;
  const W = 1920;
  const horizontal = getAspectRange(frame);
  const vertical = getAspectRange({ x: 0, y: 0, width: 1080, height: 1920 });

  test('empty row is all fill', () => {
    expect(distributeWidths({ clips: [], width: W, height: H, gap: 0 })).toEqual({ widths: [], fill: W });
  });

  test('single 16:9 clip fills the frame', () => {
    expect(distributeWidths({ clips: [horizontal], width: W, height: H, gap: 0 })).toEqual({ widths: [1920], fill: 0 });
  });

  test('infeasible row', () => {
    expect(distributeWidths({ clips: [horizontal, horizontal], width: W, height: H, gap: 0 })).toBeUndefined();
  });

  test('three rigid verticals leave fill', () => {
    expect(distributeWidths({ clips: [vertical, vertical, vertical], width: W, height: H, gap: 0 })).toEqual({ widths: [608, 608, 608], fill: 96 });
  });

  test('three verticals with a min can widen to fill', () => {
    const range = getAspectRange({ x: 0, y: 0, width: 1080, height: 1920 }, { x: 270, y: 160, width: 540, height: 1600 });
    expect(distributeWidths({ clips: [range, range, range], width: W, height: H, gap: 0 })).toEqual({ widths: [640, 640, 640], fill: 0 });
    expect(distributeWidths({ clips: [range, range, range], width: W, height: H, gap: 6 })).toEqual({ widths: [636, 636, 636], fill: 0 });
  });

  test('flexibility is spent proportionally to the margin', () => {
    const rigid = getAspectRange({ x: 0, y: 0, width: 1080, height: 1080 });
    const flexible = getAspectRange(frame, { x: 760, y: 0, width: 400, height: 1080 });
    // rigid square keeps 1080, flexible 16:9 shrinks to 840
    expect(distributeWidths({ clips: [rigid, flexible], width: W, height: H, gap: 0 })).toEqual({ widths: [1080, 840], fill: 0 });
  });

  test('odd gap leaves a 1 px fill', () => {
    const range = getAspectRange(frame, { x: 760, y: 0, width: 400, height: 1080 });
    const result = distributeWidths({ clips: [range, range], width: W, height: H, gap: 3 });
    expect(result?.fill).toBe(1);
    expect(result?.widths.every((w) => isEven(w))).toBe(true);
  });

  test('properties over random rows', () => {
    const rnd = seededRandom(42);
    const heights = [360, 720, 1080, 2160];
    let feasible = 0;
    let withFill = 0;
    let infeasible = 0;
    for (let i = 0; i < 3000; i += 1) {
      const height = heights[randInt(rnd, 0, heights.length - 1)]!;
      const width = (height * 16) / 9;
      const n = randInt(rnd, 1, 5);
      const gap = rnd() < 0.5 ? 0 : randInt(rnd, 0, 20);
      const rects = Array.from({ length: n }, () => {
        // realistic sources: aspect between 1:4 and 4:1
        const sw = randInt(rnd, 240, 3840);
        const sh = Math.round(clampNum(sw / Math.exp((rnd() * 2 - 1) * Math.log(4)), 64, 3840));
        const max = randomRectInside(rnd, { x: 0, y: 0, width: sw, height: sh }, 64);
        const min = rnd() < 0.3 ? undefined : randomRectInside(rnd, max, 32);
        return { max, min };
      });
      const clips: AspectRange[] = rects.map(({ max, min }) => getAspectRange(max, min));
      const result = distributeWidths({ clips, width, height, gap });
      const bounds = clips.map((c) => getWidthRange(c, height));
      const usable = width - (n - 1) * gap;
      const ctx = JSON.stringify({ i, height, gap, clips, result });

      if (result == null) {
        infeasible += 1;
        expect(bounds.reduce((acc, bound) => acc + bound.min, 0), ctx).toBeGreaterThan(usable);
      } else {
        const sum = result.widths.reduce((acc, w) => acc + w, 0);
        expect(sum + (n - 1) * gap + result.fill, ctx).toBe(width);
        expect(result.fill, ctx).toBeGreaterThanOrEqual(0);
        result.widths.forEach((w, j) => {
          expect(isEven(w), ctx).toBe(true);
          expect(w, ctx).toBeGreaterThanOrEqual(bounds[j]!.min);
          expect(w, ctx).toBeLessThanOrEqual(bounds[j]!.max);
          // every column can be filled by a crop of its clip (a rigid clip whose exact width isn't even is off by
          // 1 px, which the tolerance absorbs unless the column is very narrow)
          if (bounds[j]!.min < bounds[j]!.max || w >= 2 / ASPECT_TOLERANCE) {
            expect(getCropForAspect(rects[j]!.max, rects[j]!.min, w / height).fit, ctx).toBe('fill');
          }
        });
        if (result.fill > 1) {
          withFill += 1;
          expect(result.widths, ctx).toEqual(bounds.map((b) => b.max));
        } else {
          feasible += 1;
        }
      }
    }
    // make sure the generator covers all three cases
    expect(feasible).toBeGreaterThan(100);
    expect(withFill).toBeGreaterThan(100);
    expect(infeasible).toBeGreaterThan(100);
  });

  test('is deterministic', () => {
    const clips = [getAspectRange(frame, { x: 100, y: 100, width: 300, height: 700 }), vertical, horizontal];
    const a = distributeWidths({ clips, width: 3840, height: 1080, gap: 2 });
    const b = distributeWidths({ clips, width: 3840, height: 1080, gap: 2 });
    expect(a).toEqual(b);
  });
});

describe('main axis (T29)', () => {
  test('transposing rects and aspect ranges', () => {
    const rect = { x: 10, y: 20, width: 300, height: 400 };
    expect(transposeRect(rect)).toEqual({ x: 20, y: 10, width: 400, height: 300 });
    expect(transposeRect(transposeRect(rect))).toEqual(rect);
    expect(transposeAspectRange({ min: 0.5, max: 2, preferred: 1.25 })).toEqual({ min: 0.5, max: 2, preferred: 0.8 });
    expect(transposeAspectRange({ min: 0.75, max: 16 / 9, preferred: 16 / 9 })).toEqual({ min: 9 / 16, max: 4 / 3, preferred: 9 / 16 });
    const range = { min: 0.75, max: 2, preferred: 1.5 };
    expect(getMainAspectRange(range, 'columns')).toBe(range);
    expect(getMainAspectRange(range, 'rows')).toEqual(transposeAspectRange(range));
  });

  test('the aspect range of a transposed clip is the transposed range', () => {
    const rnd = seededRandom(7);
    for (let i = 0; i < 300; i += 1) {
      const source = randomSourceFrame(rnd, true);
      const max = randomRectInside(rnd, source, 16, true);
      const min = rnd() < 0.3 ? undefined : randomRectInside(rnd, max, 16, true);
      const transposed = getAspectRange(transposeRect(max), min && transposeRect(min));
      const expected = transposeAspectRange(getAspectRange(max, min));
      expect(transposed.min).toBeCloseTo(expected.min, 12);
      expect(transposed.max).toBeCloseTo(expected.max, 12);
      expect(transposed.preferred).toBeCloseTo(expected.preferred, 12);
    }
  });

  test('the crop of a row is the transpose of the crop of the transposed column (pillarbox ↔ letterbox)', () => {
    const rnd = seededRandom(11);
    const swapFit = { fill: 'fill', pillarbox: 'letterbox', letterbox: 'pillarbox' } as const;
    for (let i = 0; i < 500; i += 1) {
      const source = randomSourceFrame(rnd, true);
      const max = randomRectInside(rnd, source, 16, true);
      const min = rnd() < 0.3 ? undefined : randomRectInside(rnd, max, 16, true);
      // a row of the output: full width W, some height h
      const W = 2 * randInt(rnd, 100, 1000);
      const h = 2 * randInt(rnd, 8, 1000);
      const row = getCropForAspect(max, min, W / h);
      const column = getCropForAspect(transposeRect(max), min && transposeRect(min), h / W);
      // allow the ±2 px of a different even rounding on the unconstrained side
      const t = transposeRect(column.crop);
      expect(Math.abs(t.width - row.crop.width) + Math.abs(t.height - row.crop.height)).toBeLessThanOrEqual(2);
      expect(swapFit[column.fit]).toBe(row.fit);
    }
  });

  test('frame lengths and cell rects along each axis', () => {
    expect(getAxisLengths('columns', { width: 1920, height: 1080 })).toEqual({ main: 1920, cross: 1080 });
    expect(getAxisLengths('rows', { width: 1080, height: 1920 })).toEqual({ main: 1920, cross: 1080 });
    expect(getCellRect('columns', { offset: 100, length: 600 }, { width: 1920, height: 1080 })).toEqual({ x: 100, y: 0, width: 600, height: 1080 });
    expect(getCellRect('rows', { offset: 100, length: 600 }, { width: 1080, height: 1920 })).toEqual({ x: 0, y: 100, width: 1080, height: 600 });
  });

  test('row heights: the column widths of the transposed clips', () => {
    // three 16:9 clips stacked in 1080x1920: 608 px each (607.5 rounded to even), 96 px of fill
    const h169 = getAspectRange({ x: 0, y: 0, width: 1920, height: 1080 });
    const result = distributeWidths({ clips: [h169, h169, h169].map((r) => getMainAspectRange(r, 'rows')), width: 1920, height: 1080, gap: 0 });
    expect(result).toEqual({ widths: [608, 608, 608], fill: 96 });
    // the upscale factor of such a row, in output terms: a 1280x720 source at 1080 px wide
    const small = { x: 0, y: 0, width: 1280, height: 720 };
    const { crop } = getCropForAspect(small, undefined, 1080 / 608);
    expect(getScaleFactor(crop, 1080, 608)).toBeCloseTo(1080 / 1280, 2);
  });
});
