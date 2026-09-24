import { describe, test, expect } from 'vitest';

import { getAspectRange } from '../geometry';
import { planMix } from '../planner/planMix';
import { createRandom } from '../planner/random';
import type { PlannerClip } from '../planner/types';
import { blurCover, buildVideoGraph, formatNumber, stepExpr, toFfmpegColor } from './buildVideoGraph';
import type { RenderClip } from './buildVideoGraph';
import { getBusyIntervals, getRenderChunks } from './renderChunks';
import { testClips, testPlans, testSettings, testSourcePaths, testSources, toRowsPlan } from './renderTestFixtures';
import type { TestSourceId } from './renderTestFixtures';
import { getColumnsAtFrame, getFillSpansAtFrame, getRenderTimeline } from './renderTimeline';
import { parseFilterGraph, verifyFilterGraph } from './verifyFilterGraph';

describe('helpers', () => {
  test('stepExpr is a flat sum of steps at frame midpoints', () => {
    expect(stepExpr([5, 5, 5], 30)).toBe('5');
    expect(stepExpr([0, 2, 2, -4], 25)).toBe("'0+2*gte(t,0.02)-6*gte(t,0.1)'");
    const long = stepExpr(Array.from({ length: 500 }, (_v, i) => i), 30);
    expect(long).not.toContain('if(');
    expect(long.split('gte(').length - 1).toBe(499);
  });

  test('formatNumber never uses exponents', () => {
    expect(formatNumber(1e-7)).toBe('0');
    expect(formatNumber(0.0000015)).toBe('0.000002');
    expect(formatNumber(1 / 3)).toBe('0.333333');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(12)).toBe('12');
  });

  test('toFfmpegColor', () => {
    expect(toFfmpegColor('#A0b1C2')).toBe('0xA0b1C2');
    expect(toFfmpegColor('black')).toBe('black');
  });

  test('blurCover keeps boxblur radii valid on narrow fills', () => {
    expect(blurCover(1920, 1080)).toContain('scale=240:136:');
    expect(blurCover(1920, 1080)).toContain('boxblur=luma_radius=6:');
    expect(blurCover(40, 360)).toContain('boxblur=luma_radius=1:');
    expect(blurCover(16, 360)).not.toContain('boxblur');
  });
});

