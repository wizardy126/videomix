import { describe, expect, test } from 'vitest';

import { buildAudioGraph, getCompensationExpr, getDuckingFilter, getMusicSchedule, getNormalizationGain, getPlacementFades, MAX_MUSIC_OCCURRENCES } from './buildAudioGraph';
import { createEmptyMixProject, defaultMusicPlaylist } from '../types';
import type { LoudnessMeasurement, MixClip, MixMusicPlaylist, MixMusicTrack, MixSettings, SoundOverlay } from '../types';
import type { LayoutKeyframe, MixPlan } from '../planner/types';
import type { ResolvedOverlayTimes } from '../overlays/resolveOverlayTimes';
import { verifyFilterGraph } from './verifyFilterGraph';

const rect = { x: 0, y: 0, width: 1920, height: 1080 };

const clip = (id: string, sourceId: string, start: number, end: number, extra: Partial<MixClip> = {}): MixClip => ({
  id, sourceId, name: id, color: 0, start, end, maxRect: rect, muted: false, gainDb: 0, ...extra,
});

const sourcePaths = { s1: '/media/h.mp4', s2: '/media/v.mp4', s3: '/media/sq.mp4' };

const makeSettings = (settings: Partial<MixSettings> = {}): MixSettings => ({ ...createEmptyMixProject().settings, ...settings });

// A single music track (the only music before T24's playlist), without a measurement: unknown duration
const withMusic = ({ volumeDb, loop }: { volumeDb: number, loop: boolean }): Pick<MixSettings, 'musicPlaylist'> => ({
  musicPlaylist: { ...defaultMusicPlaylist, tracks: [{ id: 'music', path: 'm.mp3', absolutePath: '/media/m.mp3', volumeDb }], loop },
});

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
    const settings = makeSettings(withMusic({ volumeDb: -12, loop: true }));
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
    const settings = makeSettings(withMusic({ volumeDb: 0, loop: false }));
    const audioPass = buildAudioGraph({ plan: twoColumnPlan, clips, sourcePaths, settings, loudness: { a: { hasAudio: false }, c: { hasAudio: false } } });
    // unknown duration (no measurement) and no loop: plays once, only what the video needs is read
    expect(audioPass.inputs).toEqual([['-vn', '-t', '11.600000', '-i', '/media/m.mp3']]);
    expect(audioPass).toMatchSnapshot();
  });

  test('music is normalized like a clip, plus volumeDb (T12b)', () => {
    const settings = makeSettings(withMusic({ volumeDb: -12, loop: true }));
    const loudness = { ...twoColumnLoudness, music: measured(-9, -1) };
    const { filterComplex } = buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings, loudness });
    // getNormalizationGain(-9, -1) = min(-16 - -9, 24, 5 - -1) = -7, plus volumeDb -12 = -19
    expect(filterComplex).toContain('volume=-19dB');
  });

  test('music without a loudness measurement only applies volumeDb (T12b)', () => {
    const settings = makeSettings(withMusic({ volumeDb: -12, loop: true }));
    const { filterComplex } = buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings, loudness: twoColumnLoudness });
    expect(filterComplex).toContain('volume=-12dB');
  });

  test('missing loudness of an audible clip throws', () => {
    expect(() => buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings: makeSettings(), loudness: { a: measured(-20, -6) } })).toThrow('Missing loudness');
  });
});

