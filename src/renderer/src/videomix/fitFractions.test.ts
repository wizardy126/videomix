import { describe, test, expect } from 'vitest';

import {
  fitFractions, fitMaxRectToFraction, getClipFractionFits, getFitAxes, getFitLayout, getFractionCellAspect, getFractionFits, getFractionLength, snapRectEdge,
} from './fitFractions';
import type { FitFraction, FitLayout } from './fitFractions';
import { distributeWidths, getAspectRange, getMainAspectRange, normalizeRectEven, rectContains } from './geometry';
import type { LayoutAxis } from './geometry';
import { defaultMixSettings } from './types';
import type { Rect } from './types';
import { createRandom as makeRandom } from './planner/random';

const layout = (width: number, height: number, gap = 0, axis: LayoutAxis = width >= height ? 'columns' : 'rows'): FitLayout => ({ width, height, gap, axis });
const L1080 = layout(1920, 1080);
const frame = { width: 1920, height: 1080 };
const full: Rect = { x: 0, y: 0, width: 1920, height: 1080 };

const statusOf = (fits: ReturnType<typeof getFractionFits>) => Object.fromEntries(fits.map((f) => [f.fraction, f.status]));


function randomClip(random: () => number, withMin: boolean) {
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const width = int(40, 1920);
  const height = int(40, 1080);
  const maxRect = { x: int(0, 1920 - width), y: int(0, 1080 - height), width, height };
  if (!withMin) return { maxRect, minRect: undefined };
  const minWidth = int(20, width);
  const minHeight = int(20, height);
  const minRect = { x: maxRect.x + int(0, width - minWidth), y: maxRect.y + int(0, height - minHeight), width: minWidth, height: minHeight };
  return { maxRect, minRect };
}

const layouts: FitLayout[] = [
  layout(1920, 1080), layout(1280, 720), layout(1920, 1080, 10), layout(3840, 2160, 4), layout(1280, 720, 3),
  layout(1080, 1920), layout(720, 1280, 6),
  layout(1080, 1080, 0, 'columns'), layout(1080, 1080, 8, 'rows'),
];

describe('fraction cells', () => {
  test('lengths: the usable length shared like distributeWidths, 2/3 = two thirds + a gap', () => {
    expect(fitFractions.map((f) => getFractionLength(f, L1080))).toEqual([640, 960, 1280, 1920]);
    const gap = layout(1920, 1080, 10);
    expect(getFractionLength('1/3', gap)).toBeCloseTo(1900 / 3);
    expect(getFractionLength('1/2', gap)).toBe(955);
    expect(getFractionLength('2/3', gap)).toBeCloseTo((2 * 1900) / 3 + 10);
    expect(getFractionLength('full', gap)).toBe(1920);
    // a 2/3 cell and a 1/3 cell with the gap between them make the whole row
    expect(getFractionLength('2/3', gap) + 10 + getFractionLength('1/3', gap)).toBeCloseTo(1920);
    // rows: along the height
    expect(fitFractions.map((f) => getFractionLength(f, layout(1080, 1920)))).toEqual([640, 960, 1280, 1920]);
  });

  test('cell aspect (width / height)', () => {
    expect(getFractionCellAspect('1/3', L1080)).toBeCloseTo(640 / 1080);
    expect(getFractionCellAspect('1/2', layout(1080, 1920))).toBeCloseTo(1080 / 960);
  });

  test('axes and layout of a project', () => {
    expect(getFitAxes({ width: 1920, height: 1080 })).toEqual(['columns']);
    expect(getFitAxes({ width: 1080, height: 1920 })).toEqual(['rows']);
    expect(getFitAxes({ width: 1080, height: 1080 })).toEqual(['columns', 'rows']);
    expect(getFitLayout(defaultMixSettings)).toEqual({ width: 1920, height: 1080, gap: 0, axis: 'columns' });
    expect(getFitLayout({ ...defaultMixSettings, output: { aspect: '1:1', resolution: '720' } })).toMatchObject({ axis: 'columns' });
    expect(getFitLayout({ ...defaultMixSettings, output: { aspect: '1:1', resolution: '720' } }, 'rows')).toMatchObject({ axis: 'rows' });
  });
});

