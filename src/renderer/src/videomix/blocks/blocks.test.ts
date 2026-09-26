import { describe, expect, test } from 'vitest';

import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay, createSoundOverlay, createTextOverlay } from '../overlays/factories';
import { createMixSource, mixProjectReducer } from '../projectReducer';
import type { MixProjectAction } from '../projectReducer';
import { createEmptyMixProject } from '../types';
import type { MixBlock, MixBlockDef, MixClip, MixOverlay, MixProject, TextOverlay } from '../types';
import { prepareOverlayRemoval, resolveProjectTimes } from '../overlayRemoval';
import { validateMixProject } from '../project';
import type { MixProjectIssueCode } from '../project';
import { adaptBoxToAspect, adaptBlockDefToAspect, buildBlockFromOverlays, isBlockLinked, stretchBlockDef } from './blockOperations';
import { composeBlockAnchors, expandBlocks, getBlockDefDuration, getBlockDefTimes, getBlockMemberOverlayId, parseBlockMemberOverlayId, shiftAnchor } from './expandBlocks';
import { getBlockDefVariables, getMissingVariables, getTextVariables, substituteTextVariables } from './blockVariables';

function makeClip(id: string, sourceId: string): MixClip {
  return { id, sourceId, name: `Clip ${id}`, color: 0, start: 0, end: 4, maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, muted: false, gainDb: 0 };
}

const soundDurations = { snd: 1.5 };

/**
 * cd: countdown at clip c2's start + 1 (10 s); bar: linked to cd; snd: at cd's end; logo: absolute at 2 (5 s);
 * txt: 0.5 s after logo's start; ext: 1 s after snd's start.
 */
function makeProject(): MixProject {
  const overlays: MixOverlay[] = [
    { ...createCountdownOverlay({ id: 'cd', name: 'Countdown' }), anchor: { kind: 'clip', clipId: 'c2', edge: 'start', offset: 1 } },
    createProgressBarOverlay({ id: 'bar', name: 'Bar', linkedCountdownId: 'cd' }),
    { ...createSoundOverlay({ id: 'snd', name: 'Beep', filePath: '/beep.wav' }), anchor: { kind: 'element', elementId: 'cd', edge: 'end', offset: 0 } },
    { ...createImageOverlay({ id: 'logo', name: 'Logo', filePath: '/logo.png', start: 2 }), duration: 5 },
    { ...createTextOverlay({ id: 'txt', name: 'Title', text: 'Hello {{name|World}}' }), anchor: { kind: 'element', elementId: 'logo', edge: 'start', offset: 0.5 } },
    { ...createImageOverlay({ id: 'ext', name: 'Ext', filePath: '/ext.png' }), anchor: { kind: 'element', elementId: 'snd', edge: 'start', offset: 1 } },
  ];
  return {
    ...createEmptyMixProject(),
    sources: [createMixSource({ id: 's1', filePath: '/v/a.mp4', name: 'a.mp4' }), createMixSource({ id: 's2', filePath: '/v/b.mp4', name: 'b.mp4' })],
    clips: [makeClip('c1', 's1'), makeClip('c2', 's2'), makeClip('c3', 's1')],
    overlays,
  };
}

/** Raw times of every overlay (loose and expanded) and block. Sound durations by expanded id too. */
function times(project: MixProject, durations: Record<string, number> = soundDurations) {
  const expanded = expandBlocks(project);
  const byId: Record<string, number> = {};
  expanded.all.forEach((o) => {
    const origin = expanded.origins.get(o.id);
    const sourceId = origin != null ? origin.memberId : o.id;
    if (o.type === 'sound' && durations[sourceId] != null) byId[o.id] = durations[sourceId]!;
  });
  return resolveProjectTimes(project, byId);
}

const rawTimes = (project: MixProject, mapId: (id: string) => string = (id) => id) => {
  const t = times(project);
  return Object.fromEntries([...t].map(([id, { rawStart, rawEnd }]) => [mapId(id), [rawStart, rawEnd]]));
};

const dispatch = (project: MixProject, action: MixProjectAction) => mixProjectReducer(project, prepareOverlayRemoval(project, action, {}).action);

const group = (project: MixProject, overlayIds: string[], blockId = 'B', defId = 'D') => mixProjectReducer(project, {
  type: 'groupOverlays', overlayIds, blockId, defId, name: 'Block', color: 3, resolved: times(project),
});

