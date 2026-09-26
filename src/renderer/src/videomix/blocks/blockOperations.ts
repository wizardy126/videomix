import omit from 'lodash/omit';

import type { MixBlock, MixBlockDef, MixOutputAspect, MixOverlay, MixProject, OverlayAnchor, OverlayBox } from '../types';
import { detachOverlayReferences } from '../overlays/anchors';
import type { OverlayTimeRange } from '../overlays/anchors';
import { getBlockDefVariables, getVariableDefaults, substituteTextVariables } from './blockVariables';
import { getBlockDefDuration, getBlockDefTimes, getBlockMemberOverlayId, getNormalizedMembers, shiftStoredAnchor } from './expandBlocks';

// Pure operations on blocks of overlays (H1, H5, H6, H7; T56, 04-diseno §11). The reducer wraps the ones that edit a
// project (projectReducer.ts); the rest work on a definition or on boxes. Ids are always given by the caller.

/**
 * Raw times resolved before an edit, by overlay id (loose and expanded, `resolveOverlayTimes` of
 * `expandBlocks(project).all`) and by block id (`resolveBlockTimes`). See `resolveProjectTimes` (overlayRemoval.ts).
 */
export type ProjectTimes = ReadonlyMap<string, OverlayTimeRange & { warnings?: readonly { type: string }[] | undefined }>;

/** The instances of a definition, in layer order. */
export const getDefInstances = (project: Pick<MixProject, 'blocks'>, defId: string) => project.blocks.filter((b) => b.defId === defId);

/** H5: the block shares its content with other instances (editing a member changes all of them). */
export const isBlockLinked = (project: Pick<MixProject, 'blocks'>, blockId: string) => {
  const defId = project.blocks.find((b) => b.id === blockId)?.defId;
  return defId != null && getDefInstances(project, defId).length > 1;
};

const withoutDef = (blockDefs: MixBlockDef[], blocks: readonly MixBlock[], defId: string) => (blocks.some((b) => b.defId === defId) ? blockDefs : blockDefs.filter((d) => d.id !== defId));

const TIME_BREAKING_WARNINGS = new Set(['cycle', 'missing-clip', 'missing-element']);

/** The content of a new block made of loose overlays, see {@link buildBlockFromOverlays}. */
export interface BlockFromOverlays {
  def: MixBlockDef,
  /** The block's anchor: the one of its first overlay by time (see {@link buildBlockFromOverlays}). */
  anchor: OverlayAnchor,
  /** Raw start of the block in the final video (s): the start of its first overlay. */
  start: number,
  /** The overlays that went into it, in layer order (its members, with the same ids). */
  overlayIds: string[],
}

/**
 * H1 "Group into a block" (and H2 "Export selection"): the definition made of the loose overlays `overlayIds` (unknown
 * ids are ignored; undefined if none is left), keeping every time exactly (with `times` resolved before, see
 * {@link ProjectTimes}):
 * - the block starts at the earliest start of the overlays and **inherits the anchor of that first overlay** (anchored
 *   to a clip, the block follows the clip). Ties: an overlay not anchored to another selected one, then layer order. If
 *   that anchor is broken (cycle, missing clip or element) the block is absolute at its current start; a first bar
 *   linked to a countdown outside the selection anchors the block to that countdown's start;
 * - members keep their ids and layer order; anchors between them (and bars linked to a selected countdown) are kept;
 *   everything else becomes a time relative to the block's start (a bar linked to a countdown outside the selection is
 *   unlinked, keeping its start and duration).
 */