describe('buildAudioGraph: sound overlays (T21)', () => {
  const sound = (id: string, absolutePath: string, gainDb = 0): Pick<SoundOverlay, 'id' | 'absolutePath' | 'gainDb'> => ({ id, absolutePath, gainDb });
  const times = (entries: [string, Pick<ResolvedOverlayTimes extends Map<string, infer V> ? V : never, 'start' | 'end'>][]): ResolvedOverlayTimes => new Map(entries.map(([id, { start, end }]) => [id, { start, end, rawStart: start, rawEnd: end, warnings: [] }]));

  test('mixed in after the compensation, before the limiter', () => {
    const overlays = [sound('beep', '/media/beep.wav', -3)];
    const overlayTimes = times([['beep', { start: 2, end: 3.5 }]]);
    const loudness = { ...twoColumnLoudness, beep: measured(-20, -6) };
    const audioPass = buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings: makeSettings({ fadeInOut: false }), loudness, overlays, overlayTimes });
    expect(audioPass.inputs).toContainEqual(['-vn', '-i', '/media/beep.wav']);
    // getNormalizationGain(-20, -6) = min(4, 24, 11) = 4, plus gainDb -3 = 1
    expect(audioPass.filterComplex).toContain('volume=1dB');
    expect(audioPass.filterComplex).toContain('adelay=96000S:all=1'); // 2s * 48000
    expect(audioPass.filterComplex).toContain('atrim=duration=1.5'); // 3.5 - 2
    // after the clips' compensation and (no music here) right before the limiter
    expect(audioPass.filterComplex).toMatch(/\[clips]\[s\d+]amix=inputs=2:normalize=0:duration=first,asetpts=N\/SR\/TB\[withSounds];\n\[withSounds]atrim.*alimiter/s);
    expect(audioPass).toMatchSnapshot();
  });

  test('with music too: sounds are summed in after the music mix', () => {
    const overlays = [sound('beep', '/media/beep.wav')];
    const overlayTimes = times([['beep', { start: 1, end: 2 }]]);
    const loudness = { ...twoColumnLoudness, beep: measured(-16, -3) };
    const settings = makeSettings(withMusic({ volumeDb: -12, loop: true }));
    const { filterComplex } = buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings, loudness, overlays, overlayTimes });
    expect(filterComplex).toMatch(/\[mix]\[s\d+]amix=inputs=2:normalize=0:duration=first,asetpts=N\/SR\/TB\[withSounds]/);
  });

  test('a resolved zero-duration overlay (outside the video) is left out', () => {
    const overlays = [sound('beep', '/media/beep.wav')];
    const overlayTimes = times([['beep', { start: 11.5, end: 11.5 }]]);
    const loudness = { ...twoColumnLoudness, beep: measured(-16, -3) };
    const audioPass = buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings: makeSettings(), loudness, overlays, overlayTimes });
    expect(audioPass.inputs).not.toContainEqual(['-vn', '-i', '/media/beep.wav']);
    expect(audioPass.filterComplex).not.toContain('withSounds');
  });

  test('an overlay missing from overlayTimes is left out', () => {
    const overlays = [sound('beep', '/media/beep.wav')];
    const loudness = { ...twoColumnLoudness, beep: measured(-16, -3) };
    const audioPass = buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings: makeSettings(), loudness, overlays, overlayTimes: new Map() });
    expect(audioPass.inputs).not.toContainEqual(['-vn', '-i', '/media/beep.wav']);
  });

  test('a silent overlay (no audio) is left out', () => {
    const overlays = [sound('beep', '/media/beep.wav')];
    const overlayTimes = times([['beep', { start: 1, end: 2 }]]);
    const loudness = { ...twoColumnLoudness, beep: { hasAudio: false as const } };
    const audioPass = buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings: makeSettings(), loudness, overlays, overlayTimes });
    expect(audioPass.inputs).not.toContainEqual(['-vn', '-i', '/media/beep.wav']);
  });

  test('an unmeasured overlay (T21b) still plays, at gainDb alone (no normalization)', () => {
    const overlays = [sound('beep', '/media/beep.wav', -3)];
    const overlayTimes = times([['beep', { start: 1, end: 2 }]]);
    const loudness = { ...twoColumnLoudness, beep: { hasAudio: false as const, unmeasured: true as const } };
    const audioPass = buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings: makeSettings(), loudness, overlays, overlayTimes });
    expect(audioPass.inputs).toContainEqual(['-vn', '-i', '/media/beep.wav']);
    expect(audioPass.filterComplex).toContain('volume=-3dB'); // gainDb alone, no getNormalizationGain
  });

  test('missing loudness of a sounding overlay throws', () => {
    const overlays = [sound('beep', '/media/beep.wav')];
    const overlayTimes = times([['beep', { start: 1, end: 2 }]]);
    expect(() => buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings: makeSettings(), loudness: twoColumnLoudness, overlays, overlayTimes })).toThrow('Missing loudness of sound overlay beep');
  });

  test('no overlays (or overlayTimes): unchanged from callers that don\'t pass them', () => {
    const withoutOverlays = buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings: makeSettings({ fadeInOut: false }), loudness: twoColumnLoudness });
    const withEmptyOverlays = buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings: makeSettings({ fadeInOut: false }), loudness: twoColumnLoudness, overlays: [], overlayTimes: new Map() });
    expect(withEmptyOverlays).toEqual(withoutOverlays);
  });
});

