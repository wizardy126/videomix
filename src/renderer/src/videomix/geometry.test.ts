import { describe, test, expect } from 'vitest';

import {
  ASPECT_TOLERANCE, clampRect, distributeWidths, extendMaxRect, getAspectRange, getAxisLengths, getCellRect, getCropForAspect,
  getExtendedCropForAspect, getExtensionRoom, getMainAspectRange,
  getOrientation, getScaleFactor, getTolerantWidthRange, getWidthRange, normalizeClipRects, normalizeRectEven, rectAspect, rectContains,
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
const floorEven = (v: number) => 2 * Math.floor(v / 2);
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
    expect(getCropForAspect(frame, undefined, 16 / 9)).toEqual({ crop: frame, fit: 'fill', strategy: 'none' });
    expect(getCropForAspect(frame, undefined, 32 / 9)).toEqual({ crop: frame, fit: 'pillarbox', strategy: 'none' });
    expect(getCropForAspect(frame, undefined, 8 / 9)).toEqual({ crop: frame, fit: 'letterbox', strategy: 'none' });
  });

  test('preferred aspect shows the whole max', () => {
    expect(getCropForAspect(frame, centerMin, 16 / 9)).toEqual({ crop: frame, fit: 'fill', strategy: 'none' });
  });

  test('square crop centered on min', () => {
    expect(getCropForAspect(frame, centerMin, 1)).toEqual({ crop: { x: 420, y: 0, width: 1080, height: 1080 }, fit: 'fill', strategy: 'none' });
  });

  test('wide crop is width-limited', () => {
    expect(getCropForAspect(frame, centerMin, 3)).toEqual({ crop: { x: 0, y: 220, width: 1920, height: 640 }, fit: 'fill', strategy: 'none' });
  });

  test('min at the edges of max', () => {
    expect(getCropForAspect(frame, { x: 0, y: 0, width: 400, height: 400 }, 1).crop).toEqual({ x: 0, y: 0, width: 1080, height: 1080 });
    expect(getCropForAspect(frame, { x: 1520, y: 680, width: 400, height: 400 }, 1).crop).toEqual({ x: 840, y: 0, width: 1080, height: 1080 });
    expect(getCropForAspect(frame, { x: 1520, y: 680, width: 400, height: 400 }, 3).crop).toEqual({ x: 0, y: 440, width: 1920, height: 640 });
  });

  test('extreme aspects', () => {
    expect(getCropForAspect(frame, centerMin, 10)).toEqual({ crop: { x: 0, y: 340, width: 1920, height: 400 }, fit: 'pillarbox', strategy: 'none' });
    expect(getCropForAspect(frame, centerMin, 0.05)).toEqual({ crop: { x: 760, y: 0, width: 400, height: 1080 }, fit: 'letterbox', strategy: 'none' });
  });

  test('tolerance around the range limits', () => {
    const range = getAspectRange(frame, centerMin);
    expect(getCropForAspect(frame, centerMin, range.max * (1 + ASPECT_TOLERANCE / 2)).fit).toBe('fill');
    expect(getCropForAspect(frame, centerMin, range.max * (1 + ASPECT_TOLERANCE * 2)).fit).toBe('pillarbox');
    expect(getCropForAspect(frame, centerMin, range.min * (1 - ASPECT_TOLERANCE / 2)).fit).toBe('fill');
    expect(getCropForAspect(frame, centerMin, range.min * (1 - ASPECT_TOLERANCE * 2)).fit).toBe('letterbox');
  });

  test('T44b: within the tolerance a clip without min is cut inside its max, centred, and scaled uniformly', () => {
    const third: Rect = { x: 100, y: 0, width: 426, height: 720 };
    // a 428x720 cell (0.5944 against 0.5917): 4 px less height, 2 px at the top and 2 at the bottom
    expect(getCropForAspect(third, undefined, 428 / 720)).toEqual({ crop: { x: 100, y: 2, width: 426, height: 716 }, fit: 'fill', strategy: 'crop' });
    // a narrower 424x720 cell: less width (the even centring takes 2 px from one side)
    expect(getCropForAspect(third, undefined, 424 / 720)).toEqual({ crop: { x: 102, y: 0, width: 424, height: 720 }, fit: 'fill', strategy: 'crop' });
    // a mismatch below the even rounding of the crop changes nothing
    expect(getCropForAspect(third, undefined, 426.5 / 720)).toEqual({ crop: third, fit: 'fill', strategy: 'none' });
    // beyond the tolerance: pillarbox with the whole max, as before
    expect(getCropForAspect(third, undefined, 432 / 720)).toEqual({ crop: third, fit: 'pillarbox', strategy: 'none' });
  });

  test('T44b: within the tolerance a clip with min keeps the crop at the range limit, stretched', () => {
    const max: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const min: Rect = { x: 760, y: 140, width: 400, height: 800 };
    // range [400/1080, 1920/800 = 2.4]
    expect(getCropForAspect(max, min, 2.4 * 1.005)).toEqual({ crop: { x: 0, y: 140, width: 1920, height: 800 }, fit: 'fill', strategy: 'stretch' });
    expect(getCropForAspect(max, min, (400 / 1080) * 0.995)).toEqual({ crop: { x: 760, y: 0, width: 400, height: 1080 }, fit: 'fill', strategy: 'stretch' });
    // at the limit itself, nothing to absorb
    expect(getCropForAspect(max, min, 2.4).strategy).toBe('none');
    // a min touching the max's edges is the same (the explicit min is a hard limit)
    expect(getCropForAspect(max, max, (16 / 9) * 1.005)).toEqual({ crop: max, fit: 'fill', strategy: 'stretch' });
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

      const { crop, fit, strategy } = getCropForAspect(max, min, aspect);
      const normalized = normalizeClipRects(max, min);
      const ctx = { i, max, min, aspect, crop, fit, strategy };

      expect(isEvenRect(crop), JSON.stringify(ctx)).toBe(true);
      expect(rectContains(max, crop), JSON.stringify(ctx)).toBe(true);
      expect(rectContains(sourceFrame, crop), JSON.stringify(ctx)).toBe(true);
      if (strategy === 'crop') {
        // T44b: only a clip without min, cut by at most the tolerance (+ the even rounding) across the mismatch, centred
        expect(min, JSON.stringify(ctx)).toBeUndefined();
        const m = normalized.max;
        const cutWidth = crop.width < m.width;
        expect(cutWidth ? crop.height : crop.width, JSON.stringify(ctx)).toBe(cutWidth ? m.height : m.width);
        const [size, full] = cutWidth ? [crop.width, m.width] : [crop.height, m.height];
        expect(size, JSON.stringify(ctx)).toBeGreaterThanOrEqual(full * (1 - ASPECT_TOLERANCE) - 2);
        const start = cutWidth ? crop.x - m.x : crop.y - m.y;
        expect(Math.abs(start - (full - size - start)), JSON.stringify(ctx)).toBeLessThanOrEqual(2);
        // closer to the requested aspect than the whole max
        expect(Math.abs(Math.log(rectAspect(crop) / aspect)), JSON.stringify(ctx)).toBeLessThan(Math.abs(Math.log(rectAspect(m) / aspect)));
      } else {
        expect(rectContains(crop, normalized.min), JSON.stringify(ctx)).toBe(true);
        // with even inputs the min is fully contained; with odd ones, all of min that lies in the even max
        expect(rectContains(crop, evenInputs ? (min ?? max) : intersect(min ?? max, normalized.max)), JSON.stringify(ctx)).toBe(true);
      }

      if (aspect >= range.min && aspect <= range.max) {
        expect(fit, JSON.stringify(ctx)).toBe('fill');
        expect(strategy, JSON.stringify(ctx)).toBe('none');
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
        // T44b: within the tolerance, a clip without min is cut, one with min stretched (unless the rounding covers it)
        if (min == null) {
          expect(strategy, JSON.stringify(ctx)).toBe(rectContains(crop, normalized.max) ? 'none' : 'crop');
        } else {
          // the crop at the range limit; stretched, unless the mismatch is below the even rounding of its size
          expect(rectAspect(crop)).toBeCloseTo(aspect > range.max ? range.max : range.min, 9);
          const mismatch = aspect > range.max ? aspect * crop.height - crop.width : crop.width / aspect - crop.height;
          expect(strategy, JSON.stringify(ctx)).toBe(mismatch >= 1 ? 'stretch' : 'none');
        }
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
    let tolerated = 0;
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
      const tolerant = clips.map((c) => getTolerantWidthRange(c, height));
      const usable = width - (n - 1) * gap;
      const ctx = JSON.stringify({ i, height, gap, clips, result });

      if (result == null) {
        infeasible += 1;
        // T44b: not even within the tolerance
        expect(tolerant.reduce((acc, bound) => acc + bound.min, 0), ctx).toBeGreaterThan(usable);
      } else {
        const sum = result.widths.reduce((acc, w) => acc + w, 0);
        expect(sum + (n - 1) * gap + result.fill, ctx).toBe(width);
        expect(result.fill, ctx).toBeGreaterThanOrEqual(0);
        const exact = result.widths.every((w, j) => w >= bounds[j]!.min && w <= bounds[j]!.max);
        result.widths.forEach((w, j) => {
          expect(isEven(w), ctx).toBe(true);
          expect(w, ctx).toBeGreaterThanOrEqual(tolerant[j]!.min);
          expect(w, ctx).toBeLessThanOrEqual(tolerant[j]!.max);
          // every column can be filled by a crop of its clip (a rigid clip whose exact width isn't even is off by
          // 1 px, which the tolerance absorbs unless the column is very narrow)
          if (bounds[j]!.min < bounds[j]!.max || w >= 2 / ASPECT_TOLERANCE || w !== bounds[j]!.min) {
            expect(getCropForAspect(rects[j]!.max, rects[j]!.min, w / height).fit, ctx).toBe('fill');
          }
        });
        if (result.fill > 1) {
          withFill += 1;
          // the tolerance is only used when it removes all the fill
          expect(result.widths, ctx).toEqual(bounds.map((b) => b.max));
        } else if (exact) {
          feasible += 1;
        } else {
          // T44b: only when the exact widths would leave fill or not fit, all of them on the same side of their range
          tolerated += 1;
          const sumExact = (key: 'min' | 'max') => bounds.reduce((acc, b) => acc + b[key], 0);
          expect(sumExact('max') < floorEven(usable) || sumExact('min') > floorEven(usable), ctx).toBe(true);
          const wider = result.widths.every((w, j) => w >= bounds[j]!.max);
          const narrower = result.widths.every((w, j) => w <= bounds[j]!.min);
          expect(wider || narrower, ctx).toBe(true);
        }
      }
    }
    // make sure the generator covers all the cases
    expect(feasible).toBeGreaterThan(100);
    expect(withFill).toBeGreaterThan(100);
    expect(infeasible).toBeGreaterThan(100);
    expect(tolerated).toBeGreaterThan(5);
  });

  test('T44b: tolerant widths are those getCropForAspect fills, around the exact ones', () => {
    // rigid 1/3 of 1280x720 ("Fit to 1/3" of a 16:9 source: 426x720): exactly 426.67 px would be needed
    const third = getAspectRange({ x: 0, y: 0, width: 426, height: 720 });
    expect(getWidthRange(third, 720)).toEqual({ min: 426, max: 426, preferred: 426 });
    expect(getTolerantWidthRange(third, 720)).toEqual({ min: 422, max: 430 });
    // the collapsed width of a range too narrow for an even width is always inside
    const nine16 = getAspectRange({ x: 0, y: 0, width: 1080, height: 1920 });
    expect(getTolerantWidthRange(nine16, 1080)).toEqual({ min: 602, max: 612 });
    for (const w of [422, 424, 428, 430]) expect(getCropForAspect({ x: 0, y: 0, width: 426, height: 720 }, undefined, w / 720).fit).toBe('fill');
    for (const w of [420, 432]) expect(getCropForAspect({ x: 0, y: 0, width: 426, height: 720 }, undefined, w / 720).fit).not.toBe('fill');
  });

  test('T44b: three rigid clips fitted to 1/3 leave no fill, with and without gap', () => {
    // 16:9 sources, "Fit to 1/3" at 1280x720: 426x720 (426.67 rounded); before T44b, 2 px of fill
    const third = getAspectRange({ x: 0, y: 0, width: 426, height: 720 });
    expect(distributeWidths({ clips: [third, third, third], width: 1280, height: 720, gap: 0 })).toEqual({ widths: [428, 426, 426], fill: 0 });
    // with a 10 px gap: 420 px each exactly (the rigid clips are 1260/3 = 420 px only with a 420x720 max)
    const gapThird = getAspectRange({ x: 0, y: 0, width: 420, height: 720 });
    expect(distributeWidths({ clips: [gapThird, gapThird, gapThird], width: 1280, height: 720, gap: 10 })).toEqual({ widths: [420, 420, 420], fill: 0 });
    // a 9:16 source (720x1280) fitted to 1/3: 720x1214, 427.02 px, rounded to 428: before T44b the row didn't fit
    const fitted = getAspectRange({ x: 0, y: 34, width: 720, height: 1214 });
    expect(getWidthRange(fitted, 720)).toEqual({ min: 428, max: 428, preferred: 428 });
    expect(distributeWidths({ clips: [fitted, fitted, fitted], width: 1280, height: 720, gap: 0 })).toEqual({ widths: [428, 426, 426], fill: 0 });
    // 1920x1080 with a 6 px gap: 636 px each; a 1080x1920 source fitted to 1/3 (1080x1834, 636.00 px) and a 16:9 one
    // (636x1080) fit exactly; with an 8 px gap (634.67 px) they need the tolerance
    const v1080 = getAspectRange({ x: 0, y: 0, width: 1080, height: 1834 });
    expect(distributeWidths({ clips: [v1080, v1080, v1080], width: 1920, height: 1080, gap: 6 })).toEqual({ widths: [636, 636, 636], fill: 0 });
    const h1080 = getAspectRange({ x: 0, y: 0, width: 634, height: 1080 });
    expect(distributeWidths({ clips: [h1080, h1080, h1080], width: 1920, height: 1080, gap: 8 })).toEqual({ widths: [636, 634, 634], fill: 0 });
  });

  test('T44b: the tolerance is not used when fill would remain anyway, nor when the exact widths suffice', () => {
    const vertical916 = getAspectRange({ x: 0, y: 0, width: 1080, height: 1920 });
    // three real 9:16 clips at 1280x720: 405 px each, 5 % short of a third: fill stays (E7 may extend them)
    expect(distributeWidths({ clips: [vertical916, vertical916, vertical916], width: 1280, height: 720, gap: 0 })).toEqual({ widths: [406, 406, 406], fill: 62 });
    const flexible = getAspectRange({ x: 0, y: 0, width: 1080, height: 1920 }, { x: 270, y: 160, width: 540, height: 1600 });
    expect(distributeWidths({ clips: [flexible, flexible, flexible], width: 1920, height: 1080, gap: 0 })).toEqual({ widths: [640, 640, 640], fill: 0 });
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

function frameRect({ width, height }: { width: number, height: number }): Rect {
  return { x: 0, y: 0, width, height };
}

describe('extension beyond the max (E7, T38b)', () => {
  const source = { width: 1920, height: 1080 };
  // a 9:16 max in the middle of a 16:9 source
  const middle: Rect = { x: 656, y: 0, width: 608, height: 1080 };
  // the same, near the left edge
  const nearLeft: Rect = { x: 100, y: 0, width: 608, height: 1080 };

  test('room: what the source source has beyond the max along the direction', () => {
    expect(getExtensionRoom(middle, source, 'horizontal')).toBe(1312);
    expect(getExtensionRoom(middle, source, 'vertical')).toBe(0);
    expect(getExtensionRoom({ x: 0, y: 140, width: 1920, height: 800 }, source, 'vertical')).toBe(280);
    // odd source sizes count to even px; a max outside its source can't extend
    expect(getExtensionRoom(middle, { width: 1921, height: 1080 }, 'horizontal')).toBe(1312);
    expect(getExtensionRoom({ x: 1500, y: 0, width: 608, height: 1080 }, source, 'horizontal')).toBe(0);
  });

  test('extended max: centred on the max, asymmetric at the source edge, never beyond the room', () => {
    expect(extendMaxRect(middle, source, 'horizontal', 400)).toEqual({ x: 456, y: 0, width: 1008, height: 1080 });
    // only 100 px on the left: the other 300 px go to the right
    expect(extendMaxRect(nearLeft, source, 'horizontal', 400)).toEqual({ x: 0, y: 0, width: 1008, height: 1080 });
    // at the right edge
    expect(extendMaxRect({ x: 1212, y: 0, width: 608, height: 1080 }, source, 'horizontal', 400)).toEqual({ x: 912, y: 0, width: 1008, height: 1080 });
    expect(extendMaxRect(middle, source, 'horizontal', 5000)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    // odd extra rounds up to even; vertical keeps x/width
    expect(extendMaxRect(middle, source, 'horizontal', 3)).toEqual({ x: 654, y: 0, width: 612, height: 1080 });
    expect(extendMaxRect({ x: 0, y: 100, width: 1920, height: 800 }, source, 'vertical', 200)).toEqual({ x: 0, y: 0, width: 1920, height: 1000 });
    expect(extendMaxRect(middle, source, 'horizontal', 0)).toEqual(middle);
  });

  test('extended crop: the same as getCropForAspect where the max is enough', () => {
    const ext = extendMaxRect(middle, source, 'horizontal', 1312);
    for (const aspect of [0.3, 9 / 16, (9 / 16) * 1.005]) {
      expect(getExtendedCropForAspect(middle, undefined, ext, aspect)).toEqual(getCropForAspect(middle, undefined, aspect));
    }
    expect(getExtendedCropForAspect(middle, undefined, undefined, 16 / 9)).toEqual(getCropForAspect(middle, undefined, 16 / 9));
    // a vertical extension doesn't help a pillarbox
    expect(getExtendedCropForAspect({ x: 0, y: 140, width: 1920, height: 800 }, undefined, frameRect(source), 3)).toEqual(getCropForAspect({ x: 0, y: 140, width: 1920, height: 800 }, undefined, 3));
  });

  test('extended crop: centred on the max, shifted at the edge, pillarbox for what the extension lacks', () => {
    const all = frameRect(source);
    expect(getExtendedCropForAspect(middle, undefined, all, 16 / 9)).toEqual({ crop: all, fit: 'fill', strategy: 'extend' });
    expect(getExtendedCropForAspect(middle, undefined, all, 1)).toEqual({ crop: { x: 420, y: 0, width: 1080, height: 1080 }, fit: 'fill', strategy: 'extend' });
    expect(getExtendedCropForAspect(nearLeft, undefined, all, 1)).toEqual({ crop: { x: 0, y: 0, width: 1080, height: 1080 }, fit: 'fill', strategy: 'extend' });
    // limited extension: all of it, and the rest is pillarbox
    const partial = extendMaxRect(middle, source, 'horizontal', 400);
    expect(getExtendedCropForAspect(middle, undefined, partial, 16 / 9)).toEqual({ crop: partial, fit: 'pillarbox', strategy: 'extend' });
    // with a min: the crop keeps the height (and position) of the min, as the crop at the range limit
    const min: Rect = { x: 656, y: 140, width: 608, height: 800 };
    expect(getCropForAspect(middle, min, 16 / 9)).toEqual({ crop: min, fit: 'pillarbox', strategy: 'none' });
    expect(getExtendedCropForAspect(middle, min, all, 16 / 9)).toEqual({ crop: { x: 250, y: 140, width: 1422, height: 800 }, fit: 'fill', strategy: 'extend' });
  });

  test('extended crop: vertical (rows) is the transpose', () => {
    const wide: Rect = { x: 0, y: 140, width: 1920, height: 800 };
    const ext = extendMaxRect(wide, source, 'vertical', 280);
    expect(ext).toEqual(frameRect(source));
    // a 1080x1000 row: 1920x1778 would be needed, the source has 1080
    expect(getExtendedCropForAspect(wide, undefined, ext, 1080 / 1000)).toEqual({ crop: ext, fit: 'letterbox', strategy: 'extend' });
    expect(getExtendedCropForAspect(wide, undefined, ext, 1920 / 1000)).toEqual({ crop: { x: 0, y: 40, width: 1920, height: 1000 }, fit: 'fill', strategy: 'extend' });
    const t = getExtendedCropForAspect(transposeRect(wide), undefined, transposeRect(ext), 1000 / 1920);
    expect(t).toEqual({ crop: transposeRect({ x: 0, y: 40, width: 1920, height: 1000 }), fit: 'fill', strategy: 'extend' });
  });

  test('T44b: extended crop: within the tolerance a clip with min shows a few px beyond the max instead of stretching', () => {
    const min: Rect = { x: 656, y: 140, width: 608, height: 800 };
    const wide = (608 / 800) * 1.008; // 0.8 % wider than the range allows
    expect(getCropForAspect(middle, min, wide)).toEqual({ crop: { x: 656, y: 140, width: 608, height: 800 }, fit: 'fill', strategy: 'stretch' });
    const ext = extendMaxRect(middle, source, 'horizontal', 6);
    expect(getExtendedCropForAspect(middle, min, ext, wide)).toEqual({ crop: { x: 654, y: 140, width: 612, height: 800 }, fit: 'fill', strategy: 'extend' });
    // a clip without min is cut inside its max first: the extension isn't used
    expect(getExtendedCropForAspect(middle, undefined, ext, (608 / 1080) * 1.008).strategy).toBe('crop');
    // narrower cells can't use a horizontal extension: still stretched
    expect(getExtendedCropForAspect(middle, min, ext, (608 / 1080) * 0.995).strategy).toBe('stretch');
    // rows: the transpose
    const t = getExtendedCropForAspect(transposeRect(middle), transposeRect(min), transposeRect(ext), 1 / wide);
    expect(t).toEqual({ crop: transposeRect({ x: 654, y: 140, width: 612, height: 800 }), fit: 'fill', strategy: 'extend' });
  });

  test('extended crop properties: even, inside the extended rect, contains the min, fills when the extension allows it', () => {
    const rnd = seededRandom(7);
    const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
    for (let i = 0; i < 2000; i += 1) {
      const src = { width: 2 * int(20, 1000), height: 2 * int(20, 1000) };
      const max: Rect = { x: 2 * int(0, src.width / 4), y: 2 * int(0, src.height / 4), width: 0, height: 0 };
      max.width = 2 * int(8, (src.width - max.x) / 2);
      max.height = 2 * int(8, (src.height - max.y) / 2);
      const min = rnd() < 0.5 ? undefined : { x: max.x, y: max.y + 2 * int(0, (max.height - 16) / 4), width: 2 * int(8, max.width / 2), height: 16 };
      const direction = rnd() < 0.5 ? 'horizontal' : 'vertical';
      const ext = extendMaxRect(max, src, direction, 2 * int(0, 1000));
      expect(rectContains(ext, max)).toBe(true);
      expect(rectContains(frameRect(src), ext)).toBe(true);
      const aspect = 0.1 + rnd() * 5;
      const { crop, fit } = getExtendedCropForAspect(max, min, ext, aspect);
      expect([crop.x, crop.y, crop.width, crop.height].every((v) => v % 2 === 0)).toBe(true);
      expect(rectContains(ext, crop)).toBe(true);
      if (min != null) expect(rectContains(crop, normalizeClipRects(max, min).min)).toBe(true);
      const normal = getCropForAspect(max, min, aspect);
      if (fit === 'fill') expect(crop.width / crop.height).toBeCloseTo(aspect, 0);
      // never worse than without the extension
      if (normal.fit === 'fill') expect(fit).toBe('fill');
    }
  });
});
