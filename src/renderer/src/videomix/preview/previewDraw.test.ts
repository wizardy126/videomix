import { describe, expect, test } from 'vitest';

import { getAnimatedCellCrop } from '../animatedCrop';
import { getCropForAspect } from '../geometry';
import { getRenderTimeline } from '../render/renderTimeline';
import { testClips, testPlans, testSettings, toRowsPlan } from '../render/renderTestFixtures';
import type { MixPlan } from '../planner/types';
import type { MixSettings } from '../types';
import { clipDrawToBounds, createPreviewDrawModel, getCoverSource, getGlobalFadeAlpha, getPreviewDrawList } from './previewDraw';
import type { PreviewDrawOp } from './previewDraw';

const model = (plan: MixPlan, overrides: Partial<MixSettings> = {}) => {
  const settings = testSettings(overrides);
  const tl = getRenderTimeline(plan, { fps: settings.fps, gap: settings.gap.width, transitionDuration: settings.transition.duration });
  return createPreviewDrawModel(tl, testClips, settings);
};
const clip = (id: string) => testClips.find((c) => c.id === id)!;
const videos = (ops: PreviewDrawOp[]) => ops.filter((op) => op.kind === 'video');

describe('clipDrawToBounds / getCoverSource', () => {
  test('cuts dest to the bounds and src in proportion', () => {
    expect(clipDrawToBounds({ x: 0, y: 0, width: 100, height: 100 }, { x: -50, y: 0, width: 200, height: 200 }, { x: 0, y: 0, width: 100, height: 100 })).toEqual({
      src: { x: 25, y: 0, width: 50, height: 50 },
      dest: { x: 0, y: 0, width: 100, height: 100 },
    });
    expect(clipDrawToBounds({ x: 0, y: 0, width: 10, height: 10 }, { x: 200, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 100, height: 100 })).toBeUndefined();
  });

  test('cover: largest centred part with the destination aspect', () => {
    expect(getCoverSource({ x: 0, y: 0, width: 1920, height: 1080 }, { width: 100, height: 100 })).toEqual({ x: 420, y: 0, width: 1080, height: 1080 });
    expect(getCoverSource({ x: 10, y: 0, width: 100, height: 100 }, { width: 200, height: 100 })).toEqual({ x: 10, y: 25, width: 100, height: 50 });
  });
});

