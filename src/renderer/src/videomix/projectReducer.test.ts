import { describe, test, expect } from 'vitest';

import { createMixSource, mixProjectReducer } from './projectReducer';
import { createEmptyMixProject } from './types';
import type { MixClip, MixOverlay, MixProject } from './types';
import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay, createSoundOverlay } from './overlays/factories';
import { resolveOverlayTimes } from './overlays/resolveOverlayTimes';

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

  test('batch applies the actions in order and keeps the object if nothing changes', () => {
    const project = makeProject();
    const next = mixProjectReducer(project, {
      type: 'batch',
      actions: [
        { type: 'updateClip', clipId: 'c1', patch: { end: 3 } },
        { type: 'duplicateClip', clipId: 'c1', newId: 'c4' },
        { type: 'removeClip', clipId: 'c2' },
      ],
    });
    expect(ids(next)).toEqual(['c1', 'c4', 'c3']);
    expect(next.clips[1]!.end).toBe(3);
    expect(mixProjectReducer(project, { type: 'batch', actions: [] })).toBe(project);
    expect(mixProjectReducer(project, { type: 'batch', actions: [{ type: 'removeClip', clipId: 'nope' }] })).toBe(project);
  });
});

describe('overlay actions', () => {
  // Layer order: img1, beep (sound), cd, bar, img2
  function makeOverlayProject(): MixProject {
    const overlays: MixOverlay[] = [
      { ...createImageOverlay({ id: 'img1', name: 'Logo', filePath: '/logo.png' }), anchor: { kind: 'clip', clipId: 'c1', edge: 'start', offset: 1 } },
      { ...createSoundOverlay({ id: 'beep', name: 'Beep', filePath: '/beep.wav' }), anchor: { kind: 'element', elementId: 'cd', edge: 'end', offset: 0 } },
      { ...createCountdownOverlay({ id: 'cd', name: 'Countdown' }), anchor: { kind: 'clip', clipId: 'c2', edge: 'start', offset: 0 } },
      createProgressBarOverlay({ id: 'bar', name: 'Bar', linkedCountdownId: 'cd' }),
      createImageOverlay({ id: 'img2', name: 'Other', filePath: '/other.png', start: 2 }),
    ];
    return { ...makeProject(), overlays };
  }
  const overlayIds = (project: MixProject) => project.overlays.map((o) => o.id);

  test('addOverlay appends (on top) or inserts, and rejects duplicate ids', () => {
    const project = makeOverlayProject();
    const sound = createSoundOverlay({ id: 'new', name: 'New', filePath: '/n.wav' });
    expect(overlayIds(mixProjectReducer(project, { type: 'addOverlay', overlay: sound }))).toEqual(['img1', 'beep', 'cd', 'bar', 'img2', 'new']);
    expect(overlayIds(mixProjectReducer(project, { type: 'addOverlay', overlay: sound, index: 0 }))).toEqual(['new', 'img1', 'beep', 'cd', 'bar', 'img2']);
    expect(() => mixProjectReducer(project, { type: 'addOverlay', overlay: { ...sound, id: 'cd' } })).toThrow('Duplicate overlay id');
  });

  test('updateOverlay patches, removes optional keys set to undefined and skips no-ops', () => {
    const project = makeOverlayProject();
    const next = mixProjectReducer(project, { type: 'updateOverlay', overlayId: 'cd', patch: { duration: 5, font: { path: '/f.ttf', absolutePath: '/f.ttf' } } });
    expect(next.overlays[2]).toMatchObject({ duration: 5, font: { path: '/f.ttf' }, type: 'countdown', id: 'cd' });
    expect(project.overlays[2]).not.toHaveProperty('font');
    const unlinked = mixProjectReducer(project, { type: 'updateOverlay', overlayId: 'bar', patch: { linkedCountdownId: undefined } });
    expect('linkedCountdownId' in unlinked.overlays[3]!).toBe(false);
    expect(mixProjectReducer(project, { type: 'updateOverlay', overlayId: 'cd', patch: { duration: 10 } })).toBe(project);
    expect(mixProjectReducer(project, { type: 'updateOverlay', overlayId: 'nope', patch: { duration: 1 } })).toBe(project);
  });

  test('duplicateOverlay inserts the copy one layer above', () => {
    const project = makeOverlayProject();
    const next = mixProjectReducer(project, { type: 'duplicateOverlay', overlayId: 'img1', newId: 'img1b', name: 'Logo 2' });
    expect(overlayIds(next)).toEqual(['img1', 'img1b', 'beep', 'cd', 'bar', 'img2']);
    expect(next.overlays[1]).toEqual({ ...project.overlays[0], id: 'img1b', name: 'Logo 2' });
    expect(next.overlays[1]!.anchor).not.toBe(project.overlays[0]!.anchor);
    expect(() => mixProjectReducer(project, { type: 'duplicateOverlay', overlayId: 'img1', newId: 'cd' })).toThrow('Duplicate overlay id');
    expect(mixProjectReducer(project, { type: 'duplicateOverlay', overlayId: 'nope', newId: 'x' })).toBe(project);
  });

  test('moveOverlayLayer moves visual overlays past visual ones (sounds are not layered)', () => {
    const project = makeOverlayProject();
    const move = (overlayId: string, to: 'up' | 'down' | 'front' | 'back') => overlayIds(mixProjectReducer(project, { type: 'moveOverlayLayer', overlayId, to }));
    expect(move('img1', 'up')).toEqual(['beep', 'cd', 'img1', 'bar', 'img2']);
    expect(move('cd', 'down')).toEqual(['cd', 'img1', 'beep', 'bar', 'img2']);
    expect(move('img1', 'front')).toEqual(['beep', 'cd', 'bar', 'img2', 'img1']);
    expect(move('img2', 'back')).toEqual(['img2', 'img1', 'beep', 'cd', 'bar']);
    expect(move('bar', 'up')).toEqual(['img1', 'beep', 'cd', 'img2', 'bar']);
    expect(mixProjectReducer(project, { type: 'moveOverlayLayer', overlayId: 'img2', to: 'up' })).toBe(project);
    expect(mixProjectReducer(project, { type: 'moveOverlayLayer', overlayId: 'img1', to: 'back' })).toBe(project);
    expect(mixProjectReducer(project, { type: 'moveOverlayLayer', overlayId: 'beep', to: 'front' })).toBe(project);
  });

  const plan = { duration: 30,
    placements: [
      { clipId: 'c1', column: 0, startTime: 0, endTime: 4, transitionIn: 0 },
      { clipId: 'c2', column: 1, startTime: 3, endTime: 7, transitionIn: 0 },
      { clipId: 'c3', column: 0, startTime: 4, endTime: 8, transitionIn: 0 },
    ] };

  test('removeOverlay detaches its dependents at their resolved times', () => {
    const project = makeOverlayProject();
    const resolved = resolveOverlayTimes(project, plan, { soundDurations: { beep: 1 } });
    const next = mixProjectReducer(project, { type: 'removeOverlay', overlayId: 'cd', resolved });
    expect(overlayIds(next)).toEqual(['img1', 'beep', 'bar', 'img2']);
    // countdown: c2 start (3) + 10 s
    expect(next.overlays[1]!.anchor).toEqual({ kind: 'absolute', time: 13 });
    expect(next.overlays[2]).toMatchObject({ anchor: { kind: 'absolute', time: 3 }, duration: 10 });
    expect('linkedCountdownId' in next.overlays[2]!).toBe(false);
    // same times after the removal
    const after = resolveOverlayTimes(next, plan, { soundDurations: { beep: 1 } });
    expect(after.get('beep')).toMatchObject({ start: 13, end: 14, warnings: [] });
    expect(after.get('bar')).toMatchObject({ start: 3, end: 13, warnings: [] });
    expect(mixProjectReducer(project, { type: 'removeOverlay', overlayId: 'nope' })).toBe(project);
  });

  test('removeClip / removeSource detach the overlays anchored to the removed clips', () => {
    const project = makeOverlayProject();
    const resolved = resolveOverlayTimes(project, plan);
    const next = mixProjectReducer(project, { type: 'removeClip', clipId: 'c2', resolved });
    expect(next.overlays[2]!.anchor).toEqual({ kind: 'absolute', time: 3 });
    expect(next.overlays[0]).toBe(project.overlays[0]);

    const noSource = mixProjectReducer(project, { type: 'removeSource', sourceId: 's1', resolved });
    // img1 was anchored to c1 (start 0) + 1
    expect(noSource.overlays[0]!.anchor).toEqual({ kind: 'absolute', time: 1 });
    expect(noSource.overlays[2]).toBe(project.overlays[2]);

    // Without resolved times: max(0, offset)
    expect(mixProjectReducer(project, { type: 'removeClip', clipId: 'c1' }).overlays[0]!.anchor).toEqual({ kind: 'absolute', time: 1 });
    // No dependents: overlays are kept as they are
    expect(mixProjectReducer(project, { type: 'removeClip', clipId: 'c3' }).overlays).toBe(project.overlays);
  });

  test('batch removal of a chain (clip and the overlay anchored to it)', () => {
    const project = makeOverlayProject();
    const resolved = resolveOverlayTimes(project, plan, { soundDurations: { beep: 1 } });
    const next = mixProjectReducer(project, { type: 'batch',
      actions: [
        { type: 'removeClip', clipId: 'c2', resolved },
        { type: 'removeOverlay', overlayId: 'cd', resolved },
      ] });
    expect(overlayIds(next)).toEqual(['img1', 'beep', 'bar', 'img2']);
    const elementRefs = next.overlays.flatMap(({ anchor }) => (anchor.kind === 'element' ? [anchor.elementId] : []));
    expect(elementRefs.every((id) => next.overlays.some((o) => o.id === id))).toBe(true);
    expect(next.overlays[1]!.anchor).toEqual({ kind: 'absolute', time: 13 });
  });
});
