import { describe, test, expect } from 'vitest';

import { OVERLAY_MARGIN, createCountdownOverlay, createProgressBarOverlay, getOverlayBoxPreset, overlayPxToOutput } from './factories';
import { mixOverlaySchema } from '../types';

describe('overlay factories', () => {
  test('box presets', () => {
    const size = { width: 0.2, height: 0.1 };
    expect(getOverlayBoxPreset('topLeft', size)).toEqual({ x: OVERLAY_MARGIN, y: OVERLAY_MARGIN, ...size });
    expect(getOverlayBoxPreset('bottomRight', size, 0)).toEqual({ x: 0.8, y: 0.9, ...size });
    expect(getOverlayBoxPreset('center', size)).toEqual({ x: 0.4, y: 0.45, ...size });
    expect(getOverlayBoxPreset('fullScreen', size)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  test('defaults match the schema', () => {
    const countdown = createCountdownOverlay({ id: 'c', name: 'Countdown', start: -1 });
    expect(mixOverlaySchema.parse(countdown)).toEqual(countdown);
    expect(countdown).toMatchObject({ duration: 10, color: '#ffffff', border: { color: '#000000' }, anchor: { kind: 'absolute', time: 0 } });
    expect(countdown.box.x + countdown.box.width).toBeCloseTo(1 - OVERLAY_MARGIN);

    const bar = createProgressBarOverlay({ id: 'b', name: 'Bar', linkedCountdownId: 'c' });
    expect(mixOverlaySchema.parse(bar)).toEqual(bar);
    expect(bar.box.x + bar.box.width).toBeCloseTo(1 - OVERLAY_MARGIN);
    expect(bar.box.y + bar.box.height).toBeCloseTo(1 - OVERLAY_MARGIN);
    expect('linkedCountdownId' in createProgressBarOverlay({ id: 'b', name: 'Bar' })).toBe(false);
  });

  test('reference px', () => {
    expect(overlayPxToOutput(4, 1080)).toBe(4);
    expect(overlayPxToOutput(4, 720)).toBeCloseTo(2.667, 3);
  });
});