const def = (members: MixOverlay[], id = 'D'): MixBlockDef => ({ id, name: 'Block', color: 0, members });
const block = (props: Partial<MixBlock> & Pick<MixBlock, 'id'>): MixBlock => ({ defId: 'D', anchor: { kind: 'absolute', time: 0 }, ...props });

describe('variables (H4)', () => {
  test('placeholders, defaults and substitution', () => {
    expect(getTextVariables('{{ name }} and {{team|Blue team}}, {{name|x}} {{}} {{a|}}')).toEqual([
      { name: 'name', defaultValue: 'x' },
      { name: 'team', defaultValue: 'Blue team' },
      { name: 'a', defaultValue: '' },
    ]);
    expect(substituteTextVariables('Hi {{name}}, {{team|Blue}}!', { name: 'Ana' })).toBe('Hi Ana, Blue!');
    expect(substituteTextVariables('Hi {{name}}', {})).toBe('Hi {{name}}');
    expect(substituteTextVariables('Hi {{name}}', undefined, { name: 'you' })).toBe('Hi you');
    expect(substituteTextVariables('{{a|}}x', undefined)).toBe('x');
    expect(substituteTextVariables('no vars', { a: 'b' })).toBe('no vars');

    const d = def([createTextOverlay({ id: 't1', name: 'T', text: '{{who}} vs {{rival|them}}' }), createTextOverlay({ id: 't2', name: 'T', text: '{{score}}' })]);
    expect(getBlockDefVariables(d).map((v) => v.name)).toEqual(['who', 'rival', 'score']);
    expect(getMissingVariables(d, { who: 'A' })).toEqual(['score']);
  });
});

