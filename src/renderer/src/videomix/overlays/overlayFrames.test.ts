import { describe, test, expect } from 'vitest';

import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay, createSoundOverlay } from './factories';
import {
  formatCountdown, getCountdownSecondsFormatFrames, getCountdownTextAt, getCountdownUnits, getOverlayFrames, getOverlayPixelBox, getProgressBarFraction, getVisibleOverlayBoxes,
} from './overlayFrames';
import { resolveOverlayTimes } from './resolveOverlayTimes';

describe('countdown', () => {
  test('rounds up at the chosen precision, exact at whole values', () => {
    expect(getCountdownUnits(300, 30, 0)).toBe(10);
    expect(getCountdownUnits(299, 30, 0)).toBe(10);
    expect(getCountdownUnits(270, 30, 0)).toBe(9);
    expect(getCountdownUnits(1, 30, 0)).toBe(1);
    expect(getCountdownUnits(1, 30, 3)).toBe(34); // 0.0333… → 0.034
    expect(getCountdownUnits(3, 30, 1)).toBe(1); // 0.1 exactly
    expect(getCountdownUnits(1, 25, 2)).toBe(4);
  });

  test('format: SS below 60 s, M:SS from 60 s, decimals and leading zeros', () => {
    expect(formatCountdown(5, 0, false)).toBe('5');
    expect(formatCountdown(5, 0, true)).toBe('05');
    expect(formatCountdown(59, 0, false)).toBe('59');
    expect(formatCountdown(60, 0, false)).toBe('1:00');
    expect(formatCountdown(65, 0, true)).toBe('01:05');
    expect(formatCountdown(6005, 0, false)).toBe('100:05');
    expect(formatCountdown(34, 3, false)).toBe('0.034');
    expect(formatCountdown(34, 3, true)).toBe('00.034');
    expect(formatCountdown(5999, 2, false)).toBe('59.99');
    expect(formatCountdown(6000, 2, false)).toBe('1:00.00');
    expect(formatCountdown(7234, 1, false)).toBe('12:03.4');
  });

  test('the M:SS → SS switch frame agrees with the formatted value', () => {
    for (const fps of [24, 25, 30, 50, 60]) {
      for (const decimals of [0, 1, 2, 3]) {
        const r = getCountdownSecondsFormatFrames(fps, decimals);
        expect(formatCountdown(getCountdownUnits(r, fps, decimals), decimals, false)).not.toContain(':');
        expect(formatCountdown(getCountdownUnits(r + 1, fps, decimals), decimals, false)).toContain(':');
      }
    }
  });

  test('text at a frame: visible frames only, disappears at 0', () => {
    const countdown = { ...createCountdownOverlay({ id: 'c', name: 'c' }), decimals: 1 as const };
    const frames = getOverlayFrames({ start: 1, end: 3, rawStart: 1, rawEnd: 3 }, 30);
    expect(getCountdownTextAt(countdown, frames, 29, 30)).toBeUndefined();
    expect(getCountdownTextAt(countdown, frames, 30, 30)).toBe('2.0');
    expect(getCountdownTextAt(countdown, frames, 89, 30)).toBe('0.1');
    expect(getCountdownTextAt(countdown, frames, 90, 30)).toBeUndefined();
  });
});

test('progress bar fraction', () => {
  const frames = { rawStart: 10, rawEnd: 70 };
  expect(getProgressBarFraction('fill', frames, 10)).toBe(0);
  expect(getProgressBarFraction('fill', frames, 40)).toBe(0.5);
  expect(getProgressBarFraction('empty', frames, 40)).toBe(0.5);
  expect(getProgressBarFraction('empty', frames, 10)).toBe(1);
  expect(getProgressBarFraction('fill', frames, 100)).toBe(1);
});

test('pixel boxes are even and at least 2 px', () => {
  expect(getOverlayPixelBox({ x: 0.03, y: 0.94, width: 0.94, height: 0.03 }, 1920, 1080)).toEqual({ x: 58, y: 1016, width: 1804, height: 32 });
  expect(getOverlayPixelBox({ x: 0.5, y: 0.5, width: 0.0001, height: 0 }, 640, 360)).toEqual({ x: 320, y: 180, width: 2, height: 2 });
});

test('visible overlay boxes for the mini frame view, bottom to top', () => {
  const logo = { ...createImageOverlay({ id: 'i', name: 'Logo', start: 1, filePath: '/a.png' }), duration: 2 };
  const overlays = [
    logo,
    createSoundOverlay({ id: 's', name: 'Beep', start: 0, filePath: '/b.wav' }),
    createCountdownOverlay({ id: 'c', name: 'Count', start: 0 }),
    createProgressBarOverlay({ id: 'b', name: 'Bar', linkedCountdownId: 'c' }),
  ];
  const resolved = resolveOverlayTimes({ overlays, clips: [] }, { duration: 20, placements: [] }, { soundDurations: { s: 5 } });
  expect(getVisibleOverlayBoxes({ overlays, resolved, time: 0.5, fps: 30 }).map((o) => [o.id, o.type, o.layer])).toEqual([['c', 'countdown', 2], ['b', 'progressBar', 3]]);
  // the image's last frame is 89 (end 3 s = frame 90, excluded), like the render
  expect(getVisibleOverlayBoxes({ overlays, resolved, time: 2.98, fps: 30 }).map((o) => o.id)).toEqual(['i', 'c', 'b']);
  expect(getVisibleOverlayBoxes({ overlays, resolved, time: 2.999, fps: 30 }).map((o) => o.id)).toEqual(['c', 'b']);
  const [image] = getVisibleOverlayBoxes({ overlays, resolved, time: 2, fps: 30, width: 640, height: 360 });
  expect(image).toMatchObject({ id: 'i', name: 'Logo', box: logo.box, pixelBox: { x: 224, y: 126, width: 192, height: 108 } });
});
