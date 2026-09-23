import { describe, test, expect } from 'vitest';

import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay, createSoundOverlay } from './factories';
import {
  formatCountdown, getCountdownMinutesFormat, getCountdownTextAt, getCountdownUnits, getOverlayFrames, getOverlayPixelBox, getProgressBarFraction, getVisibleOverlayBoxes,
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

  test('format: SS or M:SS (per the minutesFormat flag), decimals and leading zeros', () => {
    expect(formatCountdown(5, 0, false, false)).toBe('5');
    expect(formatCountdown(5, 0, true, false)).toBe('05');
    expect(formatCountdown(59, 0, false, false)).toBe('59');
    expect(formatCountdown(60, 0, false, true)).toBe('1:00');
    expect(formatCountdown(65, 0, true, true)).toBe('01:05');
    expect(formatCountdown(6005, 0, false, true)).toBe('100:05');
    expect(formatCountdown(34, 3, false, false)).toBe('0.034');
    expect(formatCountdown(34, 3, true, false)).toBe('00.034');
    expect(formatCountdown(5999, 2, false, false)).toBe('59.99');
    expect(formatCountdown(6000, 2, false, true)).toBe('1:00.00');
    expect(formatCountdown(7234, 1, false, true)).toBe('12:03.4');
    // below 60 s of shown value but the format stays M:SS because the whole countdown does (01-requisitos §9.1)
    expect(formatCountdown(59, 0, false, true)).toBe('0:59');
  });

  test('minutes format: decided once by the (uncut) duration, not by the shown value', () => {
    expect(getCountdownMinutesFormat({ rawStart: 0, rawEnd: 59 * 30 }, 30)).toBe(false);
    expect(getCountdownMinutesFormat({ rawStart: 0, rawEnd: 60 * 30 }, 30)).toBe(true);
    expect(getCountdownMinutesFormat({ rawStart: 10 * 30, rawEnd: 10 * 30 + 60 * 30 }, 30)).toBe(true);
  });

  test('text at a frame: visible frames only, disappears at 0, M:SS throughout a ≥ 60 s countdown', () => {
    const countdown = { ...createCountdownOverlay({ id: 'c', name: 'c' }), decimals: 1 as const };
    const frames = getOverlayFrames({ start: 1, end: 3, rawStart: 1, rawEnd: 3 }, 30);
    expect(getCountdownTextAt(countdown, frames, 29, 30)).toBeUndefined();
    expect(getCountdownTextAt(countdown, frames, 30, 30)).toBe('2.0');
    expect(getCountdownTextAt(countdown, frames, 89, 30)).toBe('0.1');
    expect(getCountdownTextAt(countdown, frames, 90, 30)).toBeUndefined();

    const longFrames = getOverlayFrames({ start: 0, end: 61, rawStart: 0, rawEnd: 61 }, 1);
    const long = { ...createCountdownOverlay({ id: 'c2', name: 'c2' }), decimals: 0 as const };
    expect(getCountdownTextAt(long, longFrames, 0, 1)).toBe('1:01');
    expect(getCountdownTextAt(long, longFrames, 1, 1)).toBe('1:00');
    expect(getCountdownTextAt(long, longFrames, 2, 1)).toBe('0:59');
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
