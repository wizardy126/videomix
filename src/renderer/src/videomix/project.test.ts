import { describe, test, expect } from 'vitest';
import JSON5 from 'json5';
import { ZodError } from 'zod';

import { clipsBySource, getClipDuration, parseMixProject, validateMixProject } from './project';
import { createEmptyMixProject, defaultMixSettings, transitionTypes } from './types';
import type { MixClip, MixProject } from './types';

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
    expect(project).toEqual({ version: 1, sources: [], clips: [], settings: defaultMixSettings });
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
    expect(() => parseMixProject({ ...createEmptyMixProject(), version: 2 })).toThrow('newer than supported');
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
});
