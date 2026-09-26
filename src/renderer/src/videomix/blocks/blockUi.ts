import type { MixBlock, MixBlockDef, MixProject, OverlayAnchor } from '../types';
import { findOverlayCycleIds } from '../overlays/anchors';
import { roundOverlayTime } from '../overlayTimeline';
import { composeBlockAnchors, expandBlocks, getBlockMemberOverlayId } from './expandBlocks';
import type { BlockProject } from './expandBlocks';

// Pure helpers of the blocks UI (T57, 04-diseno §11.6): the blocks lane of the Mix view, block drags, the overlay
// multi-selection and the anchor targets that know the blocks. No React, so they can be unit tested.

const EPS = 1e-6;

export interface BlockLaneMember {
  /** Expanded overlay id (`block/member`). */
  overlayId: string,
  memberId: string,
  start: number,
  end: number,
  /** Row inside the lane. */
  row: number,
}

export interface BlockLaneItem {
  blockId: string,
  /** Times of the block's piece on the axis (cut to the video), up to the end of its content (sounds included). */
  start: number,
  end: number,
  /** Row of the block's piece. Unless it's collapsed, its members go in the rows right below it. */
  row: number,
  /** Rows it takes: 1 + its members' rows (1 if collapsed). */
  rows: number,
  members: BlockLaneMember[],
}

export interface BlockLaneLayout {
  /** ≥ 1 when there are blocks, 0 otherwise (no lane). */
  rows: number,
  items: BlockLaneItem[],
}

type Times = ReadonlyMap<string, { start: number, end: number }>;

/**
 * The blocks lane (T57): each block instance is one piece, from its start to the end of its content, with its members
 * (unless collapsed) packed into sub-rows below it. Pieces overlapping in time go to different rows, greedily by start
 * (first place where all the rows it needs are free), like `layoutOverlayLanes`. `minDuration` as there.
 */
export function layoutBlockLane({ blocks, blockDefs }: Pick<MixProject, 'blocks' | 'blockDefs'>, blockTimes: ReadonlyMap<string, { start: number, end: number, contentEnd: number }>, resolved: Times, videoDuration: number, { minDuration = 0 }: { minDuration?: number } = {}): BlockLaneLayout {
  if (blocks.length === 0) return { rows: 0, items: [] };
  const defsById = new Map(blockDefs.map((d) => [d.id, d]));
  const entries = blocks.map((block, layer) => {
    const times = blockTimes.get(block.id);
    const start = times?.start ?? 0;
    const end = times != null ? Math.max(times.end, Math.min(Math.max(times.contentEnd, start), Math.max(0, videoDuration))) : start;
    return { block, layer, start, end };
  }).sort((a, b) => a.start - b.start || a.layer - b.layer);

  const rowEnds: number[] = [];
  const isFree = (row: number, start: number) => (rowEnds[row] ?? -Infinity) <= start + EPS;
  const items = entries.map(({ block, start, end }): BlockLaneItem => {
    // members packed like an overlay lane, relative to the block's first member row
    const memberRowEnds: number[] = [];
    const members = block.collapsed ? [] : (defsById.get(block.defId)?.members ?? [])
      .map((member, layer) => {
        const overlayId = getBlockMemberOverlayId(block.id, member.id);
        const t = resolved.get(overlayId);
        return { overlayId, memberId: member.id, layer, start: t?.start ?? start, end: t?.end ?? start };
      })
      .sort((a, b) => a.start - b.start || a.layer - b.layer)
      .map(({ overlayId, memberId, start: s, end: e }) => {
        let row = memberRowEnds.findIndex((rowEnd) => rowEnd <= s + EPS);
        if (row === -1) row = memberRowEnds.length;
        memberRowEnds[row] = Math.max(e, s + minDuration);
        return { overlayId, memberId, start: s, end: e, row };
      });
    const rows = 1 + memberRowEnds.length;
    const packEnd = Math.max(end, start + minDuration, ...members.map((m) => Math.max(m.end, m.start + minDuration)));
    const fitsAt = (first: number) => Array.from({ length: rows }, (_, k) => isFree(first + k, start)).every(Boolean);
    let row = 0;
    while (!fitsAt(row)) row += 1;
    for (let k = 0; k < rows; k += 1) rowEnds[row + k] = packEnd;
    return { blockId: block.id, start, end, row, rows, members: members.map((m) => ({ ...m, row: row + 1 + m.row })) };
  });
  return { rows: Math.max(1, rowEnds.length), items };
}

/**
 * Moving a block by `dt` s (its piece dragged in the lane): its anchor's `offset` if it's anchored, else its absolute
 * `time`, computed from the anchor at the start of the drag; its start (`rawStart` then) can't go below 0 s.
 */
export function getBlockMoveAnchor({ anchor, rawStart, dt }: { anchor: OverlayAnchor, rawStart: number, dt: number }): OverlayAnchor {
  const delta = Math.max(dt, -Math.max(0, rawStart));
  return anchor.kind === 'absolute'
    ? { kind: 'absolute', time: Math.max(0, roundOverlayTime(anchor.time + delta)) }
    : { ...anchor, offset: roundOverlayTime(anchor.offset + delta) };
}

