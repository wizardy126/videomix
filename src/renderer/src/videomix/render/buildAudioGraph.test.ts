import { describe, expect, test } from 'vitest';

import { MUSIC_LOUDNESS_KEY, buildAudioGraph, getCompensationExpr, getNormalizationGain, getPlacementFades } from './buildAudioGraph';
import { createEmptyMixProject } from '../types';
import type { LoudnessMeasurement, MixClip, MixSettings } from '../types';
import type { LayoutKeyframe, MixPlan } from '../planner/types';

const rect = { x: 0, y: 0, width: 1920, height: 1080 };

const clip = (id: string, sourceId: string, start: number, end: number, extra: Partial<MixClip> = {}): MixClip => ({
  id, sourceId, name: id, color: 0, start, end, maxRect: rect, muted: false, gainDb: 0, ...extra,
});

const sourcePaths = { s1: '/media/h.mp4', s2: '/media/v.mp4', s3: '/media/sq.mp4' };

const makeSettings = (settings: Partial<MixSettings> = {}): MixSettings => ({ ...createEmptyMixProject().settings, ...settings });

const measured = (inputI: number, inputTp: number, extra: Partial<Extract<LoudnessMeasurement, { hasAudio: true }>> = {}): LoudnessMeasurement => ({
  hasAudio: true, inputI, inputTp, inputLra: 3, inputThresh: inputI - 10, ...extra,
});

const layout = (time: number, transitionDuration: number, columns: number[]): LayoutKeyframe => ({
  time,
  transitionDuration,
  columns: columns.map((column, i) => ({ column, x: i * 960, width: 960 })),
  fills: [],
});

// Two columns. Column 0: a (0–6) crossfades into b (5.5–11.5). Column 1: c (0–8) fades into the fill at the end.
const twoColumnPlan: MixPlan = {
  width: 1920,
  height: 1080,
  duration: 11.5,
  placements: [
    { clipId: 'a', column: 0, startTime: 0, endTime: 6, transitionIn: 0 },
    { clipId: 'c', column: 1, startTime: 0, endTime: 8, transitionIn: 0, transitionOut: 0.5 },
    { clipId: 'b', column: 0, startTime: 5.5, endTime: 11.5, transitionIn: 0.5 },
  ],
  layouts: [layout(0, 0, [0, 1])],
  warnings: [],
};

const twoColumnClips = [clip('a', 's1', 1, 7), clip('b', 's2', 0, 6, { gainDb: -3 }), clip('c', 's1', 2, 10)];
const twoColumnLoudness = { a: measured(-20, -6), b: measured(-30, -12), c: measured(-10, 0, { channels: 4, channelLayout: '4 channels (UNSD+UNSD+UNSD+UNSD)' }) };

describe('getNormalizationGain', () => {
  test('to the target', () => {
    expect(getNormalizationGain({ hasAudio: true, inputI: -20, inputTp: -6, inputLra: 0, inputThresh: -30 })).toBe(4);
    expect(getNormalizationGain({ hasAudio: true, inputI: -8, inputTp: 0, inputLra: 0, inputThresh: -18 })).toBe(-8);
  });

  test('capped by the peak and the maximum boost', () => {
    expect(getNormalizationGain({ hasAudio: true, inputI: -30, inputTp: -3, inputLra: 0, inputThresh: -40 })).toBe(8);
    expect(getNormalizationGain({ hasAudio: true, inputI: -60, inputTp: -40, inputLra: 0, inputThresh: -70 })).toBe(24);
  });
});

describe('getPlacementFades', () => {
  test('crossfade and fade into the fill', () => {
    const [a, c, b] = twoColumnPlan.placements;
    expect(getPlacementFades(twoColumnPlan, a!)).toEqual({ fadeIn: 0.01, fadeOut: 0.5 });
    expect(getPlacementFades(twoColumnPlan, b!)).toEqual({ fadeIn: 0.5, fadeOut: 0.01 });
    expect(getPlacementFades(twoColumnPlan, c!)).toEqual({ fadeIn: 0.01, fadeOut: 0.5 });
  });

  test('column appearing and disappearing in re-layouts', () => {
    const plan: MixPlan = {
      width: 1920,
      height: 1080,
      duration: 12,
      placements: [
        { clipId: 'a', column: 0, startTime: 0, endTime: 12, transitionIn: 0 },
        { clipId: 'b', column: 1, startTime: 0, endTime: 4.4, transitionIn: 0 },
        { clipId: 'c', column: 2, startTime: 3, endTime: 9, transitionIn: 0 },
      ],
      layouts: [layout(0, 0, [0, 1]), layout(3, 0.4, [0, 1, 2]), layout(4, 0.4, [0, 2])],
      warnings: [],
    };
    const [, b, c] = plan.placements;
    expect(getPlacementFades(plan, b!)).toEqual({ fadeIn: 0.01, fadeOut: 0.4 });
    expect(getPlacementFades(plan, c!)).toEqual({ fadeIn: 0.4, fadeOut: 0.01 });
  });

  test('never longer than the clip', () => {
    const plan: MixPlan = {
      width: 1920,
      height: 1080,
      duration: 1,
      placements: [{ clipId: 'a', column: 0, startTime: 0.5, endTime: 0.51, transitionIn: 0.5 }],
      layouts: [layout(0, 0, [0])],
      warnings: [],
    };
    const { fadeIn, fadeOut } = getPlacementFades(plan, plan.placements[0]!);
    expect(fadeIn + fadeOut).toBeCloseTo(0.01);
  });
});