describe('expansion', () => {
  test('without blocks nothing changes: the same overlays array', () => {
    const project = makeProject();
    const expanded = expandBlocks(project);
    expect(expanded.all).toBe(project.overlays);
    expect(expanded.visible).toBe(project.overlays);
    // unused definitions don't matter either
    expect(expandBlocks({ ...project, blockDefs: [def([])] }).all).toBe(project.overlays);
  });

  test('member ids, relative times, internal references, variables and hidden blocks', () => {
    const members: MixOverlay[] = [
      { ...createCountdownOverlay({ id: 'cd', name: 'C', start: 1 }), duration: 5 },
      createProgressBarOverlay({ id: 'bar', name: 'B', linkedCountdownId: 'cd' }),
      { ...createTextOverlay({ id: 't', name: 'T', text: '{{who|Ana}} {{n}}' }), anchor: { kind: 'element', elementId: 'cd', edge: 'end', offset: -1 }, duration: 1 },
    ];
    const project: MixProject = {
      ...createEmptyMixProject(),
      overlays: [createImageOverlay({ id: 'loose', name: 'L', filePath: '/l.png' })],
      blockDefs: [def(members)],
      blocks: [block({ id: 'b1', anchor: { kind: 'absolute', time: 10 }, variables: { n: '7' } }), block({ id: 'b2', anchor: { kind: 'absolute', time: 30 }, hidden: true })],
    };
    const { all, visible, origins } = expandBlocks(project);
    expect(all.map((o) => o.id)).toEqual(['loose', 'b1/cd', 'b1/bar', 'b1/t', 'b2/cd', 'b2/bar', 'b2/t']);
    expect(visible.map((o) => o.id)).toEqual(['loose', 'b1/cd', 'b1/bar', 'b1/t']);
    expect(origins.get('b2/t')).toEqual({ blockId: 'b2', memberId: 't' });
    expect(all[1]!.anchor).toEqual({ kind: 'absolute', time: 11 });
    expect(all[2]).toMatchObject({ linkedCountdownId: 'b1/cd' });
    expect(all[3]).toMatchObject({ anchor: { kind: 'element', elementId: 'b1/cd', edge: 'end', offset: -1 }, text: 'Ana 7' });
    expect((all[6] as TextOverlay).text).toBe('Ana {{n}}');
    // the definition itself is untouched
    expect(project.blockDefs[0]!.members).toBe(members);

    const t = times(project);
    expect(t.get('b1/t')).toMatchObject({ rawStart: 15, rawEnd: 16 });
    expect(t.get('b2/bar')).toMatchObject({ rawStart: 31, rawEnd: 36 });
    expect(t.get('b1')).toMatchObject({ rawStart: 10, rawEnd: 16 });
    expect(getBlockDefDuration(project.blockDefs[0]!)).toBe(6);
    expect(getBlockMemberOverlayId('b', 'm')).toBe('b/m');
    expect(parseBlockMemberOverlayId('b/m/x')).toEqual({ blockId: 'b', memberId: 'm/x' });
    expect(parseBlockMemberOverlayId('b/m', new Set(['other']))).toBeUndefined();
    expect(parseBlockMemberOverlayId('plain')).toBeUndefined();
  });

  test('anchors to blocks: loose overlays and other blocks, to the start or the end', () => {
    const project: MixProject = {
      ...createEmptyMixProject(),
      clips: [makeClip('c1', 's1')],
      sources: [createMixSource({ id: 's1', filePath: '/v/a.mp4', name: 'a.mp4' })],
      overlays: [
        { ...createImageOverlay({ id: 'afterB1', name: 'A', filePath: '/a.png' }), anchor: { kind: 'element', elementId: 'b1', edge: 'end', offset: 0.5 } },
        { ...createImageOverlay({ id: 'onMember', name: 'M', filePath: '/m.png' }), anchor: { kind: 'element', elementId: 'b2/img', edge: 'start', offset: 0 } },
      ],
      blockDefs: [def([{ ...createImageOverlay({ id: 'img', name: 'I', filePath: '/i.png', start: 1 }), duration: 2 }])],
      blocks: [
        block({ id: 'b1', anchor: { kind: 'clip', clipId: 'c1', edge: 'start', offset: 2 } }),
        block({ id: 'b2', anchor: { kind: 'element', elementId: 'b1', edge: 'end', offset: 1 } }),
      ],
    };
    const composed = composeBlockAnchors(project);
    expect(composed.get('b2')).toEqual({ anchor: { kind: 'clip', clipId: 'c1', edge: 'start', offset: 6 }, cycle: false });
    const t = times(project);
    const c1 = t.get('b1')!.rawStart - 2;
    expect(t.get('b1')).toMatchObject({ rawStart: c1 + 2, rawEnd: c1 + 5 });
    expect(t.get('afterB1')!.rawStart).toBe(c1 + 5.5);
    expect(t.get('b2')!.rawStart).toBe(c1 + 6);
    expect(t.get('b2/img')!.rawStart).toBe(c1 + 7);
    expect(t.get('onMember')!.rawStart).toBe(c1 + 7);
    expect(validateMixProject(project).filter((i) => i.level === 'error')).toEqual([]);
  });

  test('cycles through blocks fall back to absolute and are reported', () => {
    const project: MixProject = {
      ...createEmptyMixProject(),
      blockDefs: [def([createImageOverlay({ id: 'img', name: 'I', filePath: '/i.png' })])],
      blocks: [
        block({ id: 'b1', anchor: { kind: 'element', elementId: 'b2', edge: 'start', offset: 3 } }),
        block({ id: 'b2', anchor: { kind: 'element', elementId: 'b1', edge: 'start', offset: 4 } }),
        block({ id: 'b3', anchor: { kind: 'element', elementId: 'b1', edge: 'start', offset: 1 } }),
      ],
    };
    const composed = composeBlockAnchors(project);
    expect(composed.get('b1')).toEqual({ anchor: { kind: 'absolute', time: 3 }, cycle: true });
    expect(composed.get('b3')).toEqual({ anchor: { kind: 'absolute', time: 4 }, cycle: false });
    const issues = validateMixProject(project);
    expect(issues.filter((i) => i.code === 'block-cycle').map((i) => i.blockId)).toEqual(['b1', 'b2']);
    // a block anchored to its own member: the members' own cycle
    const self: MixProject = { ...project, blocks: [block({ id: 'b1', anchor: { kind: 'element', elementId: 'b1/img', edge: 'start', offset: 0 } })] };
    expect(validateMixProject(self).filter((i) => i.code === 'block-cycle').map((i) => i.blockId)).toEqual(['b1']);
    expect(times(self).get('b1/img')?.warnings).toContainEqual({ type: 'cycle' });
  });

  test('def-relative times: invalid member references fall back like broken ones', () => {
    const d = def([
      { ...createImageOverlay({ id: 'a', name: 'A', filePath: '/a.png' }), anchor: { kind: 'clip', clipId: 'c1', edge: 'start', offset: 2 }, duration: 1 },
      { ...createImageOverlay({ id: 'b', name: 'B', filePath: '/b.png' }), anchor: { kind: 'element', elementId: 'nope', edge: 'start', offset: -1 }, duration: 1 },
      { ...createProgressBarOverlay({ id: 'c', name: 'C', linkedCountdownId: 'outside', start: 4 }), duration: 3 },
      createSoundOverlay({ id: 's', name: 'S', filePath: '/s.wav', start: 6 }),
    ]);
    expect(Object.fromEntries([...getBlockDefTimes(d)].map(([id, t]) => [id, [t.start, t.end]]))).toEqual({ a: [2, 3], b: [0, 1], c: [4, 7], s: [6, 6] });
    expect(getBlockDefDuration(d)).toBe(7);
    expect(getBlockDefDuration(d, { soundDurations: { s: 2 } })).toBe(8);
    const project: MixProject = { ...createEmptyMixProject(), blockDefs: [d], blocks: [block({ id: 'b1' })] };
    const codes = validateMixProject(project).map((i) => [i.code, i.overlayId]);
    expect(codes).toEqual(expect.arrayContaining([['block-member-invalid-reference', 'a'], ['block-member-invalid-reference', 'b'], ['block-member-invalid-reference', 'c']]));
    expect(expandBlocks(project).all.find((o) => o.id === 'b1/c')).not.toHaveProperty('linkedCountdownId');
  });
});

