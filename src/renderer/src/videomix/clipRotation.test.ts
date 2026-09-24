import { describe, test, expect } from 'vitest';

import { addRotation, getClipFrame, getRotationFilter, getUnrotatedCrop, rotateClipRects, rotateRect, rotateSize, unrotateRect } from './clipRotation';
import { getSplitClipAction } from './clips';
import { rectContains } from './geometry';
import { getPlannerInput } from './planner/plannerInput';
import { planMix } from './planner/planMix';
import { validatePlan } from './planner/validatePlan';
import { parseMixProject, validateMixProject } from './project';
import { createMixSource, mixProjectReducer } from './projectReducer';
import { rotateFrameChange } from './sourceResize';
import { createEmptyMixProject, mixClipRotations } from './types';
import type { MixClip, MixClipRotation, MixProject, Rect } from './types';

const frame = { width: 1920, height: 1080 };
const inside = (size: { width: number, height: number }, r: Rect) => rectContains({ x: 0, y: 0, ...size }, r);
const isEven = (r: Rect) => [r.x, r.y, r.width, r.height].every((v) => v % 2 === 0);

describe('rotateRect', () => {
  test('turns a pixel clockwise with the picture', () => {
    // pixel (u, v) of a W×H frame lands on (H − 1 − v, u) after a clockwise quarter turn
    const pixel = { x: 10, y: 20, width: 1, height: 1 };
    expect(rotateRect(pixel, frame, 90)).toEqual({ x: 1080 - 1 - 20, y: 10, width: 1, height: 1 });
    expect(rotateRect(pixel, frame, 180)).toEqual({ x: 1920 - 1 - 10, y: 1080 - 1 - 20, width: 1, height: 1 });
    expect(rotateRect(pixel, frame, 270)).toEqual({ x: 20, y: 1920 - 1 - 10, width: 1, height: 1 });
    expect(rotateRect(pixel, frame, 0)).toBe(pixel);
  });

  test('two quarter turns are a half turn, four are none', () => {
    const r = { x: 100, y: 40, width: 600, height: 300 };
    expect(rotateRect(rotateRect(r, frame, 90), rotateSize(frame, 90), 90)).toEqual(rotateRect(r, frame, 180));
    expect(rotateRect(rotateRect(r, frame, 180), frame, 180)).toEqual(r);
    expect(rotateRect(rotateRect(r, frame, 90), rotateSize(frame, 90), 270)).toEqual(r);
  });

  test('round trip, even and inside the frame in the 4 turns', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: 100, y: 40, width: 600, height: 300 },
      { x: 1904, y: 1064, width: 16, height: 16 },
      { x: 0, y: 500, width: 16, height: 580 },
    ];
    for (const rotation of mixClipRotations) {
      const turned = rotateSize(frame, rotation);
      for (const r of rects) {
        const t = rotateRect(r, frame, rotation);
        expect(inside(turned, t)).toBe(true);
        expect(isEven(t)).toBe(true);
        expect(unrotateRect(t, frame, rotation)).toEqual(r);
      }
    }
  });

  test('addRotation and rotateSize', () => {
    expect(addRotation(0, -90)).toBe(270);
    expect(addRotation(270, 90)).toBe(0);
    expect(addRotation(90, 180)).toBe(270);
    expect(addRotation(180, -540)).toBe(0);
    expect(() => addRotation(0, 45)).toThrow();
    expect(rotateSize(frame, 90)).toEqual({ width: 1080, height: 1920 });
    expect(rotateSize(frame, 180)).toBe(frame);
  });
});

