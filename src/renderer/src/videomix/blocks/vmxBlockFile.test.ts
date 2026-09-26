import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import set from 'lodash/set';
import unset from 'lodash/unset';
import { describe, expect, test } from 'vitest';

import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay, createSoundOverlay, createTextOverlay } from '../overlays/factories';
import { createEmptyMixProject } from '../types';
import type { MixBlockDef, MixOverlay, MixProject, OverlayFile } from '../types';
import { groupOverlaysIntoBlock } from './blockOperations';
import { createVmxBlockFile, getBlockExport, getOverlaysExport, getVmxBlockJsonSchema, getVmxBlockPlacementAnchor, instantiateVmxBlock, parseVmxBlockFile, serializeVmxBlockFile, VmxBlockParseError } from './vmxBlockFile';
import type { VmxBlockIssue } from './vmxBlockFile';

const schemaPath = fileURLToPath(new URL('../../../../../docs/videomix/vmxblock.schema.json', import.meta.url));

// Files live next to the .vmxblock in /lib (stored relative), except fonts, which stay absolute
const toFilePath = (file: OverlayFile) => (file.absolutePath.startsWith('/lib/') ? file.absolutePath.slice('/lib/'.length) : file.absolutePath);
const resolveFile = (p: string): OverlayFile => {
  const absolute = p.startsWith('/') ? p : `/lib/${p}`;
  return { path: absolute, absolutePath: absolute };
};

function makeDef(): MixBlockDef {
  const members: MixOverlay[] = [
    { ...createCountdownOverlay({ id: 'cd', name: 'Countdown', start: 1 }), duration: 5, font: { path: '/fonts/a.ttf', absolutePath: '/fonts/a.ttf' } },
    createProgressBarOverlay({ id: 'bar', name: 'Bar', linkedCountdownId: 'cd' }),
    { ...createImageOverlay({ id: 'img', name: 'Logo', filePath: '/lib/files/logo.png' }), duration: 2 },
    { ...createTextOverlay({ id: 'txt', name: 'Title', text: '{{team|Blue}} vs {{rival}}' }), anchor: { kind: 'element', elementId: 'cd', edge: 'end', offset: -1 } },
    { ...createSoundOverlay({ id: 'snd', name: 'Beep', filePath: '/lib/files/beep.wav' }), anchor: { kind: 'element', elementId: 'cd', edge: 'end', offset: 0 } },
  ];
  return { id: 'D', name: 'Intro', color: 4, members };
}

const issuesOf = (text: string): VmxBlockIssue[] => {
  try {
    parseVmxBlockFile(text, { resolveFile });
  } catch (err) {
    if (err instanceof VmxBlockParseError) return err.issues;
    throw err;
  }
  throw new Error('parsed');
};

