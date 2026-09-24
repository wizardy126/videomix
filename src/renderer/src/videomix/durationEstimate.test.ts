import { describe, expect, test } from 'vitest';

import { exceedsMaxDuration, formatEstimatedDuration, formatMaxDuration } from './durationEstimate';

describe('formatEstimatedDuration', () => {
  test('no duration yet: no label', () => {
    expect(formatEstimatedDuration(undefined)).toBeUndefined();
  });

  test('formats with the "≈" prefix', () => {
    expect(formatEstimatedDuration(65)).toBe('≈ 1:05');
  });
});

describe('exceedsMaxDuration', () => {
  test('no limit: never exceeds', () => {
    expect(exceedsMaxDuration(100, undefined)).toBe(false);
  });

  test('no duration yet: never exceeds', () => {
    expect(exceedsMaxDuration(undefined, 10)).toBe(false);
  });

  test('over the limit', () => {
    expect(exceedsMaxDuration(30, 20)).toBe(true);
  });

  test('at or under the limit', () => {
    expect(exceedsMaxDuration(20, 20)).toBe(false);
    expect(exceedsMaxDuration(10, 20)).toBe(false);
  });
});

describe('formatMaxDuration', () => {
  test('formats the limit itself', () => {
    expect(formatMaxDuration(90)).toBe('1:30');
  });
});
