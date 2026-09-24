import { describe, test, expect } from 'vitest';

import { rectContains } from './geometry';
import { createMixSource, mixProjectReducer } from './projectReducer';
import { getSourceFrameChange, rescaleClipRects } from './sourceResize';
import { createEmptyMixProject } from './types';
import type { MixClip, MixProject, Rect } from './types';

const isEven = (r: Rect) => [r.x, r.y, r.width, r.height].every((v) => v % 2 === 0);

describe('getSourceFrameChange', () => {
  const hd = { width: 1920, height: 1080 };

  test('no change: same size, or unknown on either side (first probe)', () => {
    expect(getSourceFrameChange(hd, hd)).toBeUndefined();
    expect(getSourceFrameChange({}, hd)).toBeUndefined();
    expect(getSourceFrameChange(hd, { width: 1280 })).toBeUndefined();
  });

  test('same proportion / different proportion', () => {
    expect(getSourceFrameChange(hd, { width: 1280, height: 720 })).toEqual({ from: hd, to: { width: 1280, height: 720 }, aspectChanged: false });
    expect(getSourceFrameChange(hd, { width: 1080, height: 1080 })).toMatchObject({ aspectChanged: true });
  });

  test('B1 upgrade of a source cached before v3 (coded size, no SAR): not a change', () => {
    expect(getSourceFrameChange({ width: 1280, height: 720 }, { width: 1358, height: 720, sar: { num: 679, den: 640 } })).toBeUndefined();
    expect(getSourceFrameChange({ width: 720, height: 1280 }, { width: 720, height: 1358, sar: { num: 640, den: 679 } })).toBeUndefined();
    // but a real change of size of an anamorphic file is
    expect(getSourceFrameChange({ width: 1358, height: 720, sar: { num: 679, den: 640 } }, { width: 1920, height: 1080, sar: { num: 1, den: 1 } })).toMatchObject({ aspectChanged: true });
  });
});

describe('rescaleClipRects', () => {
  test('same proportion: scaled with the frame', () => {
    const change = getSourceFrameChange({ width: 1920, height: 1080 }, { width: 1280, height: 720 })!;
    expect(rescaleClipRects({ maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, minRect: { x: 600, y: 0, width: 606, height: 1080 } }, change)).toEqual({
      maxRect: { x: 0, y: 0, width: 1280, height: 720 },
      minRect: { x: 400, y: 0, width: 404, height: 720 },
    });
    // 4K → 1080p
    const down = getSourceFrameChange({ width: 3840, height: 2160 }, { width: 1920, height: 1080 })!;
    expect(rescaleClipRects({ maxRect: { x: 1000, y: 200, width: 1216, height: 2160 - 200 } }, down)).toEqual({ maxRect: { x: 500, y: 100, width: 608, height: 980 }, minRect: undefined });
  });

  test('different proportion: the rects keep their own proportion, fitted into the frame, min ⊆ max, even', () => {
    const change = getSourceFrameChange({ width: 1920, height: 1080 }, { width: 1080, height: 1920 })!;
    expect(change.aspectChanged).toBe(true);
    const maxRect = { x: 0, y: 0, width: 1920, height: 1080 };
    const minRect = { x: 656, y: 0, width: 608, height: 1080 };
    const res = rescaleClipRects({ maxRect, minRect }, change);
    const frame = { x: 0, y: 0, width: 1080, height: 1920 };
    expect(rectContains(frame, res.maxRect)).toBe(true);
    expect(rectContains(res.maxRect, res.minRect!)).toBe(true);
    expect(isEven(res.maxRect) && isEven(res.minRect!)).toBe(true);
    // 16:9 kept, full width, centred vertically
    expect(res.maxRect).toEqual({ x: 0, y: 656, width: 1080, height: 608 });
    expect(Math.abs(res.minRect!.width / res.minRect!.height - minRect.width / minRect.height)).toBeLessThan(0.02);
  });

  test('a rect at the edge of a smaller frame stays inside it, at least MIN_RECT_SIZE', () => {
    const change = getSourceFrameChange({ width: 1920, height: 1080 }, { width: 641, height: 479 })!;
    const res = rescaleClipRects({ maxRect: { x: 1900, y: 1060, width: 20, height: 20 } }, change);
    expect(rectContains({ x: 0, y: 0, width: 640, height: 478 }, res.maxRect)).toBe(true);
    expect(res.maxRect.width).toBeGreaterThanOrEqual(16);
    expect(isEven(res.maxRect)).toBe(true);
  });
});

