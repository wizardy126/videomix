import { describe, test, expect } from 'vitest';

import { getAspectRange } from '../geometry';
import { planMix } from '../planner/planMix';
import { createRandom } from '../planner/random';
import type { MixPlan, PlannerClip } from '../planner/types';
import { blurCover, buildVideoGraph, formatNumber, frameStepExpr, stepExpr, toFfmpegColor } from './buildVideoGraph';
import type { RenderClip } from './buildVideoGraph';
import { getBusyIntervals, getRenderChunks } from './renderChunks';
import { testClips, testPlans, testSettings, testSourcePaths, testSources, toRowsPlan } from './renderTestFixtures';
import type { TestSourceId } from './renderTestFixtures';
import { getColumnsAtFrame, getFillSpansAtFrame, getRenderTimeline } from './renderTimeline';
import { parseFilterGraph, parseFilterOptions, verifyFilterGraph } from './verifyFilterGraph';

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

describe('extension beyond the max (E7, T38b)', () => {
  // a 9:16 max in the middle of the 1920x1080 source, shown in a full-width column
  const v: RenderClip = { id: 'v', sourceId: 'h1080', start: 0, maxRect: { x: 656, y: 0, width: 608, height: 1080 } };
  const full = { x: 0, y: 0, width: 1920, height: 1080 };
  const settings = testSettings({ gap: { width: 0, color: '#000000' } });
  const graphOf = (p: MixPlan) => {
    const tl = getRenderTimeline(p, { fps: 30, gap: 0, transitionDuration: 0.5 });
    return getRenderChunks(tl, { maxChunkSeconds: 5 }).map((chunk) => buildVideoGraph({ timeline: tl, clips: [v], sourcePaths: testSourcePaths('/m'), settings, chunk }));
  };
  const base: MixPlan = {
    width: 640,
    height: 360,
    duration: 3,
    placements: [{ clipId: 'v', column: 0, startTime: 0, endTime: 3, transitionIn: 0 }],
    layouts: [{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 640 }], fills: [] }],
    warnings: [],
  };

  test('a static column crops the extended rect instead of pillarboxing', () => {
    const [before] = graphOf(base);
    expect(before!.filterComplex).toContain('crop=608:1080:656:0,split');
    const [graph] = graphOf({ ...base, placements: [{ ...base.placements[0]!, extendedMaxRect: full }] });
    expect(graph!.filterComplex).toContain('crop=1920:1080:0:0,scale=640:360:flags=bicubic');
    expect(graph!.filterComplex).not.toContain('split');
    expect(verifyFilterGraph(graph!, { sourceSizes: [full] })).toEqual([]);
  });

  test('a column growing in a re-layout crops the union of its extended crops, inside the source', () => {
    const p: MixPlan = {
      ...base,
      placements: [{ ...base.placements[0]!, extendedMaxRect: full }],
      layouts: [
        { time: 0, transitionDuration: 0, columns: [{ column: 0, x: 218, width: 202 }], fills: [{ x: 0, width: 218 }, { x: 420, width: 220 }] },
        { time: 1, transitionDuration: 0.5, columns: [{ column: 0, x: 0, width: 640 }], fills: [] },
      ],
    };
    const graphs = graphOf(p);
    const animated = graphs.find((g) => g.filterComplex.includes('eval=frame'))!;
    // the last animated frame is 634 px wide: 1904 source px, centred on the max
    expect(animated.filterComplex).toContain('crop=1904:1080:8:0');
    graphs.forEach((g) => expect(verifyFilterGraph(g, { sourceSizes: g.inputs.map(() => full) })).toEqual([]));
  });
});