describe('getPreviewDrawList', () => {
  test('static columns: gap colour, then each clip cropped like the render into its cell', () => {
    const { ops, fadeAlpha } = getPreviewDrawList(model(testPlans.static), 1);
    expect(ops[0]).toEqual({ kind: 'color', rect: { x: 0, y: 0, width: 640, height: 360 }, color: '#303030', alpha: 1 });
    expect(videos(ops)).toEqual([
      { kind: 'video', key: 'p0', clipId: 'b', src: getCropForAspect(clip('b').maxRect, clip('b').minRect, 202 / 360).crop, dest: { x: 0, y: 0, width: 202, height: 360 }, alpha: 1 },
      { kind: 'video', key: 'p1', clipId: 'a', src: getCropForAspect(clip('a').maxRect, clip('a').minRect, 430 / 360).crop, dest: { x: 210, y: 0, width: 430, height: 360 }, alpha: 1 },
    ]);
    expect(fadeAlpha).toBe(0);
  });

  test('crossfade: the incoming clip on top with a growing opacity', () => {
    const m = model(testPlans.substitutions);
    // c starts at 2.5 with a 0.5 s xfade over a
    const at = (t: number) => videos(getPreviewDrawList(m, t).ops).map((op) => [op.clipId, op.alpha]);
    expect(at(2.4)).toEqual([['b', 1], ['a', 1]]);
    expect(at(2.75)).toEqual([['b', 1], ['a', 1], ['c', 0.5]]);
    expect(at(3.1)).toEqual([['b', 1], ['c', 1]]);
  });

  test('a last clip fades into the fill, then its column is fill (blurred from the nearest clip)', () => {
    const m = model(testPlans.substitutions);
    const fading = getPreviewDrawList(m, 4.25).ops;
    const b = fading.findIndex((op) => op.kind === 'video' && op.clipId === 'b');
    expect(fading[b]!.alpha).toBeCloseTo(0.5);
    // the fill is drawn under it, in the column's cell
    expect(fading[b - 1]).toMatchObject({ kind: 'blur', key: 'p2', dest: { x: 0, y: 0, width: 202, height: 360 } });

    const after = getPreviewDrawList(m, 5).ops;
    expect(videos(after).map((op) => op.clipId)).toEqual(['c']);
    expect(after).toContainEqual(expect.objectContaining({ kind: 'blur', key: 'p2', dest: { x: 0, y: 0, width: 202, height: 360 } }));
    // in colour mode it's a plain fill
    expect(getPreviewDrawList(model(testPlans.substitutions, { fill: { mode: 'color', color: '#112233' } }), 5).ops)
      .toContainEqual({ kind: 'color', rect: { x: 0, y: 0, width: 202, height: 360 }, color: '#112233', alpha: 1 });
  });

  test('re-layout: widths follow the render timeline (smoothstep)', () => {
    const m = model(testPlans.relayout);
    // halfway through 632|1280 → 776|1136: smoothstep(0.5) = 0.5
    const ops = videos(getPreviewDrawList(m, 2.25).ops);
    expect(ops.find((op) => op.clipId === 'b')!.dest).toEqual({ x: 0, y: 0, width: 704, height: 1080 });
    expect(ops.find((op) => op.clipId === 'c')!.dest).toEqual({ x: 712, y: 0, width: 1208, height: 1080 });
  });

  test('pillarbox: the clip centred on its own blurred cover, edge fills blurred from it', () => {
    const { ops } = getPreviewDrawList(model(testPlans.fills), 1);
    // rigid square d in a 440x360 column at x=100
    expect(ops).toContainEqual({ kind: 'video', key: 'p0', clipId: 'd', src: { x: 0, y: 0, width: 1080, height: 1080 }, dest: { x: 140, y: 0, width: 360, height: 360 }, alpha: 1 });
    expect(ops).toContainEqual(expect.objectContaining({ kind: 'blur', key: 'p0', dest: { x: 100, y: 0, width: 440, height: 360 } }));
    const fills = ops.filter((op) => op.kind === 'blur' && op.dest.width === 100);
    expect(fills.map((op) => op.kind === 'blur' && op.dest.x)).toEqual([0, 540]);
  });

  test('a column shrinking to 0 keeps its full height, cut by its window', () => {
    const { ops } = getPreviewDrawList(model(testPlans.removal), 2.25);
    const e = videos(ops).find((op) => op.clipId === 'e')!;
    expect(e.dest.height).toBe(360);
    expect(e.dest.width).toBeLessThan(202);
    // src cut in the same proportion as dest: same scale on both axes
    expect(e.src.width / e.dest.width).toBeCloseTo(e.src.height / e.dest.height);
  });

  test('rows: full-width cells stacked', () => {
    const { ops } = getPreviewDrawList(model(toRowsPlan(testPlans.static)), 1);
    const [b, a] = videos(ops);
    expect(a!.dest).toEqual({ x: 0, y: 210, width: 360, height: 430 });
    // the vertical clip in a wide 360x202 row: pillarboxed (full row height, centred) on its blurred cover
    expect(b!.dest.height).toBe(202);
    expect(b!.dest.x + b!.dest.width / 2).toBeCloseTo(180);
    expect(ops).toContainEqual(expect.objectContaining({ kind: 'blur', key: 'p0', dest: { x: 0, y: 0, width: 360, height: 202 } }));
  });

  test('global fade from/to black', () => {
    const settings = testSettings();
    expect(getGlobalFadeAlpha(settings, 0, 3)).toBe(1);
    expect(getGlobalFadeAlpha(settings, 0.25, 3)).toBeCloseTo(0.5);
    expect(getGlobalFadeAlpha(settings, 1.5, 3)).toBe(0);
    expect(getGlobalFadeAlpha(settings, 2.9, 3)).toBeCloseTo(0.8);
    expect(getGlobalFadeAlpha({ ...settings, fadeInOut: false }, 0, 3)).toBe(0);
  });
});

describe('extension beyond the max (E7, T38b)', () => {
  test('the preview crops the extended rect like the render', () => {
    const v = { id: 'v', sourceId: 'h1080', start: 0, maxRect: { x: 100, y: 0, width: 608, height: 1080 } };
    const plan: MixPlan = {
      width: 640,
      height: 360,
      duration: 3,
      placements: [{ clipId: 'v', column: 0, startTime: 0, endTime: 3, transitionIn: 0, extendedMaxRect: { x: 0, y: 0, width: 960, height: 1080 } }],
      layouts: [{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 160, width: 320 }], fills: [{ x: 0, width: 160 }, { x: 480, width: 160 }] }],
      warnings: [],
    };
    const settings = testSettings();
    const tl = getRenderTimeline(plan, { fps: 30, gap: 8, transitionDuration: 0.5 });
    const { ops } = getPreviewDrawList(createPreviewDrawModel(tl, [v], settings), 1);
    // 960x1080 from the source's left edge (100 px on the left of the max, 252 on the right): no pillarbox background
    expect(videos(ops)).toEqual([{ kind: 'video', key: 'p0', clipId: 'v', src: { x: 0, y: 0, width: 960, height: 1080 }, dest: { x: 160, y: 0, width: 320, height: 360 }, alpha: 1 }]);
    expect(ops.filter((op) => op.kind === 'blur' && op.clipId === 'v' && op.dest.x === 160)).toEqual([]);
  });
});

