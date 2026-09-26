import { describe, expect, test } from 'vitest';

import { clampMixZoom, getAnchoredScrollLeft, getFollowScrollLeft, getMaxMixZoom, getTimeTicks, getWheelPixels, getWheelZoomFactor } from './mixPlanZoom';

describe('zoom limits', () => {
  test('from the whole mix to 2 s across the view', () => {
    expect(getMaxMixZoom(60)).toBe(30);
    expect(clampMixZoom(100, 60)).toBe(30);
    expect(clampMixZoom(0.5, 60)).toBe(1);
    expect(clampMixZoom(4, 60)).toBe(4);
  });

  test('a short (or empty) mix can\'t zoom', () => {
    expect(getMaxMixZoom(1)).toBe(1);
    expect(clampMixZoom(3, 0)).toBe(1);
    expect(clampMixZoom(Number.NaN, 60)).toBe(1);
  });
});

describe('wheel', () => {
  test('down zooms out, up zooms in, symmetrically', () => {
    expect(getWheelZoomFactor(100)).toBeLessThan(1);
    expect(getWheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(getWheelZoomFactor(100) * getWheelZoomFactor(-100)).toBeCloseTo(1);
  });

  test('line and page deltas in px', () => {
    expect(getWheelPixels({ deltaX: 0, deltaY: 3, deltaMode: 0 })).toEqual({ x: 0, y: 3 });
    expect(getWheelPixels({ deltaX: 1, deltaY: 3, deltaMode: 1 })).toEqual({ x: 40, y: 120 });
    expect(getWheelPixels({ deltaX: 0, deltaY: 1, deltaMode: 2 })).toEqual({ x: 0, y: 800 });
  });
});

describe('getAnchoredScrollLeft', () => {
  test('keeps the time under the anchor', () => {
    // 10 s of 60 at 4000 px wide is at 666.67 px; with the mouse 200 px into the view
    expect(getAnchoredScrollLeft({ time: 10, duration: 60, contentWidth: 4000, viewportWidth: 1000, anchorX: 200 })).toBeCloseTo(466.67, 1);
  });

  test('clamped to the content', () => {
    expect(getAnchoredScrollLeft({ time: 1, duration: 60, contentWidth: 4000, viewportWidth: 1000, anchorX: 500 })).toBe(0);
    expect(getAnchoredScrollLeft({ time: 60, duration: 60, contentWidth: 4000, viewportWidth: 1000, anchorX: 0 })).toBe(3000);
    expect(getAnchoredScrollLeft({ time: 30, duration: 60, contentWidth: 1000, viewportWidth: 1000, anchorX: 0 })).toBe(0);
  });
});

describe('getFollowScrollLeft', () => {
  const view = { duration: 60, contentWidth: 6000, viewportWidth: 1000 };

  test('nothing to do while the cursor is visible, or without zoom', () => {
    expect(getFollowScrollLeft({ ...view, time: 5, scrollLeft: 0 })).toBeUndefined();
    expect(getFollowScrollLeft({ ...view, time: 10, scrollLeft: 0 })).toBeUndefined();
    expect(getFollowScrollLeft({ duration: 60, contentWidth: 1000, viewportWidth: 1000, time: 50, scrollLeft: 0 })).toBeUndefined();
  });

  test('pages forward when the cursor leaves the view, and back', () => {
    // 10.5 s = 1050 px: it lands 100 px into the view
    expect(getFollowScrollLeft({ ...view, time: 10.5, scrollLeft: 0 })).toBe(950);
    expect(getFollowScrollLeft({ ...view, time: 2, scrollLeft: 3000 })).toBe(100);
    expect(getFollowScrollLeft({ ...view, time: 60, scrollLeft: 0 })).toBe(5000);
  });
});

describe('getTimeTicks', () => {
  test('the smallest step with room for the labels', () => {
    // 10 px/s → 10 s (100 px); 100 px/s → 1 s
    expect(getTimeTicks({ duration: 60, pixelsPerSecond: 10, from: 0, to: 60 })).toEqual({ step: 10, ticks: [0, 10, 20, 30, 40, 50, 60] });
    expect(getTimeTicks({ duration: 60, pixelsPerSecond: 100, from: 0, to: 60 }).step).toBe(1);
  });

  test('only the visible range', () => {
    expect(getTimeTicks({ duration: 60, pixelsPerSecond: 100, from: 12.5, to: 15.2 }).ticks).toEqual([13, 14, 15]);
    expect(getTimeTicks({ duration: 60, pixelsPerSecond: 500, from: 1, to: 2 }).ticks).toEqual([1, 1.5, 2]);
  });

  test('nothing without a duration or a width', () => {
    expect(getTimeTicks({ duration: 0, pixelsPerSecond: 10, from: 0, to: 10 }).ticks).toEqual([]);
    expect(getTimeTicks({ duration: 10, pixelsPerSecond: 0, from: 0, to: 10 }).ticks).toEqual([]);
  });
});
