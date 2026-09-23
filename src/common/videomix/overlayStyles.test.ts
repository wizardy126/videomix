// eslint-disable-next-line import/no-extraneous-dependencies
import { describe, expect, test } from 'vitest';

import { overlayStyleKeys, overlayStylePresetSchema } from './overlayStyles.ts';

describe('overlay style presets', () => {
  test('parse a preset of each type', () => {
    const border = { width: 4, color: '#000000' };
    const presets = [
      {
        id: 'p1',
        name: 'Title',
        type: 'text',
        style: {
          align: 'left',
          color: '#ffffff',
          border,
          shadow: { x: 2, y: 2, color: '#00000080' },
          lineSpacing: 0.2,
          fadeIn: 0.5,
          fadeOut: 0.5,
          entry: { kind: 'slide', from: 'left', duration: 0.6 },
          font: { path: '/f.ttf', absolutePath: '/f.ttf' },
        },
      },
      { id: 'p2', name: 'Timer', type: 'countdown', style: { align: 'right', decimals: 1, leadingZeros: true, color: '#ffcc00', border, fadeOut: 0 } },
      { id: 'p3', name: 'Bar', type: 'progressBar', style: { fillColor: '#ffffff', backgroundColor: '#00000000', border, direction: 'rtl', mode: 'empty' } },
    ];
    presets.forEach((preset) => expect(overlayStylePresetSchema.parse(preset)).toEqual(preset));
  });

  test('a preset has no times, anchor, box or text', () => {
    Object.values(overlayStyleKeys).forEach((keys) => {
      ['id', 'name', 'type', 'anchor', 'duration', 'box', 'text', 'linkedCountdownId'].forEach((key) => expect(keys).not.toContain(key));
    });
    expect(() => overlayStylePresetSchema.parse({ id: 'p', name: '', type: 'image', style: {} })).toThrow();
    expect(() => overlayStylePresetSchema.parse({ id: 'p', name: '', type: 'countdown', style: { align: 'right' } })).toThrow();
  });
});
