import { describe, test, expect } from 'vitest';

import { getAspectRange } from '../geometry';
import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay, createSoundOverlay, createTextOverlay } from '../overlays/factories';
import { resolveOverlayTimes } from '../overlays/resolveOverlayTimes';
import { planMix } from '../planner/planMix';
import { createRandom } from '../planner/random';
import type { PlannerClip } from '../planner/types';
import type { MixOverlay, TextOverlay } from '../types';
import { buildRenderJob } from './buildRenderJob';
import { buildVideoGraph } from './buildVideoGraph';
import type { RenderClip } from './buildVideoGraph';
import { escapeFilterValue, toFfmpegColor } from './ffmpegArgs';
import type { VideoGraphOverlays } from './overlayFilters';
import { getRenderChunks } from './renderChunks';
import { testClips, testPlans, testSettings, testSourcePaths, testSources } from './renderTestFixtures';
import type { TestSourceId } from './renderTestFixtures';
import { getRenderTimeline } from './renderTimeline';
import { parseFilterGraph, parseFilterOptions, unescapeFilterToken, verifyFilterGraph } from './verifyFilterGraph';

const fontPath = '/fonts/OpenSans-Bold.ttf';

/** One of each visual type (and a sound, which the video graph ignores), all visible in [0.5, 2.5) of the 3 s static plan. */
function testOverlays(): MixOverlay[] {
  const image = { ...createImageOverlay({ id: 'img', name: 'Logo', start: 0.5, filePath: '/img/logo.png' }), duration: 2, fadeIn: 0.4 };
  const countdown = {
    ...createCountdownOverlay({ id: 'cd', name: 'Countdown', start: 0.5 }),
    duration: 2,
    decimals: 1 as const,
    shadow: { x: 2, y: 2, color: '#00000080' },
    fadeOut: 0.5,
  };
  const bar = { ...createProgressBarOverlay({ id: 'bar', name: 'Bar', linkedCountdownId: 'cd' }), direction: 'btt' as const, mode: 'empty' as const };
  const sound = createSoundOverlay({ id: 'snd', name: 'Beep', start: 1, filePath: '/snd/beep.wav' });
  return [image, countdown, bar, sound];
}

function overlaysFor(overlays: MixOverlay[], plan: Parameters<typeof resolveOverlayTimes>[1]): VideoGraphOverlays {
  return { overlays, times: resolveOverlayTimes({ overlays, clips: [] }, plan), defaultFontPath: fontPath };
}

describe('escaping', () => {
  test.each([
    String.raw`C:\Users\Ana\Fonts\My Font.ttf`,
    '/home/ana/it\'s [new], v1; ok.ttf',
    '%{eif:floor(ceil((40-round(t*30))*10/30)/10):d:2}.%{eif:mod(ceil((40-round(t*30))*10/30),10):d:1}',
    String.raw`\\server\share\a:b.otf`,
  ])('%s survives both levels of ffmpeg unescaping', (value) => {
    const escaped = escapeFilterValue(value);
    // graph level: no bare separators left
    expect(parseFilterGraph(`[a]drawtext=text=${escaped}:x=0[b]`)).toHaveLength(1);
    expect(parseFilterGraph(`[a]drawtext=text=${escaped}:x=0[b]`)[0]!.filters).toHaveLength(1);
    expect(unescapeFilterToken(unescapeFilterToken(escaped))).toBe(value);
    expect(parseFilterOptions(`drawtext=fontfile=${escaped}:text=${escaped}:x=1`)).toEqual({ fontfile: value, text: value, x: '1' });
  });

  test('colours with alpha', () => {
    expect(toFfmpegColor('#00000080')).toBe('0x00000080');
    expect(toFfmpegColor('#ffffff')).toBe('0xffffff');
  });
});