export function buildBlockFromOverlays(overlays: readonly MixOverlay[], overlayIds: readonly string[], times: ProjectTimes, { defId, name, color }: { defId: string, name: string, color: number }): BlockFromOverlays | undefined {
  const ids = new Set(overlayIds);
  const selected = overlays.filter((o) => ids.has(o.id));
  if (selected.length === 0) return undefined;
  const selectedIds = new Set(selected.map((o) => o.id));

  const timesOf = (o: MixOverlay) => {
    const t = times.get(o.id);
    const fallback = Math.max(0, o.anchor.kind === 'absolute' ? o.anchor.time : o.anchor.offset);
    const rawStart = t?.rawStart ?? fallback;
    const rawEnd = t?.rawEnd ?? rawStart + (o.type === 'sound' ? 0 : Math.max(0, o.duration));
    const warnings = new Set((t?.warnings ?? []).map((w) => w.type));
    return { rawStart, rawEnd, warnings };
  };
  const inCycle = (o: MixOverlay) => timesOf(o).warnings.has('cycle');
  // A bar takes its times from its countdown unless resolveOverlayTimes said the link is broken
  const linkedTo = (o: MixOverlay) => (o.type === 'progressBar' && o.linkedCountdownId != null && times.get(o.id) != null && !timesOf(o).warnings.has('missing-linked-countdown') ? o.linkedCountdownId : undefined);
  const dependsInside = (o: MixOverlay) => {
    if (inCycle(o)) return false;
    const linked = linkedTo(o);
    if (linked != null) return selectedIds.has(linked);
    return o.anchor.kind === 'element' && selectedIds.has(o.anchor.elementId);
  };

  const first = selected.reduce((best, o) => {
    const a = timesOf(o).rawStart;
    const b = timesOf(best).rawStart;
    if (a !== b) return a < b ? o : best;
    return dependsInside(best) && !dependsInside(o) ? o : best;
  });
  const start = timesOf(first).rawStart;

  let anchor: OverlayAnchor;
  const firstLinked = linkedTo(first);
  if (firstLinked != null && !selectedIds.has(firstLinked)) {
    anchor = { kind: 'element', elementId: firstLinked, edge: 'start', offset: 0 };
  } else if (dependsInside(first) || [...timesOf(first).warnings].some((w) => TIME_BREAKING_WARNINGS.has(w))) {
    anchor = { kind: 'absolute', time: Math.max(0, start) };
  } else {
    anchor = first.anchor;
  }

  const members = selected.map((o): MixOverlay => {
    const { rawStart, rawEnd } = timesOf(o);
    const relative: OverlayAnchor = { kind: 'absolute', time: Math.max(0, rawStart - start) };
    let member: MixOverlay = o;
    if (member.type === 'progressBar' && member.linkedCountdownId != null) {
      const linked = linkedTo(member);
      if (linked == null) {
        member = omit(member, 'linkedCountdownId');
      } else if (!selectedIds.has(linked) || inCycle(member)) {
        member = { ...omit(member, 'linkedCountdownId'), duration: rawEnd - rawStart };
      }
    }
    const keepAnchor = member.anchor.kind === 'element' && selectedIds.has(member.anchor.elementId) && !inCycle(member);
    return keepAnchor ? member : { ...member, anchor: relative };
  });

  return { def: { id: defId, name, color, members }, anchor, start, overlayIds: selected.map((o) => o.id) };
}

/** Rewrites the element anchors and linked countdowns of loose overlays and blocks with `remap` (same arrays if nothing changes). */
function remapReferences(project: Pick<MixProject, 'overlays' | 'blocks'>, remapAnchor: (anchor: OverlayAnchor) => OverlayAnchor, remapId: (id: string) => string) {
  let overlaysChanged = false;
  const overlays = project.overlays.map((o) => {
    let next = o;
    const anchor = remapAnchor(o.anchor);
    if (anchor !== o.anchor) next = { ...next, anchor };
    if (next.type === 'progressBar' && next.linkedCountdownId != null) {
      const linked = remapId(next.linkedCountdownId);
      if (linked !== next.linkedCountdownId) next = { ...next, linkedCountdownId: linked };
    }
    if (next !== o) overlaysChanged = true;
    return next;
  });
  let blocksChanged = false;
  const blocks = project.blocks.map((b) => {
    const anchor = remapAnchor(b.anchor);
    if (anchor === b.anchor) return b;
    blocksChanged = true;
    return { ...b, anchor };
  });
  return { overlays: overlaysChanged ? overlays : project.overlays, blocks: blocksChanged ? blocks : project.blocks };
}

const remapElementIds = (remapId: (id: string) => string) => (anchor: OverlayAnchor): OverlayAnchor => {
  if (anchor.kind !== 'element') return anchor;
  const elementId = remapId(anchor.elementId);
  return elementId === anchor.elementId ? anchor : { ...anchor, elementId };
};