describe('timeline', () => {
  test('re-layout geometry is eased and exact at both ends', () => {
    const tl = getRenderTimeline(testPlans.relayout, { fps: 30, gap: 8, transitionDuration: 0.5 });
    expect(getColumnsAtFrame(tl, 59).get(0)).toEqual({ x: 0, width: 632 });
    expect(getColumnsAtFrame(tl, 60).get(0)).toEqual({ x: 0, width: 632 });
    expect(getColumnsAtFrame(tl, 75).get(1)).toEqual({ x: 784, width: 1136 });
    const mid = getColumnsAtFrame(tl, 67).get(0)!.width; // p = 7/15 → smoothstep ≈ 0.45
    expect(mid).toBeGreaterThan(632 + 0.4 * 144);
    expect(mid).toBeLessThan(632 + 0.5 * 144);
  });

  test('removed column collapses next to its right neighbour; fills follow the columns', () => {
    const tl = getRenderTimeline(testPlans.removal, { fps: 30, gap: 8, transitionDuration: 0.5 });
    // last animated frame: almost collapsed at x = right neighbour's x − gap = 276
    const last = getColumnsAtFrame(tl, 74).get(1)!;
    expect(last.width).toBeLessThan(5);
    expect(last.x).toBeGreaterThan(274);
    expect(last.x + last.width + 8).toBeCloseTo(getColumnsAtFrame(tl, 74).get(2)!.x, 6);
    expect(getColumnsAtFrame(tl, 75).has(1)).toBe(false);
    expect(tl.placements.find((p) => p.placement.clipId === 'e')!.endsInFill).toBe(false);

    const fills = getRenderTimeline(testPlans.fills, { fps: 30, gap: 8, transitionDuration: 0.5 });
    expect([...getFillSpansAtFrame(fills, getColumnsAtFrame(fills, 0))]).toEqual([['L', { x: 0, width: 100 }], ['R', { x: 540, width: 100 }]]);
    expect([...getFillSpansAtFrame(fills, getColumnsAtFrame(fills, 75))]).toEqual([]);
  });

  test('a column growing at the right edge next to a right fill: the gap comes in with it (no gap bar pops up)', () => {
    const tl = getRenderTimeline(testPlans.fills, { fps: 30, gap: 8, transitionDuration: 0.5 });
    // without a right neighbour it starts past W with its gap: W + gap
    expect(getColumnsAtFrame(tl, 60).get(1)).toEqual({ x: 648, width: 0 });
    // the areas of the frame before the animation and of its first frame are the same: [0, 100) fill, column, [540, 640) fill
    const spans = (f: number) => [...getFillSpansAtFrame(tl, getColumnsAtFrame(tl, f)).values()].sort((a, b) => a.x - b.x);
    expect(spans(59)).toEqual([{ x: 0, width: 100 }, { x: 540, width: 100 }]);
    expect(spans(60)).toEqual(spans(59));
    // the fill between the columns touches the left one and keeps the gap before the right one
    const mid = getColumnsAtFrame(tl, 67);
    const between = getFillSpansAtFrame(tl, mid).get('0-1')!;
    expect(between.x).toBeCloseTo(mid.get(0)!.x + mid.get(0)!.width, 6);
    expect(between.x + between.width + 8).toBeCloseTo(mid.get(1)!.x, 6);
  });

  test('end of video: clip without successor fades into fill', () => {
    const tl = getRenderTimeline(testPlans.substitutions, { fps: 30, gap: 8, transitionDuration: 0.5 });
    const b = tl.placements.find((p) => p.placement.clipId === 'b')!;
    expect(b).toMatchObject({ f0: 0, f1: 135, endsInFill: true, fadeOutFrames: 15 });
    expect(tl.placements.find((p) => p.placement.clipId === 'c')!.endsInFill).toBe(false); // ends with the video
    expect(getBusyIntervals(tl)).toEqual([{ start: 75, end: 90, anim: false }, { start: 120, end: 135, anim: false }]);
  });

  test('chunks: cut around re-layouts, cover every frame', () => {
    const tl = getRenderTimeline(testPlans.relayout, { fps: 30, gap: 8, transitionDuration: 0.5 });
    expect(getRenderChunks(tl)).toEqual([
      { index: 0, f0: 0, f1: 60, animated: false },
      { index: 1, f0: 60, f1: 75, animated: true },
      { index: 2, f0: 75, f1: 120, animated: false },
    ]);
  });
});

describe('buildVideoGraph', () => {
  test('ADR-001 example: animated chunk uses the column layer technique', () => {
    const tl = getRenderTimeline(testPlans.relayout, { fps: 30, gap: 8, transitionDuration: 0.5 });
    const graph = buildVideoGraph({ timeline: tl, clips: testClips, sourcePaths: testSourcePaths('/m'), settings: testSettings({ fadeInOut: false }), chunk: { f0: 60, f1: 75 } });
    expect(graph.frames).toBe(15);
    // inputs: seek 0.1 s earlier and compensate with setpts before fps
    expect(graph.inputs[0]).toEqual(['-ss', '1.9', '-t', '1.1', '-i', '/m/v-1080x1920-12s.mp4']);
    expect(graph.filterComplex).toContain('[0:v]setpts=PTS-0.1/TB,fps=30:start_time=0,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=15,setpts=PTS-STARTPTS,crop=');
    // incoming clip starts in the chunk: no preroll
    expect(graph.inputs[2]).toEqual(['-ss', '0', '-t', '1', '-i', '/m/h-720p-25fps-8s.mp4']);
    expect(graph.filterComplex).toMatch(/scale=w='[^']+':h='[^']+':eval=frame/);
    expect(graph.filterComplex).toContain('xfade=transition=fade:duration=0.5:offset=0[');
    // gap bar redrawn at the right edge of column 0
    expect(graph.filterComplex).toMatch(/color=c=0x303030:s=8x1080:r=30:d=0.533333,trim=end_frame=15\[gap\d+\]/);
  });
});

