import { describe, expect, test } from 'vitest';

import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay, createSoundOverlay, createTextOverlay } from '../overlays/factories';
import { getOverlayPixelBox } from '../overlays/overlayFrames';
import type { ResolvedOverlayTimes } from '../overlays/resolveOverlayTimes';
import type { MixOverlay } from '../types';
import { getPreviewOverlayOps, getProgressBarFillRect } from './previewOverlays';

const W = 1920;
const H = 1080;
const fps = 30;
const times = (entries: [string, number, number][]): ResolvedOverlayTimes => new Map(entries.map(([id, start, end]) => [id, { start, end, rawStart: start, rawEnd: end, warnings: [] }]));
const ops = (overlays: MixOverlay[], resolved: ResolvedOverlayTimes, time: number) => getPreviewOverlayOps({ overlays, resolved, time, fps, width: W, height: H });

describe('getPreviewOverlayOps', () => {
  test('visible overlays in layer order, with the render px boxes; sounds are not drawn', () => {
    const image = createImageOverlay({ id: 'img', name: 'img', filePath: '/logo.png' });
    const countdown = createCountdownOverlay({ id: 'cd', name: 'cd' });
    const sound = createSoundOverlay({ id: 'snd', name: 'snd', filePath: '/beep.wav' });
    const resolved = times([['img', 0, 5], ['cd', 2, 12], ['snd', 0, 1]]);
    expect(ops([image, countdown, sound], resolved, 1).map((op) => op.id)).toEqual(['img']);
    const both = ops([image, countdown, sound], resolved, 3);
    expect(both.map((op) => op.id)).toEqual(['img', 'cd']);
    expect(both[0]).toEqual({ kind: 'image', id: 'img', path: '/logo.png', rect: getOverlayPixelBox(image.box, W, H), alpha: 1 });
    expect(ops([image], resolved, 5)).toEqual([]);
  });

  test('image fades (linear, from the raw start/end)', () => {
    const image = createImageOverlay({ id: 'img', name: 'img', filePath: '/logo.png' });
    const resolved = times([['img', 1, 6]]);
    // frame-based like the render: frame 37 is 7 frames into a 15-frame fade, frame 172 is 8 frames before the end
    const alpha = (time: number) => {
      const [op] = ops([image], resolved, time);
      return op?.kind === 'image' ? op.alpha : undefined;
    };
    expect(alpha(1.25)).toBeCloseTo(7 / 15);
    expect(alpha(5.75)).toBeCloseTo(8 / 15);
  });

  test('countdown: the render text, box-height font, centred in the box', () => {
    const countdown = { ...createCountdownOverlay({ id: 'cd', name: 'cd' }), fadeOut: 1 };
    const resolved = times([['cd', 0, 10]]);
    const [op] = ops([countdown], resolved, 0);
    const box = getOverlayPixelBox(countdown.box, W, H);
    expect(op).toMatchObject({ kind: 'text', align: 'right', lines: [{ text: '10', full: '10', cy: box.y + box.height / 2 }], alpha: 1 });
    expect(op?.kind === 'text' && op.style).toEqual({ fontPath: undefined, fontSize: Math.round(countdown.box.height * H), color: '#ffffff', borderWidth: 4, borderColor: '#000000', shadow: undefined });
    expect(ops([countdown], resolved, 9.5)[0]).toMatchObject({ lines: [{ text: '1' }], alpha: 0.5 });
  });

  test('text: lines centred like the render, typewriter prefix aligned as the whole line, slide offset', () => {
    const text = { ...createTextOverlay({ id: 't', name: 't', text: 'Hello\nWorld' }), entry: { kind: 'typewriter' as const, duration: 1 } };
    const resolved = times([['t', 0, 5]]);
    // 10 characters over 30 frames: at frame 14, 5 are shown
    const [op] = ops([text], resolved, 14 / fps);
    expect(op?.kind === 'text' && op.lines.map((l) => [l.text, l.full])).toEqual([['Hello', 'Hello']]);
    const [later] = ops([text], resolved, 17 / fps);
    expect(later?.kind === 'text' && later.lines.map((l) => [l.text, l.full])).toEqual([['Hello', 'Hello'], ['W', 'World']]);
    if (later?.kind === 'text') expect(later.lines[1]!.cy - later.lines[0]!.cy).toBeCloseTo(Math.round(0.08 * H) * 1.2);

    const slide = { ...text, entry: { kind: 'slide' as const, from: 'left' as const, duration: 1 }, fadeIn: 0 };
    const [start] = ops([slide], resolved, 0);
    // fully out of the frame to the left at its first frame
    expect(start?.kind === 'text' && start.dx).toBeCloseTo(-(slide.box.x + slide.box.width) * W);
    expect(ops([slide], resolved, 2)[0]).toMatchObject({ dx: 0, dy: 0 });
  });

  test('progress bar: fill from the growing side inside the border', () => {
    const bar = createProgressBarOverlay({ id: 'bar', name: 'bar' });
    const [op] = ops([bar], times([['bar', 0, 10]]), 5);
    const box = getOverlayPixelBox(bar.box, W, H);
    expect(op).toMatchObject({ kind: 'bar', box, border: 2, fill: { x: box.x + 2, y: box.y + 2, width: Math.round((box.width - 4) * 0.5), height: box.height - 4 } });

    const inner = { x: 0, y: 0, width: 100, height: 40 };
    const frames = { rawStart: 0, rawEnd: 100 };
    expect(getProgressBarFillRect({ direction: 'rtl', mode: 'fill' }, inner, frames, 25)).toEqual({ x: 75, y: 0, width: 25, height: 40 });
    expect(getProgressBarFillRect({ direction: 'btt', mode: 'empty' }, inner, frames, 25)).toEqual({ x: 0, y: 10, width: 100, height: 30 });
    expect(getProgressBarFillRect({ direction: 'ttb', mode: 'fill' }, inner, frames, 0)).toBeUndefined();
  });
});
