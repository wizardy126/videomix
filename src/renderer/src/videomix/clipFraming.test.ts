import { describe, test, expect } from 'vitest';

import { copyClipFraming, getPasteFramingAction, getPasteFramingPatch } from './clipFraming';
import { mixProjectReducer } from './projectReducer';
import { createEmptyMixProject } from './types';
import type { MixClip, MixProject } from './types';

function makeClip(id: string, overrides: Partial<MixClip> = {}): MixClip {
  return { id, sourceId: 's1', name: id, color: 0, start: 10, end: 20, maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, muted: false, gainDb: 0, ...overrides };
}

const framed = makeClip('a', {
  maxRect: { x: 960, y: 0, width: 960, height: 1080 },
  minRect: { x: 1200, y: 200, width: 480, height: 600 },
  keyframes: [{ time: 10, centerX: 1440, centerY: 540, scale: 1 }, { time: 14, centerX: 1200, centerY: 540, scale: 0.5, interpolation: 'linear' }],
  extendBeyondMax: false,
  muted: true,
  gainDb: 3,
});

function makeProject(): MixProject {
  return {
    ...createEmptyMixProject(),
    sources: [
      { id: 's1', path: '/a.mp4', absolutePath: '/a.mp4', name: 'a.mp4', width: 1920, height: 1080 },
      { id: 's2', path: '/b.mp4', absolutePath: '/b.mp4', name: 'b.mp4', width: 1280, height: 720 },
      { id: 's3', path: '/c.mp4', absolutePath: '/c.mp4', name: 'c.mp4', width: 1440, height: 1080 },
      { id: 's4', path: '/d.mp4', absolutePath: '/d.mp4', name: 'd.mp4' },
    ],
    clips: [
      framed,
      makeClip('same', { start: 0, end: 5, rotation: 90, keyframes: [{ time: 1, centerX: 0, centerY: 0, scale: 1 }] }),
      makeClip('smaller', { sourceId: 's2', start: 2, end: 8, maxRect: { x: 0, y: 0, width: 1280, height: 720 } }),
      makeClip('other-aspect', { sourceId: 's3', maxRect: { x: 0, y: 0, width: 1440, height: 1080 } }),
      makeClip('unknown', { sourceId: 's4' }),
    ],
  };
}

describe('copyClipFraming', () => {
  test('keeps max, min, turn, keyframes, the frame and the start', () => {
    const framing = copyClipFraming(framed, { width: 1920, height: 1080 });
    expect(framing).toEqual({
      maxRect: framed.maxRect, minRect: framed.minRect, rotation: 0, keyframes: framed.keyframes, frame: { width: 1920, height: 1080 }, start: 10,
    });
    // a copy, not the clip's objects
    expect(framing!.maxRect).not.toBe(framed.maxRect);
  });

  test('turned clip: the turned frame; unknown source size: nothing to copy', () => {
    expect(copyClipFraming(makeClip('t', { rotation: 90, maxRect: { x: 0, y: 0, width: 1080, height: 1920 } }), { width: 1920, height: 1080 })).toMatchObject({ rotation: 90, frame: { width: 1080, height: 1920 } });
    expect(copyClipFraming(framed, {})).toBeUndefined();
  });
});

describe('paste', () => {
  const framing = copyClipFraming(framed, { width: 1920, height: 1080 })!;

  test('same size: as is; keyframes shifted to keep their offset from the clip start; turn, min and keyframes replaced', () => {
    const pasted = getPasteFramingPatch(framing, { start: 0 }, { width: 1920, height: 1080 });
    expect(pasted).toEqual({
      patch: {
        maxRect: framed.maxRect,
        minRect: framed.minRect,
        rotation: undefined,
        keyframes: [{ time: 0, centerX: 1440, centerY: 540, scale: 1 }, { time: 4, centerX: 1200, centerY: 540, scale: 0.5, interpolation: 'linear' }],
      },
      aspectChanged: false,
    });
    // pasting a framing without min or keyframes clears them
    const plain = copyClipFraming(makeClip('p'), { width: 1920, height: 1080 })!;
    expect(getPasteFramingPatch(plain, framed, { width: 1920, height: 1080 })!.patch).toEqual({ maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, minRect: undefined, rotation: undefined, keyframes: undefined });
  });

  test('another size with the same proportion: scaled with the frame', () => {
    const pasted = getPasteFramingPatch(framing, { start: 2 }, { width: 1280, height: 720 })!;
    expect(pasted.aspectChanged).toBe(false);
    expect(pasted.patch.maxRect).toEqual({ x: 640, y: 0, width: 640, height: 720 });
    expect(pasted.patch.minRect).toEqual({ x: 800, y: 134, width: 320, height: 400 });
    expect(pasted.patch.keyframes).toEqual([{ time: 2, centerX: 960, centerY: 360, scale: 1 }, { time: 6, centerX: 800, centerY: 360, scale: 0.5, interpolation: 'linear' }]);
  });

  test('another proportion: fitted into the frame, with a warning', () => {
    const pasted = getPasteFramingPatch(framing, { start: 10 }, { width: 1440, height: 1080 })!;
    expect(pasted.aspectChanged).toBe(true);
    const { maxRect, minRect } = pasted.patch;
    expect(maxRect!.x + maxRect!.width).toBeLessThanOrEqual(1440);
    // keeps its own proportion
    expect(maxRect!.width / maxRect!.height).toBeCloseTo(960 / 1080, 1);
    expect(minRect!.x).toBeGreaterThanOrEqual(maxRect!.x);
  });

  test('the turn goes with the framing: its rects live in the turned frame of the target', () => {
    const turned = copyClipFraming(makeClip('t', { rotation: 90, maxRect: { x: 0, y: 0, width: 1080, height: 960 } }), { width: 1920, height: 1080 })!;
    expect(getPasteFramingPatch(turned, { start: 0 }, { width: 1280, height: 720 })!.patch).toMatchObject({ rotation: 90, maxRect: { x: 0, y: 0, width: 720, height: 640 } });
  });

  test('several clips as one batch; unknown sizes and ids are skipped', () => {
    const project = makeProject();
    const { action, aspectChangedClipIds, skippedClipIds } = getPasteFramingAction({ project, framing, clipIds: ['same', 'smaller', 'other-aspect', 'unknown', 'nope', 'same'] });
    expect(aspectChangedClipIds).toEqual(['other-aspect']);
    expect(skippedClipIds).toEqual(['unknown', 'nope']);
    expect(action?.type).toBe('batch');
    const next = mixProjectReducer(project, action!);
    const same = next.clips.find((c) => c.id === 'same')!;
    // not copied: E7 flag and audio; the turn is replaced (none)
    expect(same).toEqual({ ...makeClip('same', { start: 0, end: 5 }), maxRect: framed.maxRect, minRect: framed.minRect, keyframes: [{ time: 0, centerX: 1440, centerY: 540, scale: 1 }, { time: 4, centerX: 1200, centerY: 540, scale: 0.5, interpolation: 'linear' }] });
    expect('rotation' in same).toBe(false);
    expect(getPasteFramingAction({ project, framing, clipIds: ['unknown'] }).action).toBeUndefined();
  });
});
