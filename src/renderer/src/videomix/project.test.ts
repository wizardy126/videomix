import { describe, test, expect } from 'vitest';
import JSON5 from 'json5';
import { ZodError } from 'zod';

import { LINK_GAP_TOLERANCE, MIGRATED_MUSIC_TRACK_ID, clipsBySource, getClipChains, getClipDuration, parseMixProject, validateMixProject } from './project';
import { createEmptyMixProject, defaultAlwaysVisible, defaultLinksSettings, defaultMixSettings, defaultMusicPlaylist, getOutputSize, mixOutputAspects, mixOutputResolutions, transitionTypes } from './types';
import type { MixClip, MixOverlay, MixProject, MixSettings, TextOverlay } from './types';
import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay, createSoundOverlay, createTextOverlay } from './overlays/factories';

function makeClip(overrides: Partial<MixClip> = {}): MixClip {
  return {
    id: 'c1',
    sourceId: 's1',
    name: 'a #1',
    color: 0,
    start: 1,
    end: 5,
    maxRect: { x: 0, y: 0, width: 1920, height: 1080 },
    muted: false,
    gainDb: 0,
    ...overrides,
  };
}

function makeProject(clips: MixClip[] = [makeClip()]): MixProject {
  return {
    ...createEmptyMixProject(),
    sources: [
      { id: 's1', path: 'a.mp4', absolutePath: '/v/a.mp4', name: 'a.mp4', width: 1920, height: 1080, duration: 60 },
      { id: 's2', path: 'b.mp4', absolutePath: '/v/b.mp4', name: 'b.mp4' },
    ],
    clips,
  };
}

// Settings as saved by v1/v2 builds (before T24): `resolution` and an optional single `music`
const { output, encoder, musicPlaylist, ...unchangedSettings } = defaultMixSettings;
const legacySettings = { ...unchangedSettings, resolution: '1080p' };
const migratedSettings = (overrides: Partial<MixSettings> = {}): MixSettings => ({ ...defaultMixSettings, ...overrides });

describe('types', () => {
  test('createEmptyMixProject', () => {
    const project = createEmptyMixProject();
    expect(project).toEqual({ version: 4, sources: [], clips: [], settings: defaultMixSettings, overlays: [] });
    // must not share nested objects with the defaults
    project.settings.gap.width = 10;
    project.settings.musicPlaylist.ducking.amountDb = 0;
    project.settings.encoder.codec = 'h265';
    expect(defaultMixSettings.gap.width).toBe(0);
    expect(defaultMusicPlaylist.ducking.amountDb).toBe(-10);
    expect(defaultMixSettings.encoder.codec).toBe('h264');
  });

  test('defaults: 16:9 1080p, H.264 with automatic encoder, no music', () => {
    expect(output).toEqual({ aspect: '16:9', resolution: '1080' });
    expect(encoder).toEqual({ codec: 'h264', hardware: 'auto' });
    expect(musicPlaylist).toEqual({ tracks: [], crossfade: 2, loop: true, ducking: { enabled: false, amountDb: -10 } });
  });

  test('output sizes: the resolution is the short side', () => {
    expect(getOutputSize({ aspect: '16:9', resolution: '720' })).toEqual({ width: 1280, height: 720 });
    expect(getOutputSize({ aspect: '16:9', resolution: '2160' })).toEqual({ width: 3840, height: 2160 });
    expect(getOutputSize({ aspect: '9:16', resolution: '1080' })).toEqual({ width: 1080, height: 1920 });
    expect(getOutputSize({ aspect: '1:1', resolution: '720' })).toEqual({ width: 720, height: 720 });
    mixOutputAspects.forEach((aspect) => mixOutputResolutions.forEach((resolution) => {
      const { width, height } = getOutputSize({ aspect, resolution });
      expect(Math.min(width, height)).toBe(Number(resolution));
      expect([width % 2, height % 2]).toEqual([0, 0]);
      const [w, h] = aspect.split(':').map(Number);
      expect(width / height).toBeCloseTo(w! / h!, 10);
    }));
  });

  test('transition list', () => {
    expect(transitionTypes).toHaveLength(16);
    expect(transitionTypes).toContain('circleopen');
  });
});

