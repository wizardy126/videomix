import { describe, expect, test } from 'vitest';

import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay, createSoundOverlay, createTextOverlay } from '../overlays/factories';
import { resolveOverlayTimes } from '../overlays/resolveOverlayTimes';
import { buildAudioGraph } from '../render/buildAudioGraph';
import { buildRenderJob } from '../render/buildRenderJob';
import { testClips, testPlans, testSettings, testSourcePaths } from '../render/renderTestFixtures';
import { createEmptyMixProject } from '../types';
import type { LoudnessMeasurement, MixClip, MixOverlay, MixProject } from '../types';
import { groupOverlaysIntoBlock } from './blockOperations';
import { expandBlocks, resolveBlockTimes } from './expandBlocks';

// T56 acceptance: projects without blocks render exactly as before, and grouping overlays into a block doesn't change
// the render graphs (video and audio) at all.

const plan = testPlans.static;
const settings = testSettings({ fadeInOut: false });
const clips = testClips.map((c): MixClip => ({ ...c, name: c.id, color: 0, end: c.start + 3, muted: false, gainDb: 0 }));

function makeProject(): MixProject {
  const overlays: MixOverlay[] = [
    { ...createImageOverlay({ id: 'img', name: 'Logo', filePath: '/img/logo.png' }), anchor: { kind: 'clip', clipId: 'a', edge: 'start', offset: 0.5 }, duration: 2, fadeIn: 0.4 },
    { ...createCountdownOverlay({ id: 'cd', name: 'Countdown', start: 0.5 }), duration: 2, decimals: 1 },
    createProgressBarOverlay({ id: 'bar', name: 'Bar', linkedCountdownId: 'cd' }),
    { ...createTextOverlay({ id: 'txt', name: 'Title', text: 'Go Blue!' }), anchor: { kind: 'element', elementId: 'cd', edge: 'start', offset: 0.25 }, duration: 1.5 },
    { ...createSoundOverlay({ id: 'snd', name: 'Beep', filePath: '/snd/beep.wav' }), anchor: { kind: 'element', elementId: 'cd', edge: 'end', offset: -0.5 } },
  ];
  return { ...createEmptyMixProject(), clips, overlays };
}

const measured: LoudnessMeasurement = { hasAudio: true, inputI: -20, inputTp: -3, inputLra: 5, inputThresh: -30, duration: 0.3 };

function renderGraphs(project: MixProject) {
  const { all, visible } = expandBlocks(project);
  const sounds = visible.filter((o) => o.type === 'sound');
  const soundDurations = Object.fromEntries(sounds.map((o) => [o.id, 0.3]));
  const times = resolveOverlayTimes({ overlays: all, clips: project.clips }, plan, { soundDurations });
  const loudness = Object.fromEntries([...project.clips.map((c) => [c.id, measured] as const), ...sounds.map((o) => [o.id, measured] as const)]);
  const job = buildRenderJob({
    plan,
    clips: testClips,
    sourcePaths: testSourcePaths('/m'),
    settings,
    workDir: '/w',
    outPath: '/o.mp4',
    maxChunkSeconds: 1,
    overlays: { overlays: visible, times, defaultFontPath: '/fonts/default.ttf' },
  });
  const audio = buildAudioGraph({ plan, clips: project.clips, sourcePaths: testSourcePaths('/m'), settings, loudness, overlays: sounds, overlayTimes: times });
  return { video: job.chunks.map((c) => c.args), filters: job.files.map((f) => f.content), audio: { args: audio.inputs, filters: audio.filterComplex }, times };
}

describe('render with blocks', () => {
  test('without blocks the overlays given to the render are the project\'s own', () => {
    const project = makeProject();
    expect(expandBlocks(project).visible).toBe(project.overlays);
  });

  test('grouping every overlay into a block gives exactly the same video and audio graphs', () => {
    const project = makeProject();
    const before = renderGraphs(project);
    const grouped = groupOverlaysIntoBlock(project, { overlayIds: project.overlays.map((o) => o.id), blockId: 'B', defId: 'D', name: 'Block', color: 0, times: before.times });
    expect(grouped.overlays).toEqual([]);
    expect(grouped.blocks[0]!.anchor).toEqual({ kind: 'clip', clipId: 'a', edge: 'start', offset: 0.5 });
    const after = renderGraphs(grouped);
    expect(after.video).toEqual(before.video);
    expect(after.filters).toEqual(before.filters);
    expect(after.audio).toEqual(before.audio);
    expect(before.filters.some((f) => f.includes('Go Blue!'))).toBe(true);

    // a variable with its default gives the same text; a value changes only the text
    const withVariable = { ...grouped, blockDefs: grouped.blockDefs.map((d) => ({ ...d, members: d.members.map((m) => (m.type === 'text' ? { ...m, text: 'Go {{team|Blue}}!' } : m)) })) };
    expect(renderGraphs(withVariable).filters).toEqual(before.filters);
    const withValue = { ...withVariable, blocks: [{ ...grouped.blocks[0]!, variables: { team: 'Red' } }] };
    expect(renderGraphs(withValue).filters).toEqual(before.filters.map((f) => f.replaceAll('Go Blue!', 'Go Red!')));

    // hiding the block removes its overlays from the graphs
    const hidden = renderGraphs({ ...grouped, blocks: [{ ...grouped.blocks[0]!, hidden: true }] });
    const empty = renderGraphs({ ...project, overlays: [] });
    expect(hidden.filters).toEqual(empty.filters);
    expect(hidden.audio).toEqual(empty.audio);
    // …while its times are still resolved (what's anchored to it keeps its place)
    expect(hidden.times.get('B/snd')?.rawStart).toBe(before.times.get('snd')?.rawStart);
    expect(resolveBlockTimes(grouped, plan, after.times).get('B')).toMatchObject({ rawStart: before.times.get('img')!.rawStart, contentEnd: before.times.get('img')!.rawEnd });
  });
});
