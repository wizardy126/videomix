import { describe, test, expect } from 'vitest';

import {
  clampTransform, easeKeyframe, findKeyframeIndex, getBaseTransform, getClipRectsAt, getKeyframeSegments, getKeyframeTransformAt,
  getNextKeyframe, getPrevKeyframe, getRectsForTransform, getTransformFromMaxRect, getTransformedRects, isClipAnimated,
  normalizeKeyframes, removeKeyframe, rescaleKeyframes, rotateKeyframes, setKeyframe, setKeyframeInterpolation, shiftKeyframes,
} from './clipKeyframes';
import { rotateClipRects } from './clipRotation';
import { rectContains } from './geometry';
import type { MixClip, MixClipKeyframe, Rect } from './types';

const frame = { width: 1920, height: 1080 };
const maxRect: Rect = { x: 480, y: 270, width: 960, height: 540 };
const minRect: Rect = { x: 720, y: 270, width: 480, height: 540 };

const kf = (time: number, centerX: number, centerY: number, scale: number, interpolation?: MixClipKeyframe['interpolation']): MixClipKeyframe => (
  { time, centerX, centerY, scale, ...(interpolation != null && { interpolation }) }
);

const isEven = (r: Rect) => [r.x, r.y, r.width, r.height].every((v) => v % 2 === 0);

describe('easeKeyframe', () => {
  test('curves', () => {
    expect([0, 0.25, 0.5, 0.75, 1].map((u) => easeKeyframe('linear', u))).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect([0, 0.5, 1].map((u) => easeKeyframe('smooth', u))).toEqual([0, 0.5, 1]);
    // ease in-out: slow at both ends
    expect(easeKeyframe('smooth', 0.1)).toBeLessThan(0.1);
    expect(easeKeyframe('smooth', 0.9)).toBeGreaterThan(0.9);
    expect([0, 0.5, 0.999, 1].map((u) => easeKeyframe('hold', u))).toEqual([0, 0, 0, 1]);
    // clamped
    expect(easeKeyframe('linear', -1)).toBe(0);
    expect(easeKeyframe('smooth', 2)).toBe(1);
  });
});

describe('getKeyframeTransformAt', () => {
  const keyframes = [kf(2, 960, 540, 1), kf(4, 760, 440, 0.5, 'linear'), kf(6, 960, 540, 1, 'hold'), kf(8, 1000, 600, 1)];

  test('no keyframes', () => {
    expect(getKeyframeTransformAt(undefined, 3)).toBeUndefined();
    expect(getKeyframeTransformAt([], 3)).toBeUndefined();
  });

  test('holds the first/last keyframe outside them', () => {
    expect(getKeyframeTransformAt(keyframes, 0)).toEqual({ centerX: 960, centerY: 540, scale: 1 });
    expect(getKeyframeTransformAt(keyframes, 100)).toEqual({ centerX: 1000, centerY: 600, scale: 1 });
  });

  test('interpolates with the first keyframe interpolation (smooth by default)', () => {
    // smooth at the middle is half way, at a quarter less than linear
    expect(getKeyframeTransformAt(keyframes, 3)).toEqual({ centerX: 860, centerY: 490, scale: 0.75 });
    expect(getKeyframeTransformAt(keyframes, 2.5)!.scale).toBeGreaterThan(1 - 0.25 * 0.5);
    // linear
    expect(getKeyframeTransformAt(keyframes, 4.5)).toEqual({ centerX: 810, centerY: 465, scale: 0.625 });
    // hold until the next one
    expect(getKeyframeTransformAt(keyframes, 7.99)).toEqual({ centerX: 960, centerY: 540, scale: 1 });
    expect(getKeyframeTransformAt(keyframes, 8)).toEqual({ centerX: 1000, centerY: 600, scale: 1 });
  });

  test('exact at the keyframes, and order-independent', () => {
    keyframes.forEach((k) => expect(getKeyframeTransformAt(keyframes, k.time)).toEqual({ centerX: k.centerX, centerY: k.centerY, scale: k.scale }));
    expect(getKeyframeTransformAt([...keyframes].reverse(), 3)).toEqual(getKeyframeTransformAt(keyframes, 3));
  });

  test('segments for the render', () => {
    expect(getKeyframeSegments(keyframes).map(({ from, to, interpolation }) => ({ from, to, interpolation }))).toEqual([
      { from: 2, to: 4, interpolation: 'smooth' },
      { from: 4, to: 6, interpolation: 'linear' },
      { from: 6, to: 8, interpolation: 'hold' },
    ]);
    expect(getKeyframeSegments([kf(1, 0, 0, 1)])).toEqual([]);
    expect(getKeyframeSegments(undefined)).toEqual([]);
  });
});

