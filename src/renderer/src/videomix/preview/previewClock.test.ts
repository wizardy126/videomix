import { describe, expect, test } from 'vitest';

import { DRIFT_SEEK_THRESHOLD, MAX_RATE_NUDGE, SEEK_LEAD, createPreviewClock, getClockTime, getDriftCorrection, isClockAtEnd, pauseClock, playClock, seekClock, setClockDuration } from './previewClock';

describe('preview clock', () => {
  test('runs in real time while playing and stops at the end', () => {
    let clock = createPreviewClock(10);
    expect(getClockTime(clock, 5000)).toBe(0);
    clock = playClock(clock, 1000);
    expect(getClockTime(clock, 3500)).toBeCloseTo(2.5);
    expect(getClockTime(clock, 20_000)).toBe(10);
    expect(isClockAtEnd(clock, 20_000)).toBe(true);
    expect(isClockAtEnd(clock, 2000)).toBe(false);
  });

  test('pause keeps the time, seek moves it (clamped), play at the end restarts', () => {
    let clock = playClock(createPreviewClock(10), 0);
    clock = pauseClock(clock, 4000);
    expect(clock.playing).toBe(false);
    expect(getClockTime(clock, 9000)).toBe(4);
    clock = seekClock(clock, 7, 9000);
    expect(getClockTime(clock, 12_000)).toBe(7);
    expect(seekClock(clock, -3, 0).time).toBe(0);
    expect(seekClock(clock, 30, 0).time).toBe(10);
    // seeking while playing keeps playing from there
    clock = seekClock(playClock(clock, 12_000), 2, 13_000);
    expect(getClockTime(clock, 14_000)).toBeCloseTo(3);
    clock = playClock(pauseClock(seekClock(clock, 10, 15_000), 15_000), 16_000);
    expect(getClockTime(clock, 16_000)).toBe(0);
  });

  test('a shorter duration clamps the time', () => {
    const clock = setClockDuration(seekClock(createPreviewClock(10), 8, 0), 5, 0);
    expect(getClockTime(clock, 0)).toBe(5);
    expect(clock.duration).toBe(5);
  });
});

describe('getDriftCorrection', () => {
  test('small drift while playing: nothing', () => {
    expect(getDriftCorrection({ expected: 5, actual: 5.02, playing: true })).toEqual({ kind: 'none', rate: 1 });
  });

  test('moderate drift: rate nudge, slower when ahead, faster when behind, bounded', () => {
    const ahead = getDriftCorrection({ expected: 5, actual: 5.08, playing: true });
    const behind = getDriftCorrection({ expected: 5, actual: 4.92, playing: true });
    expect(ahead.kind).toBe('rate');
    expect(ahead.rate).toBeLessThan(1);
    expect(behind.rate).toBeGreaterThan(1);
    expect(Math.abs(ahead.rate - 1)).toBeLessThanOrEqual(MAX_RATE_NUDGE + 1e-9);
    expect(Math.abs(getDriftCorrection({ expected: 5, actual: 5 + DRIFT_SEEK_THRESHOLD - 0.001, playing: true }).rate - 1)).toBeLessThanOrEqual(MAX_RATE_NUDGE + 1e-9);
  });

  test('large drift: seek a bit ahead while playing, exactly when paused', () => {
    expect(getDriftCorrection({ expected: 5, actual: 5.5, playing: true })).toEqual({ kind: 'seek', time: 5 + SEEK_LEAD, rate: 1 });
    expect(getDriftCorrection({ expected: 5, actual: 4, playing: true })).toEqual({ kind: 'seek', time: 5 + SEEK_LEAD, rate: 1 });
    expect(getDriftCorrection({ expected: 5, actual: 5.02, playing: false })).toEqual({ kind: 'seek', time: 5, rate: 1 });
    expect(getDriftCorrection({ expected: 5, actual: 5, playing: false })).toEqual({ kind: 'none', rate: 1 });
  });
});
