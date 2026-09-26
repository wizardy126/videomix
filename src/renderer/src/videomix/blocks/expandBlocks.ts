import omit from 'lodash/omit';

import type { MixPlan } from '../planner/types';
import type { MixBlock, MixBlockDef, MixOverlay, MixProject, OverlayAnchor } from '../types';
import { resolveOverlayTimes } from '../overlays/resolveOverlayTimes';
import type { OverlayTimeWarning, ResolvedOverlayTime, ResolvedOverlayTimes } from '../overlays/resolveOverlayTimes';
import { getBlockDefVariables, getVariableDefaults, substituteTextVariables } from './blockVariables';

// Blocks of overlays (H1, T56, 04-diseno §11). A block instance (`MixBlock`) places the members of its definition
// (`MixBlockDef`) on the video. The rest of the app (render, audio, live preview, time resolution, validation of the
// overlays) keeps working on a flat list of overlays: `expandBlocks` turns the instances into concrete overlays. Pure.

export type BlockProject = Pick<MixProject, 'overlays' | 'blockDefs' | 'blocks'>;

/** Separator of the ids of expanded members. Block and member ids never contain it (nanoid's alphabet doesn't). */
export const BLOCK_MEMBER_ID_SEPARATOR = '/';

/**
 * Id of the concrete overlay of member `memberId` in block instance `blockId`: deterministic, so anchors to it (from a
 * loose overlay or another block) and caches keyed by overlay id (loudness) survive edits.
 */
export const getBlockMemberOverlayId = (blockId: string, memberId: string) => `${blockId}${BLOCK_MEMBER_ID_SEPARATOR}${memberId}`;

export interface BlockMemberRef { blockId: string, memberId: string }

/**
 * The block and member of an expanded overlay id, or undefined for any other id. With `blockIds`, only ids of those
 * blocks count (a loose overlay id with a `/`, e.g. from a hand-edited file, isn't mistaken for a member).
 */
export function parseBlockMemberOverlayId(id: string, blockIds?: ReadonlySet<string>): BlockMemberRef | undefined {
  const index = id.indexOf(BLOCK_MEMBER_ID_SEPARATOR);
  if (index <= 0 || index === id.length - 1) return undefined;
  const blockId = id.slice(0, index);
  if (blockIds != null && !blockIds.has(blockId)) return undefined;
  return { blockId, memberId: id.slice(index + 1) };
}

/** `anchor` moved by `dt` s: the time of an absolute anchor (may become negative: callers storing it clamp it), else the offset. */
export function shiftAnchor(anchor: OverlayAnchor, dt: number): OverlayAnchor {
  if (dt === 0) return anchor;
  return anchor.kind === 'absolute' ? { ...anchor, time: anchor.time + dt } : { ...anchor, offset: anchor.offset + dt };
}

/** Like {@link shiftAnchor}, but an absolute time stays ≥ 0 (as the schema requires), for anchors that are stored. */
export const shiftStoredAnchor = (anchor: OverlayAnchor, dt: number): OverlayAnchor => {
  const shifted = shiftAnchor(anchor, dt);
  return shifted.kind === 'absolute' && shifted.time < 0 ? { ...shifted, time: 0 } : shifted;
};

const memberIdsOf = (def: Pick<MixBlockDef, 'members'>) => new Set(def.members.map((m) => m.id));

/** A member's anchor or link that doesn't point inside the block (see `mixBlockDefSchema`). */
export function isInvalidMemberReference(member: MixOverlay, memberIds: ReadonlySet<string>) {
  const { anchor } = member;
  return anchor.kind === 'clip'
    || (anchor.kind === 'element' && !memberIds.has(anchor.elementId))
    || (member.type === 'progressBar' && member.linkedCountdownId != null && !memberIds.has(member.linkedCountdownId));
}

/**
 * The members with their references normalized to the block's rules: an anchor that doesn't point to another member
 * becomes relative at `max(0, offset)`, and a bar linked to something that isn't a member is unlinked (it uses its own
 * anchor and duration, as resolveOverlayTimes does with a broken link).
 */
export function getNormalizedMembers(def: Pick<MixBlockDef, 'members'>): MixOverlay[] {
  const memberIds = memberIdsOf(def);
  return def.members.map((member) => {
    let ret = member;
    const { anchor } = ret;
    if (anchor.kind === 'clip' || (anchor.kind === 'element' && !memberIds.has(anchor.elementId))) {
      ret = { ...ret, anchor: { kind: 'absolute', time: Math.max(0, anchor.offset) } };
    }
    if (ret.type === 'progressBar' && ret.linkedCountdownId != null && !memberIds.has(ret.linkedCountdownId)) {
      ret = omit(ret, 'linkedCountdownId');
    }
    return ret;
  });
}