describe('group and ungroup (H1)', () => {
  test('grouping keeps every time; the block inherits the first overlay anchor', () => {
    const project = makeProject();
    const before = rawTimes(project);
    const grouped = group(project, ['snd', 'bar', 'cd']);

    expect(grouped.overlays.map((o) => o.id)).toEqual(['logo', 'txt', 'ext']);
    expect(grouped.blocks).toEqual([{ id: 'B', defId: 'D', anchor: { kind: 'clip', clipId: 'c2', edge: 'start', offset: 1 } }]);
    const [d] = grouped.blockDefs;
    expect(d).toMatchObject({ id: 'D', name: 'Block', color: 3 });
    expect(d!.members.map((m) => [m.id, m.anchor])).toEqual([
      ['cd', { kind: 'absolute', time: 0 }],
      ['bar', { kind: 'absolute', time: 0 }],
      ['snd', { kind: 'element', elementId: 'cd', edge: 'end', offset: 0 }],
    ]);
    expect(d!.members[1]).toMatchObject({ linkedCountdownId: 'cd' });
    // the dependent outside now points to the expanded member
    expect(grouped.overlays.find((o) => o.id === 'ext')?.anchor).toEqual({ kind: 'element', elementId: 'B/snd', edge: 'start', offset: 1 });

    const after = rawTimes(grouped, (id) => parseBlockMemberOverlayId(id, new Set(['B']))?.memberId ?? id);
    const { B, ...afterOverlays } = after;
    expect(afterOverlays).toEqual(before);
    expect(B).toEqual([before['cd']![0], before['cd']![0]! + 10]);
    expect(validateMixProject(grouped).filter((i) => i.level === 'error' || i.code.startsWith('block'))).toEqual([]);

    // ungrouping restores the same times and ids
    const ungrouped = mixProjectReducer(grouped, { type: 'ungroupBlock', blockId: 'B' });
    expect(ungrouped.blocks).toEqual([]);
    expect(ungrouped.blockDefs).toEqual([]);
    expect(ungrouped.overlays.map((o) => o.id)).toEqual(['logo', 'txt', 'ext', 'cd', 'bar', 'snd']);
    expect(ungrouped.overlays.find((o) => o.id === 'ext')?.anchor).toEqual({ kind: 'element', elementId: 'snd', edge: 'start', offset: 1 });
    expect(ungrouped.overlays.find((o) => o.id === 'cd')?.anchor).toEqual({ kind: 'clip', clipId: 'c2', edge: 'start', offset: 1 });
    expect(rawTimes(ungrouped)).toEqual(before);
  });

  test('anchors outside the selection become relative; a first overlay anchored outside gives the block its anchor', () => {
    const project = makeProject();
    const before = rawTimes(project);
    // txt is anchored to logo (not selected), ext to snd (not selected)
    const grouped = group(project, ['txt', 'ext']);
    expect(grouped.blocks[0]!.anchor).toEqual({ kind: 'element', elementId: 'logo', edge: 'start', offset: 0.5 });
    expect(grouped.blockDefs[0]!.members.map((m) => m.anchor)).toEqual([{ kind: 'absolute', time: 0 }, { kind: 'absolute', time: before['ext']![0]! - before['txt']![0]! }]);
    const after = rawTimes(grouped, (id) => parseBlockMemberOverlayId(id, new Set(['B']))?.memberId ?? id);
    expect(Object.fromEntries(Object.entries(after).filter(([id]) => id !== 'B'))).toEqual(before);

    // a bar linked to a countdown outside: unlinked with its times; as the first overlay, the block follows the countdown
    const bar = group(project, ['bar']);
    expect(bar.blocks[0]!.anchor).toEqual({ kind: 'element', elementId: 'cd', edge: 'start', offset: 0 });
    expect(bar.blockDefs[0]!.members[0]).not.toHaveProperty('linkedCountdownId');
    expect(bar.blockDefs[0]!.members[0]).toMatchObject({ duration: 10, anchor: { kind: 'absolute', time: 0 } });
    expect(rawTimes(bar)['B/bar']).toEqual(before['bar']);

    // group → ungroup of loose ids that are taken: new ids
    const taken = mixProjectReducer({ ...bar, overlays: [...bar.overlays, createImageOverlay({ id: 'bar', name: 'x', filePath: '/x.png' })] }, { type: 'ungroupBlock', blockId: 'B' });
    expect(taken.overlays.map((o) => o.id).slice(-2)).toEqual(['bar', 'bar-2']);
  });

  test('broken or cyclic first anchors: the block is absolute at the current start', () => {
    const project = makeProject();
    const broken: MixProject = { ...project, overlays: [{ ...createImageOverlay({ id: 'x', name: 'X', filePath: '/x.png' }), anchor: { kind: 'clip', clipId: 'gone', edge: 'start', offset: 3 } }] };
    expect(group(broken, ['x']).blocks[0]!.anchor).toEqual({ kind: 'absolute', time: 3 });
    const built = buildBlockFromOverlays(project.overlays, ['nope'], new Map(), { defId: 'D', name: 'N', color: 0 });
    expect(built).toBeUndefined();
    expect(group(project, ['nope'])).toBe(project);
  });

  test('ungrouping bakes the variables and keeps following the block anchor', () => {
    const project = makeProject();
    const grouped = mixProjectReducer(group(project, ['logo', 'txt']), { type: 'updateBlock', blockId: 'B', patch: { variables: { name: 'Ana' } } });
    expect((expandBlocks(grouped).all.find((o) => o.id === 'B/txt') as TextOverlay).text).toBe('Hello Ana');
    const ungrouped = mixProjectReducer(grouped, { type: 'ungroupBlock', blockId: 'B' });
    expect(ungrouped.overlays.find((o): o is TextOverlay => o.id === 'txt')?.text).toBe('Hello Ana');
    expect(rawTimes(ungrouped)).toEqual(rawTimes(project));
  });
});

