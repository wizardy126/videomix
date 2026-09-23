import { describe, expect, test } from 'vitest';

import { DRIFT_SEEK_THRESHOLD, MAX_RATE_NUDGE, MAX_SEEK_LEAD, SEEK_LEAD, createPreviewClock, getClockTime, getDriftCorrection, getSeekLead, isClockAtEnd, pauseClock, playClock, seekClock, setClockDuration, smoothSeekDuration } from './previewClock';

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

describe('seek lead (T33)', () => {
  test('the measured seek duration, between SEEK_LEAD and MAX_SEEK_LEAD', () => {
    expect(getSeekLead(undefined)).toBe(SEEK_LEAD);
    expect(getSeekLead(0.02)).toBe(SEEK_LEAD);
    expect(getSeekLead(1.2)).toBe(1.2);
    expect(getSeekLead(10)).toBe(MAX_SEEK_LEAD);
    expect(getSeekLead(Number.NaN)).toBe(SEEK_LEAD);
  });

  test('smoothed over the seeks', () => {
    expect(smoothSeekDuration(undefined, 1)).toBe(1);
    expect(smoothSeekDuration(1, 2)).toBe(1.5);
  });

  test('ahead by less than the lead: wait for the clock; with the default lead, never', () => {
    expect(getDriftCorrection({ expected: 5, actual: 5.5, playing: true, seekLead: 1.2 })).toEqual({ kind: 'wait', rate: 1 });
    expect(getDriftCorrection({ expected: 5, actual: 6.5, playing: true, seekLead: 1.2 })).toEqual({ kind: 'seek', time: 6.2, rate: 1 });
    expect(getDriftCorrection({ expected: 5, actual: 5 + DRIFT_SEEK_THRESHOLD + 0.01, playing: true }).kind).toBe('seek');
  });

  test('a seek aims that far ahead', () => {
    expect(getDriftCorrection({ expected: 5, actual: 4, playing: true, seekLead: 1.2 })).toEqual({ kind: 'seek', time: 6.2, rate: 1 });
    // paused: exact
    expect(getDriftCorrection({ expected: 5, actual: 4, playing: false, seekLead: 1.2 })).toEqual({ kind: 'seek', time: 5, rate: 1 });
  });

  test('a slow seek converges instead of seeking again forever', () => {
    // An element whose seeks take 1.5 s: simulate the clock and the element (it plays in real time once seeked)
    const seekTime = 1.5;
    let seekDuration: number | undefined;
    let clock = 3;
    let actual = 0;
    let seeks = 0;
    for (let i = 0; i < 10; i += 1) {
      const correction = getDriftCorrection({ expected: clock, actual, playing: true, seekLead: getSeekLead(seekDuration) });
      if (correction.kind !== 'seek') break;
      seeks += 1;
      clock += seekTime;
      actual = correction.time;
      seekDuration = smoothSeekDuration(seekDuration, seekTime);
    }
    expect(seeks).toBe(2);
    expect(Math.abs(actual - clock)).toBeLessThanOrEqual(DRIFT_SEEK_THRESHOLD);
  });
});