describe('music playlist (C2, T27)', () => {
  const track = (id: string, volumeDb = -12): MixMusicTrack => ({ id, path: `${id}.mp3`, absolutePath: `/media/${id}.mp3`, volumeDb });
  const playlist = (tracks: MixMusicTrack[], patch: Partial<MixMusicPlaylist> = {}): MixMusicPlaylist => ({ ...defaultMusicPlaylist, tracks, ...patch });
  const schedule = (occurrences: ReturnType<typeof getMusicSchedule>) => occurrences.map(({ track: { id }, start, crossfade }) => [id, start, crossfade]);

  test('tracks in sequence with crossfades, the list repeated while looping', () => {
    const occurrences = getMusicSchedule({ playlist: playlist([track('a'), track('b')], { crossfade: 2, loop: true }), durations: { a: 20, b: 15 }, totalDuration: 50 });
    expect(schedule(occurrences)).toEqual([['a', 0, 0], ['b', 18, 2], ['a', 31, 2], ['b', 49, 2]]);
  });

  test('without loop, the list plays once', () => {
    const occurrences = getMusicSchedule({ playlist: playlist([track('a'), track('b')], { crossfade: 2, loop: false }), durations: { a: 20, b: 15 }, totalDuration: 100 });
    expect(schedule(occurrences)).toEqual([['a', 0, 0], ['b', 18, 2]]);
  });

  test('a single looped track crossfades into itself', () => {
    const occurrences = getMusicSchedule({ playlist: playlist([track('a')], { crossfade: 1, loop: true }), durations: { a: 10 }, totalDuration: 25 });
    expect(schedule(occurrences)).toEqual([['a', 0, 0], ['a', 9, 1], ['a', 18, 1]]);
  });

  test('the crossfade is at most half of the shorter track', () => {
    const occurrences = getMusicSchedule({ playlist: playlist([track('a'), track('b')], { crossfade: 5, loop: false }), durations: { a: 20, b: 3 }, totalDuration: 100 });
    expect(schedule(occurrences)).toEqual([['a', 0, 0], ['b', 18.5, 1.5]]);
  });

  test('a track of unknown duration plays to the end; empty tracks are skipped', () => {
    const occurrences = getMusicSchedule({ playlist: playlist([track('a'), track('empty'), track('b'), track('c')], { crossfade: 2, loop: true }), durations: { a: 10, empty: 0, c: 10 }, totalDuration: 100 });
    expect(schedule(occurrences)).toEqual([['a', 0, 0], ['b', 8, 2]]);
    expect(occurrences[1]!.duration).toBe(Infinity);
  });

  test('stops at the end of the video, and after MAX_MUSIC_OCCURRENCES', () => {
    expect(getMusicSchedule({ playlist: playlist([track('a')], { crossfade: 0, loop: true }), durations: { a: 10 }, totalDuration: 20 })).toHaveLength(2);
    expect(getMusicSchedule({ playlist: playlist([track('a')], { crossfade: 0, loop: true }), durations: { a: 0.1 }, totalDuration: 3600 })).toHaveLength(MAX_MUSIC_OCCURRENCES);
    expect(getMusicSchedule({ playlist: playlist([]), durations: {}, totalDuration: 20 })).toEqual([]);
  });

  test('graph: one input per occurrence, normalized per track, placed with equal-power fades', () => {
    const settings = makeSettings({ musicPlaylist: playlist([track('a', -12), track('b', -6)], { crossfade: 2, loop: true }) });
    const loudness = { ...twoColumnLoudness, a: measured(-10, -2, { duration: 7 }), b: measured(-20, -8, { duration: 5 }) };
    const audioPass = buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings, loudness });
    // a 0–7, b 5–10 (crossfade 2), a 8–15 (crossfade 2; half of b's 5 s would allow 2.5)
    expect(audioPass.inputs.slice(3)).toEqual([
      ['-vn', '-i', '/media/a.mp3'],
      ['-vn', '-i', '/media/b.mp3'],
      ['-vn', '-t', '3.600000', '-i', '/media/a.mp3'],
    ]);
    // a: min(-6, 24, 7) - 12 = -18; b: min(4, 24, 13) - 6 = -2
    expect(audioPass.filterComplex).toContain('[3:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=7,volume=-18dB,afade=t=out:st=5:d=2:curve=qsin[m0]');
    expect(audioPass.filterComplex).toContain('[4:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=5,volume=-2dB,afade=t=in:d=2:curve=qsin,afade=t=out:st=3:d=2:curve=qsin,adelay=240000S:all=1[m1]');
    expect(audioPass.filterComplex).toContain('[5:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=7,volume=-18dB,afade=t=in:d=2:curve=qsin,adelay=384000S:all=1[m2]');
    expect(audioPass.filterComplex).toContain('[m0][m1][m2]amix=inputs=3:normalize=0:duration=longest,asetpts=N/SR/TB,atrim=duration=11.5,afade=t=out:st=9.5:d=2[music]');
    expect(verifyFilterGraph(audioPass)).toEqual([]);
    expect(audioPass).toMatchSnapshot();
  });

  test('no crossfade: back to back, with anti-click fades', () => {
    const settings = makeSettings({ musicPlaylist: playlist([track('a'), track('b')], { crossfade: 0, loop: false }) });
    const loudness = { ...twoColumnLoudness, a: measured(-10, -2, { duration: 5 }), b: measured(-20, -8, { duration: 5 }) };
    const { filterComplex } = buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings, loudness });
    expect(filterComplex).toContain('afade=t=out:st=4.99:d=0.01:curve=qsin[m0]');
    expect(filterComplex).toContain('afade=t=in:d=0.01:curve=qsin,adelay=240000S:all=1[m1]');
  });

  test('a looped track of unknown duration is looped with -stream_loop (as before T27)', () => {
    const settings = makeSettings(withMusic({ volumeDb: -12, loop: true }));
    const audioPass = buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings, loudness: twoColumnLoudness });
    expect(audioPass.inputs.at(-1)).toEqual(['-stream_loop', '-1', '-vn', '-t', '11.600000', '-i', '/media/m.mp3']);
  });
});

