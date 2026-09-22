import { describe, test, expect } from 'vitest';

import { createMixSource, mixProjectReducer } from './projectReducer';
import { createEmptyMixProject } from './types';
import type { MixClip, MixProject } from './types';

function makeClip(id: string, overrides: Partial<MixClip> = {}): MixClip {
  return {
    id,
    sourceId: 's1',
    name: `a #${id}`,
    color: 0,
    start: 1,
    end: 5,
    maxRect: { x: 0, y: 0, width: 1920, height: 1080 },
    muted: false,
    gainDb: 0,
    ...overrides,
  };
}

function makeProject(): MixProject {
  return {
    ...createEmptyMixProject(),
    sources: [
      createMixSource({ id: 's1', filePath: '/v/a.mp4', name: 'a.mp4' }),
      createMixSource({ id: 's2', filePath: '/v/b.mp4', name: 'b.mp4' }),
    ],
    clips: [makeClip('c1'), makeClip('c2', { sourceId: 's2' }), makeClip('c3')],
  };
}

const ids = (project: MixProject) => project.clips.map((c) => c.id);

describe('mixProjectReducer', () => {
  test('addSources skips duplicate files and ids', () => {
    const project = makeProject();
    const next = mixProjectReducer(project, {
      type: 'addSources',
      sources: [
        createMixSource({ id: 's3', filePath: '/v/c.mp4', name: 'c.mp4' }),
        createMixSource({ id: 's4', filePath: '/v/a.mp4', name: 'a.mp4' }),
        createMixSource({ id: 's1', filePath: '/v/d.mp4', name: 'd.mp4' }),
        createMixSource({ id: 's5', filePath: '/v/c.mp4', name: 'c.mp4' }),
      ],
    });
    expect(next.sources.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(mixProjectReducer(project, { type: 'addSources', sources: [] })).toBe(project);
  });

  test('removeSource removes its clips', () => {
    const next = mixProjectReducer(makeProject(), { type: 'removeSource', sourceId: 's1' });
    expect(next.sources.map((s) => s.id)).toEqual(['s2']);
    expect(ids(next)).toEqual(['c2']);
  });

  test('relinkSource', () => {
    const project = makeProject();
    const next = mixProjectReducer(project, { type: 'relinkSource', sourceId: 's1', source: { path: '/w/a.mp4', absolutePath: '/w/a.mp4', duration: 10 } });
    expect(next.sources[0]).toEqual({ id: 's1', path: '/w/a.mp4', absolutePath: '/w/a.mp4', name: 'a.mp4', duration: 10 });
    expect(next.sources[1]).toBe(project.sources[1]);
    expect(mixProjectReducer(project, { type: 'relinkSource', sourceId: 's1', source: { path: '/v/a.mp4', absolutePath: '/v/a.mp4' } })).toBe(project);
    expect(mixProjectReducer(project, { type: 'relinkSource', sourceId: 'x', source: { path: '/w', absolutePath: '/w' } })).toBe(project);
  });

  test('addClip', () => {
    const project = makeProject();
    expect(ids(mixProjectReducer(project, { type: 'addClip', clip: makeClip('c4') }))).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(ids(mixProjectReducer(project, { type: 'addClip', clip: makeClip('c4'), index: 1 }))).toEqual(['c1', 'c4', 'c2', 'c3']);
    expect(() => mixProjectReducer(project, { type: 'addClip', clip: makeClip('c1') })).toThrow('Duplicate clip id');
  });

  test('updateClip', () => {
    const project = makeProject();
    const minRect = { x: 10, y: 10, width: 100, height: 100 };
    const next = mixProjectReducer(project, { type: 'updateClip', clipId: 'c1', patch: { name: 'x', minRect } });
    expect(next.clips[0]).toMatchObject({ id: 'c1', name: 'x', minRect });
    expect(next.clips[1]).toBe(project.clips[1]);
    expect(project.clips[0]!.name).toBe('a #c1');

    // clearing minRect removes the key
    const cleared = mixProjectReducer(next, { type: 'updateClip', clipId: 'c1', patch: { minRect: undefined } });
    expect('minRect' in cleared.clips[0]!).toBe(false);

    // equal values (even new objects) are a no-op
    expect(mixProjectReducer(next, { type: 'updateClip', clipId: 'c1', patch: { minRect: { ...minRect } } })).toBe(next);
    expect(mixProjectReducer(project, { type: 'updateClip', clipId: 'nope', patch: { name: 'x' } })).toBe(project);
  });

  test('removeClip', () => {
    const project = makeProject();
    expect(ids(mixProjectReducer(project, { type: 'removeClip', clipId: 'c2' }))).toEqual(['c1', 'c3']);
    expect(mixProjectReducer(project, { type: 'removeClip', clipId: 'nope' })).toBe(project);
  });

  test('duplicateClip inserts a deep copy after the original', () => {
    const project = makeProject();
    const next = mixProjectReducer(project, { type: 'duplicateClip', clipId: 'c1', newId: 'c9', name: 'copy' });
    expect(ids(next)).toEqual(['c1', 'c9', 'c2', 'c3']);
    expect(next.clips[1]).toEqual({ ...project.clips[0], id: 'c9', name: 'copy' });
    expect(next.clips[1]!.maxRect).not.toBe(project.clips[0]!.maxRect);
    expect(mixProjectReducer(project, { type: 'duplicateClip', clipId: 'c1', newId: 'c4' }).clips[1]!.name).toBe('a #c1');
    expect(() => mixProjectReducer(project, { type: 'duplicateClip', clipId: 'c1', newId: 'c2' })).toThrow('Duplicate clip id');
  });

  test('reorderClips', () => {
    const project = makeProject();
    expect(ids(mixProjectReducer(project, { type: 'reorderClips', ids: ['c3', 'c1', 'c2'] }))).toEqual(['c3', 'c1', 'c2']);
    // partial / unknown / duplicate ids
    expect(ids(mixProjectReducer(project, { type: 'reorderClips', ids: ['c3', 'x', 'c3'] }))).toEqual(['c3', 'c1', 'c2']);
    expect(mixProjectReducer(project, { type: 'reorderClips', ids: ['c1', 'c2', 'c3'] })).toBe(project);
  });

  test('updateSettings', () => {
    const project = makeProject();
    const music = { path: '/m.mp3', absolutePath: '/m.mp3', volumeDb: -3, loop: true };
    const next = mixProjectReducer(project, { type: 'updateSettings', patch: { maxColumns: 2, music } });
    expect(next.settings).toEqual({ ...project.settings, maxColumns: 2, music });
    const noMusic = mixProjectReducer(next, { type: 'updateSettings', patch: { music: undefined } });
    expect('music' in noMusic.settings).toBe(false);
    expect(mixProjectReducer(project, { type: 'updateSettings', patch: { maxColumns: 3 } })).toBe(project);
  });

  test('setLoudnessCache', () => {
    const project = makeProject();
    const loudnessCache = { k: { hasAudio: false as const } };
    const next = mixProjectReducer(project, { type: 'setLoudnessCache', loudnessCache });
    expect(next.loudnessCache).toBe(loudnessCache);
    expect('loudnessCache' in mixProjectReducer(next, { type: 'setLoudnessCache', loudnessCache: undefined })).toBe(false);
  });
});