/** Times of a member relative to its block's start (s). `end === start` for a sound whose duration isn't given. */
export interface BlockMemberTime { start: number, end: number, warnings: OverlayTimeWarning[] }

/**
 * Times of the members of a definition relative to the block's start, resolved like the loose overlays (internal
 * anchors, linked bars; cycles and broken references with the usual fallbacks). `soundDurations` is keyed by *member*
 * id (e.g. `getKnownSoundDurations(def.members)`); without it, sounds last 0 s.
 */
export function getBlockDefTimes(def: Pick<MixBlockDef, 'members'>, { soundDurations }: { soundDurations?: Readonly<Record<string, number>> | undefined } = {}): Map<string, BlockMemberTime> {
  const resolved = resolveOverlayTimes({ overlays: getNormalizedMembers(def), clips: [] }, { duration: Infinity, placements: [] }, { soundDurations });
  return new Map([...resolved].map(([id, t]) => [id, { start: t.rawStart, end: t.rawEnd, warnings: t.warnings.filter((w) => w.type !== 'clipped' && w.type !== 'outside-video') }]));
}

/**
 * Length of a block (s): the latest end of its members, from the block's start (≥ 0). By default without the tail of its
 * sounds (their length depends on the file, not on the project), so it's the same everywhere (anchors to a block's end,
 * stretching, the `.vmxblock` preview); pass `soundDurations` (by member id) to include them, e.g. to draw the block.
 */
export function getBlockDefDuration(def: Pick<MixBlockDef, 'members'>, options?: { soundDurations?: Readonly<Record<string, number>> | undefined }): number {
  let duration = 0;
  getBlockDefTimes(def, options).forEach(({ end }) => {
    if (Number.isFinite(end)) duration = Math.max(duration, end);
  });
  return duration;
}

/** Ids of the blocks whose chain of anchors to other blocks loops back to them. */
export function findBlockCycleIds(blocks: readonly MixBlock[]): Set<string> {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const next = (id: string) => {
    const anchor = byId.get(id)?.anchor;
    return anchor?.kind === 'element' && byId.has(anchor.elementId) ? anchor.elementId : undefined;
  };
  const inCycle = new Set<string>();
  const done = new Set<string>();
  blocks.forEach((block) => {
    const path: string[] = [];
    const onPath = new Set<string>();
    let cur: string | undefined = block.id;
    while (cur != null && !done.has(cur) && !onPath.has(cur)) {
      path.push(cur);
      onPath.add(cur);
      cur = next(cur);
    }
    if (cur != null && onPath.has(cur)) path.slice(path.indexOf(cur)).forEach((id) => inCycle.add(id));
    path.forEach((id) => done.add(id));
  });
  return inCycle;
}

export interface ComposedBlockAnchor {
  /**
   * The block's anchor with references to other blocks replaced by what they're anchored to (so it's absolute, or points
   * to a clip, a loose overlay or a member overlay).
   */
  anchor: OverlayAnchor,
  /** Its chain of block references loops: resolved as absolute at `max(0, offset)`, like an overlay cycle. */
  cycle: boolean,
}

/**
 * Composed anchor of every block (see {@link ComposedBlockAnchor}). An anchor to a block's start is its composed anchor
 * shifted by the offset; to its end, by the offset plus its length ({@link getBlockDefDuration}).
 */
export function composeBlockAnchors({ blocks, blockDefs }: Pick<MixProject, 'blocks' | 'blockDefs'>): Map<string, ComposedBlockAnchor> {
  const blocksById = new Map(blocks.map((b) => [b.id, b]));
  const defsById = new Map(blockDefs.map((d) => [d.id, d]));
  const durations = new Map<string, number>();
  const durationOf = (block: MixBlock) => {
    let duration = durations.get(block.defId);
    if (duration == null) {
      const def = defsById.get(block.defId);
      duration = def != null ? getBlockDefDuration(def) : 0;
      durations.set(block.defId, duration);
    }
    return duration;
  };

  const result = new Map<string, ComposedBlockAnchor>();
  // The members of a loop get the fallback (not the blocks that merely depend on one, which follow it), like overlays.
  // With the loops set first, the recursion below always ends.
  findBlockCycleIds(blocks).forEach((id) => {
    const { anchor } = blocksById.get(id)!;
    result.set(id, { anchor: { kind: 'absolute', time: Math.max(0, anchor.kind === 'absolute' ? anchor.time : anchor.offset) }, cycle: true });
  });

  function compose(block: MixBlock): ComposedBlockAnchor {
    const done = result.get(block.id);
    if (done != null) return done;
    const { anchor } = block;
    const target = anchor.kind === 'element' ? blocksById.get(anchor.elementId) : undefined;
    const ret: ComposedBlockAnchor = anchor.kind !== 'element' || target == null
      ? { anchor, cycle: false }
      : { anchor: shiftAnchor(compose(target).anchor, anchor.offset + (anchor.edge === 'end' ? durationOf(target) : 0)), cycle: false };
    result.set(block.id, ret);
    return ret;
  }

  blocks.forEach((block) => compose(block));
  return result;
}