describe('rows (T29)', () => {
  const settings = { fps: 30, gap: 8, transitionDuration: 0.5 };

  test('timeline geometry is along the vertical axis: a removed row collapses past the bottom edge with its gap', () => {
    const tl = getRenderTimeline(toRowsPlan(testPlans.fills), settings);
    // the new row grows from height 0 past H (640) + gap, like a column past W
    expect(getColumnsAtFrame(tl, 60).get(1)).toEqual({ x: 648, width: 0 });
    expect([...getFillSpansAtFrame(tl, getColumnsAtFrame(tl, 0))]).toEqual([['L', { x: 0, width: 100 }], ['R', { x: 540, width: 100 }]]);
  });

  test.each(Object.keys(testPlans) as (keyof typeof testPlans)[])('%s as rows: every chunk graph is valid', (name) => {
    const plan = toRowsPlan(testPlans[name]);
    const tl = getRenderTimeline(plan, settings);
    for (const chunk of getRenderChunks(tl)) {
      for (const fill of ['blur', 'color'] as const) {
        const graph = buildVideoGraph({ timeline: tl, clips: testClips, sourcePaths: testSourcePaths('/m'), settings: testSettings({ fill: { mode: fill, color: '#000000' } }), chunk });
        const sizes = graph.inputs.map((args) => Object.values(testSources).find((s) => args.at(-1) === `/m/${s.file}`));
        expect(verifyFilterGraph(graph, { sourceSizes: sizes }), `chunk ${chunk.index}`).toEqual([]);
        // rows are composed top to bottom: every element goes on the canvas at x=0
        expect(graph.filterComplex).not.toMatch(/\[cv\d+\]\[\w+\]overlay=x=[^0]/);
        expect(graph.filterComplex).toContain(`s=${plan.width}x${plan.height}:`);
      }
    }
  });

  test('animated chunk: row layers of the full width, per-frame y, horizontal gap bars', () => {
    const plan = toRowsPlan(testPlans.relayout);
    const tl = getRenderTimeline(plan, settings);
    const graph = buildVideoGraph({ timeline: tl, clips: testClips, sourcePaths: testSourcePaths('/m'), settings: testSettings({ fadeInOut: false }), chunk: { f0: 60, f1: 75 } });
    // row 1 moves down while row 0 grows 632 → 776: y per frame
    expect(graph.filterComplex).toMatch(/overlay=x=0:y='640\+\d+\*gte\(t,[^']+':eval=frame:eof_action=pass/);
    // gap bar: the full width, gap px high
    expect(graph.filterComplex).toMatch(/color=c=0x303030:s=1080x8:r=30:d=0.533333,trim=end_frame=15\[gap\d+\]/);
    // row layers are 1080 px wide and as high as the row's longest extent in the chunk (row 0 over its blurred cover)
    expect(graph.filterComplex).toContain('scale=1080:776:flags=bilinear');
    expect(graph.filterComplex).toContain('color=c=black:s=1080x1280:');
    expect(graph.filterComplex).toMatchSnapshot();
  });

  test('static chunk with a pillarboxed rigid square in a wide row', () => {
    const plan = toRowsPlan(testPlans.fills);
    const tl = getRenderTimeline(plan, settings);
    const graph = buildVideoGraph({ timeline: tl, clips: testClips, sourcePaths: testSourcePaths('/m'), settings: testSettings({ fadeInOut: false }), chunk: { f0: 0, f1: 60 } });
    // the square is 440 px high in a 360 px wide row: letterbox in output terms (fill above and below)
    expect(graph.filterComplex).toContain('scale=360:360:flags=bicubic');
    expect(graph.filterComplex).toContain('overlay=x=0:y=40:shortest=1');
    expect(graph.filterComplex).toMatchSnapshot();
  });
});