/**
 * H1: groups the loose overlays `overlayIds` into a new block `blockId` (definition `defId`), see
 * {@link buildBlockFromOverlays}: every time stays exactly the same. The block goes on top of the other blocks (blocks
 * are drawn above the loose overlays, so a loose overlay that was above a member ends up below it). Loose overlays
 * and blocks anchored to a member (or bars linked to one) now point to its expanded id. Same project if no overlay matches.
 */
export function groupOverlaysIntoBlock(project: MixProject, { overlayIds, blockId, defId, name, color, times }: {
  overlayIds: readonly string[],
  blockId: string,
  defId: string,
  name: string,
  color: number,
  times: ProjectTimes,
}): MixProject {
  const built = buildBlockFromOverlays(project.overlays, overlayIds, times, { defId, name, color });
  if (built == null) return project;
  if (project.blocks.some((b) => b.id === blockId) || project.overlays.some((o) => o.id === blockId)) throw new Error(`Duplicate block id ${blockId}`);
  if (project.blockDefs.some((d) => d.id === defId)) throw new Error(`Duplicate block definition id ${defId}`);

  const memberIds = new Set(built.overlayIds);
  const remapId = (id: string) => (memberIds.has(id) ? getBlockMemberOverlayId(blockId, id) : id);
  const { overlays, blocks } = remapReferences({ overlays: project.overlays.filter((o) => !memberIds.has(o.id)), blocks: project.blocks }, remapElementIds(remapId), remapId);
  return {
    ...project,
    overlays,
    blockDefs: [...project.blockDefs, built.def],
    blocks: [...blocks, { id: blockId, defId, anchor: built.anchor }],
  };
}

const pickFreeId = (base: string, used: Set<string>) => {
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
  used.add(id);
  return id;
};

/**
 * H1: the members of block `blockId` become loose overlays again with the same times: relative times become the
 * block's own anchor shifted (so they keep following its clip or element), anchors between members are kept and the
 * text variables are baked into the texts. They keep their member ids when free (so group → ungroup restores the
 * ids), else `<id>-2`… References to the block or its members are rewritten; the definition is removed if no other
 * instance uses it. They go on top of the loose overlays (below the other blocks). Note that a hidden block's
 * overlays become visible (the UI may want to disable ungrouping a hidden block).
 */
export function ungroupBlock(project: MixProject, { blockId }: { blockId: string }): MixProject {
  const block = project.blocks.find((b) => b.id === blockId);
  const def = project.blockDefs.find((d) => d.id === block?.defId);
  if (block == null || def == null) return project;

  const used = new Set([...project.overlays.map((o) => o.id), ...project.blocks.map((b) => b.id)]);
  const newIds = new Map(def.members.map((m) => [m.id, pickFreeId(m.id, used)]));
  const defaults = getVariableDefaults(getBlockDefVariables(def));
  const members = getNormalizedMembers(def).map((member): MixOverlay => {
    const { anchor } = member;
    let ret: MixOverlay = {
      ...member,
      id: newIds.get(member.id)!,
      anchor: anchor.kind === 'element' ? { ...anchor, elementId: newIds.get(anchor.elementId)! } : shiftStoredAnchor(block.anchor, anchor.kind === 'absolute' ? anchor.time : 0),
    };
    if (ret.type === 'progressBar' && ret.linkedCountdownId != null) ret = { ...ret, linkedCountdownId: newIds.get(ret.linkedCountdownId)! };
    if (ret.type === 'text') ret = { ...ret, text: substituteTextVariables(ret.text, block.variables, defaults) };
    return ret;
  });

  const duration = getBlockDefDuration(def);
  const expandedToNew = new Map(def.members.map((m) => [getBlockMemberOverlayId(blockId, m.id), newIds.get(m.id)!]));
  const remapId = (id: string) => expandedToNew.get(id) ?? id;
  const remapAnchor = (anchor: OverlayAnchor): OverlayAnchor => {
    if (anchor.kind !== 'element') return anchor;
    // An anchor to the block itself: its own anchor, shifted to the edge (a loose overlay can't point to a removed block)
    if (anchor.elementId === blockId) return block.anchor.kind === 'element' && block.anchor.elementId === blockId ? { kind: 'absolute', time: Math.max(0, anchor.offset) } : shiftStoredAnchor(block.anchor, anchor.offset + (anchor.edge === 'end' ? duration : 0));
    return remapElementIds(remapId)(anchor);
  };
  const rest = remapReferences({ overlays: project.overlays, blocks: project.blocks.filter((b) => b.id !== blockId) }, remapAnchor, remapId);
  return {
    ...project,
    overlays: [...rest.overlays, ...members],
    blocks: rest.blocks,
    blockDefs: withoutDef(project.blockDefs, rest.blocks, def.id),
  };
}

