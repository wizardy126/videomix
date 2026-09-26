import { describe, expect, test } from 'vitest';

import { createCountdownOverlay, createImageOverlay, createSoundOverlay } from '../overlays/factories';
import { createEmptyMixProject } from '../types';
import type { MixBlock, MixBlockDef, MixProject } from '../types';
import { getAnchorTargets, getBlockLabel, getBlockMoveAnchor, getNextSelection, getRepeatClipIds, getSelectionMode, isBlockDefLocked, layoutBlockLane, wouldCreateAnchorCycle } from './blockUi';

const def = (id: string, members: MixBlockDef['members']): MixBlockDef => ({ id, name: `Def ${id}`, color: 0, members });
const atZero: MixBlock['anchor'] = { kind: 'absolute', time: 0 };
const block = (id: string, defId: string, anchor: MixBlock['anchor'] = atZero, extra: Partial<MixBlock> = {}): MixBlock => ({ id, defId, anchor, ...extra });

describe('layoutBlockLane', () => {
  // d1: two overlapping members (0–4 and 1–3), so 2 member rows; d2: one member
  const defs = [
    def('d1', [{ ...createImageOverlay({ id: 'm1', name: 'A', filePath: '/a.png' }), duration: 4 }, { ...createCountdownOverlay({ id: 'm2', name: 'B', start: 1 }), duration: 2 }]),
    def('d2', [{ ...createImageOverlay({ id: 'n1', name: 'C', filePath: '/c.png' }), duration: 2 }]),
  ];
  const resolved = new Map([
    ['b1/m1', { start: 0, end: 4 }], ['b1/m2', { start: 1, end: 3 }],
    ['b2/m1', { start: 10, end: 14 }], ['b2/m2', { start: 11, end: 13 }],
    ['b3/n1', { start: 2, end: 4 }],
  ]);
  const blockTimes = new Map([
    ['b1', { start: 0, end: 4, contentEnd: 4 }],
    ['b2', { start: 10, end: 14, contentEnd: 14 }],
    ['b3', { start: 2, end: 4, contentEnd: 4 }],
  ]);

  test('no blocks: no lane', () => {
    expect(layoutBlockLane({ blocks: [], blockDefs: defs }, new Map(), new Map(), 20)).toEqual({ rows: 0, items: [] });
  });

  test('blocks that don\'t overlap share rows; one that overlaps goes below all the rows of the other', () => {
    const { rows, items } = layoutBlockLane({ blocks: [block('b1', 'd1'), block('b2', 'd1'), block('b3', 'd2')], blockDefs: defs }, blockTimes, resolved, 20);
    const byId = new Map(items.map((i) => [i.blockId, i]));
    expect(byId.get('b1')).toMatchObject({ row: 0, rows: 3, start: 0, end: 4 });
    expect(byId.get('b1')!.members.map((m) => [m.memberId, m.row])).toEqual([['m1', 1], ['m2', 2]]);
    expect(byId.get('b2')).toMatchObject({ row: 0, rows: 3 });
    // b3 overlaps b1 in time: below its 3 rows
    expect(byId.get('b3')).toMatchObject({ row: 3, rows: 2 });
    expect(byId.get('b3')!.members[0]).toMatchObject({ overlayId: 'b3/n1', row: 4 });
    expect(rows).toBe(5);
  });

  test('a collapsed block is one row, without members', () => {
    const { rows, items } = layoutBlockLane({ blocks: [block('b1', 'd1', undefined, { collapsed: true }), block('b3', 'd2')], blockDefs: defs }, blockTimes, resolved, 20);
    expect(items[0]).toMatchObject({ blockId: 'b1', row: 0, rows: 1, members: [] });
    expect(items[1]).toMatchObject({ blockId: 'b3', row: 1, rows: 2 });
    expect(rows).toBe(3);
  });

  test('the piece reaches the end of its content (sounds), cut to the video', () => {
    const soundDef = def('d3', [createSoundOverlay({ id: 's', name: 'S', filePath: '/s.wav' })]);
    const { items } = layoutBlockLane({ blocks: [block('b4', 'd3')], blockDefs: [soundDef] }, new Map([['b4', { start: 5, end: 5, contentEnd: 30 }]]), new Map(), 20);
    expect(items[0]).toMatchObject({ start: 5, end: 20 });
  });
});

describe('getBlockMoveAnchor', () => {
  test('absolute: time, not below 0', () => {
    expect(getBlockMoveAnchor({ anchor: { kind: 'absolute', time: 2 }, rawStart: 2, dt: 1.234 })).toEqual({ kind: 'absolute', time: 3.23 });
    expect(getBlockMoveAnchor({ anchor: { kind: 'absolute', time: 2 }, rawStart: 2, dt: -5 })).toEqual({ kind: 'absolute', time: 0 });
  });

  test('anchored: offset, with the start not below 0', () => {
    const anchor = { kind: 'clip' as const, clipId: 'c', edge: 'start' as const, offset: 1 };
    expect(getBlockMoveAnchor({ anchor, rawStart: 3, dt: 2 })).toEqual({ ...anchor, offset: 3 });
    expect(getBlockMoveAnchor({ anchor, rawStart: 3, dt: -10 })).toEqual({ ...anchor, offset: -2 });
  });
});

