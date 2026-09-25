import { describe, test, expect } from 'vitest';

import { getAnimatedCellCrop } from './animatedCrop';
import { getClipRectsAt } from './clipKeyframes';
import { ASPECT_TOLERANCE, extendMaxRect, getAspectRange, getExtendedCropForAspect, rectContains } from './geometry';
import { createRandom } from './planner/random';
import type { MixClipKeyframe, Rect } from './types';

const frame = { width: 1920, height: 1080 };
const maxRect: Rect = { x: 480, y: 270, width: 960, height: 540 };
const minRect: Rect = { x: 720, y: 270, width: 480, height: 540 };

const kf = (time: number, centerX: number, centerY: number, scale: number, interpolation?: MixClipKeyframe['interpolation']): MixClipKeyframe => (
  { time, centerX, centerY, scale, ...(interpolation != null && { interpolation }) }
);

const inside = (outer: Rect, r: Rect) => r.x >= outer.x - 1e-6 && r.y >= outer.y - 1e-6
  && r.x + r.width <= outer.x + outer.width + 1e-6 && r.y + r.height <= outer.y + outer.height + 1e-6;
const frameRect = { x: 0, y: 0, ...frame };

describe('getAnimatedCellCrop', () => {
  test('without keyframes: exactly the static crop', () => {
    for (const aspect of [0.5, 1, 16 / 9, 3]) {
      const clip = { maxRect, minRect };
      expect(getAnimatedCellCrop({ clip, aspect, time: 3, frame })).toEqual(getExtendedCropForAspect(maxRect, minRect, undefined, aspect));
      expect(getAnimatedCellCrop({ clip: { ...clip, keyframes: undefined }, aspect, time: 3 })).toEqual(getExtendedCropForAspect(maxRect, minRect, undefined, aspect));
    }
  });

  test('the static crop moved and scaled with the max: same proportion, inside the animated max', () => {
    const keyframes = [kf(0, 960, 540, 1), kf(2, 600, 400, 0.5, 'linear')];
    const clip = { maxRect, minRect, keyframes };
    const aspect = 1;
    const base = getExtendedCropForAspect(maxRect, minRect, undefined, aspect);
    // at the first keyframe (the base transform): the static crop
    expect(getAnimatedCellCrop({ clip, aspect, time: 0, frame })).toEqual(base);
    const end = getAnimatedCellCrop({ clip, aspect, time: 2, frame });
    expect(end.fit).toBe('fill');
    expect(end.crop.width).toBeCloseTo(base.crop.width / 2);
    expect(end.crop.width / end.crop.height).toBeCloseTo(aspect);
    // the min is centred in the max, so is the crop: centred on the keyframe's centre
    expect(end.crop.x + end.crop.width / 2).toBeCloseTo(600);
    expect(end.crop.y + end.crop.height / 2).toBeCloseTo(400);
    // real-valued: half way along a linear keyframe it moves by exactly half (no even-px rounding)
    const mid = getAnimatedCellCrop({ clip, aspect, time: 1, frame });
    expect(mid.crop.x + mid.crop.width / 2).toBeCloseTo(780);
    expect(mid.crop.width).toBeCloseTo(base.crop.width * 0.75);
    const tiny = getAnimatedCellCrop({ clip, aspect, time: 0.01, frame });
    expect(Number.isInteger(tiny.crop.x)).toBe(false);
  });

  test('within about a px of the crop of the (even) rects of getClipRectsAt', () => {
    const random = createRandom(7);
    let compared = 0;
    for (let i = 0; i < 300; i += 1) {
      const keyframes = [kf(0, 200 + random() * 1500, 150 + random() * 800, 0.3 + random() * 1.5), kf(1, 200 + random() * 1500, 150 + random() * 800, 0.3 + random() * 1.5, random() < 0.5 ? 'linear' : undefined)];
      const clip = { maxRect, minRect: random() < 0.5 ? minRect : undefined, keyframes };
      const aspect = 0.4 + random() * 2.5;
      const time = random();
      const res = getAnimatedCellCrop({ clip, aspect, time, frame });
      const rects = getClipRectsAt(clip, time, frame);
      const reference = getExtendedCropForAspect(rects.maxRect, rects.minRect, undefined, aspect);
      expect(inside(frameRect, res.crop)).toBe(true);
      // the rounding of small rects moves their aspect range a little: skip the aspects at its (tolerance) edges
      const range = getAspectRange(clip.maxRect, clip.minRect);
      const limits = [range.min, range.max].flatMap((l) => [l, l * (1 - ASPECT_TOLERANCE), l * (1 + ASPECT_TOLERANCE)]);
      if (limits.every((l) => Math.abs(aspect / l - 1) >= 0.03)) {
        expect(res.fit).toBe(reference.fit);
        // the even rounding of the rects (and of the crop) moves the edges by a few source px at most
        for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(res.crop[key] - reference.crop[key])).toBeLessThanOrEqual(4.01);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(200);
  });

  test('kept inside the frame (the transform is clamped like getClipRectsAt)', () => {
    const clip = { maxRect, minRect, keyframes: [kf(0, 0, 0, 3)] };
    const res = getAnimatedCellCrop({ clip, aspect: 16 / 9, time: 0, frame });
    expect(inside(frameRect, res.crop)).toBe(true);
    // scale clamped to 2 (the base max is half the frame): the crop at the cell's aspect spans the whole height
    expect(res.crop.height).toBeCloseTo(1080);
  });

  test('E7: the extension scales with the framing, centred on the animated max, inside the frame', () => {
    // a 9:16 max (608x1080 at x 656) in a wider cell: extended horizontally to 1216 px
    const max: Rect = { x: 656, y: 0, width: 608, height: 1080 };
    const extended = extendMaxRect(max, frame, 'horizontal', 608);
    const aspect = 1216 / 1080;
    const base = getExtendedCropForAspect(max, undefined, extended, aspect);
    expect(base).toMatchObject({ fit: 'fill', strategy: 'extend' });
    expect(base.crop.width).toBe(1216);

    // zoomed in (scale 0.5) around (700, 500): half the crop, the extension around the animated max
    const zoomed = getAnimatedCellCrop({ clip: { maxRect: max, keyframes: [kf(0, 700, 500, 0.5)] }, aspect, time: 0, frame, extendedMaxRect: extended });
    expect(zoomed.fit).toBe('fill');
    expect(zoomed.crop.width).toBeCloseTo(608);
    expect(zoomed.crop.height).toBeCloseTo(540);
    expect(zoomed.crop.x + zoomed.crop.width / 2).toBeCloseTo(700);
    expect(zoomed.crop.y).toBeCloseTo(230);

    // panned to the left edge: the extension takes what's left on that side and the rest on the other one
    const edge = getAnimatedCellCrop({ clip: { maxRect: max, keyframes: [kf(0, 304, 540, 1)] }, aspect, time: 0, frame, extendedMaxRect: extended });
    expect(edge.fit).toBe('fill');
    expect(edge.crop.x).toBeCloseTo(0);
    expect(edge.crop.width).toBeCloseTo(1216);
    expect(inside(frameRect, edge.crop)).toBe(true);

    // zoomed out beyond what the frame can extend: cut at the frame, pillarbox for that frame
    const wide = getAnimatedCellCrop({ clip: { maxRect: max, keyframes: [kf(0, 960, 540, 1)] }, aspect: 2.5, time: 0, frame, extendedMaxRect: extendMaxRect(max, frame, 'horizontal', 1312) });
    expect(wide.fit).toBe('pillarbox');
    expect(wide.crop.width).toBeCloseTo(1920);
    const tooWide = getAnimatedCellCrop({ clip: { maxRect: { x: 656, y: 270, width: 608, height: 540 }, keyframes: [kf(0, 960, 540, 2)] }, aspect: 1216 / 540, time: 0, frame, extendedMaxRect: extendMaxRect({ x: 656, y: 270, width: 608, height: 540 }, frame, 'horizontal', 608) });
    // 2 × 1216 px would be needed, the frame has 1920
    expect(tooWide.fit).toBe('pillarbox');
    expect(tooWide.crop.width).toBeCloseTo(1920);
    expect(rectContains(frameRect, { ...tooWide.crop, x: Math.round(tooWide.crop.x), width: Math.round(tooWide.crop.width) })).toBe(true);
  });

  test('E7 vertical (rows): the transpose', () => {
    const max: Rect = { x: 0, y: 400, width: 1080, height: 600 };
    const vframe = { width: 1080, height: 1920 };
    const extended = extendMaxRect(max, vframe, 'vertical', 600);
    const aspect = 1080 / 1200;
    const zoomed = getAnimatedCellCrop({ clip: { maxRect: max, keyframes: [kf(0, 540, 1000, 0.5)] }, aspect, time: 0, frame: vframe, extendedMaxRect: extended });
    expect(zoomed.fit).toBe('fill');
    expect(zoomed.crop.height).toBeCloseTo(600);
    expect(zoomed.crop.y + zoomed.crop.height / 2).toBeCloseTo(1000);
  });
});