describe('rects', () => {
  test('base transform gives back the base rects', () => {
    expect(getBaseTransform(maxRect)).toEqual({ centerX: 960, centerY: 540, scale: 1 });
    expect(getRectsForTransform({ maxRect, minRect }, getBaseTransform(maxRect), frame)).toEqual({ maxRect, minRect });
    expect(getTransformFromMaxRect(maxRect, { x: 0, y: 0, width: 480, height: 270 })).toEqual({ centerX: 240, centerY: 135, scale: 0.5 });
  });

  test('the min keeps its relative position inside the max, both scaled', () => {
    const { maxRect: max, minRect: min } = getTransformedRects({ maxRect, minRect }, { centerX: 400, centerY: 300, scale: 0.5 });
    expect(max).toEqual({ x: 160, y: 165, width: 480, height: 270 });
    expect(min).toEqual({ x: 280, y: 165, width: 240, height: 270 });
    expect(getTransformedRects({ maxRect }, { centerX: 400, centerY: 300, scale: 0.5 }).minRect).toBeUndefined();
  });

  test('clamped into the frame: scale first, then the centre', () => {
    expect(clampTransform(maxRect, { centerX: 100, centerY: 100, scale: 3 }, frame)).toEqual({ centerX: 960, centerY: 540, scale: 2 });
    expect(clampTransform(maxRect, { centerX: 0, centerY: 2000, scale: 1 }, frame)).toEqual({ centerX: 480, centerY: 810, scale: 1 });
    expect(clampTransform(maxRect, { centerX: 0, centerY: 0, scale: 1 }, undefined)).toEqual({ centerX: 0, centerY: 0, scale: 1 });
  });

  test('getClipRectsAt: base rects without keyframes, even rects inside the frame with the same proportion', () => {
    const odd = { maxRect: { x: 1, y: 1, width: 961, height: 541 }, minRect: undefined };
    expect(getClipRectsAt(odd, 3, frame)).toEqual(odd);

    const clip: Pick<MixClip, 'maxRect' | 'minRect' | 'keyframes'> = {
      maxRect,
      minRect,
      keyframes: [kf(0, 960, 540, 1), kf(10, 300, 200, 0.37, 'linear'), kf(20, 1900, 1000, 2)],
    };
    for (let t = -1; t <= 21; t += 0.37) {
      const { maxRect: max, minRect: min } = getClipRectsAt(clip, t, frame);
      expect(isEven(max)).toBe(true);
      expect(isEven(min!)).toBe(true);
      expect(rectContains({ x: 0, y: 0, ...frame }, max)).toBe(true);
      expect(rectContains(max, min!)).toBe(true);
      // proportion kept up to the even rounding
      expect(Math.abs(max.width / max.height - 16 / 9)).toBeLessThan(0.03);
    }
    expect(getClipRectsAt(clip, 10, frame).maxRect).toEqual({ x: 122, y: 100, width: 356, height: 200 });
  });

  test('isClipAnimated', () => {
    expect(isClipAnimated({})).toBe(false);
    expect(isClipAnimated({ keyframes: [] })).toBe(false);
    expect(isClipAnimated({ keyframes: [kf(0, 0, 0, 1)] })).toBe(true);
  });
});

