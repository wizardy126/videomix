import { describe, test, expect } from 'vitest';
import JSON5 from 'json5';
import { ZodError } from 'zod';

import { clipsBySource, getClipDuration, parseMixProject, validateMixProject } from './project';
import { createEmptyMixProject, defaultMixSettings, transitionTypes } from './types';
import type { MixClip, MixOverlay, MixProject } from './types';
import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay, createSoundOverlay } from './overlays/factories';

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

describe('types', () => {
  test('createEmptyMixProject', () => {
    const project = createEmptyMixProject();
    expect(project).toEqual({ version: 2, sources: [], clips: [], settings: defaultMixSettings, overlays: [] });
    // must not share nested objects with the defaults
    project.settings.gap.width = 10;
    expect(defaultMixSettings.gap.width).toBe(0);
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
    project.settings.music = { path: 'm.mp3', absolutePath: '/m.mp3', volumeDb: -6, loop: true };
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
      ],
    };
    expect(parseMixProject(JSON5.parse(JSON5.stringify(project)))).toEqual(project);
  });

  test('migrates v1 to v2 without losing anything', () => {
    const { overlays, ...rest } = makeProject();
    expect(overlays).toEqual([]);
    const v1 = { ...structuredClone(rest), version: 1, loudnessCache: { k: { hasAudio: false } } };
    const parsed = parseMixProject(JSON5.parse(JSON5.stringify(v1)));
    expect(parsed).toEqual({ ...v1, version: 2, overlays: [] });
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
    expect(parseMixProject(json)).toEqual({ ...json, version: 2, overlays: [] });
  });

  test('fills missing settings from defaults', () => {
    const settings: Record<string, unknown> = { ...defaultMixSettings, fps: 60 };
    delete settings['fadeInOut'];
    const parsed = parseMixProject({ version: 1, sources: [], clips: [], settings });
    expect(parsed.settings.fadeInOut).toBe(true);
    expect(parsed.settings.fps).toBe(60);
  });

  test('rejects non-objects and bad versions', () => {
    expect(() => parseMixProject(null)).toThrow('not an object');
    expect(() => parseMixProject([])).toThrow('not an object');
    expect(() => parseMixProject({ sources: [] })).toThrow('missing version');
    expect(() => parseMixProject({ version: '1' })).toThrow('missing version');
    expect(() => parseMixProject({ version: 0 })).toThrow('missing version');
    expect(() => parseMixProject({ ...createEmptyMixProject(), version: 3 })).toThrow('newer than supported');
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
    ['v2 without overlays', broken((p) => Reflect.deleteProperty(p, 'overlays'))],
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

  describe('overlays', () => {
    const withOverlays = (...overlays: MixOverlay[]) => ({ ...makeProject(), overlays });
    const countdown = (overrides: Partial<MixOverlay> = {}) => ({ ...createCountdownOverlay({ id: 'cd', name: 'Countdown' }), ...overrides }) as MixOverlay;

    test('default overlays are valid', () => {
      expect(validateMixProject(withOverlays(
        createImageOverlay({ id: 'i', name: 'Image', filePath: '/a.png' }),
        countdown(),
        createProgressBarOverlay({ id: 'b', name: 'Bar', linkedCountdownId: 'cd' }),
        createSoundOverlay({ id: 's', name: 'Sound', filePath: '/a.wav' }),
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

    test('colors (for projects not built by the schema)', () => {
      expect(codes(withOverlays(countdown({ color: 'white' } as Partial<MixOverlay>)))).toEqual(['overlay-invalid-color']);
      expect(codes(withOverlays({ ...createProgressBarOverlay({ id: 'b', name: '' }), backgroundColor: '#0000' }))).toEqual(['overlay-invalid-color']);
      expect(codes(withOverlays({ ...createProgressBarOverlay({ id: 'b', name: '' }), backgroundColor: '#00000000' }))).toEqual([]);
    });
  });
});