describe('getFractionFits', () => {
  test('a whole 16:9 frame only fits full; a 1/3 crop only 1/3', () => {
    expect(statusOf(getFractionFits({ maxRect: full, layout: L1080 }))).toEqual({ '1/3': 'no', '1/2': 'no', '2/3': 'no', full: 'fits' });
    expect(getFractionFits({ maxRect: full, layout: L1080 })[0]).toEqual({ fraction: '1/3', length: 640, status: 'no', excess: 1920 - 640 });
    expect(statusOf(getFractionFits({ maxRect: { x: 640, y: 0, width: 640, height: 1080 }, layout: L1080 }))).toEqual({ '1/3': 'fits', '1/2': 'no', '2/3': 'no', full: 'no' });
  });

  test('a min makes a range of fractions', () => {
    // max 16:9 whole frame, min a 1/3 column: fits everything from 1/3 to full
    const fits = getFractionFits({ maxRect: full, minRect: { x: 640, y: 0, width: 640, height: 1080 }, layout: L1080 });
    expect(statusOf(fits)).toEqual({ '1/3': 'fits', '1/2': 'fits', '2/3': 'fits', full: 'fits' });
  });

  test('missing: the max is too narrow; extends with E7 when the frame has material', () => {
    const maxRect = { x: 700, y: 0, width: 600, height: 1080 };
    const fits = getFractionFits({ maxRect, layout: L1080 });
    expect(fits[0]).toEqual({ fraction: '1/3', length: 640, status: 'no', missing: 40 });
    expect(fits[1]).toMatchObject({ status: 'no', missing: 360 });
    // E7: the frame has 1320 px more, enough for any fraction
    expect(statusOf(getFractionFits({ maxRect, frame, extendBeyondMax: true, layout: L1080 }))).toEqual({ '1/3': 'extends', '1/2': 'extends', '2/3': 'extends', full: 'extends' });
    // not without the flag or the frame
    expect(statusOf(getFractionFits({ maxRect, frame, layout: L1080 }))['1/3']).toBe('no');
    expect(statusOf(getFractionFits({ maxRect, extendBeyondMax: true, layout: L1080 }))['1/3']).toBe('no');
    // a narrow frame: only up to what it has
    expect(statusOf(getFractionFits({ maxRect, frame: { width: 1000, height: 1080 }, extendBeyondMax: false, layout: L1080 }))['1/3']).toBe('no');
    expect(statusOf(getFractionFits({ maxRect: { x: 0, y: 0, width: 600, height: 1080 }, frame: { width: 1000, height: 1080 }, extendBeyondMax: true, layout: L1080 })))
      .toEqual({ '1/3': 'extends', '1/2': 'extends', '2/3': 'no', full: 'no' });
  });

  test('excess: the min is too wide (or the whole max without min)', () => {
    const fits = getFractionFits({ maxRect: full, minRect: { x: 560, y: 0, width: 800, height: 1080 }, layout: L1080 });
    expect(fits[0]).toEqual({ fraction: '1/3', length: 640, status: 'no', excess: 160 });
    expect(statusOf(fits)).toEqual({ '1/3': 'no', '1/2': 'fits', '2/3': 'fits', full: 'fits' });
  });

  test('rows (9:16): heights; a 1920×1080 source fits a 1080×640 row only by cropping', () => {
    const rows = layout(1080, 1920);
    // whole 16:9 frame in a 1080 px wide row: 607.5 px tall, shorter than 1/3 (640)
    expect(statusOf(getFractionFits({ maxRect: full, layout: rows }))).toEqual({ '1/3': 'no', '1/2': 'no', '2/3': 'no', full: 'no' });
    // 1136 px tall (in the source) would be 639 px, rounded to 640 like the planner's getWidthRange
    expect(getFractionFits({ maxRect: full, layout: rows })[0]).toMatchObject({ status: 'no', missing: 56 });
    // a min narrower than 1080 × 1080/640 = 1822 px lets it crop to a third
    expect(statusOf(getFractionFits({ maxRect: full, minRect: { x: 100, y: 0, width: 1700, height: 1080 }, layout: rows }))['1/3']).toBe('fits');
  });

  test('matches distributeWidths for n equal clips (1/3, 1/2, full), any output, gap and axis', () => {
    const random = makeRandom(44);
    const fractions: [FitFraction, number][] = [['1/3', 3], ['1/2', 2], ['full', 1]];
    for (let i = 0; i < 300; i += 1) {
      const { maxRect, minRect } = randomClip(random, i % 3 !== 0);
      layouts.forEach((l) => {
        const fits = getFractionFits({ maxRect, minRect, layout: l });
        const [main, cross] = l.axis === 'columns' ? [l.width, l.height] : [l.height, l.width];
        const range = getMainAspectRange(getAspectRange(maxRect, minRect), l.axis);
        fractions.forEach(([fraction, n]) => {
          const dist = distributeWidths({ clips: Array.from({ length: n }, () => range), width: main, height: cross, gap: l.gap });
          const plannerFits = dist != null && dist.fill < 2;
          expect(fits.find((f) => f.fraction === fraction)!.status === 'fits').toBe(plannerFits);
        });
      });
    }
  });

  test('missing/excess are minimal and enough (even source px)', () => {
    const random = makeRandom(7);
    for (let i = 0; i < 200; i += 1) {
      const { maxRect: raw, minRect: rawMin } = randomClip(random, i % 2 === 0);
      const maxRect = normalizeRectEven(raw, 'shrink');
      const minRect = rawMin != null ? { ...normalizeRectEven(rawMin, 'grow') } : undefined;
      const valid = minRect == null || rectContains(maxRect, minRect);
      (valid ? layouts : []).forEach((l) => {
        const horizontal = l.axis === 'columns';
        const grow = (r: Rect, n: number) => (horizontal ? { ...r, width: r.width + n } : { ...r, height: r.height + n });
        getFractionFits({ maxRect, minRect, layout: l }).forEach((fit) => {
          const statusWith = (max: Rect, min: Rect | undefined) => getFractionFits({ maxRect: max, minRect: min, layout: l, fractions: [fit.fraction] })[0]!;
          if (fit.missing != null) {
            expect(fit.missing % 2).toBe(0);
            // enough: the max is no longer too short (with a min; a rigid clip grows as a whole and may overshoot)
            const after = statusWith(grow(maxRect, fit.missing), minRect != null ? minRect : undefined);
            expect(after.missing).toBeUndefined();
            if (fit.missing > 2) expect(statusWith(grow(maxRect, fit.missing - 2), minRect).missing).toBeDefined();
          }
          if (fit.excess != null) {
            expect(fit.excess % 2).toBe(0);
            if (minRect != null) {
              const shrunk = grow(minRect, -fit.excess);
              if ((horizontal ? shrunk.width : shrunk.height) >= 2) {
                expect(statusWith(maxRect, shrunk).excess).toBeUndefined();
                if (fit.excess > 2) expect(statusWith(maxRect, grow(minRect, 2 - fit.excess)).excess).toBeDefined();
              }
            } else if ((horizontal ? maxRect.width : maxRect.height) - fit.excess >= 2) {
              expect(statusWith(grow(maxRect, -fit.excess), undefined).excess).toBeUndefined();
            }
          }
        });
      });
    }
  });

  test('getClipFractionFits: turned clip (E9) uses the turned frame for E7', () => {
    const source = { width: 1920, height: 1080 };
    // turned 90°: a 1080×1920 frame; a 1080×1080 max has no room horizontally
    const clip = { maxRect: { x: 0, y: 420, width: 1080, height: 1080 }, rotation: 90 as const };
    expect(statusOf(getClipFractionFits({ clip, source, settings: defaultMixSettings }))).toEqual({ '1/3': 'no', '1/2': 'no', '2/3': 'no', full: 'no' });
    // unturned the same max has 840 px of room: extends up to 1080 × (1920/1080)
    expect(statusOf(getClipFractionFits({ clip: { maxRect: { x: 0, y: 0, width: 1080, height: 1080 } }, source, settings: defaultMixSettings })))
      .toEqual({ '1/3': 'no', '1/2': 'no', '2/3': 'extends', full: 'extends' });
    // extendBeyondMax: false
    expect(statusOf(getClipFractionFits({ clip: { maxRect: { x: 0, y: 0, width: 1080, height: 1080 }, extendBeyondMax: false }, source, settings: defaultMixSettings }))['full']).toBe('no');
  });
});