describe('editing helpers', () => {
  const keyframes = [kf(1, 10, 10, 1), kf(3, 30, 30, 1, 'linear')];

  test('normalizeKeyframes sorts, merges the same time and drops an empty list', () => {
    expect(normalizeKeyframes([])).toBeUndefined();
    expect(normalizeKeyframes(undefined)).toBeUndefined();
    expect(normalizeKeyframes([kf(3, 3, 3, 1), kf(1, 1, 1, 1), kf(3.0001, 4, 4, 1)])).toEqual([kf(1, 1, 1, 1), kf(3.0001, 4, 4, 1)]);
  });

  test('setKeyframe adds or updates (auto-key)', () => {
    expect(setKeyframe(undefined, 2, { centerX: 1, centerY: 2, scale: 0.5 })).toEqual([kf(2, 1, 2, 0.5)]);
    expect(setKeyframe(keyframes, 2, { centerX: 20, centerY: 20, scale: 0.5 })).toEqual([keyframes[0], kf(2, 20, 20, 0.5), keyframes[1]]);
    // updating keeps the time and the interpolation of the existing one
    expect(setKeyframe(keyframes, 3.0004, { centerX: 5, centerY: 5, scale: 2 })).toEqual([keyframes[0], kf(3, 5, 5, 2, 'linear')]);
    expect(setKeyframe(keyframes, 3, { centerX: 5, centerY: 5, scale: 2 }, { interpolation: 'smooth' })).toEqual([keyframes[0], kf(3, 5, 5, 2)]);
    expect(setKeyframe(keyframes, 5, { centerX: 5, centerY: 5, scale: 2 }, { interpolation: 'hold' })).toEqual([...keyframes, kf(5, 5, 5, 2, 'hold')]);
    // doesn't mutate
    expect(keyframes).toEqual([kf(1, 10, 10, 1), kf(3, 30, 30, 1, 'linear')]);
  });

  test('removeKeyframe', () => {
    expect(removeKeyframe(keyframes, 1)).toEqual([keyframes[1]]);
    expect(removeKeyframe([keyframes[0]!], 1)).toBeUndefined();
    expect(removeKeyframe(keyframes, 2)).toEqual(keyframes);
    expect(removeKeyframe(undefined, 2)).toBeUndefined();
  });

  test('setKeyframeInterpolation: the default is not stored', () => {
    expect(setKeyframeInterpolation(keyframes, 1, 'hold')).toEqual([kf(1, 10, 10, 1, 'hold'), keyframes[1]]);
    expect(setKeyframeInterpolation(keyframes, 3, 'smooth')).toEqual([keyframes[0], kf(3, 30, 30, 1)]);
    expect(setKeyframeInterpolation(keyframes, 2, 'hold')).toEqual(keyframes);
  });

  test('find, previous and next', () => {
    expect(findKeyframeIndex(keyframes, 3.0005)).toBe(1);
    expect(findKeyframeIndex(keyframes, 2)).toBe(-1);
    expect(getPrevKeyframe(keyframes, 3)?.time).toBe(1);
    expect(getPrevKeyframe(keyframes, 1)).toBeUndefined();
    expect(getNextKeyframe(keyframes, 1)?.time).toBe(3);
    expect(getNextKeyframe(keyframes, 0)?.time).toBe(1);
    expect(getNextKeyframe(keyframes, 3)).toBeUndefined();
  });
});

describe('transforms of the whole animation', () => {
  test('rotateKeyframes turns the animated rects like rotateClipRects turns the rects (E9), up to even rounding', () => {
    const keyframes = [kf(0, 700, 400, 0.5), kf(2, 1200, 600, 1)];
    for (const turn of [90, 180, 270] as const) {
      const turned = rotateClipRects({ maxRect, minRect }, frame, 0, turn);
      const turnedKeyframes = rotateKeyframes(keyframes, frame, turn);
      const turnedFrame = turn === 180 ? frame : { width: frame.height, height: frame.width };
      keyframes.forEach((k, i) => {
        const before = getRectsForTransform({ maxRect, minRect }, k, frame);
        const after = getRectsForTransform(turned, turnedKeyframes![i]!, turnedFrame);
        const expected = rotateClipRects(before, frame, 0, turn);
        // the same up to the even rounding of a centre on a tie (±2 px)
        (['maxRect', 'minRect'] as const).forEach((key) => {
          (['x', 'y', 'width', 'height'] as const).forEach((prop) => expect(Math.abs(after[key]![prop] - expected[key]![prop])).toBeLessThanOrEqual(2));
        });
      });
    }
    expect(rotateKeyframes(undefined, frame, 90)).toBeUndefined();
    expect(rotateKeyframes(keyframes, frame, 0)).toBe(keyframes);
  });

  test('rescaleKeyframes maps the centres with the frame, the scale stays', () => {
    expect(rescaleKeyframes([kf(1, 960, 540, 0.5)], { from: frame, to: { width: 1280, height: 720 } })).toEqual([kf(1, 640, 360, 0.5)]);
  });

  test('shiftKeyframes', () => {
    expect(shiftKeyframes([kf(1, 0, 0, 1)], 2.5)).toEqual([kf(3.5, 0, 0, 1)]);
    expect(shiftKeyframes(undefined, 2)).toBeUndefined();
  });
});