/** Anchor to the `edge` of block `blockId` ± `offset`, composed (see {@link composeBlockAnchors}). */
export function getAnchorToBlock(composed: ReadonlyMap<string, ComposedBlockAnchor>, durationOf: (id: string) => number, blockId: string, edge: 'start' | 'end', offset: number): OverlayAnchor | undefined {
  const c = composed.get(blockId);
  if (c == null) return undefined;
  return shiftAnchor(c.anchor, offset + (edge === 'end' ? durationOf(blockId) : 0));
}

export interface ExpandedOverlays {
  /**
   * The loose overlays (their anchors to blocks composed) followed by the members of every block instance, hidden ones
   * included, in layer order. What `resolveOverlayTimes` needs, so what's anchored to a hidden block keeps its times.
   */
  all: MixOverlay[],
  /** `all` without the members of hidden blocks: what the render, the audio and the live preview draw and play. */
  visible: MixOverlay[],
  /** Expanded overlay id → its block and member. */
  origins: Map<string, BlockMemberRef>,
  /** Composed anchor of each block, see {@link composeBlockAnchors}. */
  anchors: Map<string, ComposedBlockAnchor>,
}

/**
 * Block instances → concrete overlays (see {@link ExpandedOverlays}). For each instance whose definition exists, each
 * member becomes an overlay with:
 * - id `getBlockMemberOverlayId(blockId, memberId)`;
 * - a relative time `r` → the block's composed anchor shifted by `r` (so it follows the block's clip or element);
 * - anchors and `linkedCountdownId` between members remapped to the instance's ids (see `getNormalizedMembers` for the
 *   invalid ones);
 * - the text variables substituted with the instance's values (`substituteTextVariables`).
 * Loose overlays anchored to a block (`element` with a block id) get the composed anchor to that block's edge.
 *
 * Without blocks, `all` and `visible` are `project.overlays` itself (same array): nothing changes for such projects.
 */
export function expandBlocks(project: BlockProject): ExpandedOverlays {
  const { overlays, blocks, blockDefs } = project;
  if (blocks.length === 0) return { all: overlays, visible: overlays, origins: new Map(), anchors: new Map() };

  const defsById = new Map(blockDefs.map((d) => [d.id, d]));
  const blocksById = new Map(blocks.map((b) => [b.id, b]));
  const anchors = composeBlockAnchors({ blocks, blockDefs });
  const durations = new Map<string, number>();
  const durationOf = (blockId: string) => {
    const defId = blocksById.get(blockId)?.defId;
    if (defId == null) return 0;
    let duration = durations.get(defId);
    if (duration == null) {
      const def = defsById.get(defId);
      duration = def != null ? getBlockDefDuration(def) : 0;
      durations.set(defId, duration);
    }
    return duration;
  };

  let changed = false;
  const loose = overlays.map((overlay) => {
    const { anchor } = overlay;
    if (anchor.kind !== 'element' || !blocksById.has(anchor.elementId)) return overlay;
    changed = true;
    return { ...overlay, anchor: getAnchorToBlock(anchors, durationOf, anchor.elementId, anchor.edge, anchor.offset)! };
  });

  const origins = new Map<string, BlockMemberRef>();
  const all: MixOverlay[] = changed ? loose : [...overlays];
  const visible: MixOverlay[] = [...all];
  const normalizedByDef = new Map<string, { members: MixOverlay[], defaults: Record<string, string> }>();

  blocks.forEach((block) => {
    const def = defsById.get(block.defId);
    if (def == null) return;
    let normalized = normalizedByDef.get(def.id);
    if (normalized == null) {
      normalized = { members: getNormalizedMembers(def), defaults: getVariableDefaults(getBlockDefVariables(def)) };
      normalizedByDef.set(def.id, normalized);
    }
    const blockAnchor = anchors.get(block.id)!.anchor;
    const toId = (memberId: string) => getBlockMemberOverlayId(block.id, memberId);
    const { defaults } = normalized;
    const expanded = normalized.members.map((member): MixOverlay => {
      const { anchor } = member;
      const id = toId(member.id);
      origins.set(id, { blockId: block.id, memberId: member.id });
      // Normalized: absolute (relative time) or an element that is a member
      let ret: MixOverlay = { ...member, id, anchor: anchor.kind === 'element' ? { ...anchor, elementId: toId(anchor.elementId) } : shiftAnchor(blockAnchor, anchor.kind === 'absolute' ? anchor.time : 0) };
      if (ret.type === 'progressBar' && ret.linkedCountdownId != null) ret = { ...ret, linkedCountdownId: toId(ret.linkedCountdownId) };
      if (ret.type === 'text') ret = { ...ret, text: substituteTextVariables(ret.text, block.variables, defaults) };
      return ret;
    });
    all.push(...expanded);
    if (!block.hidden) visible.push(...expanded);
  });

  return { all, visible, origins, anchors };
}