describe('random plans from the planner', () => {
  const sourceIds = Object.keys(testSources) as TestSourceId[];

  // 16:9 (the original 25), then 9:16 (rows) and 1:1 (either axis) (T29)
  const cases = [
    ...Array.from({ length: 25 }, (_v, i) => [i + 1, 640, 360] as const),
    ...Array.from({ length: 15 }, (_v, i) => [i + 101, 360, 640] as const),
    ...Array.from({ length: 15 }, (_v, i) => [i + 201, 360, 360] as const),
  ];
  test.each(cases)('seed %i at %ix%i: every chunk graph is valid', (seed, outWidth, outHeight) => {
    const random = createRandom(seed);
    const clips: RenderClip[] = [];
    const plannerClips: PlannerClip[] = [];
    const n = 3 + Math.floor(random() * 8);
    for (let i = 0; i < n; i += 1) {
      const sourceId = sourceIds[Math.floor(random() * sourceIds.length)]!;
      const { width, height } = testSources[sourceId];
      // random min rect: some rigid, some croppable in one or both directions
      const mw = random() < 0.3 ? width : 2 * Math.round((width * (0.4 + random() * 0.6)) / 2);
      const mh = random() < 0.5 ? height : 2 * Math.round((height * (0.6 + random() * 0.4)) / 2);
      const maxRect = { x: 0, y: 0, width, height };
      const minRect = { x: 2 * Math.round((width - mw) / 4), y: 2 * Math.round((height - mh) / 4), width: mw, height: mh };
      const duration = Math.round((1 + random() * 6) * 100) / 100;
      clips.push({ id: `k${i}`, sourceId, start: Math.round(random() * 2 * 10) / 10, maxRect, minRect });
      plannerClips.push({ id: `k${i}`, duration, aspectRange: getAspectRange(maxRect, minRect), rects: { maxRect, minRect } });
    }
    const fps = [24, 25, 30][seed % 3] as 24 | 25 | 30;
    const gap = [0, 4, 8][seed % 3]!;
    const transition = seed % 5 === 0 ? 0 : 0.5;
    const settings = testSettings({ fps, gap: { width: gap, color: '#101010' }, transition: { type: 'wipeleft', duration: transition }, fill: { mode: seed % 2 === 0 ? 'blur' : 'color', color: '#000000' } });
    const plan = planMix({ clips: plannerClips, settings: { width: outWidth, height: outHeight, maxColumns: 3, gap, reorderWindow: 3, order: { mode: 'random', seed }, transitionDuration: transition } });
    const tl = getRenderTimeline(plan, { fps, gap, transitionDuration: transition });
    const chunks = getRenderChunks(tl, { maxChunkSeconds: 3 });
    expect(chunks.reduce((acc, c) => acc + c.f1 - c.f0, 0)).toBe(tl.totalFrames);

    // no cut inside an xfade or a fade into fill; every layout change is inside a single chunk
    const busy = getBusyIntervals(tl);
    for (const c of chunks.slice(1)) expect(busy.some((b) => c.f0 > b.start && c.f0 < b.end)).toBe(false);

    for (const chunk of chunks) {
      const graph = buildVideoGraph({ timeline: tl, clips, sourcePaths: testSourcePaths('/m'), settings, chunk });
      const sizes = graph.inputs.map((args) => Object.values(testSources).find((s) => args.at(-1) === `/m/${s.file}`));
      expect(verifyFilterGraph(graph, { sourceSizes: sizes }), `chunk ${chunk.index}`).toEqual([]);
      // xfade inputs of a column always have the same layer width: checked indirectly, every xfade has 2 inputs
      for (const c of parseFilterGraph(graph.filterComplex)) {
        if (c.filters.some((f) => f.startsWith('xfade='))) expect(c.inputs).toHaveLength(2);
      }
    }
  });
});