describe('parseMixProject', () => {
  test('round trip through JSON5', () => {
    const project: MixProject = {
      ...makeProject([makeClip(), makeClip({ id: 'c2', sourceId: 's2', minRect: { x: 100, y: 100, width: 200, height: 200 } })]),
      loudnessCache: {
        k1: { hasAudio: true, inputI: -20.5, inputTp: -1.2, inputLra: 5, inputThresh: -31 },
        k2: { hasAudio: false },
      },
    };
    project.settings.musicPlaylist = {
      tracks: [{ id: 't1', path: 'm.mp3', absolutePath: '/m.mp3', volumeDb: -6 }, { id: 't2', path: 'n.mp3', absolutePath: '/n.mp3', volumeDb: 0 }],
      crossfade: 3,
      loop: false,
      ducking: { enabled: true, amountDb: -12 },
    };
    project.settings.output = { aspect: '9:16', resolution: '720' };
    project.settings.encoder = { codec: 'h265', hardware: 'nvenc' };
    expect(parseMixProject(JSON5.parse(JSON5.stringify(project)))).toEqual(project);
  });

  test('round trip with pinned and grouped clips', () => {
    const project = makeProject([makeClip({ pinTime: 12.5 }), makeClip({ id: 'c2', groupId: 'g' }), makeClip({ id: 'c3', groupId: 'g', pinTime: 0 })]);
    expect(parseMixProject(JSON5.parse(JSON5.stringify(project)))).toEqual(project);
  });

  test('round trip with overlays', () => {
    const shadowed = { ...createCountdownOverlay({ id: 'o2', name: 'Countdown', start: 3 }), font: { path: 'f.ttf', absolutePath: '/f.ttf' }, shadow: { x: 2, y: 2, color: '#00000080' } };
    const project: MixProject = {
      ...makeProject(),
      overlays: [
        { ...createImageOverlay({ id: 'o1', name: 'Logo', filePath: '/logo.png' }), anchor: { kind: 'clip', clipId: 'c1', edge: 'end', offset: -1.5 } },
        shadowed,
        createProgressBarOverlay({ id: 'o3', name: 'Bar', linkedCountdownId: 'o2' }),
        { ...createSoundOverlay({ id: 'o4', name: 'Beep', filePath: '/beep.wav' }), anchor: { kind: 'element', elementId: 'o2', edge: 'end', offset: 0 } },
        createTextOverlay({ id: 'o5', name: 'Title', text: 'Line 1\nLine 2' }),
        {
          ...createTextOverlay({ id: 'o6', name: 'Styled', text: 'Hi', start: 2 }),
          font: { path: 'f.ttf', absolutePath: '/f.ttf' },
          shadow: { x: 3, y: 3, color: '#000000' },
          align: 'left',
          entry: { kind: 'slide', from: 'left', duration: 0.8 },
        },
      ],
    };
    expect(parseMixProject(JSON5.parse(JSON5.stringify(project)))).toEqual(project);
  });

  test('migrates v1 to v3 without losing anything', () => {
    const { overlays, ...rest } = makeProject();
    expect(overlays).toEqual([]);
    const v1 = { ...structuredClone(rest), version: 1, settings: { ...legacySettings, resolution: '2160p' }, loudnessCache: { k: { hasAudio: false } } };
    const parsed = parseMixProject(JSON5.parse(JSON5.stringify(v1)));
    expect(parsed).toEqual({ ...v1, version: 4, settings: migratedSettings({ output: { aspect: '16:9', resolution: '2160' } }), overlays: [] });
  });

  test('migrates v2 to v3 without losing anything: 16:9, H.264, the music as a single track', () => {
    const project = makeProject([makeClip(), makeClip({ id: 'c2' })]);
    const v2 = {
      ...structuredClone(project),
      version: 2,
      settings: { ...legacySettings, resolution: '720p', music: { path: 'm.mp3', absolutePath: '/m.mp3', volumeDb: -6, loop: false } },
      loudnessCache: { k: { hasAudio: false } },
      overlays: [createImageOverlay({ id: 'o1', name: 'Logo', filePath: '/logo.png' }), createCountdownOverlay({ id: 'o2', name: 'Countdown' })],
    };
    const parsed = parseMixProject(JSON5.parse(JSON5.stringify(v2)));
    expect(parsed).toEqual({
      ...v2,
      version: 4,
      settings: migratedSettings({
        output: { aspect: '16:9', resolution: '720' },
        musicPlaylist: { ...defaultMusicPlaylist, tracks: [{ id: MIGRATED_MUSIC_TRACK_ID, path: 'm.mp3', absolutePath: '/m.mp3', volumeDb: -6 }], loop: false },
      }),
    });
    expect('resolution' in parsed.settings || 'music' in parsed.settings).toBe(false);

    // without music: an empty playlist
    const noMusic: Record<string, unknown> = { ...v2.settings };
    delete noMusic['music'];
    expect(parseMixProject({ ...v2, settings: noMusic }).settings).toEqual(migratedSettings({ output: { aspect: '16:9', resolution: '720' } }));
    // a v2 file without `resolution` (older build): the default output
    delete noMusic['resolution'];
    expect(parseMixProject({ ...v2, settings: noMusic }).settings.output).toEqual(defaultMixSettings.output);
  });

  test('migrates v3 to v4 additively: links, maxDuration and the always-visible sequence are filled from the defaults', () => {
    const v3 = { ...structuredClone(makeProject([makeClip(), makeClip({ id: 'c2' })])), version: 3 };
    Reflect.deleteProperty(v3.settings, 'links');
    Reflect.deleteProperty(v3.settings, 'alwaysVisible');
    Reflect.deleteProperty(v3.settings, 'maxDuration');
    const parsed = parseMixProject(JSON5.parse(JSON5.stringify(v3)));
    expect(parsed).toEqual({ ...v3, version: 4, settings: { ...v3.settings, links: defaultLinksSettings, alwaysVisible: defaultAlwaysVisible } });
    expect(parsed.settings.maxDuration).toBeUndefined();
  });

  test('opens a v1 file saved by an older build', () => {
    const text = `{
      version: 1,
      sources: [{ id: 's1', path: 'a.mp4', absolutePath: '/v/a.mp4', name: 'a.mp4', width: 1920, height: 1080, duration: 60 }],
      clips: [{ id: 'c1', sourceId: 's1', name: 'a #1', color: 0, start: 1, end: 5, maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, muted: false, gainDb: 0 }],
      settings: { resolution: '720p', fps: 25, crf: 20, preset: 'fast', maxColumns: 2, gap: { width: 4, color: '#112233' }, reorderWindow: 3,
        order: { mode: 'random', seed: 7 }, transition: { type: 'dissolve', duration: 0.3 }, fadeInOut: false, fill: { mode: 'color', color: '#000000' } },
    }`;
    const json = JSON5.parse(text);
    const { resolution, ...settings } = json.settings;
    expect(resolution).toBe('720p');
    expect(parseMixProject(json)).toEqual({ ...json, version: 4, settings: { ...settings, output: { aspect: '16:9', resolution: '720' }, encoder: defaultMixSettings.encoder, musicPlaylist: defaultMusicPlaylist, links: defaultLinksSettings, alwaysVisible: defaultAlwaysVisible }, overlays: [] });
  });

  test('fills missing settings from defaults', () => {
    const settings: Record<string, unknown> = { ...defaultMixSettings, fps: 60 };
    delete settings['fadeInOut'];
    delete settings['encoder'];
    const parsed = parseMixProject({ version: 4, sources: [], clips: [], settings, overlays: [] });
    expect(parsed.settings.encoder).toEqual({ codec: 'h264', hardware: 'auto' });
    expect(parsed.settings.fadeInOut).toBe(true);
    expect(parsed.settings.fps).toBe(60);
  });

  test('reorder window (E8, v4): any integer ≥ 0 or "unlimited", additive (no version change)', () => {
    for (const reorderWindow of [0, 3, 10, 11, 250, 100_000, 'unlimited'] as const) {
      const project = { ...makeProject(), settings: { ...defaultMixSettings, reorderWindow } };
      expect(parseMixProject(JSON5.parse(JSON5.stringify(project))).settings.reorderWindow).toBe(reorderWindow);
    }
    // a v4 file saved before E8 (a number) still opens as it was
    expect(parseMixProject({ ...makeProject(), settings: { ...defaultMixSettings, reorderWindow: 7 } }).settings.reorderWindow).toBe(7);
  });

  test('rejects non-objects and bad versions', () => {
    expect(() => parseMixProject(null)).toThrow('not an object');
    expect(() => parseMixProject([])).toThrow('not an object');
    expect(() => parseMixProject({ sources: [] })).toThrow('missing version');
    expect(() => parseMixProject({ version: '1' })).toThrow('missing version');
    expect(() => parseMixProject({ version: 0 })).toThrow('missing version');
    expect(() => parseMixProject({ ...createEmptyMixProject(), version: 5 })).toThrow('newer than supported');
  });

  // Each case returns a copy of a valid project with one thing broken.
  const broken = (mutate: (p: MixProject) => void) => () => {
    const project = structuredClone(makeProject());
    mutate(project);
    return project;
  };

  test.each([
    ['missing clips', broken((p) => Reflect.deleteProperty(p, 'clips'))],
    ['unknown transition', broken((p) => Object.assign(p.settings.transition, { type: 'zoomin' }))],
    ['bad fps', broken((p) => Object.assign(p.settings, { fps: 29 }))],
    ['bad color', broken((p) => Object.assign(p.settings.gap, { color: 'red' }))],
    ['non-integer rect', broken((p) => Object.assign(p.clips[0]!.maxRect, { width: 10.5 }))],
    ['negative rect', broken((p) => Object.assign(p.clips[0]!.maxRect, { x: -2 }))],
    ['missing clip field', broken((p) => Reflect.deleteProperty(p.clips[0]!, 'muted'))],
    ['bad loudness', broken((p) => Object.assign(p, { loudnessCache: { k: { hasAudio: true } } }))],
    ['without overlays', broken((p) => Reflect.deleteProperty(p, 'overlays'))],
    ['unknown aspect', broken((p) => Object.assign(p.settings.output, { aspect: '4:3' }))],
    ['unknown resolution', broken((p) => Object.assign(p.settings.output, { resolution: '1440' }))],
    ['unknown resolution (v2)', () => ({ ...makeProject(), version: 2, settings: { ...legacySettings, resolution: '1440p' } })],
    ['unknown codec', broken((p) => Object.assign(p.settings.encoder, { codec: 'av1' }))],
    ['unknown hardware encoder', broken((p) => Object.assign(p.settings.encoder, { hardware: 'amf' }))],
    ['music track without id', broken((p) => p.settings.musicPlaylist.tracks.push({ path: 'm.mp3', absolutePath: '/m.mp3', volumeDb: 0 } as never))],
    ['negative crossfade', broken((p) => Object.assign(p.settings.musicPlaylist, { crossfade: -1 }))],
    ['negative reorder window', broken((p) => Object.assign(p.settings, { reorderWindow: -1 }))],
    ['fractional reorder window', broken((p) => Object.assign(p.settings, { reorderWindow: 2.5 }))],
    ['unknown reorder window', broken((p) => Object.assign(p.settings, { reorderWindow: 'infinite' }))],
    ['empty group id', broken((p) => Object.assign(p.clips[0]!, { groupId: '' }))],
    ['bad text entry', broken((p) => p.overlays.push({ ...createTextOverlay({ id: 'o', name: '', text: 'a' }), entry: { kind: 'bounce', duration: 1 } } as unknown as MixOverlay))],
    ['bad text entry side', broken((p) => p.overlays.push({ ...createTextOverlay({ id: 'o', name: '', text: 'a' }), entry: { kind: 'slide', from: 'center', duration: 1 } } as unknown as MixOverlay))],
    ['negative line spacing', broken((p) => p.overlays.push({ ...createTextOverlay({ id: 'o', name: '', text: 'a' }), lineSpacing: -1 }))],
    ['unknown overlay type', broken((p) => p.overlays.push({ ...createSoundOverlay({ id: 'o', name: '', filePath: '/a' }), type: 'video' } as unknown as MixOverlay))],
    ['bad overlay color', broken((p) => p.overlays.push({ ...createCountdownOverlay({ id: 'o', name: '' }), color: 'white' }))],
    ['bad countdown decimals', broken((p) => p.overlays.push({ ...createCountdownOverlay({ id: 'o', name: '' }), decimals: 4 } as unknown as MixOverlay))],
    ['bad anchor', broken((p) => p.overlays.push({ ...createCountdownOverlay({ id: 'o', name: '' }), anchor: { kind: 'clip', clipId: 'c1' } } as unknown as MixOverlay))],
    ['negative absolute time', broken((p) => p.overlays.push({ ...createCountdownOverlay({ id: 'o', name: '' }), anchor: { kind: 'absolute', time: -1 } }))],
  ])('rejects invalid project: %s', (_name, makeInvalid: () => unknown) => {
    expect(() => parseMixProject(makeInvalid())).toThrow(ZodError);
  });
});