describe('overlay filters', () => {
  const tl = getRenderTimeline(testPlans.static, { fps: 30, gap: 8, transitionDuration: 0.5 });
  const settings = testSettings({ fadeInOut: false });
  const overlays = overlaysFor(testOverlays(), testPlans.static);

  test('snapshot of a chunk with every overlay type', () => {
    const graph = buildVideoGraph({ timeline: tl, clips: testClips, sourcePaths: testSourcePaths('/m'), settings, chunk: { f0: 0, f1: 90 }, overlays });
    expect(verifyFilterGraph(graph)).toEqual([]);
    expect(graph.inputs.at(-1)).toEqual(['-f', 'image2', '-pattern_type', 'none', '-i', '/img/logo.png']);
    expect(graph.filterComplex).toMatchSnapshot();
  });

  test('layer order: image, then countdown, then bar, before vout', () => {
    const graph = buildVideoGraph({ timeline: tl, clips: testClips, sourcePaths: testSourcePaths('/m'), settings: testSettings({ fadeInOut: true }), chunk: { f0: 0, f1: 90 }, overlays });
    const chains = parseFilterGraph(graph.filterComplex);
    const index = (pred: (f: string) => boolean) => chains.findIndex((c) => c.filters.some((f) => pred(f)));
    const image = index((f) => f.startsWith('overlay=x=224:y=126:'));
    const text = index((f) => f.startsWith('drawtext='));
    const bar = index((f) => f.startsWith('overlay=x=20:'));
    const fade = index((f) => f.startsWith('fade=t=out:start_frame=0'));
    expect(image).toBeGreaterThan(0);
    expect(text).toBeGreaterThan(image);
    expect(bar).toBeGreaterThan(text);
    // under the global fade
    expect(fade).toBeGreaterThan(bar);
  });

  test('only the overlays visible in the chunk, with absolute times', () => {
    // [0, 15) frames: nothing starts before 0.5 s
    const before = buildVideoGraph({ timeline: tl, clips: testClips, sourcePaths: testSourcePaths('/m'), settings, chunk: { f0: 0, f1: 15 }, overlays });
    expect(before.filterComplex).not.toContain('drawtext');
    expect(before.inputs).toHaveLength(2);
    expect(before.filterComplex).toBe(buildVideoGraph({ timeline: tl, clips: testClips, sourcePaths: testSourcePaths('/m'), settings, chunk: { f0: 0, f1: 15 } }).filterComplex);

    // a chunk starting in the middle: the same absolute raw end (75) minus its f0
    const mid = buildVideoGraph({ timeline: tl, clips: testClips, sourcePaths: testSourcePaths('/m'), settings, chunk: { f0: 45, f1: 90 }, overlays });
    const drawtext = parseFilterGraph(mid.filterComplex).flatMap((c) => c.filters).find((f) => f.startsWith('drawtext='))!;
    expect(parseFilterOptions(drawtext)['text']).toBe('%{eif:floor(ceil((30-round(t*30))*10/30)/10):d}.%{eif:mod(ceil((30-round(t*30))*10/30),10):d:1}');
    expect(parseFilterOptions(drawtext)['enable']).toBe('between(t,-0.016667,0.983333)');
    // the image continues its fade timeline: its frame 0 in this chunk is frame 30 since its start
    expect(mid.filterComplex).toContain('settb=1/30,setpts=N+30,fade=t=in:st=0:d=0.4:alpha=1,fade=t=out:st=1.5:d=0.5:alpha=1,setpts=N+0[');
    // the bar's layer frame 0 is frame 30 of 60, emptying
    expect(mid.filterComplex).toMatch(/overlay=x='1':y='\d+-round\(\d+\*\(30-round\(t\*30\)\)\/60\)':eval=frame/);
  });

  test('a single drawtext: M:SS throughout when the (uncut) duration is ≥ 60 s, SS below', () => {
    const countdown = { ...createCountdownOverlay({ id: 'cd', name: 'C', start: 0 }), duration: 61, leadingZeros: true };
    const plan = { ...testPlans.static, duration: 70 };
    const longTl = getRenderTimeline({ ...plan, placements: plan.placements.map((p) => ({ ...p, endTime: 70 })) }, { fps: 30, gap: 8, transitionDuration: 0.5 });
    const graph = buildVideoGraph({ timeline: longTl, clips: testClips, sourcePaths: testSourcePaths('/m'), settings, chunk: { f0: 0, f1: 90 }, overlays: overlaysFor([countdown], plan) });
    const texts = parseFilterGraph(graph.filterComplex).flatMap((c) => c.filters).filter((f) => f.startsWith('drawtext=')).map((f) => parseFilterOptions(f));
    // 61 s = 1830 frames, always shown as M:SS (single drawtext, no switch)
    expect(texts.map((t) => [t['text'], t['enable']])).toEqual([
      ['%{eif:floor(ceil((1830-round(t*30))*1/30)/60):d:2}:%{eif:mod(floor(ceil((1830-round(t*30))*1/30)/1),60):d:2}', 'between(t,-0.016667,2.983333)'],
    ]);

    // below 60 s of (uncut) duration: always SS, even at its very first frame
    const short = { ...createCountdownOverlay({ id: 'cd2', name: 'C2', start: 0 }), duration: 59 };
    const shortGraph = buildVideoGraph({ timeline: tl, clips: testClips, sourcePaths: testSourcePaths('/m'), settings, chunk: { f0: 0, f1: 90 }, overlays: overlaysFor([short], testPlans.static) });
    const shortText = parseFilterGraph(shortGraph.filterComplex).flatMap((c) => c.filters).find((f) => f.startsWith('drawtext='))!;
    expect(parseFilterOptions(shortText)['text']).not.toContain('}:%{eif'); // no minutes:seconds separator
  });

  test('render job passes the overlays to every chunk', () => {
    const job = buildRenderJob({ plan: testPlans.static, clips: testClips, sourcePaths: testSourcePaths('/m'), settings, workDir: '/w', outPath: '/o.mp4', maxChunkSeconds: 1, overlays });
    expect(job.chunks.length).toBeGreaterThan(2);
    // only the chunks that the image touches open it
    expect(job.chunks.map((c) => c.args.includes('/img/logo.png'))).toEqual(job.chunks.map((c) => c.chunk.f1 > 15 && c.chunk.f0 < 75));
  });
});