describe('turned clips (E9, T38d)', () => {
  // h1080 is 1920x1080; turned a quarter, the clip's frame is 1080x1920
  const frames = { h1080: { width: 1920, height: 1080 } };
  const source = { width: 1920, height: 1080 };
  const settings = testSettings({ gap: { width: 0, color: '#000000' }, fill: { mode: 'blur', color: '#000000' } });
  const single = (width: number, height: number, extra: Partial<MixPlan> = {}): MixPlan => ({
    width,
    height,
    duration: 3,
    placements: [{ clipId: 't', column: 0, startTime: 0, endTime: 3, transitionIn: 0 }],
    layouts: [{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width }], fills: [] }],
    warnings: [],
    ...extra,
  });
  const graphsOf = (p: MixPlan, clip: RenderClip) => {
    const tl = getRenderTimeline(p, { fps: 30, gap: 0, transitionDuration: 0.5 });
    return getRenderChunks(tl, { maxChunkSeconds: 5 }).map((chunk) => buildVideoGraph({ timeline: tl, clips: [clip], sourcePaths: testSourcePaths('/m'), sourceFrames: frames, settings, chunk }));
  };

  test('the crop is in the unturned frame and only the crop is turned, before the scale', () => {
    // a max of the turned frame: turned 90° clockwise, its y 200..1120 is the source's x 200..1120 (x 800..1720 at 270°)
    const maxRect = { x: 0, y: 200, width: 1080, height: 920 };
    // T44b: the 360x306 cell (1.1765) is 0.2 % wider than the rigid 1080x920 max (1.1739): 2 px of its height are cut
    // (turned y 202..1120) instead of stretching it
    const expected = {
      90: 'crop=918:1080:202:0,transpose=clock,scale=360:306',
      180: 'crop=1080:918:840:160,hflip,vflip,scale=360:306',
      270: 'crop=918:1080:800:0,transpose=cclock,scale=360:306',
    } as const;
    for (const [rotation, filters] of Object.entries(expected)) {
      const clip: RenderClip = { id: 't', sourceId: 'h1080', start: 0, maxRect: rotation === '180' ? { x: 0, y: 0, width: 1080, height: 920 } : maxRect, rotation: Number(rotation) as 90 | 180 | 270 };
      const [graph] = graphsOf(single(360, 306), clip);
      expect(graph!.filterComplex, rotation).toContain(filters);
      expect(verifyFilterGraph(graph!, { sourceSizes: [source] })).toEqual([]);
    }
  });

  test('pillarbox: the blurred cover is turned too; the unturned clip is unchanged', () => {
    const maxRect = { x: 0, y: 420, width: 1080, height: 1080 };
    const [graph] = graphsOf(single(640, 360), { id: 't', sourceId: 'h1080', start: 0, maxRect, rotation: 90 });
    // turned y 420..1500 = source x 420..1500, turned x 0..1080 = source y 0..1080
    expect(graph!.filterComplex).toContain('crop=1080:1080:420:0,transpose=clock,split');
    expect(verifyFilterGraph(graph!, { sourceSizes: [source] })).toEqual([]);
    const [plain] = graphsOf(single(640, 360), { id: 't', sourceId: 'h1080', start: 0, maxRect: { x: 420, y: 0, width: 1080, height: 1080 } });
    expect(plain!.filterComplex).not.toMatch(/transpose|hflip/);
  });

  test('re-layout (column layer): the union crop is turned back into the source frame', () => {
    const clip: RenderClip = { id: 't', sourceId: 'h1080', start: 0, maxRect: { x: 0, y: 0, width: 1080, height: 1920 }, minRect: { x: 0, y: 420, width: 1080, height: 1080 }, rotation: 270 };
    const p = single(640, 360, {
      layouts: [
        { time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 202 }], fills: [{ x: 202, width: 438 }] },
        { time: 1, transitionDuration: 0.5, columns: [{ column: 0, x: 0, width: 360 }], fills: [{ x: 360, width: 280 }] },
      ],
    });
    const graphs = graphsOf(p, clip);
    const animated = graphs.find((g) => g.filterComplex.includes('eval=frame'))!;
    expect(animated.filterComplex).toMatch(/crop=\d+:1080:\d+:0,transpose=cclock,scale=w=/);
    graphs.forEach((g) => expect(verifyFilterGraph(g, { sourceSizes: g.inputs.map(() => source) })).toEqual([]));
  });

  test('turned anamorphic source: the unturned crop goes to coded pixels', () => {
    // 1280x720 coded at 679:640 → 1358x720; turned 90° the clip frame is 720x1358
    const ana = { h720: { width: 1358, height: 720, sar: { num: 679, den: 640 } } };
    const clip: RenderClip = { id: 't', sourceId: 'h720', start: 0, maxRect: { x: 14, y: 48, width: 694, height: 1232 }, rotation: 90 };
    const tl = getRenderTimeline(single(360, 640), { fps: 30, gap: 0, transitionDuration: 0.5 });
    const graph = buildVideoGraph({ timeline: tl, clips: [clip], sourcePaths: testSourcePaths('/m'), sourceFrames: ana, settings, chunk: { f0: 0, f1: tl.totalFrames } });
    // turned (14, 48) 694x1232 = display (48, 12) 1232x694 → coded x 46..1206
    expect(graph.filterComplex).toContain('crop=1160:694:46:12,transpose=clock,scale=360:640');
    expect(verifyFilterGraph(graph, { sourceSizes: [{ width: 1280, height: 720 }] })).toEqual([]);
  });
});