describe('helpers', () => {
  test('getClipDuration', () => {
    expect(getClipDuration(makeClip({ start: 1.5, end: 4 }))).toBe(2.5);
  });

  test('clipsBySource keeps list order', () => {
    const clips = [makeClip({ id: 'a' }), makeClip({ id: 'b', sourceId: 's2' }), makeClip({ id: 'c' })];
    const map = clipsBySource(clips);
    expect([...map.keys()]).toEqual(['s1', 's2']);
    expect(map.get('s1')?.map((c) => c.id)).toEqual(['a', 'c']);
    expect(map.get('s2')?.map((c) => c.id)).toEqual(['b']);
  });
});

describe('getClipChains', () => {
  const chainIds = (project: MixProject) => getClipChains(project).map((chain) => chain.map((c) => c.id));

  const clip = (id: string, start: number, end: number, overrides: Partial<MixClip> = {}) => makeClip({ id, start, end, ...overrides });

  test('links clips of the same source within maxGap, ordered by start regardless of list order', () => {
    // c2 (out of list order) is 1s after c1 ends (maxGap 10): linked. c3 starts 11s after c2 ends: not linked.
    const project = makeProject([clip('c2', 5, 9), clip('c1', 0, 4), clip('c3', 20, 24)]);
    expect(chainIds(project)).toEqual([['c1', 'c2'], ['c3']]);
  });

  test('maxGap threshold: exactly at the limit links, just past it does not', () => {
    const project = makeProject([clip('c1', 0, 4), clip('c2', 14, 18)]);
    project.settings.links.maxGap = 10;
    expect(chainIds(project)).toEqual([['c1', 'c2']]);
    project.settings.links.maxGap = 9.99;
    expect(chainIds(project)).toEqual([['c1'], ['c2']]);
  });

  test('overlapping clips are never auto-linked, however small the overlap (E6: duplicate / "new clip from here")', () => {
    // a large overlap
    const project = makeProject([clip('c1', 0, 5), clip('c2', 3, 8)]);
    expect(chainIds(project)).toEqual([['c1'], ['c2']]);
    // even a tiny one, well past the touching tolerance
    const barely = makeProject([clip('c1', 0, 5), clip('c2', 4.8, 8)]);
    expect(chainIds(barely)).toEqual([['c1'], ['c2']]);
    // a large maxGap doesn't help: overlaps are excluded regardless of it
    barely.settings.links.maxGap = 1000;
    expect(chainIds(barely)).toEqual([['c1'], ['c2']]);
  });

  test('touching clips (within LINK_GAP_TOLERANCE) link like a zero gap, but only with maxGap > 0', () => {
    // exactly touching (gap 0) and a hair short of it (rounding) both count as touching
    const touching = makeProject([clip('c1', 0, 5), clip('c2', 5, 8)]);
    expect(chainIds(touching)).toEqual([['c1', 'c2']]);
    const almostTouching = makeProject([clip('c1', 0, 5), clip('c2', 5 - LINK_GAP_TOLERANCE / 2, 8)]);
    expect(chainIds(almostTouching)).toEqual([['c1', 'c2']]);
    // but past the tolerance, it's an overlap: not linked
    const overlap = makeProject([clip('c1', 0, 5), clip('c2', 5 - LINK_GAP_TOLERANCE * 2, 8)]);
    expect(chainIds(overlap)).toEqual([['c1'], ['c2']]);
  });

  test('maxGap: 0 disables automatic linking entirely (01-requisitos §11 E2), even for touching clips', () => {
    const touching = makeProject([clip('c1', 0, 4), clip('c2', 4, 8)]);
    touching.settings.links.maxGap = 0;
    expect(chainIds(touching)).toEqual([['c1'], ['c2']]);
    const gapped = makeProject([clip('c1', 0, 4), clip('c2', 4.5, 8)]);
    gapped.settings.links.maxGap = 0;
    expect(chainIds(gapped)).toEqual([['c1'], ['c2']]);
  });

  test('link: break/force override the automatic rule with the previous clip of the chain', () => {
    // within maxGap, but explicitly broken
    const broken = makeProject([clip('c1', 0, 4), clip('c2', 5, 9, { link: 'break' })]);
    expect(chainIds(broken)).toEqual([['c1'], ['c2']]);
    // past maxGap, but forced
    const forced = makeProject([clip('c1', 0, 4), clip('c2', 30, 34, { link: 'force' })]);
    expect(chainIds(forced)).toEqual([['c1', 'c2']]);
    // maxGap: 0, but forced
    const forcedZero = makeProject([clip('c1', 0, 4), clip('c2', 30, 34, { link: 'force' })]);
    forcedZero.settings.links.maxGap = 0;
    expect(chainIds(forcedZero)).toEqual([['c1', 'c2']]);
    // overlapping, but forced: the only way an overlapping pair links (E6)
    const forcedOverlap = makeProject([clip('c1', 0, 5), clip('c2', 3, 8, { link: 'force' })]);
    expect(chainIds(forcedOverlap)).toEqual([['c1', 'c2']]);
    // force/break on the first clip of a source is a no-op (no previous clip to apply it to)
    const first = makeProject([clip('c1', 0, 4, { link: 'force' })]);
    expect(chainIds(first)).toEqual([['c1']]);
  });

  test('several sources: chains never cross sources', () => {
    const project = makeProject([
      clip('a1', 0, 4, { sourceId: 's1' }),
      clip('a2', 5, 9, { sourceId: 's1' }),
      clip('b1', 0, 4, { sourceId: 's2' }),
      clip('b2', 5, 9, { sourceId: 's2' }),
    ]);
    expect(chainIds(project)).toEqual([['a1', 'a2'], ['b1', 'b2']]);
  });

  test('pinned, grouped and always-visible clips are excluded entirely, not even as a lone chain', () => {
    const project = makeProject([
      clip('c1', 0, 4),
      clip('c2', 5, 9, { pinTime: 12 }),
      clip('c3', 10, 14, { groupId: 'g' }),
      clip('c4', 15, 19, { groupId: 'g' }),
      clip('c5', 20, 24),
    ]);
    project.settings.alwaysVisible = { clipIds: ['c5'] };
    // c2, c3, c4 and c5 are all excluded (pinned, grouped, always-visible); only c1 is left, as a chain of its own
    expect(chainIds(project)).toEqual([['c1']]);
  });

  test('empty project', () => {
    expect(getClipChains(makeProject([]))).toEqual([]);
  });
});

