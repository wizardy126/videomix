import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

import { createCountdownOverlay, createImageOverlay, createSoundOverlay, createTextOverlay } from '../overlays/factories';
import type { MixBlockDef, MixOverlay } from '../types';
import { findMissingTemplateFiles, getIncludedFilesDirName, getNewLibraryFilePath, getTemplateSelection, getUniqueFileName, listBlockLibrary, MissingVmxBlockFilesError, planVmxBlockFiles, readVmxBlockFile, relinkTemplateFile, toBlockFileName, writeVmxBlockFile } from './blockTemplateFiles';
import type { BlockFileDeps } from './blockTemplateFiles';
import { instantiateVmxBlock, VmxBlockParseError } from './vmxBlockFile';
import type { VmxBlockExport } from './vmxBlockFile';
import { getTemplatePreviewOps } from './blockPreview';

const deps: BlockFileDeps = { path, fs };
const p = path.posix;

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'videomix-blocks-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function makeDef(mediaDir: string): MixBlockDef {
  const members: MixOverlay[] = [
    { ...createCountdownOverlay({ id: 'cd', name: 'Countdown', start: 1 }), duration: 4, font: { path: path.join(mediaDir, 'font.ttf'), absolutePath: path.join(mediaDir, 'font.ttf') } },
    { ...createImageOverlay({ id: 'logo', name: 'Logo', filePath: path.join(mediaDir, 'logo.png') }), duration: 2 },
    // same name as the first logo, another folder
    { ...createImageOverlay({ id: 'logo2', name: 'Logo 2', filePath: path.join(mediaDir, 'other', 'logo.png') }), duration: 2 },
    createTextOverlay({ id: 'txt', name: 'Title', text: 'Round {{round|1}}', start: 0.5 }),
    { ...createSoundOverlay({ id: 'snd', name: 'Beep', filePath: path.join(mediaDir, 'beep.wav') }), anchor: { kind: 'element', elementId: 'cd', edge: 'end', offset: 0 } },
    // the same file twice: copied once
    { ...createSoundOverlay({ id: 'snd2', name: 'Beep again', filePath: path.join(mediaDir, 'beep.wav') }), anchor: { kind: 'absolute', time: 0 } },
  ];
  return { id: 'D', name: 'Intro', color: 3, members };
}

const makeExport = (def: MixBlockDef): VmxBlockExport => ({ def, aspect: '16:9', originalStart: 7, clipAnchor: undefined, variables: { round: '3' } });

async function createMedia(mediaDir: string) {
  await fs.mkdir(path.join(mediaDir, 'other'), { recursive: true });
  await Promise.all(['font.ttf', 'logo.png', 'other/logo.png', 'beep.wav'].map(async (f) => fs.writeFile(path.join(mediaDir, f), f)));
}