/** Times of a block instance in the final video, like an overlay's (see `ResolvedOverlayTime`). */
export interface ResolvedBlockTime extends ResolvedOverlayTime {
  /** Latest end of its members (raw, including the tail of sounds whose duration is known): where to draw it up to. */
  contentEnd: number,
}

/**
 * Start/end of each block instance (its anchor, composed, resolved like an overlay's; `rawEnd` = `rawStart` + its
 * length, {@link getBlockDefDuration}). `resolved` is `resolveOverlayTimes` of `expandBlocks(project).all` on the same plan.
 */
export function resolveBlockTimes(
  project: BlockProject & Pick<MixProject, 'clips'>,
  plan: Pick<MixPlan, 'duration' | 'placements'>,
  resolved: ResolvedOverlayTimes,
  expanded: Pick<ExpandedOverlays, 'anchors'> = expandBlocks(project),
): Map<string, ResolvedBlockTime> {
  const defsById = new Map(project.blockDefs.map((d) => [d.id, d]));
  const placementsByClipId = new Map(plan.placements.map((p) => [p.clipId, p]));
  const clipIds = new Set(project.clips.map((c) => c.id));
  const videoDuration = Math.max(0, plan.duration);
  const result = new Map<string, ResolvedBlockTime>();

  project.blocks.forEach((block) => {
    const composed = expanded.anchors.get(block.id);
    const warnings: OverlayTimeWarning[] = [];
    const anchor = composed?.anchor ?? block.anchor;
    const fallback = () => Math.max(0, anchor.kind === 'absolute' ? anchor.time : anchor.offset);
    let rawStart: number;
    if (composed?.cycle) {
      warnings.push({ type: 'cycle' });
      rawStart = fallback();
    } else if (anchor.kind === 'absolute') {
      rawStart = anchor.time;
    } else if (anchor.kind === 'clip') {
      const placement = placementsByClipId.get(anchor.clipId);
      if (placement == null || !clipIds.has(anchor.clipId)) {
        warnings.push({ type: 'missing-clip', clipId: anchor.clipId });
        rawStart = fallback();
      } else {
        rawStart = (anchor.edge === 'start' ? placement.startTime : placement.endTime) + anchor.offset;
      }
    } else {
      const times = resolved.get(anchor.elementId);
      if (times == null) {
        warnings.push({ type: 'missing-element', elementId: anchor.elementId });
        rawStart = fallback();
      } else {
        rawStart = (anchor.edge === 'start' ? times.rawStart : times.rawEnd) + anchor.offset;
      }
    }

    const def = defsById.get(block.defId);
    const rawEnd = rawStart + (def != null ? getBlockDefDuration(def) : 0);
    let contentEnd = rawEnd;
    def?.members.forEach((member) => {
      const t = resolved.get(getBlockMemberOverlayId(block.id, member.id));
      if (t != null) contentEnd = Math.max(contentEnd, t.rawEnd);
    });

    const start = Math.min(Math.max(rawStart, 0), videoDuration);
    const end = Math.min(Math.max(rawEnd, start), videoDuration);
    if (rawEnd > rawStart) {
      if (end <= start) warnings.push({ type: 'outside-video' });
      else if (start !== rawStart || end !== rawEnd) warnings.push({ type: 'clipped' });
    }
    result.set(block.id, { start, end, rawStart, rawEnd, contentEnd, warnings });
  });
  return result;
}