describe('validateMixProject', () => {
  const codes = (project: MixProject, options?: Parameters<typeof validateMixProject>[1]) => validateMixProject(project, options).map((i) => i.code);

  test('valid project', () => {
    expect(validateMixProject(makeProject())).toEqual([]);
    expect(validateMixProject(createEmptyMixProject())).toEqual([]);
  });

  test('ids and sources', () => {
    expect(codes(makeProject([makeClip(), makeClip()]))).toEqual(['duplicate-clip-id']);
    expect(codes(makeProject([makeClip({ sourceId: 'nope' })]))).toEqual(['unknown-source']);
    const project = makeProject();
    project.sources.push({ ...project.sources[0]! });
    expect(codes(project)).toEqual(['duplicate-source-id']);
  });

  test('time range', () => {
    expect(codes(makeProject([makeClip({ start: -1 })]))).toEqual(['invalid-time-range']);
    expect(codes(makeProject([makeClip({ start: 5, end: 5 })]))).toEqual(['invalid-time-range']);
    expect(codes(makeProject([makeClip({ end: 61 })]))).toEqual(['end-after-source-duration']);
    expect(codes(makeProject([makeClip({ end: 61 })]), { sourceDurations: { s1: 100 } })).toEqual([]);
    // unknown duration: not checked
    expect(codes(makeProject([makeClip({ sourceId: 's2', end: 1000 })]))).toEqual([]);
    expect(codes(makeProject([makeClip({ sourceId: 's2', end: 1000 })]), { sourceDurations: { s2: 999 } })).toEqual(['end-after-source-duration']);
  });

  test('clip shorter than two transitions is a warning', () => {
    const issues = validateMixProject(makeProject([makeClip({ start: 0, end: 1 })]));
    expect(issues).toMatchObject([{ level: 'warning', code: 'clip-shorter-than-transitions', clipId: 'c1' }]);
    expect(codes(makeProject([makeClip({ start: 0, end: 1.01 })]))).toEqual([]);
  });

  test('rects', () => {
    expect(codes(makeProject([makeClip({ maxRect: { x: 0, y: 0, width: 15, height: 100 } })]))).toEqual(['rect-too-small']);
    expect(codes(makeProject([makeClip({ minRect: { x: 0, y: 0, width: 100, height: 10 } })]))).toEqual(['rect-too-small']);
    expect(codes(makeProject([makeClip({ maxRect: { x: 2, y: 0, width: 1920, height: 1080 } })]))).toEqual(['max-rect-outside-frame']);
    expect(codes(makeProject([makeClip({ maxRect: { x: 2, y: 0, width: 1920, height: 1080 } })]), { sourceSizes: { s1: { width: 3840, height: 2160 } } })).toEqual([]);
    // unknown size: not checked
    expect(codes(makeProject([makeClip({ sourceId: 's2', maxRect: { x: 0, y: 0, width: 5000, height: 5000 } })]))).toEqual([]);
    expect(codes(makeProject([makeClip({ minRect: { x: 1800, y: 0, width: 200, height: 200 } })]))).toEqual(['min-rect-outside-max']);
    expect(codes(makeProject([makeClip({ minRect: { x: 0, y: 0, width: 1920, height: 1080 } })]))).toEqual([]);
  });

  test('odd gap', () => {
    const project = makeProject();
    project.settings.gap.width = 3;
    expect(codes(project)).toEqual(['odd-gap']);
  });

  test('pinned clips (v3)', () => {
    // c1 lasts 4 s, c2 6 s: c1 can start at most at 6 s without a gap before it
    const withPin = (pinTime: number) => makeProject([makeClip({ pinTime }), makeClip({ id: 'c2', start: 0, end: 6 })]);
    expect(codes(withPin(0))).toEqual([]);
    expect(codes(withPin(6))).toEqual([]);
    expect(validateMixProject(withPin(6.5))).toMatchObject([{ level: 'warning', code: 'pin-time-after-end', clipId: 'c1' }]);
    expect(validateMixProject(withPin(-1))).toMatchObject([{ level: 'error', code: 'pin-time-out-of-range', clipId: 'c1' }]);
    expect(codes(withPin(Number.NaN))).toEqual(['pin-time-out-of-range']);
  });

  test('grouped clips (v3)', () => {
    const clips = [makeClip({ groupId: 'g' }), makeClip({ id: 'c2', groupId: 'g' }), makeClip({ id: 'c3', groupId: 'h' })];
    expect(validateMixProject(makeProject(clips))).toMatchObject([{ level: 'warning', code: 'group-too-small', groupId: 'h', clipId: 'c3' }]);
    expect(codes(makeProject(clips.slice(0, 2)))).toEqual([]);
    // pinned at different times
    const pinned = [makeClip({ groupId: 'g', pinTime: 1 }), makeClip({ id: 'c2', groupId: 'g', pinTime: 2 })];
    expect(validateMixProject(makeProject(pinned))).toMatchObject([{ level: 'warning', code: 'group-pin-conflict', groupId: 'g' }]);
    expect(codes(makeProject([makeClip({ groupId: 'g', pinTime: 1 }), makeClip({ id: 'c2', groupId: 'g' })]))).toEqual([]);
  });

  test('music tracks (v3)', () => {
    const project = makeProject();
    const track = { id: 't', path: '/m.mp3', absolutePath: '/m.mp3', volumeDb: 0 };
    project.settings.musicPlaylist = { ...project.settings.musicPlaylist, tracks: [track, { ...track, path: '/n.mp3', absolutePath: '/n.mp3' }] };
    expect(validateMixProject(project)).toMatchObject([{ level: 'error', code: 'duplicate-music-track-id', trackId: 't' }]);
  });

  test('max duration (v4)', () => {
    const withMaxDuration = (maxDuration: number | undefined) => {
      const project = makeProject();
      project.settings.maxDuration = maxDuration;
      return project;
    };
    expect(codes(withMaxDuration(undefined))).toEqual([]);
    expect(codes(withMaxDuration(30))).toEqual([]);
    expect(codes(withMaxDuration(0))).toEqual(['max-duration-out-of-range']);
    expect(codes(withMaxDuration(-1))).toEqual(['max-duration-out-of-range']);
    expect(codes(withMaxDuration(Number.NaN))).toEqual(['max-duration-out-of-range']);
  });

  test('always-visible sequence (v4)', () => {
    const clips = [makeClip(), makeClip({ id: 'c2', groupId: 'g' }), makeClip({ id: 'c3', groupId: 'g' })];
    const withSequence = (clipIds: string[]) => {
      const project = makeProject(clips);
      project.settings.alwaysVisible = { clipIds };
      return project;
    };
    expect(codes(withSequence(['c1']))).toEqual([]);
    expect(codes(withSequence([]))).toEqual([]);
    expect(validateMixProject(withSequence(['nope']))).toMatchObject([{ level: 'error', code: 'always-visible-unknown-clip', clipId: 'nope' }]);
    expect(validateMixProject(withSequence(['c1', 'c1']))).toMatchObject([{ level: 'error', code: 'duplicate-always-visible-id', clipId: 'c1' }]);
    // in the sequence and in a group at the same time
    expect(validateMixProject(withSequence(['c2']))).toMatchObject([{ level: 'warning', code: 'clip-in-sequence-and-group', clipId: 'c2', groupId: 'g' }]);
  });

  describe('overlays', () => {
    const withOverlays = (...overlays: MixOverlay[]) => ({ ...makeProject(), overlays });
    const countdown = (overrides: Partial<MixOverlay> = {}) => ({ ...createCountdownOverlay({ id: 'cd', name: 'Countdown' }), ...overrides }) as MixOverlay;

    test('default overlays are valid', () => {
      expect(validateMixProject(withOverlays(
        createImageOverlay({ id: 'i', name: 'Image', filePath: '/a.png' }),
        countdown(),
        createProgressBarOverlay({ id: 'b', name: 'Bar', linkedCountdownId: 'cd' }),
        createSoundOverlay({ id: 's', name: 'Sound', filePath: '/a.wav' }),
        createTextOverlay({ id: 't', name: 'Text', text: 'Hello' }),
      ))).toEqual([]);
    });

    test('ids and references', () => {
      expect(codes(withOverlays(countdown(), countdown()))).toEqual(['duplicate-overlay-id']);
      const issues = validateMixProject(withOverlays(
        countdown({ anchor: { kind: 'clip', clipId: 'nope', edge: 'start', offset: 0 } }),
        { ...countdown({ id: 'x' }), anchor: { kind: 'element', elementId: 'nope', edge: 'end', offset: 1 } },
        createProgressBarOverlay({ id: 'b', name: 'Bar', linkedCountdownId: 'x2' }),
        // linked to something that isn't a countdown
        createProgressBarOverlay({ id: 'b2', name: 'Bar', linkedCountdownId: 'b' }),
      ));
      expect(issues).toMatchObject([
        { level: 'warning', code: 'overlay-broken-reference', overlayId: 'cd' },
        { level: 'warning', code: 'overlay-broken-reference', overlayId: 'x' },
        { level: 'warning', code: 'overlay-broken-reference', overlayId: 'b' },
        { level: 'warning', code: 'overlay-broken-reference', overlayId: 'b2' },
      ]);
    });

    test('cycles', () => {
      const a = countdown({ id: 'a', anchor: { kind: 'element', elementId: 'b', edge: 'end', offset: 0 } });
      const b = countdown({ id: 'b', anchor: { kind: 'element', elementId: 'a', edge: 'start', offset: 1 } });
      const c = countdown({ id: 'c', anchor: { kind: 'element', elementId: 'a', edge: 'start', offset: 1 } });
      expect(validateMixProject(withOverlays(a, b, c))).toMatchObject([
        { code: 'overlay-cycle', overlayId: 'a' },
        { code: 'overlay-cycle', overlayId: 'b' },
      ]);
      // self-reference
      expect(codes(withOverlays(countdown({ anchor: { kind: 'element', elementId: 'cd', edge: 'start', offset: 0 } })))).toEqual(['overlay-cycle']);
    });

    test('boxes', () => {
      const box = (b: { x: number, y: number, width: number, height: number }) => codes(withOverlays(countdown({ box: b })));
      expect(box({ x: 0, y: 0, width: 1, height: 1 })).toEqual([]);
      expect(box({ x: -0.1, y: 0, width: 0.5, height: 0.5 })).toEqual(['overlay-box-out-of-range']);
      expect(box({ x: 0.6, y: 0, width: 0.5, height: 0.5 })).toEqual(['overlay-box-out-of-range']);
      expect(box({ x: 0, y: 0.9, width: 0.5, height: 0.2 })).toEqual(['overlay-box-out-of-range']);
      expect(box({ x: 0, y: 0, width: 0, height: 0.2 })).toEqual(['overlay-box-out-of-range']);
      expect(box({ x: 0, y: 0, width: Number.NaN, height: 0.2 })).toEqual(['overlay-box-out-of-range']);
      // sounds have no box
      expect(codes(withOverlays(createSoundOverlay({ id: 's', name: '', filePath: '/a.wav' })))).toEqual([]);
    });

    test('durations and fades', () => {
      expect(codes(withOverlays(countdown({ duration: 0 })))).toEqual(['overlay-invalid-duration']);
      expect(codes(withOverlays(countdown({ duration: -1 })))).toEqual(['overlay-invalid-duration']);
      expect(codes(withOverlays({ ...createImageOverlay({ id: 'i', name: '', filePath: '/a.png' }), duration: 0.8, fadeIn: 0.5, fadeOut: 0.5 }))).toEqual(['overlay-fades-too-long']);
      expect(codes(withOverlays(countdown({ duration: 1, fadeOut: 2 } as Partial<MixOverlay>)))).toEqual(['overlay-fades-too-long']);
      // a linked bar's own duration is not used
      expect(codes(withOverlays(countdown(), { ...createProgressBarOverlay({ id: 'b', name: '', linkedCountdownId: 'cd' }), duration: 0 }))).toEqual([]);
      expect(codes(withOverlays({ ...createProgressBarOverlay({ id: 'b', name: '' }), duration: 0 }))).toEqual(['overlay-invalid-duration']);
    });

    test('texts (v3)', () => {
      const text = (overrides: Partial<TextOverlay> = {}) => ({ ...createTextOverlay({ id: 't', name: 'Text', text: 'Hello' }), ...overrides });
      expect(validateMixProject(withOverlays(text({ text: ' \n ' })))).toMatchObject([{ level: 'warning', code: 'overlay-empty-text', overlayId: 't' }]);
      expect(validateMixProject(withOverlays(text({ entry: { kind: 'slide', duration: 1 } })))).toMatchObject([{ level: 'error', code: 'overlay-invalid-entry' }]);
      expect(codes(withOverlays(text({ entry: { kind: 'slide', from: 'top', duration: 1 } })))).toEqual([]);
      expect(codes(withOverlays(text({ entry: { kind: 'typewriter', duration: 1 } })))).toEqual([]);
      expect(codes(withOverlays(text({ duration: 2, entry: { kind: 'typewriter', duration: 3 } })))).toEqual(['overlay-entry-too-long']);
      // no entry animation: its duration doesn't matter
      expect(codes(withOverlays(text({ duration: 2, entry: { kind: 'none', duration: 3 } })))).toEqual([]);
      expect(codes(withOverlays(text({ duration: 1, fadeIn: 0.6, fadeOut: 0.6 })))).toEqual(['overlay-fades-too-long']);
      expect(codes(withOverlays(text({ duration: 0 })))).toEqual(['overlay-invalid-duration']);
      expect(codes(withOverlays(text({ box: { x: 0.5, y: 0, width: 0.6, height: 0.1 } })))).toEqual(['overlay-box-out-of-range']);
      expect(codes(withOverlays(text({ shadow: { x: 1, y: 1, color: 'black' } })))).toEqual(['overlay-invalid-color']);
      // T26: explicit size, optional (derived from the box when missing)
      expect(codes(withOverlays(text({ fontSize: 0 })))).toEqual(['overlay-invalid-font-size']);
      expect(codes(withOverlays(text({ fontSize: Number.NaN })))).toEqual(['overlay-invalid-font-size']);
      const withoutSize = text();
      delete withoutSize.fontSize;
      expect(codes(withOverlays(withoutSize))).toEqual([]);
    });

    test('colors (for projects not built by the schema)', () => {
      expect(codes(withOverlays(countdown({ color: 'white' } as Partial<MixOverlay>)))).toEqual(['overlay-invalid-color']);
      expect(codes(withOverlays({ ...createProgressBarOverlay({ id: 'b', name: '' }), backgroundColor: '#0000' }))).toEqual(['overlay-invalid-color']);
      expect(codes(withOverlays({ ...createProgressBarOverlay({ id: 'b', name: '' }), backgroundColor: '#00000000' }))).toEqual([]);
    });
  });
});
