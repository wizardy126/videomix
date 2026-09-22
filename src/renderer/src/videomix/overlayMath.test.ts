import { describe, test, expect } from 'vitest';

import {
  applyAspect, applyRectDrag, createDefaultMin, fillFrame, formatAspect, getFrameRect, getOrientedSize, getStreamRotation,
  getVideoContentBox, resizeHandles, toScreenCoords, toSourceCoords,
} from './overlayMath';
import type { ClipRects, DragHandle, RectTarget, Size } from './overlayMath';
import { rectContains } from './geometry';
import type { Rect } from './types';
import { MIN_RECT_SIZE } from './types';

const hd: Size = { width: 1920, height: 1080 };

const isEvenRect = (r: Rect) => [r.x, r.y, r.width, r.height].every((v) => v % 2 === 0);

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

describe('getVideoContentBox', () => {
  test('container wider than video: bands on the sides', () => {
    expect(getVideoContentBox({ width: 1000, height: 400 }, hd)).toEqual({ x: (1000 - 400 * (16 / 9)) / 2, y: 0, width: 400 * (16 / 9), height: 400 });
  });

  test('container taller than video: bands on top and bottom', () => {
    expect(getVideoContentBox({ width: 960, height: 1000 }, hd)).toEqual({ x: 0, y: (1000 - 540) / 2, width: 960, height: 540 });
  });

  test('vertical video in a horizontal container', () => {
    const box = getVideoContentBox({ width: 1000, height: 500 }, { width: 1080, height: 1920 })!;
    expect(box.x).toBeCloseTo((1000 - 281.25) / 2);
    expect(box.y).toBeCloseTo(0);
    expect(box.width).toBeCloseTo(281.25);
    expect(box.height).toBeCloseTo(500);
  });

  test('exact fit', () => {
    expect(getVideoContentBox({ width: 1920, height: 1080 }, hd)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  test('empty sizes', () => {
    expect(getVideoContentBox({ width: 0, height: 100 }, hd)).toBeUndefined();
    expect(getVideoContentBox({ width: 100, height: 100 }, { width: 0, height: 0 })).toBeUndefined();
  });

  test('compat player CSS rotation fits the raw frame, then turns it', () => {
    // oriented 1080x1920 (raw 1920x1080 turned 90°) in a 1000x1000 container: raw fits at 1000/1920
    const s = 1000 / 1920;
    const box = getVideoContentBox({ width: 1000, height: 1000 }, { width: 1080, height: 1920 }, 90);
    expect(box).toEqual({ x: (1000 - 1080 * s) / 2, y: (1000 - 1920 * s) / 2, width: 1080 * s, height: 1920 * s });
    // 180° doesn't change the box
    expect(getVideoContentBox({ width: 1000, height: 1000 }, hd, 180)).toEqual(getVideoContentBox({ width: 1000, height: 1000 }, hd));
    expect(getVideoContentBox({ width: 1000, height: 1000 }, hd, -90)).toEqual(getVideoContentBox({ width: 1000, height: 1000 }, hd, 270));
  });
});

describe('coordinate conversion', () => {
  const box = getVideoContentBox({ width: 1000, height: 1000 }, hd)!; // y offset 218.75, scale 1000/1920

  test('round trip', () => {
    const rect: Rect = { x: 100, y: 200, width: 640, height: 360 };
    const screen = toScreenCoords(rect, box, hd);
    const topLeft = toSourceCoords({ x: screen.x, y: screen.y }, box, hd);
    const bottomRight = toSourceCoords({ x: screen.x + screen.width, y: screen.y + screen.height }, box, hd);
    expect(topLeft.x).toBeCloseTo(100);
    expect(topLeft.y).toBeCloseTo(200);
    expect(bottomRight.x).toBeCloseTo(740);
    expect(bottomRight.y).toBeCloseTo(560);
  });

  test('points in the bands map outside the frame', () => {
    expect(toSourceCoords({ x: 0, y: 0 }, box, hd).y).toBeLessThan(0);
    expect(toSourceCoords({ x: 500, y: 500 }, box, hd)).toEqual({ x: 960, y: 540 });
  });
});

describe('getFrameRect', () => {
  test('odd sizes are shrunk to even', () => {
    expect(getFrameRect({ width: 1081, height: 1917 })).toEqual({ x: 0, y: 0, width: 1080, height: 1916 });
  });
});

describe('applyRectDrag', () => {
  const full: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
  const drag = (start: ClipRects, target: RectTarget, handle: DragHandle, dx: number, dy: number, aspect?: number) => (
    applyRectDrag({ start, target, handle, dx, dy, videoSize: hd, aspect })
  );

  test('move is snapped to even and clamped to the frame', () => {
    const start = { maxRect: { x: 100, y: 100, width: 400, height: 300 } };
    expect(drag(start, 'max', 'move', 13.4, -7.2).maxRect).toEqual({ x: 114, y: 92, width: 400, height: 300 });
    expect(drag(start, 'max', 'move', -500, 5000).maxRect).toEqual({ x: 0, y: 780, width: 400, height: 300 });
  });

  test('resize edges and corners, snapped to even', () => {
    const start = { maxRect: { x: 100, y: 100, width: 400, height: 300 } };
    expect(drag(start, 'max', 'e', 51, 999).maxRect).toEqual({ x: 100, y: 100, width: 452, height: 300 });
    expect(drag(start, 'max', 'nw', -33, 21).maxRect).toEqual({ x: 68, y: 122, width: 432, height: 278 });
    expect(drag(start, 'max', 'se', 9999, 9999).maxRect).toEqual({ x: 100, y: 100, width: 1820, height: 980 });
  });

  test('minimum size', () => {
    const start = { maxRect: { x: 100, y: 100, width: 400, height: 300 } };
    expect(drag(start, 'max', 'w', 9999, 0).maxRect).toEqual({ x: 500 - MIN_RECT_SIZE, y: 100, width: MIN_RECT_SIZE, height: 300 });
    expect(drag(start, 'max', 'n', 0, 9999).maxRect.height).toBe(MIN_RECT_SIZE);
  });

  test('min is pushed when max moves and cropped when max shrinks', () => {
    const start = { maxRect: full, minRect: { x: 800, y: 400, width: 200, height: 200 } };
    // shrink max from the left past min: min is pushed right
    expect(drag(start, 'max', 'w', 1000, 0)).toEqual({ maxRect: { x: 1000, y: 0, width: 920, height: 1080 }, minRect: { x: 1000, y: 400, width: 200, height: 200 } });
    // shrink max below min's width: min is cropped
    expect(drag(start, 'max', 'e', -1800, 0)).toEqual({ maxRect: { x: 0, y: 0, width: 120, height: 1080 }, minRect: { x: 0, y: 400, width: 120, height: 200 } });
    // min untouched when max doesn't reach it
    expect(drag(start, 'max', 'w', 100, 0).minRect).toEqual(start.minRect);
  });

  test('min stays inside max', () => {
    const start = { maxRect: { x: 100, y: 100, width: 400, height: 300 }, minRect: { x: 200, y: 200, width: 100, height: 100 } };
    expect(drag(start, 'min', 'move', 9999, -9999).minRect).toEqual({ x: 400, y: 100, width: 100, height: 100 });
    expect(drag(start, 'min', 'se', 9999, 9999).minRect).toEqual({ x: 200, y: 200, width: 300, height: 200 });
    expect(drag(start, 'min', 'nw', 9999, 9999).minRect).toEqual({ x: 300 - MIN_RECT_SIZE, y: 300 - MIN_RECT_SIZE, width: MIN_RECT_SIZE, height: MIN_RECT_SIZE });
    expect(drag(start, 'min', 'move', 10, 10).maxRect).toBe(start.maxRect);
  });

  test('editing a missing min is a no-op', () => {
    const start = { maxRect: full };
    expect(drag(start, 'min', 'move', 10, 10)).toBe(start);
  });

  test('locked aspect: corner follows the axis that moved the most', () => {
    const start = { maxRect: { x: 0, y: 0, width: 608, height: 1080 } };
    const r = drag(start, 'max', 'se', -100, -10, 9 / 16).maxRect;
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.width).toBe(508);
    expect(Math.abs(r.height - (508 * 16) / 9)).toBeLessThanOrEqual(1);
  });

  test('locked aspect: fixed corner is kept and the frame limits the size', () => {
    const start = { maxRect: { x: 1000, y: 500, width: 400, height: 400 } };
    const r = drag(start, 'max', 'nw', -5000, -5000, 1).maxRect;
    expect(r).toEqual({ x: 500, y: 0, width: 900, height: 900 });
  });

  test('locked aspect: edge handle grows the other axis around the center', () => {
    const start = { maxRect: { x: 800, y: 300, width: 400, height: 400 } };
    expect(drag(start, 'max', 'e', 100, 0, 1).maxRect).toEqual({ x: 800, y: 250, width: 500, height: 500 });
    // near the top of the frame it's shifted down to stay inside
    const top = { maxRect: { x: 800, y: 0, width: 400, height: 400 } };
    expect(drag(top, 'max', 'e', 100, 0, 1).maxRect).toEqual({ x: 800, y: 0, width: 500, height: 500 });
  });

  test('locked aspect: minimum size keeps the aspect', () => {
    const start = { maxRect: { x: 0, y: 0, width: 1920, height: 1080 } };
    const r = drag(start, 'max', 'se', -5000, -5000, 16 / 9).maxRect;
    expect(r.height).toBe(MIN_RECT_SIZE);
    expect(r.width).toBe(28); // 16 * 16/9 = 28.4, floored to even
  });

  test('random drags keep all invariants', () => {
    const rnd = seededRandom(42);
    const frame = getFrameRect(hd);
    let rects: ClipRects = { maxRect: full, minRect: { x: 600, y: 300, width: 400, height: 300 } };
    const handles: DragHandle[] = ['move', ...resizeHandles];
    for (let i = 0; i < 3000; i += 1) {
      const target: RectTarget = rnd() < 0.5 ? 'max' : 'min';
      const handle = handles[Math.floor(rnd() * handles.length)]!;
      const aspect = target === 'max' && rnd() < 0.3 ? [9 / 16, 1, 16 / 9][Math.floor(rnd() * 3)] : undefined;
      rects = drag(rects, target, handle, (rnd() - 0.5) * 1500, (rnd() - 0.5) * 1000, aspect);
      const { maxRect, minRect } = rects;
      expect(isEvenRect(maxRect)).toBe(true);
      expect(rectContains(frame, maxRect)).toBe(true);
      expect(maxRect.width).toBeGreaterThanOrEqual(MIN_RECT_SIZE);
      expect(maxRect.height).toBeGreaterThanOrEqual(MIN_RECT_SIZE);
      expect(minRect).toBeDefined();
      expect(isEvenRect(minRect!)).toBe(true);
      expect(rectContains(maxRect, minRect!)).toBe(true);
      expect(minRect!.width).toBeGreaterThanOrEqual(MIN_RECT_SIZE);
      expect(minRect!.height).toBeGreaterThanOrEqual(MIN_RECT_SIZE);
      // ±1 px of even rounding, unless clamped by the minimum size
      if (aspect != null && handle !== 'move' && maxRect.width > 2 * MIN_RECT_SIZE && maxRect.height > 2 * MIN_RECT_SIZE) {
        expect(Math.abs(maxRect.width / aspect - maxRect.height)).toBeLessThanOrEqual(2);
      }
    }
  });

  test('odd video size', () => {
    const r = applyRectDrag({ start: { maxRect: { x: 0, y: 0, width: 1081, height: 1917 } }, target: 'max', handle: 'se', dx: 100, dy: 100, videoSize: { width: 1081, height: 1917 } });
    expect(r.maxRect).toEqual({ x: 0, y: 0, width: 1080, height: 1916 });
  });
});

describe('toolbar actions', () => {
  test('fillFrame', () => {
    const min = { x: 10, y: 10, width: 100, height: 100 };
    expect(fillFrame({ maxRect: { x: 0, y: 0, width: 200, height: 200 }, minRect: min }, hd)).toEqual({ maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, minRect: min });
  });

  test('applyAspect keeps the height and centers', () => {
    expect(applyAspect({ maxRect: { x: 0, y: 0, width: 1920, height: 1080 } }, 9 / 16, hd).maxRect).toEqual({ x: 656, y: 0, width: 608, height: 1080 });
  });

  test('applyAspect shrinks to fit the frame', () => {
    const r = applyAspect({ maxRect: { x: 800, y: 0, width: 400, height: 1080 } }, 16 / 9, hd).maxRect;
    expect(r).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  test('applyAspect keeps min inside when it fits', () => {
    const minRect = { x: 1400, y: 400, width: 300, height: 300 };
    const r = applyAspect({ maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, minRect }, 9 / 16, hd);
    expect(rectContains(r.maxRect, minRect)).toBe(true);
    expect(r.minRect).toEqual(minRect);
  });

  test('createDefaultMin', () => {
    expect(createDefaultMin({ x: 100, y: 100, width: 402, height: 300 })).toEqual({ x: 202, y: 176, width: 200, height: 150 });
  });
});

describe('formatting and stream helpers', () => {
  test('formatAspect', () => {
    expect(formatAspect(1920, 1080)).toBe('16:9');
    expect(formatAspect(606, 1078)).toBe('9:16');
    expect(formatAspect(1000, 1000)).toBe('1:1');
    expect(formatAspect(1850, 1000)).toBe('1.85:1');
    expect(formatAspect(0, 10)).toBe('-');
  });

  test('getStreamRotation', () => {
    expect(getStreamRotation({ tags: { rotate: '90' } })).toBe(90);
    expect(getStreamRotation({ side_data_list: [{}, { rotation: -90 }] })).toBe(-90);
    expect(getStreamRotation({})).toBe(0);
  });

  test('getOrientedSize', () => {
    expect(getOrientedSize(hd, -90)).toEqual({ width: 1080, height: 1920 });
    expect(getOrientedSize(hd, 180)).toEqual(hd);
  });
});
