import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { describe, expect, test } from 'vitest';

import type { OverlayFile } from '../types';
import { instantiateVmxBlock, parseVmxBlockFile } from './vmxBlockFile';
import { getBlockDefTimes } from './expandBlocks';
import { getBlockDefVariables } from './blockVariables';

// T59: the hand-edited .vmxblock examples of the format guide (docs/videomix/guia-vmxblock.md) must actually parse
// and instantiate, so the guide never drifts from what parseVmxBlockFile accepts. resolveFile only needs to return
// something (existence of the referenced files is the caller's job, not the parser's, see vmxBlockFile.ts).
const examplePath = (name: string) => fileURLToPath(new URL(`../../../../../docs/videomix/ejemplos/${name}`, import.meta.url));
const resolveFile = (path: string): OverlayFile => ({ path, absolutePath: path });

describe('.vmxblock examples (docs/videomix/ejemplos)', () => {
  test('rotulo-ejercicio.vmxblock: two texts with variables ({{exercise|default}} and {{reps}})', () => {
    const text = readFileSync(examplePath('rotulo-ejercicio.vmxblock'), 'utf8');
    const template = parseVmxBlockFile(text, { resolveFile });
    expect(template).toMatchObject({ name: 'Rótulo de ejercicio', aspect: '9:16', members: expect.arrayContaining([expect.objectContaining({ id: 'title' })]) });
    expect(template.variableNames).toEqual(['exercise', 'reps']);
    // the top-level "variables" default wins over the text's own "|default" for "exercise", and fills "reps" (no default in the text)
    expect(template.variables).toEqual({ exercise: 'Sentadillas', reps: '3 series x 12' });
    expect(getBlockDefVariables({ members: template.members })).toEqual([
      { name: 'exercise', defaultValue: 'Sentadillas' },
      { name: 'reps', defaultValue: undefined },
    ]);
    // "subtitle" anchors to "title" (another member), not to a clip: resolved relative to the block, not the project
    const times = getBlockDefTimes({ members: template.members });
    expect(times.get('subtitle')).toMatchObject({ start: 0.2 });

    const { def, block } = instantiateVmxBlock(template, { defId: nanoid(), blockId: nanoid(), placement: { kind: 'cursor', time: 10 } });
    expect(def.members).toHaveLength(2);
    expect(block.anchor).toEqual({ kind: 'absolute', time: 10 });
    expect(block.variables).toEqual(template.variables);
  });

  test('descanso.vmxblock: a countdown, a bar linked to it, a text and a beep anchored to the countdown\'s end', () => {
    const text = readFileSync(examplePath('descanso.vmxblock'), 'utf8');
    const template = parseVmxBlockFile(text, { resolveFile });
    expect(template).toMatchObject({ name: 'Descanso', aspect: '16:9', duration: 15 });
    expect(template.members.map((m) => m.id)).toEqual(['label', 'cd', 'bar', 'beep']);
    const bar = template.members.find((m) => m.id === 'bar');
    expect(bar).toMatchObject({ type: 'progressBar', linkedCountdownId: 'cd' });
    const beep = template.members.find((m) => m.id === 'beep');
    expect(beep).toMatchObject({ type: 'sound', anchor: { kind: 'element', elementId: 'cd', edge: 'end', offset: 0 } });

    // adapted to a project's 9:16, as the "Adapt" checkbox of the import dialog would do (H7)
    const { def } = instantiateVmxBlock(template, { defId: nanoid(), blockId: nanoid(), placement: { kind: 'original' }, adaptTo: '9:16' });
    expect(def.members).toHaveLength(4);
  });
});
