import { describe, test, expect } from 'vitest';

import { getCodedSize, getDisplaySize, getOrientedSar, isSameSar, normalizeSar, parseSampleAspectRatio, toCodedRect } from './sampleAspect';

describe('parseSampleAspectRatio', () => {
  test('reduced ratio, undefined when unknown or invalid', () => {
    expect(parseSampleAspectRatio('679:640')).toEqual({ num: 679, den: 640 });
    expect(parseSampleAspectRatio('32:27')).toEqual({ num: 32, den: 27 });
    expect(parseSampleAspectRatio('2:2')).toEqual({ num: 1, den: 1 });
    expect(parseSampleAspectRatio('0:1')).toBeUndefined();
    expect(parseSampleAspectRatio('N/A')).toBeUndefined();
    expect(parseSampleAspectRatio(undefined)).toBeUndefined();
  });
});

describe('SAR helpers', () => {
  test('square = undefined', () => {
    expect(normalizeSar({ num: 1, den: 1 })).toBeUndefined();
    expect(normalizeSar({ num: 8, den: 9 })).toEqual({ num: 8, den: 9 });
    expect(isSameSar(undefined, { num: 3, den: 3 })).toBe(true);
    expect(isSameSar({ num: 4, den: 3 }, { num: 8, den: 6 })).toBe(true);
    expect(isSameSar({ num: 4, den: 3 }, undefined)).toBe(false);
  });

  test('a quarter turn inverts the SAR (ffmpeg transpose)', () => {
    expect(getOrientedSar({ num: 679, den: 640 }, 90)).toEqual({ num: 640, den: 679 });
    expect(getOrientedSar({ num: 679, den: 640 }, -90)).toEqual({ num: 640, den: 679 });
    expect(getOrientedSar({ num: 679, den: 640 }, 180)).toEqual({ num: 679, den: 640 });
    expect(getOrientedSar(undefined, 90)).toBeUndefined();
  });

  test('display size grows one dimension, like Chromium (verified in Electron)', () => {
    expect(getDisplaySize({ width: 1280, height: 720 }, { num: 679, den: 640 })).toEqual({ width: 1358, height: 720 });
    expect(getDisplaySize({ width: 1280, height: 720 }, { num: 87, den: 82 })).toEqual({ width: 1358, height: 720 });
    // rotated: 720x1280 at 640:679 → taller
    expect(getDisplaySize({ width: 720, height: 1280 }, { num: 640, den: 679 })).toEqual({ width: 720, height: 1358 });
    // SAR < 1 (720x480 at 8:9, DVD 4:3) → 720x540, not 640x480
    expect(getDisplaySize({ width: 720, height: 480 }, { num: 8, den: 9 })).toEqual({ width: 720, height: 540 });
    expect(getDisplaySize({ width: 1920, height: 1080 }, undefined)).toEqual({ width: 1920, height: 1080 });
  });

  test('coded size is the inverse', () => {
    expect(getCodedSize({ width: 1358, height: 720 }, { num: 679, den: 640 })).toEqual({ width: 1280, height: 720 });
    expect(getCodedSize({ width: 1358, height: 720 }, { num: 87, den: 82 })).toEqual({ width: 1280, height: 720 });
    expect(getCodedSize({ width: 720, height: 1358 }, { num: 640, den: 679 })).toEqual({ width: 720, height: 1280 });
    expect(getCodedSize({ width: 720, height: 540 }, { num: 8, den: 9 })).toEqual({ width: 720, height: 480 });
  });
});

describe('toCodedRect', () => {
  test('the user case: 78,14 1232x694 on 1358x720 display (1280x720 at 679:640)', () => {
    const coded = toCodedRect({ x: 78, y: 14, width: 1232, height: 694 }, { num: 679, den: 640 }, { width: 1358, height: 720 });
    // 78 / 1.0609 = 73.5 → 74; 1310 / 1.0609 = 1234.8 → 1234
    expect(coded).toEqual({ x: 74, y: 14, width: 1160, height: 694 });
  });

  test('full frame maps to the full coded frame', () => {
    expect(toCodedRect({ x: 0, y: 0, width: 1358, height: 720 }, { num: 87, den: 82 }, { width: 1358, height: 720 })).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  test('rotated (oriented SAR < 1): the vertical axis', () => {
    const coded = toCodedRect({ x: 14, y: 78, width: 694, height: 1232 }, { num: 640, den: 679 }, { width: 720, height: 1358 });
    expect(coded).toEqual({ x: 14, y: 74, width: 694, height: 1160 });
  });

  test('SAR < 1: the vertical axis, even edges', () => {
    // 720x540 display of 720x480: y × 8/9
    expect(toCodedRect({ x: 100, y: 60, width: 400, height: 400 }, { num: 8, den: 9 }, { width: 720, height: 540 })).toEqual({ x: 100, y: 54, width: 400, height: 354 });
  });

  test('stays inside an odd coded frame, at least 2 px', () => {
    // 1279 coded px at 2:1 → 2558 display
    expect(toCodedRect({ x: 2500, y: 0, width: 58, height: 100 }, { num: 2, den: 1 }, { width: 2558, height: 100 })).toEqual({ x: 1250, y: 0, width: 28, height: 100 });
    expect(toCodedRect({ x: 2556, y: 0, width: 2, height: 100 }, { num: 2, den: 1 }, { width: 2558, height: 100 })).toEqual({ x: 1276, y: 0, width: 2, height: 100 });
  });

  test('square pixels: unchanged', () => {
    const rect = { x: 3, y: 5, width: 101, height: 99 };
    expect(toCodedRect(rect, undefined)).toBe(rect);
    expect(toCodedRect(rect, { num: 1, den: 1 })).toBe(rect);
  });
});
