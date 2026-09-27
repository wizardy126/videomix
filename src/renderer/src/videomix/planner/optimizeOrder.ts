import invariant from 'tiny-invariant';

import { comparePlanQuality, planMixBest } from './planMix';
import type { PlanQuality } from './planMix';
import { createRandom } from './random';
import { getReorderWindowSize } from './types';
import type { MixPlan, PlanMixInput, PlanPriority } from './types';

// I2 (T61): "Optimize montage". A search over the order of the clip list, each candidate planned by the real planner
// (planMixBest, the one the render uses, safety net included) and compared by the project's priority.

/** A candidate's quality: the plan's, with `order` counting also how far the list moved from the original one. */
export interface OrderQuality extends PlanQuality {
  /** Σ |new list position − original position| (the list moves, not the planner's own reordering). */
  displacement: number,
}

export interface OrderOptimizerBest {
  /** Clip ids in the best list order found so far. */
  order: string[],
  quality: OrderQuality,
  /** Evaluations done when it was found. */
  evaluation: number,
}

/**
 * Initial temperature of each annealing round, as a fraction of the original plan's main metric (duration, or fill
 * with the fill priority): a move that makes a 300 s video 1.5 s longer is still taken about a third of the times.
 */
const START_TEMPERATURE = 0.005;
/** The temperature falls geometrically to this fraction of the initial one along a round. */
const END_TEMPERATURE = 0.01;
/** Evaluations of the first round; each round doubles the previous one and restarts from the best order so far. */
const FIRST_ROUND = 200;
/**
 * The annealing walks by a scalar energy: the main metric plus this much of the second one (fill or duration) and of
 * the displacement, so it also prefers less fill and fewer moves. The best order is kept by {@link comparePlanQuality}.
 */
const SECOND_WEIGHT = 0.05;
const DISPLACEMENT_WEIGHT = 0.001;
/** How much the walk pays for each unit of the second metric above the original order's (see {@link keepsSecond}). */
const EXCESS_WEIGHT = 1;
/** The steps of comparePlanQuality (planMix.ts, T52). */
const DURATION_STEP = 0.05;
const FILL_STEP = 0.01;
/** Tries to find a move that keeps every clip in its window before giving up an evaluation. */
const MOVE_TRIES = 20;
const EPS = 1e-6;
/** Remembered candidates (by order), so a revisited order isn't planned again. */
const CACHE_SIZE = 20_000;

/**
 * Clips the optimizer leaves where they are in the list: pinned ones (their own pin or a pinned group's, A4) and those
 * of the always-visible sequence (E5). The planner doesn't take them by list position, so moving them can't help.
 */
export function getFixedClipIds({ clips, sequence = [] }: Pick<PlanMixInput, 'clips' | 'sequence'>): Set<string> {
  const pinnedGroups = new Set(clips.filter((clip) => clip.pinTime != null && clip.groupId != null).map((clip) => clip.groupId));
  const fixed = new Set(sequence);
  clips.forEach((clip) => {
    if (clip.pinTime != null || (clip.groupId != null && pinnedGroups.has(clip.groupId))) fixed.add(clip.id);
  });
  return fixed;
}

/** Why the order can't be optimized, if it can't: random order (the list isn't the base order) or nothing to move. */
export function getOptimizeOrderBlocker(input: Pick<PlanMixInput, 'clips' | 'settings' | 'sequence'>): 'random-order' | 'no-window' | 'too-few-clips' | undefined {
  if (input.settings.order.mode === 'random') return 'random-order';
  if (getReorderWindowSize(input.settings.reorderWindow) < 1) return 'no-window';
  const fixed = getFixedClipIds(input);
  if (input.clips.filter((clip) => !fixed.has(clip.id)).length < 2) return 'too-few-clips';
  return undefined;
}

/** The metric the priority puts second (fill with `duration`, duration with `fill`). */
const getSecond = ({ duration, fill }: Pick<PlanQuality, 'duration' | 'fill'>, priority: PlanPriority) => (priority === 'fill' ? duration : fill);

/**
 * Whether `quality` is no worse than `initial` in the second metric (by the steps of comparePlanQuality): the
 * optimizer only offers orders that improve the main metric without paying for it with the other one, e.g. a shorter
 * video with more letterbox (see T61's notes).
 */