describe('rotateClipRects', () => {
  const rects = { maxRect: { x: 200, y: 40, width: 1200, height: 1000 }, minRect: { x: 600, y: 300, width: 400, height: 400 } };

  test('keeps the framing: every turn and back gives the same rects, min stays inside max', () => {
    for (const from of mixClipRotations) {
      const start = rotateClipRects(rects, frame, 0, from);
      for (const to of mixClipRotations) {
        const turned = rotateClipRects(start, frame, from, to);
        const size = rotateSize(frame, to);
        expect(inside(size, turned.maxRect)).toBe(true);
        expect(rectContains(turned.maxRect, turned.minRect!)).toBe(true);
        expect(isEven(turned.maxRect) && isEven(turned.minRect!)).toBe(true);
        // the same as turning straight from 0
        expect(turned).toEqual(rotateClipRects(rects, frame, 0, to));
        expect(rotateClipRects(turned, frame, to, from)).toEqual(start);
      }
    }
  });

  test('a quarter turn swaps the orientation of the max', () => {
    const turned = rotateClipRects(rects, frame, 0, 90);
    expect(turned).toEqual({ maxRect: { x: 40, y: 200, width: 1000, height: 1200 }, minRect: { x: 380, y: 600, width: 400, height: 400 } });
  });

  test('without min', () => {
    expect(rotateClipRects({ maxRect: rects.maxRect }, frame, 0, 180)).toEqual({ maxRect: { x: 520, y: 40, width: 1200, height: 1000 }, minRect: undefined });
  });

  test('an odd frame snaps the turned rects to even edges inside it', () => {
    const odd = { width: 1359, height: 720 };
    const turned = rotateClipRects({ maxRect: { x: 0, y: 0, width: 1358, height: 720 }, minRect: { x: 100, y: 100, width: 200, height: 200 } }, odd, 0, 180);
    expect(isEven(turned.maxRect) && isEven(turned.minRect!)).toBe(true);
    expect(inside(odd, turned.maxRect)).toBe(true);
    expect(rectContains(turned.maxRect, turned.minRect!)).toBe(true);
    expect(turned.maxRect).toEqual({ x: 0, y: 0, width: 1358, height: 720 });
  });
});

test('getUnrotatedCrop and getRotationFilter', () => {
  const r = { x: 40, y: 200, width: 1000, height: 1200 };
  expect(getUnrotatedCrop(r, frame, 0)).toBe(r);
  expect(getUnrotatedCrop(r, frame, 90)).toEqual({ x: 200, y: 40, width: 1200, height: 1000 });
  expect(() => getUnrotatedCrop(r, undefined, 90)).toThrow();
  expect(mixClipRotations.map((rotation) => getRotationFilter(rotation))).toEqual(['', 'transpose=clock', 'hflip,vflip', 'transpose=cclock']);
});

function makeClip(id: string, overrides: Partial<MixClip> = {}): MixClip {
  return { id, sourceId: 's1', name: id, color: 0, start: 0, end: 5, maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, muted: false, gainDb: 0, ...overrides };
}

function makeProject(clips: MixClip[] = [makeClip('c1', { minRect: { x: 600, y: 300, width: 400, height: 400 } })]): MixProject {
  return {
    ...createEmptyMixProject(),
    sources: [{ ...createMixSource({ id: 's1', filePath: '/v/a.mp4', name: 'a.mp4' }), width: 1920, height: 1080, duration: 10 }],
    clips,
  };
}

