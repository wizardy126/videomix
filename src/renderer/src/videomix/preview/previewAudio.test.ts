import { describe, expect, test } from 'vitest';

import { evaluateCompensation, getCompensationExpr, getCompensationSteps } from '../render/buildAudioGraph';
import { testPlans, testSettings } from '../render/renderTestFixtures';
import type { LoudnessMeasurement, MixMusicTrack } from '../types';
import { buildPreviewAudioModel, dbToGain, getDuckingAmount, getGlobalFadeGain, getPreviewClipGain, getPreviewMusicGain, getPreviewSoundGain, getPreviewSoundStarts, qsin } from './previewAudio';

const measurement = (inputI: number, duration?: number): LoudnessMeasurement => ({ hasAudio: true, inputI, inputTp: -1, inputLra: 2, inputThresh: inputI - 10, ...(duration != null && { duration }) });
const clips = [
  { id: 'a', muted: false, gainDb: 0 },
  { id: 'b', muted: false, gainDb: -6 },
  { id: 'c', muted: false, gainDb: 0 },
];
const track = (id: string, volumeDb = 0): MixMusicTrack => ({ id, path: `${id}.mp3`, absolutePath: `/${id}.mp3`, volumeDb });

describe('compensation', () => {
  test('evaluateCompensation follows the render expression', () => {
    const audible = [
      { startTime: 0, endTime: 3, fadeIn: 0.01, fadeOut: 0.5 },
      { startTime: 0, endTime: 4.5, fadeIn: 0.01, fadeOut: 0.5 },
      { startTime: 2.5, endTime: 6, fadeIn: 0.5, fadeOut: 0.5 },
      { startTime: 5, endTime: 6, fadeIn: 1, fadeOut: 0.01 },
    ];
    const steps = getCompensationSteps(audible, 6);
    // a substitution (2.75) doesn't change it; b ends at 4.25 (ramp 4-4.5), d starts at 5.5 (ramp 5-6)
    expect(getCompensationExpr(audible, 6)).toBe('0.707107+0.292893*clip((t-4)/0.5,0,1)-0.292893*clip((t-5)/1,0,1)');
    expect(evaluateCompensation(steps, 1)).toBeCloseTo(Math.SQRT1_2);
    expect(evaluateCompensation(steps, 2.75)).toBeCloseTo(Math.SQRT1_2);
    expect(evaluateCompensation(steps, 4.25)).toBeCloseTo((Math.SQRT1_2 + 1) / 2);
    expect(evaluateCompensation(steps, 4.8)).toBeCloseTo(1);
    expect(evaluateCompensation(steps, 5.9)).toBeCloseTo(1 - 0.9 * (1 - Math.SQRT1_2));
  });
});