describe('block operations', () => {
  const base = () => group(makeProject(), ['cd', 'bar', 'snd']);

  test('duplicate: an independent copy; unlink; repeat (H5): linked instances', () => {
    const project = base();
    const dup = mixProjectReducer(project, { type: 'duplicateBlock', blockId: 'B', newBlockId: 'B2', newDefId: 'D2' });
    expect(dup.blocks.map((b) => [b.id, b.defId])).toEqual([['B', 'D'], ['B2', 'D2']]);
    expect(dup.blockDefs[1]).toEqual({ ...project.blockDefs[0], id: 'D2' });
    expect(isBlockLinked(dup, 'B')).toBe(false);

    const repeated = mixProjectReducer(project, { type: 'repeatBlock', blockId: 'B', newBlockIds: ['R1', 'R2'], repeat: { kind: 'interval', interval: 20 } });
    expect(repeated.blocks.map((b) => [b.id, b.defId, b.anchor])).toEqual([
      ['B', 'D', { kind: 'clip', clipId: 'c2', edge: 'start', offset: 1 }],
      ['R1', 'D', { kind: 'clip', clipId: 'c2', edge: 'start', offset: 21 }],
      ['R2', 'D', { kind: 'clip', clipId: 'c2', edge: 'start', offset: 41 }],
    ]);
    expect(isBlockLinked(repeated, 'R1')).toBe(true);
    const t = times(repeated);
    expect(t.get('R2/cd')!.rawStart - t.get('B/cd')!.rawStart).toBeCloseTo(40);

    const atClips = mixProjectReducer(project, { type: 'repeatBlock', blockId: 'B', newBlockIds: ['K1', 'K3'], repeat: { kind: 'clips', clipIds: ['c1', 'c3'] } });
    expect(atClips.blocks.slice(1).map((b) => b.anchor)).toEqual([{ kind: 'clip', clipId: 'c1', edge: 'start', offset: 0 }, { kind: 'clip', clipId: 'c3', edge: 'start', offset: 0 }]);

    // editing a member changes every linked instance
    const edited = mixProjectReducer(repeated, { type: 'updateBlockMember', defId: 'D', memberId: 'cd', patch: { color: '#ff0000' } });
    expect(expandBlocks(edited).all.filter((o) => o.type === 'countdown').map((o) => (o.type === 'countdown' ? o.color : ''))).toEqual(['#ff0000', '#ff0000', '#ff0000']);

    const unlinked = mixProjectReducer(repeated, { type: 'unlinkBlock', blockId: 'R1', newDefId: 'D3' });
    expect(unlinked.blocks.map((b) => b.defId)).toEqual(['D', 'D3', 'D']);
    expect(unlinked.blockDefs.find((d) => d.id === 'D3')?.members).toEqual(project.blockDefs[0]!.members);
    // not shared: nothing to unlink
    expect(mixProjectReducer(project, { type: 'unlinkBlock', blockId: 'B', newDefId: 'D9' })).toBe(project);
  });

  test('stretch (H6): times and durations scale, fades and entries keep their length', () => {
    const d = def([
      { ...createImageOverlay({ id: 'a', name: 'A', filePath: '/a.png' }), duration: 4, fadeIn: 0.5, fadeOut: 1 },
      { ...createTextOverlay({ id: 't', name: 'T', text: 'x', start: 2 }), duration: 3, entry: { kind: 'slide', from: 'left', duration: 0.8 } },
      { ...createSoundOverlay({ id: 's', name: 'S', filePath: '/s.wav' }), anchor: { kind: 'element', elementId: 'a', edge: 'end', offset: -1 } },
    ]);
    expect(getBlockDefDuration(d)).toBe(5);
    const stretched = stretchBlockDef(d, 10);
    expect(getBlockDefDuration(stretched)).toBe(10);
    expect(stretched.members[0]).toMatchObject({ duration: 8, fadeIn: 0.5, fadeOut: 1 });
    expect(stretched.members[1]).toMatchObject({ anchor: { kind: 'absolute', time: 4 }, duration: 6, entry: { duration: 0.8 } });
    expect(stretched.members[2]).toMatchObject({ anchor: { offset: -2 } });
    expect(stretchBlockDef(d, 0)).toBe(d);
    expect(stretchBlockDef(def([]), 3)).toEqual(def([]));

    const project = base();
    const t = times(project);
    const next = mixProjectReducer(project, { type: 'stretchBlock', blockId: 'B', duration: 5 });
    const t2 = times(next);
    expect(t2.get('B')!.rawEnd - t2.get('B')!.rawStart).toBeCloseTo(5);
    expect(t2.get('B')!.rawStart).toBe(t.get('B')!.rawStart);
  });

  test('adapt to another aspect (H7): size relative to the height, center kept, inside the frame', () => {
    // a square box on 16:9 (0.18 × 0.32 of the frame) stays square on 9:16
    const { box, scale } = adaptBoxToAspect({ x: 0.8, y: 0.1, width: 0.18, height: 0.32 }, '16:9', '9:16');
    expect(scale).toBe(1);
    expect(box.width * 1080).toBeCloseTo(box.height * 1920);
    expect(box.height).toBeCloseTo(0.32);
    expect(box.x + box.width).toBeCloseTo(1);
    // full width on 16:9 doesn't fit on 9:16: scaled down to the width
    const full = adaptBoxToAspect({ x: 0, y: 0, width: 1, height: 1 }, '16:9', '9:16');
    expect(full.box.width).toBeCloseTo(1);
    expect(full.box.height).toBeCloseTo((9 / 16) ** 2);
    expect(full.box.y).toBeCloseTo((1 - full.box.height) / 2);
    const text = { ...createTextOverlay({ id: 't', name: 'T', text: 'x' }), box: { x: 0, y: 0.4, width: 1, height: 0.1 }, fontSize: 0.1 };
    const adapted = adaptBlockDefToAspect(def([text, createSoundOverlay({ id: 's', name: 'S', filePath: '/s.wav' })]), '16:9', '1:1');
    expect(adapted.members[0]).toMatchObject({ fontSize: 0.1 * (9 / 16), box: { width: 1 } });
    expect(adaptBlockDefToAspect(adapted, '1:1', '1:1')).toBe(adapted);
  });

  test('remove a block or a member: what depends on them keeps its time', () => {
    const project = base();
    const before = times(project);
    const removed = dispatch(project, { type: 'removeBlock', blockId: 'B' });
    expect(removed.blocks).toEqual([]);
    expect(removed.blockDefs).toEqual([]);
    expect(removed.overlays.find((o) => o.id === 'ext')?.anchor).toEqual({ kind: 'absolute', time: before.get('ext')!.rawStart });

    // a block anchored to a removed overlay
    const anchored = mixProjectReducer(project, { type: 'updateBlock', blockId: 'B', patch: { anchor: { kind: 'element', elementId: 'logo', edge: 'end', offset: 1 } } });
    const t = times(anchored);
    expect(prepareOverlayRemoval(anchored, { type: 'removeOverlay', overlayId: 'logo' }, {}).detachedBlocks.map((b) => b.id)).toEqual(['B']);
    const noLogo = dispatch(anchored, { type: 'removeOverlay', overlayId: 'logo' });
    expect(noLogo.blocks[0]!.anchor).toEqual({ kind: 'absolute', time: t.get('B')!.rawStart });
    // and to a removed clip
    const noClip = dispatch(project, { type: 'removeClip', clipId: 'c2' });
    expect(noClip.blocks[0]!.anchor).toEqual({ kind: 'absolute', time: before.get('B')!.rawStart });

    // removing the countdown member: the bar is unlinked keeping its times, the sound anchored to its end is relative
    const noCd = dispatch(project, { type: 'removeBlockMember', defId: 'D', memberId: 'cd' });
    expect(noCd.blockDefs[0]!.members.map((m) => m.id)).toEqual(['bar', 'snd']);
    expect(noCd.blockDefs[0]!.members[0]).toMatchObject({ anchor: { kind: 'absolute', time: 0 }, duration: 10 });
    expect(noCd.blockDefs[0]!.members[0]).not.toHaveProperty('linkedCountdownId');
    expect(noCd.blockDefs[0]!.members[1]!.anchor).toEqual({ kind: 'absolute', time: 10 });
    const t2 = times(noCd);
    expect(t2.get('B/bar')!.rawStart).toBe(before.get('B/bar')!.rawStart);
    expect(t2.get('B/snd')!.rawStart).toBe(before.get('B/snd')!.rawStart);
  });

  test('updateBlock stores flags only when true; layers; addBlocks', () => {
    const project = base();
    const hidden = mixProjectReducer(project, { type: 'updateBlock', blockId: 'B', patch: { hidden: true, locked: false, variables: {} } });
    expect(hidden.blocks[0]).toEqual({ ...project.blocks[0], hidden: true });
    expect(expandBlocks(hidden).visible.map((o) => o.id)).toEqual(['logo', 'txt', 'ext']);
    const shown = mixProjectReducer(hidden, { type: 'updateBlock', blockId: 'B', patch: { hidden: false } });
    expect(shown.blocks[0]).toEqual(project.blocks[0]);
    expect(mixProjectReducer(shown, { type: 'updateBlock', blockId: 'B', patch: { collapsed: undefined } })).toBe(shown);
    expect(mixProjectReducer(project, { type: 'updateBlockDef', defId: 'D', patch: { name: 'Intro' } }).blockDefs[0]!.name).toBe('Intro');

    const two = mixProjectReducer(project, { type: 'addBlocks', defs: [def([createImageOverlay({ id: 'i', name: 'I', filePath: '/i.png' })], 'D2')], blocks: [block({ id: 'B2', defId: 'D2' })] });
    expect(two.blocks.map((b) => b.id)).toEqual(['B', 'B2']);
    expect(mixProjectReducer(two, { type: 'moveBlockLayer', blockId: 'B2', to: 'back' }).blocks.map((b) => b.id)).toEqual(['B2', 'B']);
    expect(mixProjectReducer(two, { type: 'moveBlockLayer', blockId: 'B2', to: 'up' })).toBe(two);
    expect(() => mixProjectReducer(two, { type: 'addBlocks', defs: [], blocks: [block({ id: 'logo' })] })).toThrow('Duplicate block id');
    expect(() => mixProjectReducer(two, { type: 'addBlocks', defs: [def([], 'D2')], blocks: [] })).toThrow('Duplicate block definition id');
  });

  test('the dispatch pipeline adds the times a grouping needs', () => {
    const project = makeProject();
    const action: MixProjectAction = { type: 'groupOverlays', overlayIds: ['logo', 'txt'], blockId: 'B', defId: 'D', name: 'N', color: 0 };
    const prepared = prepareOverlayRemoval(project, action, soundDurations).action;
    expect(prepared.type === 'groupOverlays' && prepared.resolved?.get('txt')?.rawStart).toBe(2.5);
    expect(mixProjectReducer(project, prepared).blocks[0]!.anchor).toEqual({ kind: 'absolute', time: 2 });
  });

  test('shiftAnchor', () => {
    expect(shiftAnchor({ kind: 'absolute', time: 1 }, -2)).toEqual({ kind: 'absolute', time: -1 });
    expect(shiftAnchor({ kind: 'clip', clipId: 'c', edge: 'end', offset: 1 }, 2)).toEqual({ kind: 'clip', clipId: 'c', edge: 'end', offset: 3 });
  });
});

