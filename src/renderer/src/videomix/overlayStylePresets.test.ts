import { describe, test, expect } from 'vitest';

import { overlayStylePresetSchema } from '../../../common/videomix/overlayStyles';
import { createCountdownOverlay, createProgressBarOverlay, createTextOverlay } from './overlays/factories';
import { getTextBlockHeight } from './overlays/textLayout';
import { createStylePreset, getStylePresetPatch, parseStylePresetsFile, sanitizeStylePresets, serializeStylePresets } from './overlayStylePresets';
import { mixProjectReducer as projectReducer } from './projectReducer';
import { createEmptyMixProject } from './types';
import type { MixOverlay, MixProject, TextOverlay } from './types';

const withOverlays = (overlays: MixOverlay[]): MixProject => ({ ...createEmptyMixProject(), overlays });

describe('style presets', () => {
  test('a preset keeps only the style: no times, anchor, box or text; fonts by absolute path', () => {
    const text: TextOverlay = {
      ...createTextOverlay({ id: 't', name: 'Title', start: 3, text: 'Hello' }),
      font: { path: 'fonts/a.ttf', absolutePath: '/p/fonts/a.ttf' },
      shadow: { x: 2, y: 2, color: '#000000' },
      entry: { kind: 'slide', from: 'left', duration: 1 },
    };
    const preset = createStylePreset(text, { id: 'p', name: 'Big title' });
    expect(preset).toEqual({
      id: 'p',
      name: 'Big title',
      type: 'text',
      style: {
        fontSize: text.fontSize,
        align: 'center',
        color: '#ffffff',
        font: { path: '/p/fonts/a.ttf', absolutePath: '/p/fonts/a.ttf' },
        border: text.border,
        shadow: text.shadow,
        lineSpacing: text.lineSpacing,
        fadeIn: text.fadeIn,
        fadeOut: text.fadeOut,
        entry: text.entry,
      },
    });
    // a text without an explicit size (v3 before T26): stored explicitly
    const legacy: TextOverlay = { ...text, box: { ...text.box, height: 0.2 } };
    delete legacy.fontSize;
    expect(createStylePreset(legacy, { id: 'p2', name: '' }).style).toMatchObject({ fontSize: 0.2 });

    const bar = createStylePreset(createProgressBarOverlay({ id: 'b', name: 'B', linkedCountdownId: 'c' }), { id: 'p3', name: 'Bar' });
    expect(Object.keys(bar.style).sort()).toEqual(['backgroundColor', 'border', 'direction', 'fillColor', 'mode']);
  });

  test('applying a preset replaces the whole style (also removing a font or shadow) and keeps the rest', () => {
    const styled = { ...createCountdownOverlay({ id: 'c1', name: 'A' }), color: '#ff0000', decimals: 2 as const, font: { path: '/a.ttf', absolutePath: '/a.ttf' }, shadow: { x: 1, y: 1, color: '#000000' } };
    const preset = createStylePreset(styled, { id: 'p', name: 'Red' });
    const plain = { ...createCountdownOverlay({ id: 'c2', name: 'B', start: 4 }), duration: 30 };
    const fromStyled = projectReducer(withOverlays([plain]), { type: 'updateOverlay', overlayId: 'c2', patch: getStylePresetPatch(plain, preset)! });
    expect(fromStyled.overlays[0]).toEqual({ ...plain, color: '#ff0000', decimals: 2, font: styled.font, shadow: styled.shadow });

    const back = projectReducer(fromStyled, { type: 'updateOverlay', overlayId: 'c2', patch: getStylePresetPatch(fromStyled.overlays[0] as typeof plain, createStylePreset(plain, { id: 'q', name: 'Plain' }))! });
    expect(back.overlays[0]).toEqual(plain);
    expect('font' in back.overlays[0]! || 'shadow' in back.overlays[0]!).toBe(false);

    // not across types
    expect(getStylePresetPatch(createTextOverlay({ id: 't', name: 'T', text: 'x' }), preset)).toBeUndefined();
  });

  test('a text preset refits the box to its size and spacing', () => {
    const big = { ...createTextOverlay({ id: 't1', name: 'A', text: 'x' }), fontSize: 0.2, lineSpacing: 0.5 };
    const small = createTextOverlay({ id: 't2', name: 'B', text: 'one\ntwo' });
    const patch = getStylePresetPatch(small, createStylePreset(big, { id: 'p', name: 'Big' }))!;
    const next = projectReducer(withOverlays([small]), { type: 'updateOverlay', overlayId: 't2', patch }).overlays[0] as TextOverlay;
    expect(next.text).toBe('one\ntwo');
    expect(next.fontSize).toBe(0.2);
    expect(next.box.height).toBeCloseTo(getTextBlockHeight(0.2, 2, 0.5), 10);
    expect(next.box.x).toBe(small.box.x);
  });

  test('stored list: invalid entries are dropped', () => {
    const valid = createStylePreset(createCountdownOverlay({ id: 'c', name: 'C' }), { id: 'p', name: 'C' });
    expect(sanitizeStylePresets([valid, { id: 'x', type: 'image' }, null, 'nope'])).toEqual([valid]);
    expect(sanitizeStylePresets(undefined)).toEqual([]);
  });

  test('export and import: new ids for existing ones, invalid entries skipped', () => {
    const a = createStylePreset(createCountdownOverlay({ id: 'c', name: 'C' }), { id: 'a', name: 'A' });
    const b = createStylePreset(createTextOverlay({ id: 't', name: 'T', text: 'x' }), { id: 'b', name: 'B' });
    const text = serializeStylePresets([a, b]);
    expect(JSON.parse(text)).toMatchObject({ format: 'videomix-overlay-styles', version: 1 });

    const newIds = ['new1', 'new2'];
    const imported = parseStylePresetsFile(text, [a], () => newIds.shift()!);
    expect(imported.presets).toEqual([{ ...a, id: 'new1' }, b]);
    expect(imported.skipped).toBe(0);
    imported.presets.forEach((p) => expect(overlayStylePresetSchema.parse(p)).toEqual(p));

    const withBad = JSON.stringify({ format: 'videomix-overlay-styles', version: 1, presets: [a, { type: 'text' }] });
    expect(parseStylePresetsFile(withBad, [], () => 'x')).toEqual({ presets: [a], skipped: 1 });

    expect(() => parseStylePresetsFile('{"presets": []}', [], () => 'x')).toThrow();
    expect(() => parseStylePresetsFile('not json', [], () => 'x')).toThrow();
  });
});
