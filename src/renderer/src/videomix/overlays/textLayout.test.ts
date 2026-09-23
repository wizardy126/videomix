import { describe, test, expect } from 'vitest';

import { createTextOverlay } from './factories';
import {
  fitTextBox, getSlideOffset, getSlideRemaining, getTextBlockHeight, getTextLineCenters, getTextOpacity, getTextOverlayFontSize, getTextOverlayLayoutPatch,
  getTypewriterCount, getTypewriterFirstFrame, getTypewriterStages, splitGraphemes, splitTextLines,
} from './textLayout';

describe('text layout', () => {
  test('lines', () => {
    expect(splitTextLines('a\r\nb\tc\n')).toEqual(['a', 'b    c', '']);
    expect(splitGraphemes('é🎉👍🏽a')).toHaveLength(4);
  });

  test('font size: explicit, or derived from the box (v3 before T26)', () => {
    const box = { x: 0, y: 0, width: 1, height: 0.1 };
    expect(getTextOverlayFontSize({ text: 'a\nb', box, lineSpacing: 0.5, fontSize: 0.03 })).toBe(0.03);
    expect(getTextOverlayFontSize({ text: 'a\nb', box, lineSpacing: 0.5 })).toBeCloseTo(0.1 / 2.5, 10);
    expect(getTextBlockHeight(0.04, 2, 0.5)).toBeCloseTo(0.1, 10);
    expect(getTextBlockHeight(0.04, 1, 0.5)).toBeCloseTo(0.04, 10);
  });

  test('adding a line grows the box and keeps the size', () => {
    const overlay = createTextOverlay({ id: 't', name: 'T', text: 'One' });
    expect(overlay.box.height).toBeCloseTo(overlay.fontSize!, 10);
    const patch = getTextOverlayLayoutPatch(overlay, { text: 'One\nTwo' });
    expect(patch.fontSize).toBe(overlay.fontSize);
    expect(patch.box).toEqual({ ...overlay.box, height: getTextBlockHeight(overlay.fontSize!, 2, overlay.lineSpacing) });
    expect(getTextOverlayFontSize({ ...overlay, ...patch })).toBe(overlay.fontSize);

    // a legacy overlay (no fontSize) keeps the size it had
    const legacy = { ...overlay, box: { ...overlay.box, height: 0.2 } };
    delete legacy.fontSize;
    expect(getTextOverlayLayoutPatch(legacy, { text: 'One\nTwo' }).fontSize).toBeCloseTo(0.2, 10);
  });

  test('the fitted box stays in the frame', () => {
    expect(fitTextBox({ x: 0.1, y: 0.9, width: 0.5, height: 0.05 }, { text: 'a\nb', fontSize: 0.1, lineSpacing: 0 })).toEqual({ x: 0.1, y: 0.8, width: 0.5, height: 0.2 });
    const tall = fitTextBox({ x: 0, y: 0.5, width: 1, height: 0.1 }, { text: 'a\nb\nc', fontSize: 0.5, lineSpacing: 0 });
    expect(tall.y).toBe(0);
    expect(tall.height).toBe(1);
  });

  test('line centers: the block is centered in the box', () => {
    expect(getTextLineCenters({ lineCount: 2, fontSize: 10, lineSpacing: 0.5, boxTop: 100, boxHeight: 45 })).toEqual([115, 130]);
  });
});

describe('entry animations', () => {
  test('typewriter count and its inverse', () => {
    const total = 7;
    const entryFrames = 20;
    for (let frame = 0; frame < 30; frame += 1) {
      const count = getTypewriterCount(frame, total, entryFrames);
      expect(count).toBe(frame >= entryFrames - 1 ? total : Math.floor(((frame + 1) * total) / entryFrames));
      if (count > 0) expect(getTypewriterFirstFrame(count, total, entryFrames)).toBeLessThanOrEqual(frame);
      if (count < total) expect(getTypewriterFirstFrame(count + 1, total, entryFrames)).toBeGreaterThan(frame);
    }
    expect(getTypewriterCount(0, 3, 1)).toBe(3);
  });

  test('typewriter stages: contiguous, merged over spaces, the whole line last', () => {
    const stages = getTypewriterStages(['ab c', '', ' d'], 12);
    expect(stages).toEqual([
      [{ text: 'a', start: 1, end: 3 }, { text: 'ab', start: 3, end: 7 }, { text: 'ab c', start: 7, end: undefined }],
      [],
      // the leading space shows nothing
      [{ text: ' d', start: 11, end: undefined }],
    ]);
    // faster than the frame rate: characters appearing in the same frame don't get a step
    expect(getTypewriterStages(['abcdef'], 2)).toEqual([[{ text: 'abc', start: 0, end: 1 }, { text: 'abcdef', start: 1, end: undefined }]]);
  });

  test('slide: eased from outside the frame to its place', () => {
    expect(getSlideRemaining(0)).toBe(1);
    expect(getSlideRemaining(0.5)).toBe(0.125);
    expect(getSlideRemaining(2)).toBe(0);
    const overlay = { box: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, entry: { kind: 'slide' as const, from: 'left' as const, duration: 1 } };
    expect(getSlideOffset(overlay, 0, 30)).toEqual({ dx: -0.4, dy: 0 });
    expect(getSlideOffset(overlay, 30, 30)).toEqual({ dx: 0, dy: 0 });
    expect(getSlideOffset({ ...overlay, entry: { ...overlay.entry, from: 'bottom' } }, 15, 30).dy).toBeCloseTo(0.8 * 0.125, 10);
    expect(getSlideOffset({ ...overlay, entry: { kind: 'none', duration: 1 } }, 0, 30)).toEqual({ dx: 0, dy: 0 });
  });

  test('opacity', () => {
    const fades = { fadeIn: 1, fadeOut: 0.5 };
    expect(getTextOpacity(fades, 0, 90, 30)).toBe(0);
    expect(getTextOpacity(fades, 15, 90, 30)).toBe(0.5);
    expect(getTextOpacity(fades, 50, 90, 30)).toBe(1);
    expect(getTextOpacity(fades, 85, 90, 30)).toBeCloseTo(5 / 15, 10);
    expect(getTextOpacity({ fadeIn: 0, fadeOut: 0 }, 0, 90, 30)).toBe(1);
  });
});