function keepsSecond(quality: PlanQuality, initial: PlanQuality, priority: PlanPriority) {
  const [a, b] = [getSecond(quality, priority), getSecond(initial, priority)];
  return priority === 'fill' ? Math.round(a / DURATION_STEP) <= Math.round(b / DURATION_STEP) : Math.round(a / FILL_STEP) <= Math.round(b / FILL_STEP);
}

function getEnergy(quality: OrderQuality, initial: OrderQuality, priority: PlanPriority) {
  const main = priority === 'fill' ? quality.fill : quality.duration;
  const second = getSecond(quality, priority);
  const excess = Math.max(0, second - getSecond(initial, priority));
  return main + SECOND_WEIGHT * second + EXCESS_WEIGHT * excess + DISPLACEMENT_WEIGHT * quality.displacement;
}

/** {@link comparePlanQuality} with the displacement of the list added to the plan's own reordering. */
export const compareOrderQuality = (a: OrderQuality, b: OrderQuality, priority: PlanPriority = 'duration') => comparePlanQuality(
  { ...a, order: a.order + a.displacement },
  { ...b, order: b.order + b.displacement },
  priority,
);

/**
 * Simulated annealing over the list order, a step at a time (so a caller can spread it over time and stop it). Moves
 * swap two clips or take one to another position; a move is only made if every clip ends up at most the reorder window
 * away from its original position (unlimited: anywhere). Fixed clips ({@link getFixedClipIds}) and clips outside the
 * input keep their positions; the constraints themselves (pins, groups, chains, sequence, maximum duration) are the
 * clips' and the settings', which the moves don't touch, and every candidate is planned with them.
 *
 * Deterministic given the seed: the sequence of candidates doesn't depend on time, so the best order after `k`
 * evaluations is always the same. Runs in rounds of growing length, each one restarting from the best order so far
 * with a falling temperature, so any budget (time or evaluations) gets whole rounds and restarts.
 */
export function createOrderOptimizer(input: PlanMixInput, { seed = 1 }: { seed?: number } = {}) {
  const { clips, settings } = input;
  const priority = settings.priority ?? 'duration';
  const N = getReorderWindowSize(settings.reorderWindow);
  const fixedIds = getFixedClipIds(input);
  /** List positions the moves may use (the rest keep their clip). */
  const slots = clips.flatMap((clip, i) => (fixedIds.has(clip.id) ? [] : [i]));
  const random = createRandom(seed);
  const cache = new Map<string, OrderQuality>();

  let evaluations = 0;

  // perm[p] = original index of the clip at list position p
  function evaluate(perm: readonly number[]): OrderQuality {
    const key = perm.join(',');
    const cached = cache.get(key);
    if (cached != null) return cached;
    evaluations += 1;
    const { quality } = planMixBest({ ...input, clips: perm.map((i) => clips[i]!) });
    const displacement = perm.reduce((sum, clip, position) => sum + Math.abs(position - clip), 0);
    const result = { ...quality, displacement };
    if (cache.size >= CACHE_SIZE) cache.clear();
    cache.set(key, result);
    return result;
  }

  const identity = clips.map((_clip, i) => i);
  const initial = evaluate(identity);
  let best: { perm: number[], quality: OrderQuality, evaluation: number } = { perm: identity, quality: initial, evaluation: evaluations };
  const scale = Math.max(priority === 'fill' ? initial.fill : initial.duration, 1);

  const inWindow = (clip: number, position: number) => Math.abs(clip - position) <= N;
  const randomSlot = () => Math.floor(random() * slots.length);
  /** A slot index whose list position is within the window of `clip`, or any slot when the window is unlimited. */
  const randomSlotNear = (clip: number) => {
    if (!Number.isFinite(N)) return randomSlot();
    // slots are sorted by position: the range of those within [clip − N, clip + N]
    let from = 0;
    while (from < slots.length && slots[from]! < clip - N) from += 1;
    let to = from;
    while (to < slots.length && slots[to]! <= clip + N) to += 1;
    return from + Math.floor(random() * (to - from));
  };

  /** Swaps the clips of slots `a` and `b`, or takes the clip of `a` to `b` shifting those in between by one slot. */
  function tryMove(perm: readonly number[], a: number, b: number, swap: boolean): number[] | undefined {
    const clipA = perm[slots[a]!]!;
    if (a === b || !inWindow(clipA, slots[b]!)) return undefined;
    const next = [...perm];
    if (swap) {
      const clipB = perm[slots[b]!]!;
      if (!inWindow(clipB, slots[a]!)) return undefined;
      next[slots[a]!] = clipB;
    } else {
      const step = b > a ? 1 : -1;
      for (let s = a; s !== b; s += step) {
        const moved = perm[slots[s + step]!]!;
        if (!inWindow(moved, slots[s]!)) return undefined;
        next[slots[s]!] = moved;
      }
    }
    next[slots[b]!] = clipA;
    return next;
  }

  /** A neighbour of `perm` that keeps every clip in its window, or undefined if none was found. */
  function getMove(perm: readonly number[]): number[] | undefined {
    for (let attempt = 0; attempt < MOVE_TRIES; attempt += 1) {
      const a = randomSlot();
      const b = randomSlotNear(perm[slots[a]!]!);
      const next = tryMove(perm, a, b, random() < 0.5);
      if (next != null) return next;
    }
    return undefined;
  }

  let round = 0;
  let roundLength = FIRST_ROUND;
  let roundStep = 0;
  let current = { perm: best.perm, quality: best.quality, energy: getEnergy(best.quality, initial, priority) };

  function stepOnce() {
    if (roundStep >= roundLength) {
      round += 1;
      roundLength *= 2;
      roundStep = 0;
      current = { perm: best.perm, quality: best.quality, energy: getEnergy(best.quality, initial, priority) };
    }
    const temperature = START_TEMPERATURE * scale * END_TEMPERATURE ** (roundStep / roundLength);
    roundStep += 1;
    const perm = getMove(current.perm);
    if (perm == null) return;
    const quality = evaluate(perm);
    const energy = getEnergy(quality, initial, priority);
    if (energy <= current.energy || random() < Math.exp((current.energy - energy) / temperature)) {
      current = { perm, quality, energy };
    }
    if (keepsSecond(quality, initial, priority) && compareOrderQuality(quality, best.quality, priority) < 0) best = { perm, quality, evaluation: evaluations };
  }

  return {
    /** The original order's quality. */
    initial,
    /** False when no clip can move (see {@link getOptimizeOrderBlocker}): stepping does nothing. */
    canMove: slots.length >= 2 && N >= 1,
    /** Tries `count` more moves (a revisited order isn't planned again, so it doesn't count as an evaluation). */
    step(count: number) {
      if (slots.length < 2 || N < 1) return;
      for (let i = 0; i < count; i += 1) stepOnce();
    },
    get evaluations() { return evaluations; },
    get round() { return round; },
    getBest(): OrderOptimizerBest {
      return { order: best.perm.map((i) => clips[i]!.id), quality: best.quality, evaluation: best.evaluation };
    },
  };
}