describe('validation (v7)', () => {
  const codes = (project: MixProject) => validateMixProject(project).map((i) => `${i.level}:${i.code}`);
  const has = (project: MixProject, code: MixProjectIssueCode) => validateMixProject(project).some((i) => i.code === code);

  test('block issues', () => {
    const base: MixProject = { ...createEmptyMixProject(), blockDefs: [def([createTextOverlay({ id: 't', name: 'T', text: '{{who}}' })])], blocks: [block({ id: 'b1' })] };
    expect(codes(base)).toEqual(['warning:block-missing-variable']);
    expect(codes({ ...base, blocks: [block({ id: 'b1', variables: { who: 'x' } })] })).toEqual([]);
    expect(has({ ...base, blocks: [...base.blocks, block({ id: 'b1' })] }, 'duplicate-block-id')).toBe(true);
    expect(has({ ...base, overlays: [createImageOverlay({ id: 'b1', name: 'x', filePath: '/x.png' })] }, 'duplicate-block-id')).toBe(true);
    expect(has({ ...base, blockDefs: [...base.blockDefs, def([])] }, 'duplicate-block-def-id')).toBe(true);
    expect(has({ ...base, blocks: [block({ id: 'b1', defId: 'nope' })] }, 'block-unknown-def')).toBe(true);
    expect(has({ ...base, blocks: [] }, 'block-def-unused')).toBe(true);
    expect(has({ ...base, blockDefs: [def([])] }, 'block-empty')).toBe(true);
    const twice = createImageOverlay({ id: 'a/b', name: 'x', filePath: '/x.png' });
    expect(has({ ...base, blockDefs: [def([twice, twice])] }, 'duplicate-block-member-id')).toBe(true);
    expect(has({ ...base, blockDefs: [def([twice])] }, 'invalid-block-member-id')).toBe(true);
    expect(has({ ...base, blocks: [block({ id: 'b1', anchor: { kind: 'clip', clipId: 'nope', edge: 'start', offset: 0 } })] }, 'block-broken-reference')).toBe(true);
    // the members' own content is checked once per definition
    const badBox = { ...createImageOverlay({ id: 'i', name: 'I', filePath: '/i.png' }), box: { x: 0.5, y: 0, width: 0.8, height: 0.2 } };
    expect(validateMixProject({ ...base, blockDefs: [def([badBox])], blocks: [block({ id: 'b1' }), block({ id: 'b2' })] })).toEqual([
      expect.objectContaining({ level: 'error', code: 'overlay-box-out-of-range', overlayId: 'i', blockDefId: 'D' }),
    ]);
    // loose overlays may be anchored to blocks and to their members
    expect(codes({ ...base, blocks: [block({ id: 'b1', variables: { who: 'x' } })], overlays: [{ ...createImageOverlay({ id: 'l', name: 'L', filePath: '/l.png' }), anchor: { kind: 'element', elementId: 'b1/t', edge: 'end', offset: 0 } }] })).toEqual([]);
  });
});