describe('anamorphic sources (B1)', () => {
  // test source h720 shown at 1358x720 (1280x720 coded at 679:640), with the user's rect
  const frame = { width: 1358, height: 720, sar: { num: 679, den: 640 } };
  const coded = { width: 1280, height: 720 };
  const maxRect = { x: 78, y: 14, width: 1232, height: 694 };
  const clips: RenderClip[] = [
    { id: 'u', sourceId: 'h720', start: 0, maxRect, minRect: { x: 478, y: 160, width: 400, height: 400 } },
    // rigid, so that a narrow column letterboxes it over its blurred cover
    { id: 'r', sourceId: 'h720', start: 1, maxRect },
  ];
  const plan = (placements: [string, number, number][], columns: [number, number][]) => ({
    width: 640,
    height: 360,
    duration: 3,
    placements: placements.map(([clipId, column, endTime]) => ({ clipId, column, startTime: 0, endTime, transitionIn: 0 })),
    layouts: [{ time: 0, transitionDuration: 0, columns: columns.map(([x, width], column) => ({ column, x, width })), fills: [] }],
    warnings: [],
  });

  test('crops in coded pixels inside the coded frame; the scale restores the proportion', () => {
    const settings = testSettings({ fill: { mode: 'blur', color: '#000000' } });
    const tl = getRenderTimeline(plan([['u', 0, 3], ['r', 1, 3]], [[0, 424], [432, 208]]), { fps: 30, gap: 8, transitionDuration: 0.5 });
    const graph = buildVideoGraph({ timeline: tl, clips, sourcePaths: testSourcePaths('/m'), sourceFrames: { h720: frame }, settings, chunk: { f0: 0, f1: tl.totalFrames } });
    expect(verifyFilterGraph(graph, { sourceSizes: graph.inputs.map(() => coded) })).toEqual([]);
    // the rigid clip: its whole rect, 78..1310 of 1358 → 74..1234 of 1280
    expect(graph.filterComplex).toContain('crop=1160:694:74:14,split');
    // its blurred cover is computed for the display aspect (1232/694), not left to force_original_aspect_ratio
    const cover = parseFilterGraph(graph.filterComplex).flatMap((c) => c.filters).filter((f) => f.startsWith('scale=') && f.includes('fast_bilinear'));
    expect(cover.length).toBeGreaterThan(0);
    expect(cover.every((f) => !f.includes('force_original_aspect_ratio'))).toBe(true);
  });

  test('re-layout (column layer): the union crop is in coded pixels too', () => {
    const settings = testSettings({ fill: { mode: 'blur', color: '#000000' } });
    const p = { ...plan([['u', 0, 3], ['r', 1, 3]], [[0, 424], [432, 208]]) };
    p.layouts = [...p.layouts, { time: 1, transitionDuration: 0.5, columns: [{ column: 0, x: 0, width: 300 }, { column: 1, x: 308, width: 332 }], fills: [] }];
    const tl = getRenderTimeline(p, { fps: 30, gap: 8, transitionDuration: 0.5 });
    for (const chunk of getRenderChunks(tl, { maxChunkSeconds: 3 })) {
      const graph = buildVideoGraph({ timeline: tl, clips, sourcePaths: testSourcePaths('/m'), sourceFrames: { h720: frame }, settings, chunk });
      expect(verifyFilterGraph(graph, { sourceSizes: graph.inputs.map(() => coded) }), `chunk ${chunk.index}`).toEqual([]);
    }
  });

  test('square sources (or no sourceFrames) give the same graph as before', () => {
    const settings = testSettings();
    const tl = getRenderTimeline(testPlans.relayout, { fps: 30, gap: settings.gap.width, transitionDuration: settings.transition.duration });
    const chunk = { f0: 0, f1: tl.totalFrames };
    const square = Object.fromEntries(Object.entries(testSources).map(([id, s]) => [id, { width: s.width, height: s.height }]));
    expect(buildVideoGraph({ timeline: tl, clips: testClips, sourcePaths: testSourcePaths('/m'), sourceFrames: square, settings, chunk }))
      .toEqual(buildVideoGraph({ timeline: tl, clips: testClips, sourcePaths: testSourcePaths('/m'), settings, chunk }));
  });

  test('blurCover with the input aspect covers the fill explicitly', () => {
    // 1.775 input into a 240x136 (1/8 of 1920x1080) cover: wider → height 136, width ceil-even(136 × 1.775) = 242
    expect(blurCover(1920, 1080, 1232 / 694)).toContain('scale=242:136:flags=fast_bilinear,crop=240:136');
    // taller input → width 240
    expect(blurCover(1920, 1080, 0.5)).toContain('scale=240:480:flags=fast_bilinear,crop=240:136');
  });
});
