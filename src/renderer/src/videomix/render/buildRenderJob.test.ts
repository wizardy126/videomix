import path from 'node:path';
import { describe, test, expect } from 'vitest';

import { buildAudioGraph } from './buildAudioGraph';
import { buildRenderJob, getChunkConcurrency } from './buildRenderJob';
import type { RenderJob } from './buildRenderJob';
import { testClips, testPlans, testSettings, testSourcePaths, testSources } from './renderTestFixtures';
import { verifyFilterGraph } from './verifyFilterGraph';
import type { MixSettings } from '../types';
import type { MixPlan } from '../planner/types';

const sourcePaths = testSourcePaths('/media');

function job(plan: MixPlan, settings: MixSettings = testSettings(), options: Partial<Parameters<typeof buildRenderJob>[0]> = {}) {
  return buildRenderJob({ plan, clips: testClips, sourcePaths, settings, workDir: '/work', outPath: '/out/mix.mp4', ...options });
}

/** Oriented size of each input of a chunk, from its path. */
const sizesOf = (inputs: string[][]) => inputs.map((args) => Object.values(testSources).find((s) => args.at(-1) === `/media/${s.file}`));

function expectValidGraphs(renderJob: RenderJob) {
  for (const chunk of renderJob.chunks) {
    const graph = renderJob.files.find((f) => f.path === chunk.graphPath)!.content;
    const inputs: string[][] = [];
    const args = chunk.args.slice(0, chunk.args.indexOf('-/filter_complex'));
    for (let i = args.indexOf('-ss'); i >= 0 && i < args.length; i += 6) inputs.push(args.slice(i, i + 6));
    expect(verifyFilterGraph({ inputs, filterComplex: graph, outLabel: 'vout' }, { sourceSizes: sizesOf(inputs) }), `chunk ${chunk.chunk.index}`).toEqual([]);
  }
}

describe('buildRenderJob', () => {
  test.each(Object.keys(testPlans) as (keyof typeof testPlans)[])('%s plan: args and graphs', (name) => {
    const renderJob = job(testPlans[name]);
    expectValidGraphs(renderJob);
    expect(renderJob.chunks.reduce((acc, c) => acc + c.frames, 0)).toBe(renderJob.totalFrames);
    expect({
      totalFrames: renderJob.totalFrames,
      chunks: renderJob.chunks.map((c) => ({ ...c.chunk, args: c.args.join(' ') })),
      files: Object.fromEntries(renderJob.files.map((f) => [f.path, f.content])),
      audio: renderJob.audio.args.join(' '),
      concat: renderJob.concat.args.join(' '),
    }).toMatchSnapshot();
  });

  test('colour fill mode, no gap, fade in/out off', () => {
    const renderJob = job(testPlans.fills, testSettings({ fill: { mode: 'color', color: '#112233' }, gap: { width: 0, color: '#000000' }, fadeInOut: false }));
    expectValidGraphs(renderJob);
    const graphs = renderJob.files.map((f) => f.content).join('\n');
    expect(graphs).not.toContain('boxblur');
    expect(graphs).toContain('color=c=0x112233');
    expect(graphs).not.toContain('fade=t=');
    expect(renderJob.files.find((f) => f.path.endsWith('chunk-0000.graph.txt'))!.content).toMatchSnapshot();
  });

  test('preview encoding overrides and custom path join', () => {
    const renderJob = job(testPlans.static, testSettings(), { encoding: { preset: 'ultrafast', crf: 30 }, join: path.win32.join });
    expect(renderJob.chunks[0]!.args).toEqual(expect.arrayContaining(['ultrafast', '30']));
    expect(renderJob.chunks[0]!.outPath).toBe(path.win32.join('/work', 'chunk-0000.mp4'));
    expect(renderJob.files.find((f) => f.path.endsWith('chunks.txt'))!.content).toBe("file 'chunk-0000.mp4'\n");
    expect(renderJob.tempPaths).not.toContain('/out/mix.mp4');
    expect(renderJob.tempPaths).toContain(path.win32.join('/work', 'audio.m4a'));
  });

  test('audio pass hook', () => {
    const renderJob = job(testPlans.static, testSettings(), {
      buildAudioGraph: ({ duration, plan }) => ({
        inputs: [['-vn', '-i', '/media/x.mp4']],
        filterComplex: `[0:a]atrim=duration=${duration},volume=${plan.placements.length}[mix]`,
        outLabel: 'mix',
      }),
    });
    expect(renderJob.audio.args).toEqual(['-hide_banner', '-nostdin', '-y', '-vn', '-i', '/media/x.mp4', '-/filter_complex', '/work/audio.graph.txt', '-map', '[mix]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '/work/audio.m4a']);
    expect(renderJob.files.find((f) => f.path === '/work/audio.graph.txt')!.content).toBe('[0:a]atrim=duration=3,volume=2[mix]');
  });

  test('T12 buildAudioGraph fits the hook', () => {
    const clips = testClips.map((c) => ({ ...c, muted: false, gainDb: 0 }));
    const loudness = Object.fromEntries(clips.map((c) => [c.id, { hasAudio: true as const, inputI: -20, inputTp: -3, inputLra: 5, inputThresh: -30 }]));
    const renderJob = job(testPlans.substitutions, testSettings(), { buildAudioGraph: (input) => buildAudioGraph({ ...input, clips, loudness }) });
    expect(renderJob.audio.args).toEqual(expect.arrayContaining(['-map', '[aout]', '/work/audio.m4a']));
    expect(renderJob.audio.args.filter((a) => a === '-i')).toHaveLength(3);
  });

  test('long plans are split into chunks of at most maxChunkSeconds, never inside a transition', () => {
    const renderJob = job(testPlans.substitutions, testSettings(), { maxChunkSeconds: 1 });
    expectValidGraphs(renderJob);
    const cuts = renderJob.chunks.map((c) => c.chunk.f0);
    // xfade [75, 90), fade into fill [120, 135): no cut strictly inside
    expect(cuts.filter((f) => (f > 75 && f < 90) || (f > 120 && f < 135))).toEqual([]);
    expect(renderJob.chunks.every((c) => c.frames <= 30)).toBe(true);
    expect(renderJob.chunks.reduce((acc, c) => acc + c.frames, 0)).toBe(180);
  });

  test('concurrency', () => {
    expect(getChunkConcurrency({ height: 1080, cpuCount: 8 })).toBe(2);
    expect(getChunkConcurrency({ height: 2160, cpuCount: 8 })).toBe(1);
    expect(getChunkConcurrency({ height: 720, cpuCount: 2 })).toBe(1);
  });
});