/**
 * After removing clips, overlays or blocks: blocks anchored to them become absolute at their current start
 * (`times.get(blockId).rawStart`, else `max(0, offset)`), like `detachOverlayReferences` does for the overlays. The same
 * array if none changes.
 */
export function detachBlockReferences(blocks: MixBlock[], { clipIds = new Set(), overlayIds = new Set(), times }: {
  clipIds?: ReadonlySet<string> | undefined,
  /** Removed overlays, blocks and expanded member ids. */
  overlayIds?: ReadonlySet<string> | undefined,
  times?: ReadonlyMap<string, OverlayTimeRange> | undefined,
}): MixBlock[] {
  let changed = false;
  const ret = blocks.map((block) => {
    const { anchor } = block;
    if (!((anchor.kind === 'clip' && clipIds.has(anchor.clipId)) || (anchor.kind === 'element' && overlayIds.has(anchor.elementId)))) return block;
    changed = true;
    return { ...block, anchor: { kind: 'absolute' as const, time: Math.max(0, times?.get(block.id)?.rawStart ?? anchor.offset) } };
  });
  return changed ? ret : blocks;
}

/** Loose overlays and blocks after removing `overlayIds` (overlays, blocks, expanded members) and `clipIds`. */
export function detachProjectReferences(project: Pick<MixProject, 'overlays' | 'blocks'>, refs: { clipIds?: ReadonlySet<string> | undefined, overlayIds?: ReadonlySet<string> | undefined, times?: ReadonlyMap<string, OverlayTimeRange> | undefined }) {
  return {
    overlays: detachOverlayReferences(project.overlays, { clipIds: refs.clipIds, overlayIds: refs.overlayIds, resolved: refs.times }),
    blocks: detachBlockReferences(project.blocks, refs),
  };
}

/** Ids that disappear when block `blockId` is removed: the block and its expanded members. */
export function getBlockRefIds(project: Pick<MixProject, 'blocks' | 'blockDefs'>, blockId: string): Set<string> {
  const block = project.blocks.find((b) => b.id === blockId);
  const def = project.blockDefs.find((d) => d.id === block?.defId);
  return new Set([blockId, ...(def?.members ?? []).map((m) => getBlockMemberOverlayId(blockId, m.id))]);
}

/**
 * Removes block `blockId` (and its definition if no other instance uses it). Overlays and blocks anchored to it or to
 * its members become absolute at their current start (`times`, see {@link ProjectTimes}).
 */
export function removeBlock(project: MixProject, { blockId, times }: { blockId: string, times?: ProjectTimes | undefined }): MixProject {
  const block = project.blocks.find((b) => b.id === blockId);
  if (block == null) return project;
  const overlayIds = getBlockRefIds(project, blockId);
  const blocks = project.blocks.filter((b) => b.id !== blockId);
  const detached = detachProjectReferences({ overlays: project.overlays, blocks }, { overlayIds, times });
  return { ...project, ...detached, blockDefs: withoutDef(project.blockDefs, detached.blocks, block.defId) };
}

/**
 * Removes member `memberId` from definition `defId` (so from every instance). Members anchored to it become relative
 * at their current time inside the block, bars linked to it are unlinked keeping their start and duration; loose
 * overlays and blocks anchored to its expanded ids become absolute at their current start (`times`). The definition
 * is kept even if left empty.
 */