/** How a click changes the overlay selection: plain click selects only it, Ctrl/Cmd toggles it, Shift adds it. */
export type SelectionMode = 'replace' | 'toggle' | 'add';

export const getSelectionMode = (e: { ctrlKey: boolean, metaKey: boolean, shiftKey: boolean }): SelectionMode => {
  if (e.ctrlKey || e.metaKey) return 'toggle';
  if (e.shiftKey) return 'add';
  return 'replace';
};

/** The selection (loose overlay and block ids, in click order) after clicking `id`. */
export function getNextSelection(ids: readonly string[], id: string, mode: SelectionMode): string[] {
  if (mode === 'replace') return [id];
  if (ids.includes(id)) return mode === 'toggle' ? ids.filter((i) => i !== id) : [...ids];
  return [...ids, id];
}

/** H8: the definition is shared with a locked instance, so its content (members, duration) can't be edited. */
export const isBlockDefLocked = (project: Pick<MixProject, 'blocks'>, defId: string) => project.blocks.some((b) => b.defId === defId && b.locked);

/** Name of a block instance in lists: its definition's name, with `#n` when it has several (linked) instances. */
export function getBlockLabel(project: Pick<MixProject, 'blocks' | 'blockDefs'>, block: MixBlock) {
  const def = project.blockDefs.find((d) => d.id === block.defId);
  const name = def?.name ?? block.id;
  const instances = project.blocks.filter((b) => b.defId === block.defId);
  return instances.length > 1 ? `${name} (${instances.indexOf(block) + 1}/${instances.length})` : name;
}

export interface AnchorTarget {
  /** Loose overlay id, block id or expanded member id. */
  id: string,
  name: string,
  kind: 'overlay' | 'block' | 'member',
}

/** What gets a new anchor: a loose overlay or a block. */
export type AnchorSubject = { overlayId: string } | { blockId: string };

function withElementAnchor(project: BlockProject, subject: AnchorSubject, targetId: string): BlockProject {
  const anchor: OverlayAnchor = { kind: 'element', elementId: targetId, edge: 'start', offset: 0 };
  if ('overlayId' in subject) return { ...project, overlays: project.overlays.map((o) => (o.id === subject.overlayId ? { ...o, anchor } : o)) };
  return { ...project, blocks: project.blocks.map((b) => (b.id === subject.blockId ? { ...b, anchor } : b)) };
}

const getCycleIds = (project: BlockProject) => {
  const blockCycles = [...composeBlockAnchors(project)].filter(([, c]) => c.cycle).map(([id]) => id);
  return new Set([...findOverlayCycleIds(expandBlocks(project).all), ...blockCycles]);
};

/**
 * True if anchoring `subject` to `targetId` makes a new cycle (between overlays, blocks or both, see `expandBlocks`).
 * Any new one counts: through a block, the cycle may not contain the subject's own overlays (e.g. a block anchored to a
 * member of a block anchored to it: that other block's members loop on themselves).
 */
export function wouldCreateAnchorCycle(project: BlockProject, subject: AnchorSubject, targetId: string, cyclesBefore = getCycleIds(project)) {
  const subjectId = 'overlayId' in subject ? subject.overlayId : subject.blockId;
  if (targetId === subjectId) return true;
  const after = getCycleIds(withElementAnchor(project, subject, targetId));
  return [...after].some((id) => !cyclesBefore.has(id));
}

/**
 * Element anchor targets of a loose overlay or a block (T57): the other loose overlays, the blocks and the members of
 * each block instance (expanded ids), without the ones that would make a cycle (`canOverlayDependOn` doesn't know the
 * blocks). In layer order.
 */
export function getAnchorTargets(project: Pick<MixProject, 'overlays' | 'blocks' | 'blockDefs'>, subject: AnchorSubject): AnchorTarget[] {
  const defsById = new Map<string, MixBlockDef>(project.blockDefs.map((d) => [d.id, d]));
  const candidates: AnchorTarget[] = [
    ...project.overlays.map((o): AnchorTarget => ({ id: o.id, name: o.name, kind: 'overlay' })),
    ...project.blocks.flatMap((block): AnchorTarget[] => {
      const label = getBlockLabel(project, block);
      return [
        { id: block.id, name: label, kind: 'block' },
        ...(defsById.get(block.defId)?.members ?? []).map((m): AnchorTarget => ({ id: getBlockMemberOverlayId(block.id, m.id), name: `${label} › ${m.name}`, kind: 'member' })),
      ];
    }),
  ];
  const cyclesBefore = getCycleIds(project);
  return candidates.filter((c) => !wouldCreateAnchorCycle(project, subject, c.id, cyclesBefore));
}

/**
 * H5 "at the start of each selected clip": the clips to repeat the block at, without the one it's already at the start
 * of (it would be a copy on top of it).
 */
export function getRepeatClipIds(block: Pick<MixBlock, 'anchor'>, clipIds: readonly string[]) {
  const { anchor } = block;
  return clipIds.filter((id) => !(anchor.kind === 'clip' && anchor.clipId === id && anchor.edge === 'start' && anchor.offset === 0));
}