export type OrderOptimizer = ReturnType<typeof createOrderOptimizer>;

/** Runs {@link createOrderOptimizer} for a number of steps (tests, scripts). */
export function optimizeOrder(input: PlanMixInput, { steps, seed }: { steps: number, seed?: number }) {
  const optimizer = createOrderOptimizer(input, { ...(seed != null && { seed }) });
  optimizer.step(steps);
  return { initial: optimizer.initial, ...optimizer.getBest(), evaluations: optimizer.evaluations };
}

/**
 * Seconds of the plan during which some column of the layout has no clip: at the end of the video, when the columns
 * whose clips have ended show fill until the last clip ends (the "empty columns" of the before/after comparison).
 */
export function getEmptyColumnTime(plan: Pick<MixPlan, 'duration' | 'layouts' | 'placements'>): number {
  const gaps: [number, number][] = [];
  plan.layouts.forEach((layout, k) => {
    const end = plan.layouts[k + 1]?.time ?? plan.duration;
    layout.columns.forEach(({ column }) => {
      const covered = plan.placements
        .filter((p) => p.column === column && p.endTime > layout.time && p.startTime < end)
        .map((p) => [Math.max(p.startTime, layout.time), Math.min(p.endTime, end)] as const)
        .sort((x, y) => x[0] - y[0]);
      let t = layout.time;
      covered.forEach(([from, to]) => {
        if (from > t + EPS) gaps.push([t, from]);
        t = Math.max(t, to);
      });
      if (end > t + EPS) gaps.push([t, end]);
    });
  });
  // union of the gaps of all columns
  gaps.sort((x, y) => x[0] - y[0]);
  let total = 0;
  let reached = -Infinity;
  gaps.forEach(([from, to]) => {
    const start = Math.max(from, reached);
    if (to > start) total += to - start;
    reached = Math.max(reached, to);
  });
  invariant(total >= 0);
  return total;
}