describe('.vmxblock files (H2, T58)', () => {
  test('unique names, the "_files" folder and block file names', () => {
    expect(getUniqueFileName('a.png', () => true)).toBe('a.png');
    const taken = new Set(['a.png', 'a (2).png']);
    expect(getUniqueFileName('a.png', (n) => !taken.has(n))).toBe('a (3).png');
    expect(getUniqueFileName('README', (n) => n !== 'README')).toBe('README (2)');
    expect(getIncludedFilesDirName(p, '/x/Intro.vmxblock')).toBe('Intro_files');
    expect(getIncludedFilesDirName(p, '/x/Intro.VMXBLOCK')).toBe('Intro_files');
    expect(toBlockFileName('Round: 1/2?')).toBe('Round_ 1_2_.vmxblock');
    expect(toBlockFileName(' .. ')).toBe('Block.vmxblock');
  });

  test('without "Include files": paths relative to the .vmxblock, nothing copied', () => {
    const def = makeDef('/media');
    const { copies, toFilePath } = planVmxBlockFiles(p, { blockFilePath: '/media/blocks/intro.vmxblock', members: def.members, includeFiles: false });
    expect(copies).toEqual([]);
    expect(toFilePath({ path: '/media/logo.png', absolutePath: '/media/logo.png' })).toBe('../logo.png');
  });

  test('with "Include files": each file copied once into <name>_files, clashing names renamed', () => {
    const def = makeDef('/media');
    const { copies, toFilePath } = planVmxBlockFiles(p, { blockFilePath: '/out/intro.vmxblock', members: def.members, includeFiles: true });
    expect(copies).toEqual([
      { from: '/media/font.ttf', to: '/out/intro_files/font.ttf' },
      { from: '/media/logo.png', to: '/out/intro_files/logo.png' },
      { from: '/media/other/logo.png', to: '/out/intro_files/logo (2).png' },
      { from: '/media/beep.wav', to: '/out/intro_files/beep.wav' },
    ]);
    expect(toFilePath({ path: '/media/other/logo.png', absolutePath: '/media/other/logo.png' })).toBe('intro_files/logo (2).png');
  });

  test('write with its files, read back from another folder, and place it', async () => {
    const mediaDir = path.join(dir, 'media');
    await createMedia(mediaDir);
    const def = makeDef(mediaDir);
    const blockFilePath = path.join(dir, 'out', 'Intro.vmxblock');
    await fs.mkdir(path.dirname(blockFilePath));
    await writeVmxBlockFile(deps, { blockFilePath, data: makeExport(def), includeFiles: true });
    expect((await fs.readdir(path.join(dir, 'out', 'Intro_files'))).sort()).toEqual(['beep.wav', 'font.ttf', 'logo (2).png', 'logo.png']);
    expect(await fs.readFile(path.join(dir, 'out', 'Intro_files', 'logo (2).png'), 'utf8')).toBe('other/logo.png');

    // moved elsewhere with its folder, the originals gone: still complete
    const moved = path.join(dir, 'moved');
    await fs.rename(path.join(dir, 'out'), moved);
    await fs.rm(mediaDir, { recursive: true });
    const template = await readVmxBlockFile(deps, path.join(moved, 'Intro.vmxblock'));
    expect(template).toMatchObject({ name: 'Intro', color: 3, originalStart: 7, variables: { round: '3' }, variableNames: ['round'], duration: 5.5 });
    expect(template.members.find((m) => m.id === 'logo2')).toMatchObject({ path: path.join(moved, 'Intro_files', 'logo (2).png'), absolutePath: path.join(moved, 'Intro_files', 'logo (2).png') });
    expect(await findMissingTemplateFiles(fs, template)).toEqual([]);

    const { def: newDef, block } = instantiateVmxBlock(template, { defId: 'd2', blockId: 'b2', placement: { kind: 'cursor', time: 2 } });
    expect(block).toEqual({ id: 'b2', defId: 'd2', anchor: { kind: 'absolute', time: 2 }, variables: { round: '3' } });
    expect(newDef.members.map((m) => m.id)).toEqual(def.members.map((m) => m.id));
  });

  test('a file to include that doesn\'t exist: nothing is written', async () => {
    const mediaDir = path.join(dir, 'media');
    await createMedia(mediaDir);
    await fs.rm(path.join(mediaDir, 'beep.wav'));
    const blockFilePath = path.join(dir, 'Intro.vmxblock');
    const promise = writeVmxBlockFile(deps, { blockFilePath, data: makeExport(makeDef(mediaDir)), includeFiles: true });
    await expect(promise).rejects.toBeInstanceOf(MissingVmxBlockFilesError);
    await expect(promise).rejects.toMatchObject({ missing: [path.join(mediaDir, 'beep.wav')] });
    expect(await fs.readdir(dir)).toEqual(['media']);
  });

  test('missing files of a template, and "Locate…" relinks every member using one', async () => {
    const mediaDir = path.join(dir, 'media');
    await createMedia(mediaDir);
    const blockFilePath = path.join(dir, 'Intro.vmxblock');
    await writeVmxBlockFile(deps, { blockFilePath, data: makeExport(makeDef(mediaDir)), includeFiles: false });
    await fs.rename(path.join(mediaDir, 'beep.wav'), path.join(dir, 'beep-moved.wav'));
    const template = await readVmxBlockFile(deps, blockFilePath);
    const missing = await findMissingTemplateFiles(fs, template);
    expect(missing).toEqual([{ kind: 'media', path: path.join(mediaDir, 'beep.wav') }]);
    const relinked = relinkTemplateFile(template, missing[0]!.path, path.join(dir, 'beep-moved.wav'));
    expect(relinked.members.filter((m) => m.type === 'sound').map((m) => m.type === 'sound' && m.absolutePath)).toEqual([path.join(dir, 'beep-moved.wav'), path.join(dir, 'beep-moved.wav')]);
    expect(await findMissingTemplateFiles(fs, relinked)).toEqual([]);
  });

  test('a hand-edited file with comments and trailing commas is read; a broken one gives every problem', async () => {
    const good = path.join(dir, 'hand.vmxblock');
    await fs.writeFile(good, `// made by hand
{
  format: 'videomix-block', version: 1, name: 'Hand', aspect: '9:16', originalStart: 0,
  members: [
    /* a text */
    { id: 't', type: 'text', name: 'T', anchor: { kind: 'absolute', time: 1 }, duration: 2, box: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
      text: 'Hi {{who|there}}', color: '#ffffff', align: 'center', lineSpacing: 0.2, fadeIn: 0, fadeOut: 0,
      border: { width: 4, color: '#000000' }, entry: { kind: 'none', duration: 0.5 }, },
  ],
}
`);
    const template = await readVmxBlockFile(deps, good);
    expect(template).toMatchObject({ name: 'Hand', aspect: '9:16', duration: 3, variables: { who: 'there' } });

    const bad = path.join(dir, 'bad.vmxblock');
    await fs.writeFile(bad, JSON.stringify({ format: 'videomix-block', version: 1, name: 'Bad', aspect: '4:3', originalStart: 0, members: [{ id: 'x', type: 'text', anchor: { kind: 'element', elementId: 'nope', edge: 'start', offset: 0 } }] }));
    const err = await readVmxBlockFile(deps, bad).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VmxBlockParseError);
    const paths = (err as VmxBlockParseError).issues.map((i) => i.path);
    expect(paths).toContain('aspect');
    expect(paths.some((x) => x.startsWith('members[0]'))).toBe(true);
  });

  test('library: sorted listing with invalid files reported, unique new names', async () => {
    const lib = path.join(dir, 'lib');
    expect(await listBlockLibrary(deps, lib)).toEqual([]);
    await fs.mkdir(lib);
    const mediaDir = path.join(dir, 'media');
    await createMedia(mediaDir);
    const first = await getNewLibraryFilePath(deps, lib, 'Intro');
    expect(first).toBe(path.join(lib, 'Intro.vmxblock'));
    await writeVmxBlockFile(deps, { blockFilePath: first, data: makeExport(makeDef(mediaDir)), includeFiles: true });
    // the name and its "_files" folder are taken
    expect(await getNewLibraryFilePath(deps, lib, 'intro')).toBe(path.join(lib, 'intro (2).vmxblock'));
    await fs.writeFile(path.join(lib, 'A broken.vmxblock'), '{ nope');
    await fs.writeFile(path.join(lib, 'notes.txt'), 'x');

    const entries = await listBlockLibrary(deps, lib);
    expect(entries.map((e) => e.fileName)).toEqual(['A broken.vmxblock', 'Intro.vmxblock']);
    expect(entries[0]!.error).toMatch(/JSON5/);
    expect(entries[1]!.template).toMatchObject({ name: 'Intro', duration: 5.5 });
  });

  test('what "Export" acts on: one block, or loose overlays only', () => {
    expect(getTemplateSelection(['b'], [])).toEqual({ blockId: 'b' });
    expect(getTemplateSelection([], ['o1', 'o2'])).toEqual({ overlayIds: ['o1', 'o2'] });
    expect(getTemplateSelection([], [])).toBeUndefined();
    expect(getTemplateSelection(['b', 'c'], [])).toBeUndefined();
    expect(getTemplateSelection(['b'], ['o1'])).toBeUndefined();
  });
});

