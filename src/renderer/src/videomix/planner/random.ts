// Seeded randomness for the planner: plans must be reproducible, so no Math.random.

/** mulberry32 PRNG: returns a function yielding floats in [0, 1). Same seed, same sequence. */
export function createRandom(seed: number) {
  // eslint-disable-next-line no-bitwise
  let state = seed >>> 0;
  return () => {
    /* eslint-disable no-bitwise */
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    /* eslint-enable no-bitwise */
  };
}

/** Deterministic Fisher-Yates shuffle (returns a new array). */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const random = createRandom(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** The base order the reorder window applies to: the list itself, or its seeded shuffle in random mode. */
export function getBaseOrder<T>(items: readonly T[], order: { mode: 'list' | 'random', seed: number }): T[] {
  return order.mode === 'random' ? shuffle(items, order.seed) : [...items];
}
