import { describe, expect, test } from 'vitest';

import {
  applyOverlayBoxDrag,
  getAnchorOfKind,
  getImageBox,
  refitImageOverlayBox,
  getOverlayFrameBoxes,
  getOverlayLane,
  getOverlayMovePatch,
  getOverlayResizePatch,
  joinOverlayColor,
  layoutOverlayLanes,
  pixelsToSeconds,
  splitOverlayColor,
} from './overlayTimeline';
import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay, createSoundOverlay } from './overlays/factories';
import type { MixOverlay } from './types';

const times = (start: number, end: number) => ({ start, end, rawStart: start, rawEnd: end });

const img = (id: string, time = 0): MixOverlay => createImageOverlay({ id, name: id, filePath: '/a.png', start: time });
const cd = (id: string): MixOverlay => ({ ...createCountdownOverlay({ id, name: id }), anchor: { kind: 'clip', clipId: 'c1', edge: 'end', offset: 1.5 } });
const bar = (id: string, linkedCountdownId?: string): MixOverlay => createProgressBarOverlay({ id, name: id, linkedCountdownId });
const snd = (id: string): MixOverlay => createSoundOverlay({ id, name: id, filePath: '/a.wav' });

describe('lanes', () => {
  test('overlay types go to their lane', () => {
    expect(getOverlayLane('image')).toBe('images');
    expect(getOverlayLane('countdown')).toBe('countdownsAndBars');
    expect(getOverlayLane('progressBar')).toBe('countdownsAndBars');
    expect(getOverlayLane('sound')).toBe('sounds');
  });

  test('blocks overlapping in time get their own row, the others reuse rows', () => {
    const overlays = [img('a'), img('b'), img('c'), cd('d'), snd('s')];
    const resolved = new Map([['a', times(0, 5)], ['b', times(2, 6)], ['c', times(5, 8)], ['d', times(1, 2)], ['s', times(3, 3)]]);
    const [images, countdowns, sounds] = layoutOverlayLanes(overlays, resolved, { minDuration: 0.5 });
    expect(images).toEqual({
      lane: 'images',
      rows: 2,
      items: [
        { overlayId: 'a', start: 0, end: 5, row: 0 },
        { overlayId: 'b', start: 2, end: 6, row: 1 },
        { overlayId: 'c', start: 5, end: 8, row: 0 },
      ],
    });
    expect(countdowns?.rows).toBe(1);
    expect(sounds?.items).toEqual([{ overlayId: 's', start: 3, end: 3, row: 0 }]);
  });

  test('a 0 s block still takes minDuration when packing', () => {
    const overlays = [snd('s1'), snd('s2')];
    const resolved = new Map([['s1', times(3, 3)], ['s2', times(3.2, 4)]]);
    expect(layoutOverlayLanes(overlays, resolved, { minDuration: 0.5 })[2]?.items.map((i) => i.row)).toEqual([0, 1]);
    expect(layoutOverlayLanes(overlays, resolved)[2]?.items.map((i) => i.row)).toEqual([0, 0]);
  });

  test('empty lanes have one row', () => {
    expect(layoutOverlayLanes([], new Map()).map((l) => l.rows)).toEqual([1, 1, 1]);
  });
});