describe('snapRectEdge (F2 magnet)', () => {
  const rect = { x: 100, y: 0, width: 650, height: 1080 };

  test('snaps the dragged edge to the closest fraction within the threshold', () => {
    expect(snapRectEdge({ rect, edge: 'right', threshold: 12, layout: L1080 })).toEqual({ rect: { ...rect, width: 640 }, fraction: '1/3' });
    // the left edge moves, the right one stays
    expect(snapRectEdge({ rect, edge: 'left', threshold: 12, layout: L1080 })).toEqual({ rect: { x: 110, y: 0, width: 640, height: 1080 }, fraction: '1/3' });
    expect(snapRectEdge({ rect, edge: 'right', threshold: 8, layout: L1080 })).toBeUndefined();
    // closest among several
    expect(snapRectEdge({ rect: { ...rect, width: 900 }, edge: 'right', threshold: 400, layout: L1080 })?.fraction).toBe('1/2');
  });

  test('top/bottom snap the height; candidates leaving the bounds are skipped', () => {
    const wide = { x: 0, y: 40, width: 640, height: 1040 };
    expect(snapRectEdge({ rect: wide, edge: 'bottom', threshold: 100, layout: L1080 })).toEqual({ rect: { ...wide, height: 1080 }, fraction: '1/3' });
    expect(snapRectEdge({ rect: wide, edge: 'bottom', threshold: 100, layout: L1080, bounds: full })).toBeUndefined();
    expect(snapRectEdge({ rect: wide, edge: 'top', threshold: 100, layout: L1080, bounds: full })).toEqual({ rect: { x: 0, y: 0, width: 640, height: 1080 }, fraction: '1/3' });
  });

  test('rows', () => {
    const rows = layout(1080, 1920);
    // a 1/2 row is 1080×960: a max 1920 px wide snaps to 1706 px tall
    expect(snapRectEdge({ rect: { x: 0, y: 0, width: 1920, height: 1700 }, edge: 'bottom', threshold: 10, layout: rows })).toEqual({ rect: { x: 0, y: 0, width: 1920, height: 1706 }, fraction: '1/2' });
  });
});