describe('aspect tolerance (T44b)', () => {
  test('a clip without min 0.25 % off its cell is cut like the render (crop=1078:1920:2:0) and fills the cell', () => {
    // removal plan: the rigid 9:16 clip e (1080x1920) in a 202x360 column (0.5611 against 0.5625)
    const e = videos(getPreviewDrawList(model(testPlans.removal), 1).ops).find((op) => op.clipId === 'e')!;
    expect(getCropForAspect(clip('e').maxRect, undefined, 202 / 360)).toMatchObject({ fit: 'fill', strategy: 'crop' });
    expect(e).toMatchObject({ src: { x: 2, y: 0, width: 1078, height: 1920 }, dest: { x: 210, y: 0, width: 202, height: 360 } });
  });
});

describe('turned clips (E9, T38d)', () => {
  test('the ops of a turned clip carry its turn (the canvas turns the picture); src stays in the turned frame', () => {
    const t = { id: 't', sourceId: 'h1080', start: 0, maxRect: { x: 0, y: 420, width: 1080, height: 1080 }, rotation: 90 as const };
    const plan: MixPlan = {
      width: 640,
      height: 360,
      duration: 3,
      placements: [{ clipId: 't', column: 0, startTime: 0, endTime: 3, transitionIn: 0 }],
      layouts: [{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 640 }], fills: [] }],
      warnings: [],
    };
    const settings = testSettings({ fill: { mode: 'blur', color: '#000000' } });
    const tl = getRenderTimeline(plan, { fps: 30, gap: 0, transitionDuration: 0.5 });
    const { ops } = getPreviewDrawList(createPreviewDrawModel(tl, [t], settings), 1);
    expect(videos(ops)).toEqual([{ kind: 'video', key: 'p0', clipId: 't', src: t.maxRect, dest: { x: 140, y: 0, width: 360, height: 360 }, alpha: 1, rotation: 90 }]);
    // its pillarbox background too
    expect(ops).toContainEqual(expect.objectContaining({ kind: 'blur', clipId: 't', rotation: 90 }));
    // unturned: no rotation key at all
    const { ops: plain } = getPreviewDrawList(createPreviewDrawModel(tl, [{ ...t, rotation: undefined }], settings), 1);
    expect(plain.every((op) => !('rotation' in op))).toBe(true);
  });
});

describe('animated framing (A9, T48)', () => {
  const plan: MixPlan = {
    width: 640,
    height: 360,
    duration: 3,
    placements: [{ clipId: 'k', column: 0, startTime: 0, endTime: 3, transitionIn: 0 }],
    layouts: [{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 640 }], fills: [] }],
    warnings: [],
  };
  const settings = testSettings({ gap: { width: 0, color: '#000000' } });
  const tl = getRenderTimeline(plan, { fps: 30, gap: 0, transitionDuration: 0.5 });
  const k = {
    id: 'k',
    sourceId: 'h1080',
    start: 1,
    maxRect: { x: 160, y: 90, width: 1600, height: 900 },
    keyframes: [{ time: 1, centerX: 960, centerY: 540, scale: 1, interpolation: 'linear' as const }, { time: 3, centerX: 1100, centerY: 500, scale: 0.5 }],
  };

  test('the clip shows the render\'s crop at the source time of the frame (between frames too)', () => {
    const m = createPreviewDrawModel(tl, [k], settings, [{ id: 'h1080', width: 1920, height: 1080 }]);
    for (const time of [0, 0.5, 1.01, 1.99, 2.5]) {
      const [op] = videos(getPreviewDrawList(m, time).ops);
      expect(op!.src, String(time)).toEqual(getAnimatedCellCrop({ clip: k, aspect: 16 / 9, time: 1 + time, frame: { width: 1920, height: 1080 } }).crop);
    }
    // half way (source 2 s): centre 1030,520 and 1200 px wide
    const [mid] = videos(getPreviewDrawList(m, 1).ops);
    expect(mid!.src.x + mid!.src.width / 2).toBeCloseTo(1030);
    expect(mid!.src.width).toBeCloseTo(1200);
  });

  test('kept inside the source frame when it is known', () => {
    const out = { ...k, keyframes: [{ time: 0, centerX: 1900, centerY: 540, scale: 1 }] };
    const [known] = videos(getPreviewDrawList(createPreviewDrawModel(tl, [out], settings, [{ id: 'h1080', width: 1920, height: 1080 }]), 1).ops);
    expect(known!.src.x + known!.src.width).toBeCloseTo(1920);
    const [unknown] = videos(getPreviewDrawList(createPreviewDrawModel(tl, [out], settings), 1).ops);
    expect(unknown!.src.x + unknown!.src.width).toBeCloseTo(2700);
  });
});