describe('relinkSource (reducer): B1 SAR and B2 rescale', () => {
  const clip = (id: string, sourceId: string, maxRect: Rect, minRect?: Rect): MixClip => ({
    id, sourceId, name: id, color: 0, start: 0, end: 4, maxRect, ...(minRect != null && { minRect }), muted: false, gainDb: 0,
  });
  const project = (): MixProject => ({
    ...createEmptyMixProject(),
    sources: [
      { ...createMixSource({ id: 's1', filePath: '/v/a.mp4', name: 'a.mp4' }), width: 1920, height: 1080 },
      { ...createMixSource({ id: 's2', filePath: '/v/b.mp4', name: 'b.mp4' }), width: 1920, height: 1080 },
    ],
    clips: [
      clip('c1', 's1', { x: 0, y: 0, width: 1920, height: 1080 }, { x: 600, y: 0, width: 606, height: 1080 }),
      clip('c2', 's2', { x: 0, y: 0, width: 1920, height: 1080 }),
    ],
  });

  test('a new size scales the clips of that source only', () => {
    const p = project();
    const next = mixProjectReducer(p, { type: 'relinkSource', sourceId: 's1', source: { path: '/v/a.mp4', absolutePath: '/v/a.mp4', width: 1280, height: 720, sar: { num: 1, den: 1 } } });
    expect(next.sources[0]).toEqual({ id: 's1', path: '/v/a.mp4', absolutePath: '/v/a.mp4', name: 'a.mp4', width: 1280, height: 720 });
    expect(next.clips[0]).toMatchObject({ maxRect: { x: 0, y: 0, width: 1280, height: 720 }, minRect: { x: 400, y: 0, width: 404, height: 720 } });
    expect(next.clips[1]).toBe(p.clips[1]);
  });

  test('square SAR is not stored; the same meta again is a no-op', () => {
    const p = project();
    expect(mixProjectReducer(p, { type: 'relinkSource', sourceId: 's1', source: { path: '/v/a.mp4', absolutePath: '/v/a.mp4', width: 1920, height: 1080, sar: { num: 1, den: 1 } } })).toBe(p);
    const withSar = mixProjectReducer(p, { type: 'relinkSource', sourceId: 's1', source: { path: '/v/a.mp4', absolutePath: '/v/a.mp4', sar: { num: 4, den: 3 } } });
    expect(withSar.sources[0]!.sar).toEqual({ num: 4, den: 3 });
    const square = mixProjectReducer(withSar, { type: 'relinkSource', sourceId: 's1', source: { path: '/v/a.mp4', absolutePath: '/v/a.mp4', sar: { num: 1, den: 1 } } });
    expect('sar' in square.sources[0]!).toBe(false);
  });

  test('the first known size and the pre-v3 SAR upgrade keep the rects', () => {
    const p = project();
    const unknown: MixProject = { ...p, sources: [createMixSource({ id: 's1', filePath: '/v/a.mp4', name: 'a.mp4' }), p.sources[1]!] };
    const first = mixProjectReducer(unknown, { type: 'relinkSource', sourceId: 's1', source: { path: '/v/a.mp4', absolutePath: '/v/a.mp4', width: 1280, height: 720 } });
    expect(first.clips).toBe(unknown.clips);

    // the user's case: cached as 1280x720 (coded), rect drawn over the 1358x720 <video>
    const userRect = { x: 78, y: 14, width: 1232, height: 694 };
    const old: MixProject = { ...p, sources: [{ ...p.sources[0]!, width: 1280, height: 720 }, p.sources[1]!], clips: [clip('c1', 's1', userRect)] };
    const upgraded = mixProjectReducer(old, { type: 'relinkSource', sourceId: 's1', source: { path: '/v/a.mp4', absolutePath: '/v/a.mp4', width: 1358, height: 720, sar: { num: 679, den: 640 } } });
    expect(upgraded.sources[0]).toMatchObject({ width: 1358, height: 720, sar: { num: 679, den: 640 } });
    expect(upgraded.clips).toBe(old.clips);
  });
});