describe('buildPreviewAudioModel', () => {
  const loudness = { a: measurement(-20), b: measurement(-16) };
  const model = buildPreviewAudioModel({ plan: testPlans.substitutions, clips, settings: testSettings(), loudness });

  test('clips: normalization + gainDb, the render fades; unmeasured ones at their manual gain', () => {
    expect(model.clips.map((c) => [c.key, c.clipId, c.normalized])).toEqual([['p0', 'b', true], ['p1', 'a', true], ['p2', 'c', false]]);
    expect(model.clips[0]!.gain).toBeCloseTo(dbToGain(-6));
    expect(model.clips[1]!.gain).toBeCloseTo(dbToGain(4));
    expect(model.clips[2]!.gain).toBe(1);
    expect(model.unnormalizedCount).toBe(1);
    // muted and confirmed silent clips are left out
    const silent = buildPreviewAudioModel({ plan: testPlans.substitutions, clips: [{ ...clips[0]!, muted: true }, clips[1]!, clips[2]!], settings: testSettings(), loudness: { ...loudness, b: { hasAudio: false } } });
    expect(silent.clips.map((c) => c.clipId)).toEqual(['c']);
  });

  test('gains at a time: fades, compensation and the global fade', () => {
    const [b, a, c] = model.clips;
    expect(getPreviewClipGain(model, b!, 1)).toBeCloseTo(dbToGain(-6) * Math.SQRT1_2);
    // middle of the a → c crossfade: equal power
    const ga = getPreviewClipGain(model, a!, 2.75) / a!.gain;
    const gc = getPreviewClipGain(model, c!, 2.75) / c!.gain;
    expect(ga ** 2 + gc ** 2).toBeCloseTo(0.5);
    expect(getPreviewClipGain(model, a!, 3)).toBe(0);
    // global fade in over D = 0.5 s
    expect(getGlobalFadeGain(model, 0.25)).toBeCloseTo(0.5);
    expect(getPreviewClipGain(model, a!, 0.25)).toBeCloseTo(a!.gain * Math.SQRT1_2 * 0.5);
    expect(qsin(0.5)).toBeCloseTo(Math.SQRT1_2);
  });

  test('music: schedule with crossfades, normalized, ducked and faded out at the end', () => {
    const settings = testSettings({ musicPlaylist: { tracks: [track('t1', -12), track('t2')], crossfade: 2, loop: false, ducking: { enabled: true, amountDb: -10 } } });
    const m = buildPreviewAudioModel({ plan: testPlans.substitutions, clips, settings, loudness: { ...loudness, t1: measurement(-10, 4) }, musicDurations: { t2: 30 } });
    expect(m.music.map((x) => [x.key, x.occurrence.start, x.occurrence.duration, x.fadeIn, x.fadeOut])).toEqual([['m0', 0, 4, 0, 2], ['m1', 2, 30, 2, 0]]);
    expect(m.music[0]!.gain).toBeCloseTo(dbToGain(-6 - 12));
    expect(m.ducking).toEqual({ amountDb: -10, intervals: [[0, 6]] });
    // at 1 s: clips sound, the music is 10 dB down
    expect(getPreviewMusicGain(m, m.music[0]!, 1)).toBeCloseTo(m.music[0]!.gain * dbToGain(-10));
    // end fade-out over max(2, D) = 2 s: halfway at 5 s
    expect(getPreviewMusicGain(m, m.music[1]!, 5)).toBeCloseTo(dbToGain(-10) * 0.5);
    expect(getPreviewMusicGain(m, m.music[0]!, 4)).toBe(0);
  });

  test('ducking follows the clips with the render attack and release', () => {
    const intervals = [[1, 3], [5, 6]] as const;
    expect(getDuckingAmount(intervals, 0.5)).toBe(0);
    expect(getDuckingAmount(intervals, 1.025)).toBeCloseTo(0.5);
    expect(getDuckingAmount(intervals, 2)).toBe(1);
    expect(getDuckingAmount(intervals, 3.2)).toBeCloseTo(0.5);
    expect(getDuckingAmount(intervals, 4)).toBe(0);
    expect(getDuckingAmount(intervals, 5.5)).toBe(1);
  });

  test('sound overlays: normalized, started where playback starts', () => {
    const overlays = [{ id: 's1', type: 'sound' as const, absolutePath: '/beep.wav', gainDb: 3 }, { id: 's2', type: 'sound' as const, absolutePath: '/boop.wav', gainDb: 0 }];
    const overlayTimes = new Map([['s1', { start: 1, end: 2, rawStart: 1, rawEnd: 2, warnings: [] }], ['s2', { start: 4, end: 5, rawStart: 4, rawEnd: 5, warnings: [] }]]);
    const m = buildPreviewAudioModel({ plan: testPlans.substitutions, clips, settings: testSettings(), loudness: { s1: measurement(-19) }, overlays, overlayTimes });
    expect(m.sounds.map((s) => [s.id, s.gain])).toEqual([['s1', dbToGain(6)], ['s2', 1]]);
    expect(getPreviewSoundGain(m, m.sounds[0]!, 1.5)).toBeCloseTo(dbToGain(6));
    expect(getPreviewSoundStarts(m.sounds, 1.5).map(({ sound, delay, offset, duration }) => [sound.id, delay, offset, duration])).toEqual([['s1', 0, 0.5, 0.5], ['s2', 2.5, 0, 1]]);
  });
});