describe('text overlays', () => {
  const tl = getRenderTimeline(testPlans.static, { fps: 30, gap: 8, transitionDuration: 0.5 });
  const settings = testSettings({ fadeInOut: false });
  const W = testPlans.static.width;
  const H = testPlans.static.height;

  const drawtexts = (overlays: MixOverlay[], chunk?: { f0: number, f1: number }) => {
    const graph = buildVideoGraph({ timeline: tl, clips: testClips, sourcePaths: testSourcePaths('/m'), settings, chunk: chunk ?? { f0: 0, f1: 90 }, overlays: overlaysFor(overlays, testPlans.static) });
    expect(verifyFilterGraph(graph)).toEqual([]);
    return parseFilterGraph(graph.filterComplex).flatMap((c) => c.filters).filter((f) => f.startsWith('drawtext=')).map((f) => parseFilterOptions(f));
  };
  const text = (props: Partial<TextOverlay>): TextOverlay => ({ ...createTextOverlay({ id: 't', name: 'T', start: 0.5, text: '' }), duration: 2, fadeIn: 0, fadeOut: 0, ...props });

  test('one literal drawtext per line, aligned in the box and placed by font metrics', () => {
    const special = String.raw`it's 100% {x} \ a:b [c];`;
    const options = drawtexts([text({ text: `First\n\n${special}   \n  last`, align: 'right', fontSize: 0.1, lineSpacing: 0.5, box: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 } })]);
    // the empty line takes its place but isn't drawn; trailing spaces are dropped, leading ones kept
    expect(options.map((o) => o['text'])).toEqual(['First', special, '  last']);
    const size = Math.round(0.1 * H);
    expect(options.every((o) => o['fontsize'] === String(size) && o['y_align'] === 'font' && o['expansion'] === 'none')).toBe(true);
    const boxX = 2 * Math.round((0.1 * W) / 2);
    const boxW = 2 * Math.round((0.5 * W) / 2);
    expect(options[0]!['x']).toBe(`${boxX}+(${boxW}-text_w)*1`);
    // 4 lines of `size` with 0.5·size between them, centered in the box: line i at blockTop + i·1.5·size + size/2
    const boxY = 2 * Math.round((0.2 * H) / 2);
    const boxH = 2 * Math.round((0.4 * H) / 2);
    const blockTop = boxY + (boxH - size * 5.5) / 2;
    const ys = options.map((o) => Number(/^([\d.-]+)-\(font_a\+font_d\)\/2$/.exec(o['y']!)![1]));
    [0, 2, 3].forEach((line, i) => expect(ys[i]).toBeCloseTo(blockTop + line * 1.5 * size + size / 2, 5));
    // frames [15, 75)
    expect(options.every((o) => o['enable'] === 'between(t,0.483333,2.483333)')).toBe(true);
    // no alpha without fades
    expect(options[0]!['alpha']).toBeUndefined();
  });

  test('fades: alpha from the raw start and until the raw end, with absolute frames in any chunk', () => {
    const [first] = drawtexts([text({ text: 'Hi', fadeIn: 0.5, fadeOut: 1 })]);
    expect(first!['alpha']).toBe('min(min(1,(-15+round(t*30))/15),(75-round(t*30))/30)');
    const [mid] = drawtexts([text({ text: 'Hi', fadeIn: 0.5, fadeOut: 1 })], { f0: 45, f1: 90 });
    expect(mid!['alpha']).toBe('min(min(1,(30+round(t*30))/15),(30-round(t*30))/30)');
  });

  test('slide: eased x or y from outside the frame', () => {
    const fromLeft = drawtexts([text({ text: 'Hi', align: 'left', entry: { kind: 'slide', from: 'left', duration: 1 } })])[0]!;
    expect(fromLeft['x']).toMatch(/^(\d+)-\(max\(\d+,\1\+text_w\)\+\d+\)\*pow\(1-min\(1,\(-15\+round\(t\*30\)\)\/30\),3\)$/);
    const fromBottom = drawtexts([text({ text: 'Hi', entry: { kind: 'slide', from: 'bottom', duration: 1 } })])[0]!;
    expect(fromBottom['y']).toMatch(/-\(font_a\+font_d\)\/2\+[\d.]+\*pow\(1-min\(1,\(-15\+round\(t\*30\)\)\/30\),3\)$/);
    expect(fromBottom['x']).not.toContain('pow');
  });

  test('typewriter: one drawtext per step, partial lines aligned by the whole line, contiguous in time', () => {
    // 5 characters in 0.2 s (6 frames): none on the text's first frame (15), then one per frame
    const options = drawtexts([text({ text: 'ab c\nd', align: 'center', entry: { kind: 'typewriter', duration: 0.2 } })]);
    const sec = (f: number) => String(Math.round((f / 30) * 1e6) / 1e6);
    expect(options.map((o) => [o['text'], o['enable'], o['line_spacing']])).toEqual([
      // "ab " looks like "ab": merged
      ['a\nab c', `between(t,${sec(15.5)},${sec(16.5)})`, String(10 * H)],
      ['ab\nab c', `between(t,${sec(16.5)},${sec(18.5)})`, String(10 * H)],
      ['ab c', `between(t,${sec(18.5)},${sec(74.5)})`, undefined],
      ['d', `between(t,${sec(19.5)},${sec(74.5)})`, undefined],
    ]);
    // all of them aligned with text_w (of the whole line for the partial ones)
    expect(new Set(options.map((o) => o['x'])).size).toBe(1);
  });

  test('empty text draws nothing', () => {
    expect(drawtexts([text({ text: ' \n ' })])).toEqual([]);
  });
});