describe('template picture (H3 thumbnail, T58)', () => {
  test('the central frame: what is visible at the middle, variables substituted, adapted to another aspect', () => {
    const members: MixOverlay[] = [
      { ...createTextOverlay({ id: 'early', name: 'Early', text: 'Early', start: 0 }), duration: 1 },
      { ...createTextOverlay({ id: 'mid', name: 'Mid', text: 'Hello {{who|you}}', start: 1 }), duration: 3, box: { x: 0.25, y: 0.4, width: 0.5, height: 0.2 } },
    ];
    const { ops, width, height, time } = getTemplatePreviewOps({ members, aspect: '16:9' }, { variables: { who: 'Ana' } });
    expect(time).toBe(2);
    expect({ width, height }).toEqual({ width: 1280, height: 720 });
    expect(ops).toHaveLength(1);
    const [op] = ops;
    expect(op).toMatchObject({ kind: 'text' });
    expect(JSON.stringify(op)).toContain('Hello Ana');

    const vertical = getTemplatePreviewOps({ members, aspect: '16:9' }, { aspect: '9:16' });
    expect({ width: vertical.width, height: vertical.height }).toEqual({ width: 720, height: 1280 });
    expect(JSON.stringify(vertical.ops[0])).toContain('Hello you');
  });
});