describe('selection', () => {
  test('modes', () => {
    expect(getSelectionMode({ ctrlKey: false, metaKey: false, shiftKey: false })).toBe('replace');
    expect(getSelectionMode({ ctrlKey: true, metaKey: false, shiftKey: true })).toBe('toggle');
    expect(getSelectionMode({ ctrlKey: false, metaKey: true, shiftKey: false })).toBe('toggle');
    expect(getSelectionMode({ ctrlKey: false, metaKey: false, shiftKey: true })).toBe('add');
  });

  test('next selection', () => {
    expect(getNextSelection(['a', 'b'], 'c', 'replace')).toEqual(['c']);
    expect(getNextSelection(['a', 'b'], 'c', 'toggle')).toEqual(['a', 'b', 'c']);
    expect(getNextSelection(['a', 'b'], 'a', 'toggle')).toEqual(['b']);
    expect(getNextSelection(['a', 'b'], 'a', 'add')).toEqual(['a', 'b']);
    expect(getNextSelection(['a'], 'b', 'add')).toEqual(['a', 'b']);
  });
});

describe('anchor targets with blocks', () => {
  // loose a (absolute), c (absolute); block b1 (def d1: m1) anchored to a's end; block b2 (def d1) anchored to b1's end
  function makeProject(): MixProject {
    return {
      ...createEmptyMixProject(),
      overlays: [
        createImageOverlay({ id: 'a', name: 'A', filePath: '/a.png' }),
        createImageOverlay({ id: 'c', name: 'C', filePath: '/c.png' }),
      ],
      blockDefs: [def('d1', [createImageOverlay({ id: 'm1', name: 'M', filePath: '/m.png' })])],
      blocks: [
        block('b1', 'd1', { kind: 'element', elementId: 'a', edge: 'end', offset: 0 }),
        block('b2', 'd1', { kind: 'element', elementId: 'b1', edge: 'end', offset: 0 }),
      ],
    };
  }

  test('a loose overlay: not to what depends on it (blocks anchored to it, their members)', () => {
    const project = makeProject();
    expect(getAnchorTargets(project, { overlayId: 'a' }).map((target) => target.id)).toEqual(['c']);
    expect(getAnchorTargets(project, { overlayId: 'c' }).map((target) => [target.id, target.kind, target.name])).toEqual([
      ['a', 'overlay', 'A'],
      ['b1', 'block', 'Def d1 (1/2)'],
      ['b1/m1', 'member', 'Def d1 (1/2) › M'],
      ['b2', 'block', 'Def d1 (2/2)'],
      ['b2/m1', 'member', 'Def d1 (2/2) › M'],
    ]);
  });

  test('a block: not to itself, its members or blocks that depend on it', () => {
    const project = makeProject();
    expect(getAnchorTargets(project, { blockId: 'b1' }).map((target) => target.id)).toEqual(['a', 'c']);
    expect(getAnchorTargets(project, { blockId: 'b2' }).map((target) => target.id)).toEqual(['a', 'c', 'b1', 'b1/m1']);
    expect(wouldCreateAnchorCycle(project, { blockId: 'b1' }, 'b1/m1')).toBe(true);
    expect(wouldCreateAnchorCycle(project, { blockId: 'b1' }, 'b2')).toBe(true);
  });

  test('labels', () => {
    const project = makeProject();
    expect(getBlockLabel(project, project.blocks[0]!)).toBe('Def d1 (1/2)');
    expect(getBlockLabel({ ...project, blocks: [project.blocks[0]!] }, project.blocks[0]!)).toBe('Def d1');
  });
});

test('getRepeatClipIds skips the clip the block is already at the start of', () => {
  expect(getRepeatClipIds({ anchor: { kind: 'clip', clipId: 'c2', edge: 'start', offset: 0 } }, ['c1', 'c2', 'c3'])).toEqual(['c1', 'c3']);
  expect(getRepeatClipIds({ anchor: { kind: 'clip', clipId: 'c2', edge: 'start', offset: 1 } }, ['c1', 'c2'])).toEqual(['c1', 'c2']);
  expect(getRepeatClipIds({ anchor: { kind: 'absolute', time: 0 } }, ['c1'])).toEqual(['c1']);
});

test('isBlockDefLocked: any locked instance locks the shared content', () => {
  const blocks = [block('b1', 'd1'), block('b2', 'd1', undefined, { locked: true }), block('b3', 'd2')];
  expect(isBlockDefLocked({ blocks }, 'd1')).toBe(true);
  expect(isBlockDefLocked({ blocks }, 'd2')).toBe(false);
});