describe('random plans with overlays', () => {
  const sourceIds = Object.keys(testSources) as TestSourceId[];

  test.each(Array.from({ length: 10 }, (_v, i) => i + 1))('seed %i: every chunk graph is valid', (seed) => {
    const random = createRandom(seed * 7);
    const clips: RenderClip[] = [];
    const plannerClips: PlannerClip[] = [];
    for (let i = 0; i < 5; i += 1) {
      const sourceId = sourceIds[Math.floor(random() * sourceIds.length)]!;
      const { width, height } = testSources[sourceId];
      const maxRect = { x: 0, y: 0, width, height };
      clips.push({ id: `k${i}`, sourceId, start: 0, maxRect });
      plannerClips.push({ id: `k${i}`, duration: 1 + Math.round(random() * 40) / 10, aspectRange: getAspectRange(maxRect, undefined), rects: { maxRect } });
    }
    const fps = [24, 25, 30][seed % 3] as 24 | 25 | 30;
    const plan = planMix({ clips: plannerClips, settings: { width: 640, height: 360, maxColumns: 3, gap: 4, reorderWindow: 3, order: { mode: 'random', seed }, transitionDuration: 0.5 } });
    const overlays: MixOverlay[] = [];
    for (let i = 0; i < 6; i += 1) {
      const start = Math.round(random() * plan.duration * 100) / 100 - 0.5;
      const common = { id: `o${i}`, name: `o${i}`, start: Math.max(0, start) };
      const kind = Math.floor(random() * 4);
      const box = { x: random() * 0.5, y: random() * 0.5, width: 0.05 + random() * 0.4, height: 0.05 + random() * 0.4 };
      const duration = 0.2 + random() * 70;
      switch (kind) {
        case 0: { overlays.push({ ...createImageOverlay({ ...common, filePath: `/i/${i}.png` }), box, duration, fadeIn: random(), fadeOut: random() * 3 }); break; }
        case 1: { overlays.push({ ...createCountdownOverlay(common), box, duration, decimals: Math.floor(random() * 4) as 0 | 1 | 2 | 3, leadingZeros: random() < 0.5, align: 'center', fadeOut: random() }); break; }
        case 2: { overlays.push({ ...createProgressBarOverlay(common), box, duration, direction: (['ltr', 'rtl', 'btt', 'ttb'] as const)[i % 4]!, mode: random() < 0.5 ? 'fill' : 'empty', border: { width: random() * 20, color: '#ff0000' } }); break; }
        default: {
          const lines = ['50% off!', String.raw`it's {new}; [a,b] C:\x`, '', '  indented  ', 'é🎉 ok'];
          overlays.push({
            ...createTextOverlay({ ...common, text: lines.slice(0, 1 + (i % 5)).join('\n') }),
            box,
            duration,
            align: (['left', 'center', 'right'] as const)[i % 3]!,
            fadeIn: random(),
            fadeOut: random(),
            entry: { kind: (['none', 'slide', 'typewriter'] as const)[i % 3]!, from: (['left', 'right', 'top', 'bottom'] as const)[i % 4]!, duration: random() * 3 },
          });
        }
      }
    }
    const settings = testSettings({ fps, gap: { width: 4, color: '#101010' } });
    const tl = getRenderTimeline(plan, { fps, gap: 4, transitionDuration: 0.5 });
    const graphOverlays = { overlays, times: resolveOverlayTimes({ overlays, clips: [] }, plan), defaultFontPath: String.raw`C:\Fonts\a font.ttf` };
    for (const chunk of getRenderChunks(tl, { maxChunkSeconds: 2 })) {
      const graph = buildVideoGraph({ timeline: tl, clips, sourcePaths: testSourcePaths('/m'), settings, chunk, overlays: graphOverlays });
      expect(verifyFilterGraph(graph), `chunk ${chunk.index}`).toEqual([]);
    }
  });
});