export function removeBlockMember(project: MixProject, { defId, memberId, times }: { defId: string, memberId: string, times?: ProjectTimes | undefined }): MixProject {
  const def = project.blockDefs.find((d) => d.id === defId);
  if (def == null || !def.members.some((m) => m.id === memberId)) return project;
  const defTimes = getBlockDefTimes(def);
  const relativeAt = (id: string): OverlayAnchor => ({ kind: 'absolute', time: Math.max(0, defTimes.get(id)?.start ?? 0) });
  const members = def.members.filter((m) => m.id !== memberId).map((m): MixOverlay => {
    let next = m;
    if (next.type === 'progressBar' && next.linkedCountdownId === memberId) {
      const t = defTimes.get(m.id);
      next = { ...omit(next, 'linkedCountdownId'), anchor: relativeAt(m.id), ...(t != null && { duration: t.end - t.start }) };
    }
    if (next.anchor.kind === 'element' && next.anchor.elementId === memberId) next = { ...next, anchor: relativeAt(m.id) };
    return next;
  });
  const overlayIds = new Set(getDefInstances(project, defId).map((b) => getBlockMemberOverlayId(b.id, memberId)));
  const detached = detachProjectReferences(project, { overlayIds, times });
  return { ...project, ...detached, blockDefs: project.blockDefs.map((d) => (d.id === defId ? { ...d, members } : d)) };
}

/**
 * H1 "Duplicate": an independent copy of block `blockId` (a new definition `newDefId` with the same content, and
 * instance `newBlockId` with the same anchor, variables and flags), right above the original.
 */
export function duplicateBlock(project: MixProject, { blockId, newBlockId, newDefId, name }: { blockId: string, newBlockId: string, newDefId: string, name?: string | undefined }): MixProject {
  const index = project.blocks.findIndex((b) => b.id === blockId);
  const block = project.blocks[index];
  const def = project.blockDefs.find((d) => d.id === block?.defId);
  if (block == null || def == null) return project;
  if (project.blocks.some((b) => b.id === newBlockId)) throw new Error(`Duplicate block id ${newBlockId}`);
  if (project.blockDefs.some((d) => d.id === newDefId)) throw new Error(`Duplicate block definition id ${newDefId}`);
  const blocks = [...project.blocks];
  blocks.splice(index + 1, 0, { ...structuredClone(block), id: newBlockId, defId: newDefId });
  return { ...project, blocks, blockDefs: [...project.blockDefs, { ...structuredClone(def), id: newDefId, name: name ?? def.name }] };
}

/** H5 "Unlink": block `blockId` gets its own copy of its definition (`newDefId`). Nothing happens if it's not shared. */
export function unlinkBlock(project: MixProject, { blockId, newDefId }: { blockId: string, newDefId: string }): MixProject {
  const block = project.blocks.find((b) => b.id === blockId);
  const def = project.blockDefs.find((d) => d.id === block?.defId);
  if (block == null || def == null || getDefInstances(project, def.id).length < 2) return project;
  if (project.blockDefs.some((d) => d.id === newDefId)) throw new Error(`Duplicate block definition id ${newDefId}`);
  return {
    ...project,
    blocks: project.blocks.map((b) => (b.id === blockId ? { ...b, defId: newDefId } : b)),
    blockDefs: [...project.blockDefs, { ...structuredClone(def), id: newDefId }],
  };
}

/** H5: how to repeat a block. */
export type BlockRepeat =
  /** A copy every `interval` s after the block (one per new id): its anchor shifted by `i · interval`. */
  | { kind: 'interval', interval: number }
  /** A copy anchored to the start of each clip (with the new id at the same index), offset 0. */
  | { kind: 'clips', clipIds: string[] };

/**
 * H5 "Repeat": linked instances of block `blockId` (same definition: editing one changes all), each with its own anchor
 * and a copy of the original's variables and flags, inserted right above the original in `newBlockIds` order. The
 * original stays where it is, so "N times" is the original plus N − 1 new ids.
 */
