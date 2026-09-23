import { describe, test, expect } from 'vitest';

import { getAspectRange } from '../geometry';
import { planMix } from '../planner/planMix';
import { createRandom } from '../planner/random';
import type { PlannerClip } from '../planner/types';
import { blurCover, buildVideoGraph, formatNumber, stepExpr, toFfmpegColor } from './buildVideoGraph';
import type { RenderClip } from './buildVideoGraph';
import { getBusyIntervals, getRenderChunks } from './renderChunks';
import { testClips, testPlans, testSettings, testSourcePaths, testSources } from './renderTestFixtures';
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

describe('random plans from the planner', () => {
  const sourceIds = Object.keys(testSources) as TestSourceId[];

  test.each(Array.from({ length: 25 }, (_v, i) => i + 1))('seed %i: every chunk graph is valid', (seed) => {
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
    const plan = planMix({ clips: plannerClips, settings: { width: 640, height: 360, maxColumns: 3, gap, reorderWindow: 3, order: { mode: 'random', seed }, transitionDuration: transition } });
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
