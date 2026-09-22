import { describe, test, expect } from 'vitest';

import { createRandom, getBaseOrder, shuffle } from './random';

describe('random', () => {
  test('same seed, same sequence; values in [0, 1)', () => {
    const a = createRandom(123);
    const b = createRandom(123);
    const values = Array.from({ length: 1000 }, () => a());
    expect(Array.from({ length: 1000 }, () => b())).toEqual(values);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(createRandom(124)()).not.toBe(values[0]);
  });

  test('shuffle is a deterministic permutation', () => {
    const items = Array.from({ length: 50 }, (_v, i) => i);
    const shuffled = shuffle(items, 7);
    expect(shuffle(items, 7)).toEqual(shuffled);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(items);
    expect(shuffled).not.toEqual(items);
    expect(shuffle(items, 8)).not.toEqual(shuffled);
    expect(items[0]).toBe(0); // input untouched
  });

  test('getBaseOrder', () => {
    const items = ['a', 'b', 'c', 'd'];
    expect(getBaseOrder(items, { mode: 'list', seed: 5 })).toEqual(items);
    expect(getBaseOrder(items, { mode: 'random', seed: 5 })).toEqual(shuffle(items, 5));
  });
});