/** Value of a flat sum of steps over a variable (`v0+Δ*gte(in,m)…`) at `value`. */
function evalSteps(expr: string, value: number) {
  const text = expr.replaceAll("'", '');
  const [first, ...rest] = text.split(/(?=[+-]\d[\d.]*\*gte\()/);
  let sum = Number(first);
  for (const term of rest) {
    const m = /^([+-][\d.]+)\*gte\(\w+,(\d+)\)$/.exec(term);
    if (m == null) throw new Error(`bad term ${term}`);
    if (value >= Number(m[2])) sum += Number(m[1]);
  }
  return sum;
}

describe('animated framing (A9, T48)', () => {
  const frames = { h1080: { width: 1920, height: 1080 } };
  const source = { width: 1920, height: 1080 };
  const settings = testSettings({ gap: { width: 0, color: '#000000' }, fill: { mode: 'blur', color: '#000000' }, fadeInOut: false });
  const maxRect = { x: 160, y: 90, width: 1600, height: 900 };
  const single = (width: number, height: number, extra: Partial<MixPlan> = {}): MixPlan => ({
    width,
    height,
    duration: 2,
    placements: [{ clipId: 'k', column: 0, startTime: 0, endTime: 2, transitionIn: 0 }],
    layouts: [{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width }], fills: [] }],
    warnings: [],
    ...extra,
  });
  const graphsOf = (p: MixPlan, clip: RenderClip, sourceFrames: Record<string, { width: number, height: number, sar?: { num: number, den: number } }> = frames) => {
    const tl = getRenderTimeline(p, { fps: 30, gap: 0, transitionDuration: 0.5 });
    return getRenderChunks(tl, { maxChunkSeconds: 5 }).map((chunk) => buildVideoGraph({ timeline: tl, clips: [clip], sourcePaths: testSourcePaths('/m'), sourceFrames, settings, chunk }));
  };
  // pan to the right and zoom in to half the size over the clip's 2nd second (source 1..2 s), from start 0.5
  const keyframes = [
    { time: 1, centerX: 960, centerY: 540, scale: 1, interpolation: 'linear' as const },
    { time: 2, centerX: 1100, centerY: 500, scale: 0.5 },
  ];
  const clip: RenderClip = { id: 'k', sourceId: 'h1080', start: 0.5, maxRect, keyframes };

  test('frameStepExpr: steps over the frame number (perspective counts from 1), rounded to 1/1000 px', () => {
    expect(frameStepExpr([3, 3, 3])).toBe('3');
    expect(frameStepExpr([0, 0.5, 0.5, 1.0004])).toBe("'0+0.5*gte(in,2)+0.5*gte(in,4)'");
    expect(frameStepExpr([10, 9.25], 'n', 0)).toBe("'10-0.75*gte(n,1)'");
  });

  test('a static column: crop of the union, then perspective with the sub-pixel crop of every frame', () => {
    const [graph] = graphsOf(single(640, 360), clip);
    expect(verifyFilterGraph(graph!, { sourceSizes: [source] })).toEqual([]);
    const chain = parseFilterGraph(graph!.filterComplex).find((c) => c.inputs[0] === '0:v')!;
    // head, crop of the union of all the frames' crops, perspective, scale to the cell
    const names = chain.filters.map((f) => f.split('=')[0]);
    expect(names.slice(-4)).toEqual(['crop', 'perspective', 'scale', 'setsar']);
    // the union: from the whole max (before the animation) to the zoomed crop, which lies inside it
    expect(chain.filters.at(-4)).toBe('crop=1600:900:160:90');
    expect(chain.filters.at(-2)).toBe('scale=640:360:flags=bicubic');
    const persp = parseFilterOptions(chain.filters.at(-3)!);
    expect(persp).toMatchObject({ interpolation: 'linear', sense: 'source', eval: 'frame' });
    // top-left corner: 0 while holding the first keyframe (source < 1 s, the first 15 frames), then the linear move
    // to the zoomed crop (centre 1100,500, 800x450): x0 = 700 − 160 = 540 at frame 45 (source 2 s)
    const x0 = (n: number) => evalSteps(persp['x0']!, n + 1);
    expect(x0(0)).toBe(0);
    expect(x0(15)).toBe(0);
    expect(x0(16)).toBeCloseTo(540 / 30, 3);
    expect(x0(30)).toBeCloseTo(270, 3);
    expect(x0(45)).toBeCloseTo(540, 3);
    expect(x0(59)).toBeCloseTo(540, 3);
    expect(evalSteps(persp['x1']!, 46) - x0(45)).toBeCloseTo(800, 3);
    expect(evalSteps(persp['y2']!, 46) - evalSteps(persp['y0']!, 46)).toBeCloseTo(450, 3);
    // same corners for x1/x3, y0/y1…
    expect(persp['x3']).toBe(persp['x1']);
    expect(persp['y1']).toBe(persp['y0']);
    expect(persp['x2']).toBe(persp['x0']);
    expect(graph!.filterComplex).toMatchSnapshot();
  });

  test('not moving during the chunk: a static crop (even px); at the base transform, exactly the unanimated graph', () => {
    const plain = graphsOf(single(640, 360), { ...clip, keyframes: undefined });
    // one keyframe at the base transform: nothing changes
    expect(graphsOf(single(640, 360), { ...clip, keyframes: [{ time: 3, centerX: 960, centerY: 540, scale: 1 }] })).toEqual(plain);
    // holding a keyframe (after the last one): that framing, rounded to even px around its centre
    const [held] = graphsOf(single(640, 360), { ...clip, keyframes: [{ time: 0, centerX: 1101, centerY: 500, scale: 0.5 }] });
    expect(held!.filterComplex).not.toContain('perspective');
    expect(held!.filterComplex).toContain('crop=800:450:702:276,scale=640:360');
  });

  test('pillarbox: the blurred cover gets the crop\'s aspect (the perspective\'s picture has the union\'s)', () => {
    const [graph] = graphsOf(single(640, 360), { ...clip, maxRect: { x: 400, y: 0, width: 608, height: 1080 }, keyframes: [{ time: 1, centerX: 704, centerY: 540, scale: 1 }, { time: 2, centerX: 900, centerY: 540, scale: 0.8 }] });
    expect(verifyFilterGraph(graph!, { sourceSizes: [source] })).toEqual([]);
    expect(graph!.filterComplex).toMatch(/perspective=[^[]+eval=frame,split\[/);
    // cover of 608/1080 at 80x46: taller than wide → width 80, height ceil-even(80 / 0.563) = 142
    expect(graph!.filterComplex).toContain(blurCover(640, 360, 608 / 1080));
    expect(graph!.filterComplex).toContain('scale=202:360:flags=bicubic');
  });

  test('pre-scaled when the source has much more resolution than the cell needs', () => {
    const [small] = graphsOf(single(160, 90), clip);
    // the most zoomed crop is 800 px wide for a 160 px cell: the 1600 px union is reduced to 320 px first
    expect(small!.filterComplex).toContain('crop=1600:900:160:90,scale=320:180:flags=bicubic,perspective=');
    const persp = parseFilterOptions(parseFilterGraph(small!.filterComplex).flatMap((c) => c.filters).find((f) => f.startsWith('perspective='))!);
    expect(evalSteps(persp['x0']!, 46)).toBeCloseTo(540 / 5, 3);
    const [big] = graphsOf(single(640, 360), clip);
    expect(big!.filterComplex).not.toMatch(/crop=1600:900:160:90,scale=/);
  });

  test('turned and anamorphic: the union in coded px of the unturned frame, the corners in the turned picture\'s px', () => {
    // h720 at 679:640 (1358x720), turned 90°: the clip's frame is 720x1358
    const ana = { h720: { width: 1358, height: 720, sar: { num: 679, den: 640 } } };
    const turned: RenderClip = { id: 'k', sourceId: 'h720', start: 0, rotation: 90, maxRect: { x: 0, y: 0, width: 720, height: 1280 }, keyframes: [{ time: 0.5, centerX: 360, centerY: 640, scale: 1 }, { time: 1.5, centerX: 360, centerY: 700, scale: 0.5 }] };
    const [graph] = graphsOf(single(360, 640), turned, ana);
    expect(verifyFilterGraph(graph!, { sourceSizes: [{ width: 1280, height: 720 }] })).toEqual([]);
    // turned y 0..1280 = display x 0..1280 → coded x 0..1206 (÷ 679/640)
    expect(graph!.filterComplex).toContain('crop=1206:720:0:0,transpose=clock,perspective=');
    const persp = parseFilterOptions(parseFilterGraph(graph!.filterComplex).flatMap((c) => c.filters).find((f) => f.startsWith('perspective='))!);
    // the turned picture is 720x1206 coded px, 1279.47 display px (the coded crop's even edges): the zoomed crop (360x640
    // display px, centred at 360,700) in its px
    const k = 640 / 679;
    expect(evalSteps(persp['y0']!, 60)).toBeCloseTo((700 - 320) * k, 2);
    expect(evalSteps(persp['y2']!, 60)).toBeCloseTo((700 + 320) * k, 2);
    expect(evalSteps(persp['x0']!, 60)).toBeCloseTo(180, 2);
  });

  test('re-layout: the column layer with the animated crops, inside the source', () => {
    const p = single(640, 360, {
      layouts: [
        { time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 360 }], fills: [{ x: 360, width: 280 }] },
        { time: 1, transitionDuration: 0.5, columns: [{ column: 0, x: 0, width: 640 }], fills: [] },
      ],
    });
    const graphs = graphsOf(p, { ...clip, minRect: { x: 660, y: 90, width: 600, height: 900 } });
    const animated = graphs.find((g) => g.filterComplex.includes('overlay=x=\''))!;
    expect(animated.filterComplex).toMatch(/scale=w='[^']+':h='[^']+':eval=frame/);
    expect(animated.filterComplex).not.toContain('perspective');
    graphs.forEach((g) => expect(verifyFilterGraph(g, { sourceSizes: g.inputs.map(() => source) })).toEqual([]));
    // the chunks after the re-layout, where the column is static again, use the perspective
    expect(graphs.some((g) => g.filterComplex.includes('perspective'))).toBe(true);
  });

  test.each([1, 2, 3, 4, 5, 6])('random keyframes, seed %i: every chunk graph is valid', (seed) => {
    const random = createRandom(seed);
    const sourceIds = ['h1080', 'h720', 'v1080', 'sq'] as const;
    const clips: RenderClip[] = [];
    const plannerClips: PlannerClip[] = [];
    for (let i = 0; i < 6; i += 1) {
      const sourceId = sourceIds[Math.floor(random() * sourceIds.length)]!;
      const { width, height } = testSources[sourceId];
      const mw = 2 * Math.round((width * (0.5 + random() * 0.5)) / 2);
      const mh = 2 * Math.round((height * (0.5 + random() * 0.5)) / 2);
      const clipMax = { x: 2 * Math.round((width - mw) / 4), y: 2 * Math.round((height - mh) / 4), width: mw, height: mh };
      const start = Math.round(random() * 20) / 10;
      const kfs = Array.from({ length: 1 + Math.floor(random() * 3) }, (_v, k) => ({
        time: start + k + random(),
        centerX: random() * width,
        centerY: random() * height,
        scale: 0.3 + random(),
        ...(random() < 0.3 && { interpolation: (['linear', 'hold'] as const)[Math.floor(random() * 2)]! }),
      }));
      clips.push({ id: `k${i}`, sourceId, start, maxRect: clipMax, keyframes: kfs, ...(random() < 0.3 && { rotation: 90 as const }) });
      const rects = { maxRect: clips.at(-1)!.rotation === 90 ? { x: clipMax.y, y: clipMax.x, width: mh, height: mw } : clipMax };
      clips.at(-1)!.maxRect = rects.maxRect;
      plannerClips.push({ id: `k${i}`, duration: 1 + random() * 3, aspectRange: getAspectRange(rects.maxRect), rects });
    }
    const plan = planMix({ clips: plannerClips, settings: { width: 640, height: 360, maxColumns: 3, gap: 4, reorderWindow: 3, order: { mode: 'random', seed }, transitionDuration: 0.5 } });
    const tl = getRenderTimeline(plan, { fps: 30, gap: 4, transitionDuration: 0.5 });
    const sourceFrames = Object.fromEntries(Object.entries(testSources).map(([id, s]) => [id, { width: s.width, height: s.height }]));
    let perspectives = 0;
    for (const chunk of getRenderChunks(tl, { maxChunkSeconds: 2 })) {
      const graph = buildVideoGraph({ timeline: tl, clips, sourcePaths: testSourcePaths('/m'), sourceFrames, settings: testSettings({ gap: { width: 4, color: '#101010' } }), chunk });
      const sizes = graph.inputs.map((args) => Object.values(testSources).find((s) => args.at(-1) === `/m/${s.file}`));
      expect(verifyFilterGraph(graph, { sourceSizes: sizes }), `chunk ${chunk.index}`).toEqual([]);
      perspectives += graph.filterComplex.split('perspective=').length - 1;
    }
    expect(perspectives).toBeGreaterThan(0);
  });
});