describe('model', () => {
  test('rotateClip turns the rects with the picture and only stores a turn', () => {
    const project = makeProject();
    const turned = mixProjectReducer(project, { type: 'rotateClip', clipId: 'c1', rotation: 90 });
    expect(turned.clips[0]).toMatchObject({ rotation: 90, maxRect: { x: 0, y: 0, width: 1080, height: 1920 }, minRect: { x: 380, y: 600, width: 400, height: 400 } });
    const back = mixProjectReducer(turned, { type: 'rotateClip', clipId: 'c1', rotation: 0 });
    expect(back.clips[0]).toEqual(project.clips[0]);
    expect(back.clips[0]).not.toHaveProperty('rotation');
    expect(mixProjectReducer(project, { type: 'rotateClip', clipId: 'c1', rotation: 0 })).toBe(project);
    expect(mixProjectReducer(project, { type: 'rotateClip', clipId: 'x', rotation: 90 })).toBe(project);
  });

  test('rotateClip does nothing while the size of the source is unknown', () => {
    const project = { ...makeProject(), sources: [createMixSource({ id: 's1', filePath: '/v/a.mp4', name: 'a.mp4' })] };
    expect(mixProjectReducer(project, { type: 'rotateClip', clipId: 'c1', rotation: 90 })).toBe(project);
  });

  test('duplicating or splitting a clip keeps its turn', () => {
    const project = mixProjectReducer(makeProject(), { type: 'rotateClip', clipId: 'c1', rotation: 270 });
    const next = mixProjectReducer(project, { type: 'duplicateClip', clipId: 'c1', newId: 'c2' });
    expect(next.clips[1]).toMatchObject({ id: 'c2', rotation: 270, maxRect: next.clips[0]!.maxRect });
    const split = getSplitClipAction({ clip: project.clips[0]!, time: 2, newId: 'c3', clips: project.clips });
    expect(mixProjectReducer(project, split!).clips[1]).toMatchObject({ id: 'c3', rotation: 270, maxRect: project.clips[0]!.maxRect });
  });

  test('a new source size scales the rects in the turned frame (B2)', () => {
    const project = mixProjectReducer(makeProject([makeClip('c1')]), { type: 'rotateClip', clipId: 'c1', rotation: 90 });
    const next = mixProjectReducer(project, { type: 'relinkSource', sourceId: 's1', source: { path: '/v/b.mp4', absolutePath: '/v/b.mp4', width: 1280, height: 720 } });
    expect(next.clips[0]!.maxRect).toEqual({ x: 0, y: 0, width: 720, height: 1280 });
    expect(rotateFrameChange({ from: frame, to: { width: 1280, height: 720 }, aspectChanged: false }, 270)).toEqual({ from: { width: 1080, height: 1920 }, to: { width: 720, height: 1280 }, aspectChanged: false });
  });

  test('schema: the 4 turns parse, others do not', () => {
    const project = makeProject();
    for (const rotation of [90, 180, 270] as MixClipRotation[]) {
      const json = { ...project, clips: [{ ...project.clips[0]!, rotation }] };
      expect(parseMixProject(json).clips[0]!.rotation).toBe(rotation);
    }
    expect(() => parseMixProject({ ...project, clips: [{ ...project.clips[0]!, rotation: 45 }] })).toThrow();
    expect(() => parseMixProject({ ...project, clips: [{ ...project.clips[0]!, rotation: -90 }] })).toThrow();
  });

  test('validation checks the max against the turned frame', () => {
    const codes = (p: MixProject, options?: Parameters<typeof validateMixProject>[1]) => validateMixProject(p, options).map((i) => i.code);
    const vertical = { x: 0, y: 0, width: 1080, height: 1920 };
    expect(codes(makeProject([makeClip('c1', { maxRect: vertical })]))).toContain('max-rect-outside-frame');
    expect(codes(makeProject([makeClip('c1', { maxRect: vertical, rotation: 90 })]))).toEqual([]);
    expect(codes(makeProject([makeClip('c1', { rotation: 270 })]))).toContain('max-rect-outside-frame');
    expect(codes(makeProject([makeClip('c1', { rotation: 180 })]))).toEqual([]);
    // fresher sizes are turned too
    expect(codes(makeProject([makeClip('c1', { maxRect: vertical, rotation: 90 })]), { sourceSizes: { s1: { width: 1920, height: 1080 } } })).toEqual([]);
    expect(getClipFrame({ rotation: 90 }, { width: 1920, height: 1080 })).toEqual({ width: 1080, height: 1920 });
    expect(getClipFrame({}, { width: 1920 })).toBeUndefined();
  });
});

describe('planner with turned clips', () => {
  test('a landscape source turned a quarter is a vertical clip, and only extends within the turned frame', () => {
    const turnedFull = { x: 0, y: 0, width: 1080, height: 1920 };
    const clips = [
      makeClip('v1', { maxRect: turnedFull, rotation: 90 }),
      makeClip('v2', { maxRect: turnedFull, rotation: 270 }),
      makeClip('v3', { maxRect: { x: 0, y: 0, width: 1080, height: 1920 }, rotation: 90, start: 5, end: 10 }),
      // unturned 1:1 in the middle of the landscape frame: 840 px of room around it
      makeClip('h1', { maxRect: { x: 420, y: 0, width: 1080, height: 1080 }, start: 2, end: 9 }),
    ];
    const project = makeProject(clips);
    project.settings.output = { aspect: '16:9', resolution: '1080' };
    const input = getPlannerInput(project);
    expect(input.clips.find((c) => c.id === 'v1')).toMatchObject({ aspectRange: { preferred: 1080 / 1920 }, extendBeyondMax: { frame: { width: 1080, height: 1920 } } });
    expect(input.clips.find((c) => c.id === 'h1')).toMatchObject({ extendBeyondMax: { frame: { width: 1920, height: 1080 } } });
    const plan = planMix(input);
    expect(validatePlan(plan, input)).toEqual([]);
    // vertical clips side by side
    expect(plan.layouts[0]!.columns.length).toBeGreaterThanOrEqual(2);
    for (const p of plan.placements) {
      const clip = clips.find((c) => c.id === p.clipId)!;
      if (p.extendedMaxRect != null) expect(inside(getClipFrame(clip, project.sources[0])!, p.extendedMaxRect)).toBe(true);
      // the turned full-frame clips have no room to extend
      if (clip.rotation != null) expect(p.extendedMaxRect ?? clip.maxRect).toEqual(clip.maxRect);
    }
  });
});