describe('block drags', () => {
  test('pixels to seconds', () => {
    expect(pixelsToSeconds(50, 500, 20)).toBe(2);
    expect(pixelsToSeconds(50, 0, 20)).toBe(0);
  });

  test('moving an absolute overlay changes its time, not below 0', () => {
    const overlay = img('a', 4);
    expect(getOverlayMovePatch({ start: overlay, rawStart: 4, dt: 1.234, overlays: [overlay] })).toEqual({ anchor: { kind: 'absolute', time: 5.23 } });
    expect(getOverlayMovePatch({ start: overlay, rawStart: 4, dt: -10, overlays: [overlay] })).toEqual({ anchor: { kind: 'absolute', time: 0 } });
  });

  test('moving an anchored overlay changes its offset, keeping the anchor', () => {
    const overlay = cd('d');
    expect(getOverlayMovePatch({ start: overlay, rawStart: 9.5, dt: -2, overlays: [overlay] })).toEqual({ anchor: { kind: 'clip', clipId: 'c1', edge: 'end', offset: -0.5 } });
    // the start can't go before the start of the video: offset down to -rawStart
    expect(getOverlayMovePatch({ start: overlay, rawStart: 9.5, dt: -20, overlays: [overlay] })).toEqual({ anchor: { kind: 'clip', clipId: 'c1', edge: 'end', offset: -8 } });
  });

  test('a linked bar can be neither moved nor resized, an unlinked one can', () => {
    const countdown = cd('d');
    const linked = bar('b', 'd');
    const overlays = [countdown, linked];
    expect(getOverlayMovePatch({ start: linked, rawStart: 0, dt: 1, overlays })).toBeUndefined();
    expect(getOverlayResizePatch({ start: linked, dt: 1, overlays })).toBeUndefined();
    // linked to a missing countdown: it uses its own times
    expect(getOverlayResizePatch({ start: linked, dt: 1, overlays: [linked] })).toEqual({ duration: 11 });
  });

  test('resizing changes the duration, with a minimum; not for sounds', () => {
    const overlay = img('a');
    expect(getOverlayResizePatch({ start: overlay, dt: 1.5, overlays: [overlay] })).toEqual({ duration: 6.5 });
    expect(getOverlayResizePatch({ start: overlay, dt: -10, overlays: [overlay] })).toEqual({ duration: 0.1 });
    expect(getOverlayResizePatch({ start: snd('s'), dt: 1, overlays: [] })).toBeUndefined();
  });
});

describe('getAnchorOfKind', () => {
  const current = { kind: 'clip' as const, clipId: 'c1', edge: 'end' as const, offset: 1 };
  test('to absolute keeps the current start', () => {
    expect(getAnchorOfKind('absolute', { current, rawStart: 7.456, targetId: undefined })).toEqual({ kind: 'absolute', time: 7.46 });
    expect(getAnchorOfKind('absolute', { current, rawStart: -1, targetId: undefined })).toEqual({ kind: 'absolute', time: 0 });
  });
  test('to anchored starts at the target start', () => {
    expect(getAnchorOfKind('element', { current, rawStart: 7, targetId: 'x' })).toEqual({ kind: 'element', elementId: 'x', edge: 'start', offset: 0 });
    expect(getAnchorOfKind('clip', { current: { kind: 'absolute', time: 1 }, rawStart: 1, targetId: 'c2' })).toEqual({ kind: 'clip', clipId: 'c2', edge: 'start', offset: 0 });
    expect(getAnchorOfKind('clip', { current: { kind: 'absolute', time: 1 }, rawStart: 1, targetId: undefined })).toBeUndefined();
  });
  test('same kind is unchanged', () => {
    expect(getAnchorOfKind('clip', { current, rawStart: 7, targetId: 'c2' })).toBe(current);
  });
});

