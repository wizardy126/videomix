import { describe, expect, test } from 'vitest';

import { formatCursorDurationLabel, getCursorDurationInfo } from './cursorDuration';

describe('getCursorDurationInfo', () => {
  test('no current segment: undefined', () => {
    expect(getCursorDurationInfo(undefined, 5)).toBeUndefined();
  });

  test('marker (no end): elapsed time from its start to the cursor', () => {
    expect(getCursorDurationInfo({ start: 2, end: undefined }, 5)).toEqual({ type: 'marker', duration: 3 });
  });

  test('marker: cursor before its start clamps to 0 (scrubbing backwards)', () => {
    expect(getCursorDurationInfo({ start: 5, end: undefined }, 2)).toEqual({ type: 'marker', duration: 0 });
  });

  test('clip (has end): its own duration and the duration if the end moved to the cursor', () => {
    expect(getCursorDurationInfo({ start: 2, end: 6 }, 5)).toEqual({ type: 'clip', duration: 4, cursorDuration: 3 });
  });

  test('clip: cursor before its start clamps the hypothetical duration to 0', () => {
    expect(getCursorDurationInfo({ start: 5, end: 8 }, 1)).toEqual({ type: 'clip', duration: 3, cursorDuration: 0 });
  });

  test('clip: cursor past its end gives a longer hypothetical duration', () => {
    expect(getCursorDurationInfo({ start: 2, end: 6 }, 10)).toEqual({ type: 'clip', duration: 4, cursorDuration: 8 });
  });
});

describe('formatCursorDurationLabel', () => {
  test('undefined info: no label', () => {
    expect(formatCursorDurationLabel(undefined)).toBeUndefined();
  });

  test('marker: just the elapsed duration', () => {
    expect(formatCursorDurationLabel({ type: 'marker', duration: 5 })).toBe('0:05');
  });

  test('clip: duration and the hypothetical one, separated by an arrow', () => {
    expect(formatCursorDurationLabel({ type: 'clip', duration: 4, cursorDuration: 90 })).toBe('0:04 → 1:30');
  });
});