describe('getCompensationExpr', () => {
  test('a crossfade keeps the count', () => {
    expect(getCompensationExpr([
      { startTime: 0, endTime: 6, fadeIn: 0.01, fadeOut: 0.5 },
      { startTime: 5.5, endTime: 11.5, fadeIn: 0.5, fadeOut: 0.01 },
    ], 11.5)).toBeUndefined();
  });

  test('ramps when the number of sources changes', () => {
    expect(getCompensationExpr([
      { startTime: 0, endTime: 10, fadeIn: 0.01, fadeOut: 0.01 },
      { startTime: 2, endTime: 6, fadeIn: 0.5, fadeOut: 0.5 },
      { startTime: 4, endTime: 10, fadeIn: 0, fadeOut: 0 },
    ], 10)).toBe('1-0.292893*clip((t-2)/0.5,0,1)-0.129757*gte(t,4)+0.129757*clip((t-5.5)/0.5,0,1)');
  });

  test('several sources from the start', () => {
    expect(getCompensationExpr([
      { startTime: 0, endTime: 5, fadeIn: 0.01, fadeOut: 0.01 },
      { startTime: 0, endTime: 5, fadeIn: 0.01, fadeOut: 0.01 },
    ], 5)).toBe('0.707107');
  });
});

describe('buildAudioGraph', () => {
  test('clips without music', () => {
    const audioPass = buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings: makeSettings({ fadeInOut: false }), loudness: twoColumnLoudness });
    expect(audioPass).toMatchSnapshot();
  });

  test('with looped music, global fades and the exact video duration', () => {
    const settings = makeSettings({ music: { path: 'm.mp3', absolutePath: '/media/m.mp3', volumeDb: -12, loop: true } });
    expect(buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings, duration: 11.5 + 1 / 60, loudness: twoColumnLoudness })).toMatchSnapshot();
  });

  test('muted clips and clips without audio are left out', () => {
    const clips = [clip('a', 's1', 1, 7), clip('b', 's2', 0, 6, { muted: true }), clip('c', 's3', 0, 8)];
    // b is muted: no measurement needed
    const audioPass = buildAudioGraph({ plan: twoColumnPlan, clips, sourcePaths, settings: makeSettings(), loudness: { a: measured(-20, -6), c: { hasAudio: false } } });
    expect(audioPass.inputs).toEqual([['-vn', '-ss', '1.000000', '-t', '6.100000', '-i', '/media/h.mp4']]);
    expect(audioPass).toMatchSnapshot();
  });

  test('no audible clip: silence of the video duration, with music', () => {
    const clips = [clip('a', 's3', 1, 7), clip('b', 's2', 0, 6, { muted: true }), clip('c', 's3', 0, 8)];
    const settings = makeSettings({ music: { path: 'm.mp3', absolutePath: '/media/m.mp3', volumeDb: 0, loop: false } });
    const audioPass = buildAudioGraph({ plan: twoColumnPlan, clips, sourcePaths, settings, loudness: { a: { hasAudio: false }, c: { hasAudio: false } } });
    expect(audioPass.inputs).toEqual([['-vn', '-i', '/media/m.mp3']]);
    expect(audioPass).toMatchSnapshot();
  });

  test('music is normalized like a clip, plus volumeDb (T12b)', () => {
    const settings = makeSettings({ music: { path: 'm.mp3', absolutePath: '/media/m.mp3', volumeDb: -12, loop: true } });
    const loudness = { ...twoColumnLoudness, [MUSIC_LOUDNESS_KEY]: measured(-9, -1) };
    const { filterComplex } = buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings, loudness });
    // getNormalizationGain(-9, -1) = min(-16 - -9, 24, 5 - -1) = -7, plus volumeDb -12 = -19
    expect(filterComplex).toContain('volume=-19dB');
  });

  test('music without a loudness measurement only applies volumeDb (T12b)', () => {
    const settings = makeSettings({ music: { path: 'm.mp3', absolutePath: '/media/m.mp3', volumeDb: -12, loop: true } });
    const { filterComplex } = buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings, loudness: twoColumnLoudness });
    expect(filterComplex).toContain('volume=-12dB');
  });

  test('missing loudness of an audible clip throws', () => {
    expect(() => buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings: makeSettings(), loudness: { a: measured(-20, -6) } })).toThrow('Missing loudness');
  });
});
