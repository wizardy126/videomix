import { getBaseOrder } from './random';
import type { PlannerSettings } from './types';

// Pinned clips and groups (A4, T30): how the planner and validatePlan see them. Shared so both read the input alike.

interface UnitClip {
  id: string,
  pinTime?: number | undefined,
  groupId?: string | undefined,
}

/**
 * Clips that start together: a single clip or a group (or, for a group larger than `maxColumns`, one chunk of it).
 * Units in the reorder window are "ordered units"; pinned ones start at `pinTime` instead.
 */
export interface PlanUnit<T extends UnitClip> {
  /** In base order. */
  clips: T[],
  groupId?: string | undefined,
  /** Index among the ordered units (singles and groups; pinned units: -1). */
  unitBase: number,
  /** Index among the ordered single clips (the reorder window applies to them), -1 for groups and pinned units. */
  singleBase: number,
  /** Effective pin time (s): the clip's own or, for a group, the earliest of its members'. */
  pinTime?: number | undefined,
  /**
   * E2 (T38): a chain is a single unit whose `clips` is its first clip; the rest follow it in the same slot, in this
   * order. They are outside the order (the chain takes one position among the single clips).
   */
  continuation?: T[] | undefined,
}

/** Chains and sequence as the planner takes them (see {@link getPlanLinks}). */
export interface PlanLinksInput {
  chains?: readonly (readonly string[])[] | undefined,
  sequence?: readonly string[] | undefined,
}

const isValidPin = (t: number | undefined): t is number => t != null && Number.isFinite(t) && t >= 0;

/** Group id → member ids (in the given order), only for groups with at least 2 of the given clips (A4). */
export function getEffectiveGroups<T extends UnitClip>(clips: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  clips.forEach((clip) => {
    if (clip.groupId != null) groups.set(clip.groupId, [...(groups.get(clip.groupId) ?? []), clip]);
  });
  [...groups.entries()].forEach(([id, members]) => { if (members.length < 2) groups.delete(id); });
  return groups;
}

/**
 * Effective pin time of each pinned clip: a clip in a group inherits the earliest valid pin of its group, so the group
 * still starts together. Invalid pins (negative, not finite) are ignored (validateMixProject reports them).
 */
export function getEffectivePins<T extends UnitClip>(clips: readonly T[]): Map<string, number> {
  const pins = new Map<string, number>();
  const groups = getEffectiveGroups(clips);
  clips.forEach((clip) => {
    const members = clip.groupId != null ? groups.get(clip.groupId) : undefined;
    const times = (members ?? [clip]).map((c) => c.pinTime).filter((t) => isValidPin(t));
    if (times.length > 0) pins.set(clip.id, Math.min(...times));
  });
  return pins;
}

/**
 * E2/E5 (T38): the chains and the always-visible sequence of a planner input, cleaned up so the planner and
 * validatePlan read them alike:
 * - the sequence keeps the known clips in order, without repeats; it wins over pins and groups, so its clips lose
 *   `pinTime` and `groupId` in the returned `clips` (same order as the input);
 * - a chain keeps its known clips that aren't in the sequence, pinned (`pinTime` set), grouped (`groupId` set) or in an
 *   earlier chain (T36's rule, also enforced by `getClipChains`); chains left with less than 2 clips are dropped.
 * Without chains and sequence, `clips` is the input array itself.
 */
export function getPlanLinks<T extends UnitClip>(clips: readonly T[], { chains = [], sequence = [] }: PlanLinksInput) {
  const byId = new Map(clips.map((clip) => [clip.id, clip]));
  const sequenceIds = [...new Set(sequence)].filter((id) => byId.has(id));
  const inSequence = new Set(sequenceIds);
  const normalized = inSequence.size === 0
    ? clips
    : clips.map((clip) => (inSequence.has(clip.id) && (clip.pinTime != null || clip.groupId != null) ? { ...clip, pinTime: undefined, groupId: undefined } : clip));
  const normalizedById = new Map(normalized.map((clip) => [clip.id, clip]));
  const used = new Set<string>();
  const validChains: T[][] = [];
  chains.forEach((chain) => {
    const members = chain.flatMap((id) => {
      const clip = normalizedById.get(id);
      if (clip == null || inSequence.has(id) || used.has(id) || clip.pinTime != null || clip.groupId != null) return [];
      used.add(id);
      return [clip];
    });
    if (members.length >= 2) validChains.push(members);
    else members.forEach((clip) => used.delete(clip.id));
  });
  return {
    clips: normalized as readonly T[],
    sequence: sequenceIds.map((id) => normalizedById.get(id)!),
    chains: validChains,
  };
}

/**
 * The planner's units in base order (the list, or its seeded shuffle):
 * - a group takes the place of its first clip (in base order), its members follow in base order;
 * - a group larger than `maxColumns` is cut into chunks of `maxColumns` clips, one after the other (warned as split);
 * - pinned units (a pinned clip, or a group with a pinned member) are left out of the order, sorted by pin time.
 */
export function getPlanUnits<T extends UnitClip>(
  clips: readonly T[],
  settings: Pick<PlannerSettings, 'order' | 'maxColumns'>,
  links: { chains?: readonly (readonly T[])[], sequence?: readonly T[] } = {},
) {
  // E2/E5 (T38): sequence clips are out of the order; a chain is one single unit at the place of its earliest clip
  const inSequence = new Set((links.sequence ?? []).map((clip) => clip.id));
  const chainOf = new Map<string, readonly T[]>();
  (links.chains ?? []).forEach((chain) => chain.forEach((clip) => chainOf.set(clip.id, chain)));
  const seenChains = new Set<readonly T[]>();
  const base = getBaseOrder(clips, settings.order).filter((clip) => !inSequence.has(clip.id));
  const groups = getEffectiveGroups(base);
  const pins = getEffectivePins(base);
  const maxColumns = Math.max(1, settings.maxColumns);

  const ordered: PlanUnit<T>[] = [];
  const pinned: PlanUnit<T>[] = [];
  const seenGroups = new Set<string>();
  let singles = 0;
  base.forEach((clip) => {
    const chain = chainOf.get(clip.id);
    if (chain != null) {
      if (seenChains.has(chain)) return;
      seenChains.add(chain);
      ordered.push({ clips: [chain[0]!], unitBase: ordered.length, singleBase: singles, continuation: chain.slice(1) });
      singles += 1;
      return;
    }
    const members = clip.groupId != null ? groups.get(clip.groupId) : undefined;
    if (members != null) {
      if (seenGroups.has(clip.groupId!)) return;
      seenGroups.add(clip.groupId!);
    }
    const pinTime = pins.get(clip.id);
    const all = members ?? [clip];
    for (let i = 0; i < all.length; i += maxColumns) {
      const chunk = all.slice(i, i + maxColumns);
      const groupId = members != null ? clip.groupId : undefined;
      if (pinTime != null) {
        pinned.push({ clips: chunk, groupId, unitBase: -1, singleBase: -1, pinTime });
      } else {
        const single = members == null;
        ordered.push({ clips: chunk, groupId, unitBase: ordered.length, singleBase: single ? singles : -1 });
        if (single) singles += 1;
      }
    }
  });
  // stable: same pin time keeps base order
  pinned.sort((a, b) => a.pinTime! - b.pinTime!);
  return { ordered, pinned, groups, pins };
}