export function repeatBlock(project: MixProject, { blockId, newBlockIds, repeat }: { blockId: string, newBlockIds: readonly string[], repeat: BlockRepeat }): MixProject {
  const index = project.blocks.findIndex((b) => b.id === blockId);
  const block = project.blocks[index];
  if (block == null || newBlockIds.length === 0) return project;
  const used = new Set([...project.blocks.map((b) => b.id), ...project.overlays.map((o) => o.id)]);
  const copies = newBlockIds.flatMap((id, i): MixBlock[] => {
    if (used.has(id)) throw new Error(`Duplicate block id ${id}`);
    used.add(id);
    let anchor: OverlayAnchor;
    if (repeat.kind === 'interval') {
      anchor = shiftStoredAnchor(block.anchor, (i + 1) * repeat.interval);
    } else {
      const clipId = repeat.clipIds[i];
      if (clipId == null) return [];
      anchor = { kind: 'clip', clipId, edge: 'start', offset: 0 };
    }
    return [{ ...structuredClone(block), id, anchor }];
  });
  const blocks = [...project.blocks];
  blocks.splice(index + 1, 0, ...copies);
  return { ...project, blocks };
}

/**
 * H6 "Block duration…": scales the times of a definition so the block lasts `duration` s ({@link getBlockDefDuration},
 * without the sounds' tails): relative starts, offsets of the anchors between members and durations are multiplied by
 * `duration / current`; fades and entry animations keep their length, sounds their file's. The same definition if the
 * current or new duration isn't > 0.
 */
export function stretchBlockDef(def: MixBlockDef, duration: number): MixBlockDef {
  const current = getBlockDefDuration(def);
  if (!(current > 0) || !(duration > 0) || !Number.isFinite(duration)) return def;
  const k = duration / current;
  if (k === 1) return def;
  const members = def.members.map((member): MixOverlay => {
    const { anchor } = member;
    const scaled: OverlayAnchor = anchor.kind === 'absolute' ? { ...anchor, time: anchor.time * k } : { ...anchor, offset: anchor.offset * k };
    return member.type === 'sound' ? { ...member, anchor: scaled } : { ...member, anchor: scaled, duration: member.duration * k };
  });
  return { ...def, members };
}

const aspectRatios: Record<MixOutputAspect, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 };

/**
 * H7: a box (fractions of the frame) made for an output of `fromAspect`, on an output of `toAspect`: it keeps its size
 * relative to the frame's height (so its proportion in px) and its center, moved inside the frame; if it no longer
 * fits the width, it's scaled down (both sides) to fit. Returns the box and that scale (1 = not scaled).
 */
export function adaptBoxToAspect(box: OverlayBox, fromAspect: MixOutputAspect, toAspect: MixOutputAspect): { box: OverlayBox, scale: number } {
  if (fromAspect === toAspect) return { box, scale: 1 };
  let width = box.width * (aspectRatios[fromAspect] / aspectRatios[toAspect]);
  let { height } = box;
  const scale = width > 1 ? 1 / width : 1;
  width *= scale;
  height *= scale;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), Math.max(0, max));
  const x = clamp(box.x + box.width / 2 - width / 2, 1 - width);
  const y = clamp(box.y + box.height / 2 - height / 2, 1 - height);
  return { box: { x, y, width, height }, scale };
}

/**
 * H7 "Adapt": the members of a definition made for `fromAspect`, adapted to `toAspect` ({@link adaptBoxToAspect}). A
 * text's `fontSize` (fraction of the height) follows its box's scale; borders and shadows (reference px of the height)
 * are kept.
 */
export function adaptBlockDefToAspect(def: MixBlockDef, fromAspect: MixOutputAspect, toAspect: MixOutputAspect): MixBlockDef {
  if (fromAspect === toAspect) return def;
  const members = def.members.map((member): MixOverlay => {
    if (member.type === 'sound') return member;
    const { box, scale } = adaptBoxToAspect(member.box, fromAspect, toAspect);
    if (member.type === 'text' && member.fontSize != null) return { ...member, box, fontSize: member.fontSize * scale };
    return { ...member, box };
  });
  return { ...def, members };
}

/** Layer move of a block among the blocks (they're all above the loose overlays). Same array if it doesn't move. */
export function moveBlockLayer(blocks: MixBlock[], blockId: string, to: 'up' | 'down' | 'front' | 'back'): MixBlock[] {
  const index = blocks.findIndex((b) => b.id === blockId);
  if (index === -1) return blocks;
  const target = { up: index + 1, down: index - 1, front: blocks.length - 1, back: 0 }[to];
  if (target < 0 || target >= blocks.length || target === index) return blocks;
  const ret = [...blocks];
  const [block] = ret.splice(index, 1);
  ret.splice(target, 0, block!);
  return ret;
}