describe('mini frame', () => {
  const overlays = [img('a'), snd('s'), bar('b'), img('hidden')];
  const resolved = new Map([['a', times(0, 5)], ['s', times(0, 5)], ['b', times(2, 12)], ['hidden', times(8, 9)]]);

  test('visual overlays on screen at a time, in layer order, with their progress', () => {
    const boxes = getOverlayFrameBoxes(overlays, resolved, 4);
    expect(boxes.map((b) => [b.overlay.id, b.visible, b.progress, b.elapsed])).toEqual([['a', true, 0.8, 4], ['b', true, 0.2, 2]]);
  });

  test('the end is exclusive, and the selected overlay is always there', () => {
    const boxes = getOverlayFrameBoxes(overlays, resolved, 5, 'hidden');
    expect(boxes.map((b) => [b.overlay.id, b.visible])).toEqual([['b', true], ['hidden', false]]);
  });

  test('box drags reuse the rect math in output px, and stay inside the frame', () => {
    const frame = { width: 1000, height: 500 };
    const start = { x: 0.1, y: 0.2, width: 0.2, height: 0.2 };
    expect(applyOverlayBoxDrag({ start, handle: 'move', dx: 100, dy: 50, frame })).toEqual({ x: 0.2, y: 0.3, width: 0.2, height: 0.2 });
    expect(applyOverlayBoxDrag({ start, handle: 'move', dx: 5000, dy: -5000, frame })).toEqual({ x: 0.8, y: 0, width: 0.2, height: 0.2 });
    expect(applyOverlayBoxDrag({ start, handle: 'se', dx: 100, dy: 100, frame })).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
    // not smaller than 16 px
    expect(applyOverlayBoxDrag({ start, handle: 'e', dx: -1000, dy: 0, frame }).width).toBeCloseTo(16 / 1000);
  });

  test('aspect-locked box drag', () => {
    const frame = { width: 1000, height: 500 };
    const box = applyOverlayBoxDrag({ start: { x: 0, y: 0, width: 0.2, height: 0.2 }, handle: 'se', dx: 200, dy: 0, frame, aspect: 2 });
    expect((box.width * frame.width) / (box.height * frame.height)).toBeCloseTo(2, 1);
  });

  test('image box keeps the image proportion on the output frame', () => {
    const box = getImageBox({ width: 400, height: 200 }, { width: 1920, height: 1080 }, 0.3);
    expect(box.width).toBe(0.3);
    expect(box.height * 1080).toBeCloseTo((0.3 * 1920) / 2);
    expect(box.x).toBeCloseTo(0.35);
    // too tall: scaled down to the frame height
    const tall = getImageBox({ width: 100, height: 1000 }, { width: 1920, height: 1080 }, 0.3);
    expect(tall.height).toBe(1);
    expect(tall.y).toBe(0);
    expect(tall.width * 1920).toBeCloseTo(108);
  });

  test('refitImageOverlayBox keeps the image proportion and the box center after an aspect change', () => {
    const box = { x: 0.2, y: 0.4, width: 0.4, height: 0.1 };
    const refitted = refitImageOverlayBox(box, { width: 400, height: 200 }, { width: 1080, height: 1920 });
    expect(refitted.width).toBeCloseTo(0.4);
    expect(refitted.height).toBeCloseTo((0.4 * 1080 * 200) / (400 * 1920));
    expect(refitted.x + refitted.width / 2).toBeCloseTo(box.x + box.width / 2);
    expect(refitted.y + refitted.height / 2).toBeCloseTo(box.y + box.height / 2);
    // too tall for the new frame: scaled down, still centered
    const tall = refitImageOverlayBox({ x: 0.1, y: 0.1, width: 0.5, height: 0.05 }, { width: 100, height: 1000 }, { width: 1920, height: 1080 });
    expect(tall.height).toBeCloseTo(1);
    expect(tall.y + tall.height / 2).toBeCloseTo(0.125);
    // invalid input: box unchanged
    expect(refitImageOverlayBox(box, { width: 0, height: 200 }, { width: 1080, height: 1920 })).toBe(box);
  });
});

describe('texts and colors', () => {
  test('colors with alpha', () => {
    expect(splitOverlayColor('#ff0000')).toEqual({ rgb: '#ff0000', alpha: 1 });
    expect(splitOverlayColor('#00000080')).toEqual({ rgb: '#000000', alpha: 128 / 255 });
    expect(joinOverlayColor('#000000', 0.5)).toBe('#00000080');
    expect(joinOverlayColor('#FFFFFF', 1)).toBe('#ffffff');
    expect(joinOverlayColor('#000000', 0)).toBe('#00000000');
  });
});