describe('.vmxblock (H2)', () => {
  test('export → import round trip', () => {
    const def = makeDef();
    const file = createVmxBlockFile({ def, aspect: '16:9', originalStart: 12.5, clipAnchor: { clipName: 'Kick-off', edge: 'start', offset: 1 }, variables: { rival: 'Red' }, toFilePath });
    const text = serializeVmxBlockFile(file);
    // strict, indented JSON, with relative paths and no absolute fallbacks
    expect(JSON.parse(text)).toEqual(file);
    expect(text).toContain('\n  "format": "videomix-block",');
    expect(file.members[2]).toMatchObject({ path: 'files/logo.png' });
    expect(file.members[2]).not.toHaveProperty('absolutePath');
    expect(file.members[0]).toMatchObject({ font: { path: '/fonts/a.ttf' } });

    const template = parseVmxBlockFile(text, { resolveFile });
    expect(template.members).toEqual(def.members);
    expect(template).toMatchObject({ name: 'Intro', color: 4, aspect: '16:9', originalStart: 12.5, clipAnchor: { clipName: 'Kick-off' }, duration: 10 });
    expect(template.variables).toEqual({ team: 'Blue', rival: 'Red' });
    expect(template.variableNames).toEqual(['team', 'rival']);

    const { def: imported, block } = instantiateVmxBlock(template, { defId: 'N', blockId: 'NB', placement: { kind: 'shift', seconds: -2 } });
    expect(imported).toEqual({ ...def, id: 'N' });
    expect(block).toEqual({ id: 'NB', defId: 'N', anchor: { kind: 'absolute', time: 10.5 }, variables: { team: 'Blue', rival: 'Red' } });
    // adapted to 9:16: the boxes change, not the times
    const adapted = instantiateVmxBlock(template, { defId: 'N', blockId: 'NB', placement: { kind: 'original' }, variables: {}, adaptTo: '9:16' });
    expect(adapted.block).toEqual({ id: 'NB', defId: 'N', anchor: { kind: 'absolute', time: 12.5 } });
    expect(adapted.def.members.map((m) => m.anchor)).toEqual(def.members.map((m) => m.anchor));
    expect(adapted.def.members[2]).not.toEqual(def.members[2]);
  });

  test('hand-edited JSON5: comments, trailing commas, optional fields', () => {
    const text = `// a countdown
    {
      format: 'videomix-block', version: 1, name: 'Hand made', aspect: '1:1', originalStart: 0,
      members: [
        { id: 'c', name: 'C', type: 'countdown', anchor: { kind: 'absolute', time: 0 }, duration: 3, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
          align: 'center', decimals: 0, leadingZeros: false, color: '#ffffff', border: { width: 0, color: '#000000' }, fadeOut: 0, }, // trailing comma
      ],
    }`;
    const template = parseVmxBlockFile(text, { resolveFile });
    expect(template).toMatchObject({ name: 'Hand made', color: 0, aspect: '1:1', duration: 3, variables: {}, clipAnchor: undefined });
    expect(template.members[0]).not.toHaveProperty('font');
  });

  test('readable errors: field path and reason, nothing imported', () => {
    const valid: unknown = JSON.parse(serializeVmxBlockFile(createVmxBlockFile({ def: makeDef(), aspect: '16:9', originalStart: 0, toFilePath })));
    /** The valid file with values set at paths (`undefined` removes it). */
    const edit = (...changes: [string, unknown][]) => {
      const json = structuredClone(valid) as object;
      changes.forEach(([key, value]) => (value === undefined ? unset(json, key) : set(json, key, value)));
      return JSON.stringify(json);
    };
    expect(issuesOf('{ format: "videomix-block", version: 1,')[0]!.message).toMatch(/JSON5: invalid end of input at 1:40/);
    expect(issuesOf('[]')).toEqual([{ path: 'format', message: 'Not a VideoMix block file (expected "videomix-block")' }]);
    expect(issuesOf(edit(['format', 'videomix-overlay-styles']))[0]!.path).toBe('format');
    expect(issuesOf(edit(['version', 2]))).toEqual([{ path: 'version', message: 'Version 2 is newer than supported (1)' }]);

    const refChanges: [string, unknown][] = [['members[3].anchor.elementId', 'nope'], ['members[1].linkedCountdownId', 'img'], ['members[4].id', 'cd']];
    const issues = issuesOf(edit(['members[2].box.width', 'wide'], ['aspect', undefined], ...refChanges));
    expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining(['aspect', 'members[2].box.width']));
    expect(issues.find((i) => i.path === 'members[2].box.width')!.message).toMatch(/number/);
    // reference checks run once the shapes are valid
    expect(issuesOf(edit(...refChanges))).toEqual([
      { path: 'members[1].linkedCountdownId', message: 'No countdown member with id "img"' },
      { path: 'members[3].anchor.elementId', message: 'No member with id "nope"' },
      { path: 'members[4].id', message: 'Duplicate member id "cd"' },
    ]);
    expect(issuesOf(edit(['members[0].anchor', { kind: 'clip', clipId: 'c', edge: 'start', offset: 0 }]))[0]!.path).toBe('members[0].anchor.kind');
    expect(issuesOf(edit(['members', []]))[0]!.path).toBe('members');
    expect(new VmxBlockParseError([{ path: 'a.b', message: 'bad' }, { path: '', message: 'worse' }]).message).toBe('a.b: bad\nworse');
  });

  test('placements', () => {
    const template = { originalStart: 3 };
    expect(getVmxBlockPlacementAnchor(template, { kind: 'original' })).toEqual({ kind: 'absolute', time: 3 });
    expect(getVmxBlockPlacementAnchor(template, { kind: 'shift', seconds: -5 })).toEqual({ kind: 'absolute', time: 0 });
    expect(getVmxBlockPlacementAnchor(template, { kind: 'cursor', time: 7.5 })).toEqual({ kind: 'absolute', time: 7.5 });
    expect(getVmxBlockPlacementAnchor(template, { kind: 'clip', clipId: 'c1', edge: 'end', offset: -1 })).toEqual({ kind: 'clip', clipId: 'c1', edge: 'end', offset: -1 });
  });

  test('export data of a block and of a selection of loose overlays', () => {
    const def = makeDef();
    const project: MixProject = {
      ...createEmptyMixProject(),
      clips: [{ id: 'c1', sourceId: 's', name: 'Kick-off', color: 0, start: 0, end: 4, maxRect: { x: 0, y: 0, width: 16, height: 16 }, muted: false, gainDb: 0 }],
      overlays: def.members.map((m) => (m.anchor.kind === 'absolute' ? { ...m, anchor: { kind: 'clip' as const, clipId: 'c1', edge: 'end' as const, offset: m.anchor.time } } : m)),
    };
    const times = new Map([['cd', { rawStart: 5, rawEnd: 10 }], ['bar', { rawStart: 5, rawEnd: 10 }], ['img', { rawStart: 4, rawEnd: 6 }], ['txt', { rawStart: 9, rawEnd: 14 }], ['snd', { rawStart: 10, rawEnd: 10 }]]);
    const selection = getOverlaysExport(project, ['cd', 'img'], times, { name: 'Selection' });
    expect(selection).toMatchObject({ aspect: '16:9', originalStart: 4, clipAnchor: { clipName: 'Kick-off', edge: 'end', offset: 0 }, def: { name: 'Selection' } });
    expect(selection!.def.members.map((m) => [m.id, m.anchor])).toEqual([['cd', { kind: 'absolute', time: 1 }], ['img', { kind: 'absolute', time: 0 }]]);

    const grouped = groupOverlaysIntoBlock(project, { overlayIds: ['cd', 'img'], blockId: 'B', defId: 'D', name: 'Block', color: 0, times });
    const exported = getBlockExport(grouped, 'B', new Map([['B', { rawStart: 4, rawEnd: 10 }]]));
    expect(exported).toMatchObject({ originalStart: 4, clipAnchor: { clipName: 'Kick-off', edge: 'end', offset: 0 } });
    expect(getBlockExport(grouped, 'nope', new Map())).toBeUndefined();
  });

  test('the JSON Schema file is generated from the zod schema', () => {
    const schema = getVmxBlockJsonSchema();
    // VIDEOMIX_UPDATE_VMXBLOCK_SCHEMA=1 yarn test run vmxBlockFile  → rewrites docs/videomix/vmxblock.schema.json
    if (process.env['VIDEOMIX_UPDATE_VMXBLOCK_SCHEMA'] === '1') writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
    expect(JSON.parse(readFileSync(schemaPath, 'utf8'))).toEqual(schema);
    expect(schema).toMatchObject({ $schema: 'http://json-schema.org/draft-07/schema#', required: expect.arrayContaining(['format', 'version', 'aspect', 'originalStart', 'members']) });
  });
});
