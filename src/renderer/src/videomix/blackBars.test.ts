import { describe, test, expect } from 'vitest';

import {
  BLACK_BARS_MIN_SIZE, createBlackBarsDetection, cropDetectToDisplayRect, getNewClipMaxRect, getPictureRect, hasBlackBars, isBlackBarsDetectionValid,
  parseCropDetectOutput, removeBlackBarsFromRects,
} from './blackBars';
import type { BlackBarsDetection } from './types';

const frame = { width: 1920, height: 1080 };
const file = { size: 1000, mtimeMs: 123 };
const letterbox = createBlackBarsDetection({ rect: { x: 0, y: 140, width: 1920, height: 800 }, frame, file });

describe('cropDetectToDisplayRect', () => {
  test('square pixels: unchanged', () => {
    expect(cropDetectToDisplayRect({ rect: { x: 0, y: 140, width: 1920, height: 800 }, sar: undefined, displayFrame: frame })).toEqual({ x: 0, y: 140, width: 1920, height: 800 });
  });

  test('SAR > 1 stretches the width (1440×1080 at 4:3 → 1920×1080), SAR < 1 the height, rounding outwards', () => {
    expect(cropDetectToDisplayRect({ rect: { x: 180, y: 0, width: 1080, height: 1080 }, sar: { num: 4, den: 3 }, displayFrame: frame })).toEqual({ x: 240, y: 0, width: 1440, height: 1080 });
    // 720×480 at 8:9 → 720×540: 60..420 → 67.5..472.5 → 67..473
    expect(cropDetectToDisplayRect({ rect: { x: 0, y: 60, width: 720, height: 360 }, sar: { num: 8, den: 9 }, displayFrame: { width: 720, height: 540 } })).toEqual({ x: 0, y: 67, width: 720, height: 406 });
  });

  test('kept inside the frame', () => {
    expect(cropDetectToDisplayRect({ rect: { x: -4, y: 0, width: 2000, height: 1080 }, sar: undefined, displayFrame: frame })).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  test('turn: from the analyzed frame to the oriented one', () => {
    // a portrait video stored as 1920×1080 with a 90° rotation, analyzed without autorotate
    expect(cropDetectToDisplayRect({ rect: { x: 0, y: 140, width: 1920, height: 800 }, sar: undefined, displayFrame: { width: 1080, height: 1920 }, turn: 90 }))
      .toEqual({ x: 140, y: 0, width: 800, height: 1920 });
  });

  test('with the parser', () => {
    const rect = parseCropDetectOutput('[Parsed_cropdetect_0 @ 0x1] x1:180 x2:1259 y1:0 y2:1079 w:1080 h:1080 x:180 y:0 pts:0 t:0 limit:0.09 crop=1072:1072:184:4');
    expect(cropDetectToDisplayRect({ rect: rect!, sar: { num: 4, den: 3 }, displayFrame: frame })).toEqual({ x: 240, y: 0, width: 1440, height: 1080 });
  });
});

describe('detection cache', () => {
  test('createBlackBarsDetection: no picture found = the whole frame', () => {
    expect(createBlackBarsDetection({ rect: undefined, frame, file })).toEqual({ rect: { x: 0, y: 0, width: 1920, height: 1080 }, frame, file });
  });

  test('isBlackBarsDetectionValid: same display size and file', () => {
    const source = { width: 1920, height: 1080 };
    expect(isBlackBarsDetectionValid(letterbox, source, file)).toBe(true);
    expect(isBlackBarsDetectionValid(letterbox, source)).toBe(true);
    expect(isBlackBarsDetectionValid(letterbox, source, { ...file, mtimeMs: 124 })).toBe(false);
    expect(isBlackBarsDetectionValid(letterbox, source, { ...file, size: 1 })).toBe(false);
    expect(isBlackBarsDetectionValid(letterbox, { width: 1280, height: 720 })).toBe(false);
    expect(isBlackBarsDetectionValid(letterbox, {})).toBe(false);
    expect(isBlackBarsDetectionValid(undefined, source)).toBe(false);
  });
});

describe('getPictureRect', () => {
  test('bars thinner than the minimum are ignored; no bars → undefined', () => {
    expect(getPictureRect({ x: 0, y: 140, width: 1920, height: 800 }, frame)).toEqual({ x: 0, y: 140, width: 1920, height: 800 });
    expect(getPictureRect({ x: 2, y: 1, width: 1916, height: 1078 }, frame)).toBeUndefined();
    expect(getPictureRect({ x: BLACK_BARS_MIN_SIZE, y: 0, width: 1920 - BLACK_BARS_MIN_SIZE, height: 1080 }, frame)).toEqual({ x: 4, y: 0, width: 1916, height: 1080 });
    expect(getPictureRect({ x: 0, y: 0, width: 1920, height: 1080 }, frame)).toBeUndefined();
  });

  test('even edges, shrunk; too small → undefined', () => {
    expect(getPictureRect({ x: 241, y: 0, width: 1437, height: 1080 }, frame)).toEqual({ x: 242, y: 0, width: 1436, height: 1080 });
    expect(getPictureRect({ x: 900, y: 500, width: 10, height: 10 }, frame)).toBeUndefined();
  });

  test('hasBlackBars', () => {
    expect(hasBlackBars(letterbox)).toBe(true);
    expect(hasBlackBars(createBlackBarsDetection({ rect: undefined, frame, file }))).toBe(false);
  });
});

describe('getNewClipMaxRect', () => {
  const source = { width: 1920, height: 1080, blackBars: letterbox };

  test('without bars, disabled or stale: the whole frame', () => {
    expect(getNewClipMaxRect({ source, autoCropBlackBars: true })).toEqual({ x: 0, y: 140, width: 1920, height: 800 });
    expect(getNewClipMaxRect({ source, autoCropBlackBars: false })).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(getNewClipMaxRect({ source: { width: 1920, height: 1080 }, autoCropBlackBars: true })).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    const stale: BlackBarsDetection = { ...letterbox, frame: { width: 1280, height: 720 } };
    expect(getNewClipMaxRect({ source: { ...source, blackBars: stale }, autoCropBlackBars: true })).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(getNewClipMaxRect({ source: { blackBars: letterbox }, autoCropBlackBars: true })).toBeUndefined();
  });

  test('turned clip (E9): the picture turned with it', () => {
    expect(getNewClipMaxRect({ source, autoCropBlackBars: true, rotation: 90 })).toEqual({ x: 140, y: 0, width: 800, height: 1920 });
    expect(getNewClipMaxRect({ source: { width: 1920, height: 1080 }, autoCropBlackBars: true, rotation: 90 })).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
  });
});

describe('removeBlackBarsFromRects', () => {
  const picture = { x: 0, y: 140, width: 1920, height: 800 };

  test('cuts the max (never grows it) and the min with it', () => {
    expect(removeBlackBarsFromRects({ maxRect: { x: 0, y: 0, width: 1920, height: 1080 } }, picture)).toEqual({ maxRect: picture });
    expect(removeBlackBarsFromRects({ maxRect: { x: 100, y: 100, width: 800, height: 600 }, minRect: { x: 200, y: 100, width: 400, height: 400 } }, picture))
      .toEqual({ maxRect: { x: 100, y: 140, width: 800, height: 560 }, minRect: { x: 200, y: 140, width: 400, height: 360 } });
  });

  test('a min left too small is moved inside instead', () => {
    expect(removeBlackBarsFromRects({ maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, minRect: { x: 0, y: 0, width: 100, height: 150 } }, picture))
      .toEqual({ maxRect: picture, minRect: { x: 0, y: 140, width: 100, height: 150 } });
  });

  test('nothing to remove, or nothing left: undefined', () => {
    expect(removeBlackBarsFromRects({ maxRect: { x: 100, y: 200, width: 800, height: 600 } }, picture)).toBeUndefined();
    expect(removeBlackBarsFromRects({ maxRect: { x: 0, y: 0, width: 1920, height: 140 } }, picture)).toBeUndefined();
  });
});