describe('ducking (C1, T27)', () => {
  const duckedSettings = (ducking: MixMusicPlaylist['ducking']) => makeSettings({
    musicPlaylist: { ...defaultMusicPlaylist, tracks: [{ id: 'm', path: 'm.mp3', absolutePath: '/media/m.mp3', volumeDb: -12 }], ducking },
  });
  const loudness = { ...twoColumnLoudness, m: measured(-14, -1, { duration: 30 }) };

  test('sidechaincompress whose maximum reduction is amountDb', () => {
    // threshold = -10 / (1 - 1/20) = -10.526 dB
    expect(getDuckingFilter({ enabled: true, amountDb: -10 })).toBe('sidechaincompress=threshold=0.297635:ratio=20:knee=1:attack=50:release=400:detection=rms:link=maximum');
    expect(getDuckingFilter({ enabled: false, amountDb: -10 })).toBeUndefined();
    expect(getDuckingFilter({ enabled: true, amountDb: 0 })).toBeUndefined();
    // never below sidechaincompress's minimum threshold
    expect(getDuckingFilter({ enabled: true, amountDb: -80 })).toContain('threshold=0.000977:');
  });

  test('the clips drive the compressor on the music, before the sounds and the limiter', () => {
    const overlays = [{ id: 'beep', absolutePath: '/media/beep.wav', gainDb: 0 }];
    const overlayTimes: ResolvedOverlayTimes = new Map([['beep', { start: 1, end: 2, rawStart: 1, rawEnd: 2, warnings: [] }]]);
    const audioPass = buildAudioGraph({
      plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings: duckedSettings({ enabled: true, amountDb: -10 }), loudness: { ...loudness, beep: measured(-16, -3) }, overlays, overlayTimes,
    });
    expect(audioPass.filterComplex).toMatch(/\[clips]asplit=2\[clipsMix]\[clipsSidechain];\n\[clipsSidechain]volume=30dB,asoftclip=type=hard\[duckingControl];\n\[music]\[duckingControl]sidechaincompress=[^[]*\[duckedMusic];\n\[clipsMix]\[duckedMusic]amix=inputs=2:normalize=0:duration=first,asetpts=N\/SR\/TB\[mix];\n.*\[mix]\[s\d+]amix/s);
    expect(verifyFilterGraph(audioPass)).toEqual([]);
    expect(audioPass).toMatchSnapshot();
  });

  test('disabled, or without audible clips: no ducking', () => {
    const disabled = buildAudioGraph({ plan: twoColumnPlan, clips: twoColumnClips, sourcePaths, settings: duckedSettings({ enabled: false, amountDb: -10 }), loudness });
    expect(disabled.filterComplex).not.toContain('sidechaincompress');
    const clips = twoColumnClips.map((c) => ({ ...c, muted: true }));
    const noClips = buildAudioGraph({ plan: twoColumnPlan, clips, sourcePaths, settings: duckedSettings({ enabled: true, amountDb: -10 }), loudness });
    expect(noClips.filterComplex).not.toContain('sidechaincompress');
    expect(noClips.filterComplex).toContain('[clips][music]amix');
  });
});