describe('fitMaxRectToFraction (F2 "Fit to")', () => {
  test('whole frame, no min: centred, keeps the height', () => {
    expect(fitMaxRectToFraction({ maxRect: full, frame, fraction: '1/3', layout: L1080 })).toEqual({ ok: true, maxRect: { x: 640, y: 0, width: 640, height: 1080 } });
    expect(fitMaxRectToFraction({ maxRect: full, frame, fraction: '2/3', layout: L1080 })).toEqual({ ok: true, maxRect: { x: 320, y: 0, width: 1280, height: 1080 } });
  });

  test('centred on the min, shifted into the frame', () => {
    const minRect = { x: 1700, y: 400, width: 200, height: 200 };
    expect(fitMaxRectToFraction({ maxRect: full, minRect, frame, fraction: '1/2', layout: L1080 })).toEqual({ ok: true, maxRect: { x: 960, y: 0, width: 960, height: 1080 } });
  });

  test('a short max grows to contain the min; a too wide min fails', () => {
    const res = fitMaxRectToFraction({ maxRect: { x: 0, y: 0, width: 400, height: 300 }, minRect: { x: 0, y: 0, width: 400, height: 300 }, frame, fraction: '1/3', layout: L1080 });
    expect(res).toEqual({ ok: true, maxRect: { x: 0, y: 0, width: 400, height: 676 } });
    expect(fitMaxRectToFraction({ maxRect: full, minRect: { x: 0, y: 0, width: 1000, height: 1080 }, frame, fraction: '1/3', layout: L1080 })).toEqual({ ok: false, reason: 'min-too-large' });
  });

  test('the result fits the fraction, is even, inside the frame and contains the min (any layout)', () => {
    const random = makeRandom(3);
    for (let i = 0; i < 150; i += 1) {
      const { maxRect, minRect } = randomClip(random, true);
      layouts.forEach((l) => {
        (['1/3', '1/2', '2/3'] as const).forEach((fraction) => {
          const res = fitMaxRectToFraction({ maxRect, minRect, frame, fraction, layout: l });
          if (!res.ok) return;
          const r = res.maxRect;
          expect([r.x, r.y, r.width, r.height].every((v) => v % 2 === 0)).toBe(true);
          expect(rectContains(full, r)).toBe(true);
          expect(rectContains(r, minRect!)).toBe(true);
          expect(getFractionFits({ maxRect: r, minRect, layout: l, fractions: [fraction] })[0]!.status).toBe('fits');
        });
      });
    }
  });
});
