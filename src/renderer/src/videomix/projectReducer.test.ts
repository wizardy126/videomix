import { describe, test, expect } from 'vitest';

import { createMixSource, dissolveSingleClipGroups, mixProjectReducer } from './projectReducer';
import { createEmptyMixProject } from './types';
import type { ImageOverlay, MixClip, MixMusicTrack, MixOverlay, MixProject } from './types';
import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay, createSoundOverlay, createTextOverlay } from './overlays/factories';
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
    const output = { aspect: '9:16' as const, resolution: '720' as const };
    const next = mixProjectReducer(project, { type: 'updateSettings', patch: { maxColumns: 2, output } });
    expect(next.settings).toEqual({ ...project.settings, maxColumns: 2, output });
    expect(mixProjectReducer(project, { type: 'updateSettings', patch: { maxColumns: 3 } })).toBe(project);
    expect(mixProjectReducer(project, { type: 'updateSettings', patch: { encoder: { codec: 'h264', hardware: 'auto' } } })).toBe(project);
  });

  test('updateSettings refits image overlay boxes when the output aspect changes (T34, pending from T29)', () => {
    const image: ImageOverlay = createImageOverlay({ id: 'i1', name: 'img', filePath: '/i.png' });
    // A wide box, centered a bit off-center
    image.box = { x: 0.2, y: 0.4, width: 0.4, height: 0.1 };
    const other: MixOverlay = createImageOverlay({ id: 'i2', name: 'img2', filePath: '/i2.png' });
    const project: MixProject = { ...makeProject(), overlays: [image, other] };
    const output = { aspect: '9:16' as const, resolution: '1080' as const };
    const imageSizes = new Map([['i1', { width: 400, height: 200 }]]);

    const asImage = (p: MixProject, id: string) => p.overlays.find((o): o is ImageOverlay => o.type === 'image' && o.id === id)!;

    const next = mixProjectReducer(project, { type: 'updateSettings', patch: { output }, imageSizes });
    expect(next.settings.output).toEqual(output);
    // i1: width kept, height recomputed for the 1080x1920 frame, centered on the previous box's center (0.4, 0.45)
    const refitted = asImage(next, 'i1').box;
    expect(refitted.width).toBeCloseTo(0.4);
    expect(refitted.height).toBeCloseTo((0.4 * 1080 * 200) / (400 * 1920));
    expect(refitted.x + refitted.width / 2).toBeCloseTo(0.4);
    expect(refitted.y + refitted.height / 2).toBeCloseTo(0.45);
    // i2: no known pixel size (missing from imageSizes) -> unchanged
    expect(asImage(next, 'i2').box).toEqual(other.box);

    // No aspect change (only resolution) -> boxes unchanged even with imageSizes
    const sameAspect = mixProjectReducer(project, { type: 'updateSettings', patch: { output: { ...project.settings.output, resolution: '720' } }, imageSizes });
    expect(asImage(sameAspect, 'i1').box).toEqual(image.box);

    // No imageSizes at all -> boxes unchanged
    const noSizes = mixProjectReducer(project, { type: 'updateSettings', patch: { output } });
    expect(asImage(noSizes, 'i1').box).toEqual(image.box);
  });

  describe('pinned and grouped clips (v3)', () => {
    const groups = (project: MixProject) => project.clips.map((c) => c.groupId);

    test('setClipPinTime', () => {
      const project = makeProject();
      const pinned = mixProjectReducer(project, { type: 'setClipPinTime', clipId: 'c2', pinTime: 12 });
      expect(pinned.clips[1]).toEqual({ ...project.clips[1], pinTime: 12 });
      expect(pinned.clips[0]).toBe(project.clips[0]);
      expect(mixProjectReducer(pinned, { type: 'setClipPinTime', clipId: 'c2', pinTime: 12 })).toBe(pinned);
      const unpinned = mixProjectReducer(pinned, { type: 'setClipPinTime', clipId: 'c2', pinTime: undefined });
      expect('pinTime' in unpinned.clips[1]!).toBe(false);
      expect(mixProjectReducer(project, { type: 'setClipPinTime', clipId: 'c2', pinTime: undefined })).toBe(project);
    });

    test('groupClips / ungroupClips', () => {
      const project = makeProject();
      const grouped = mixProjectReducer(project, { type: 'groupClips', clipIds: ['c1', 'c3', 'nope'], groupId: 'g' });
      expect(groups(grouped)).toEqual(['g', undefined, 'g']);
      // fewer than 2 existing clips: nothing
      expect(mixProjectReducer(project, { type: 'groupClips', clipIds: ['c1', 'nope'], groupId: 'g' })).toBe(project);
      expect(mixProjectReducer(grouped, { type: 'groupClips', clipIds: ['c1', 'c3'], groupId: 'g' })).toBe(grouped);

      // regrouping c3 with c2 leaves c1 alone in g: g is dissolved
      const regrouped = mixProjectReducer(grouped, { type: 'groupClips', clipIds: ['c2', 'c3'], groupId: 'h' });
      expect(groups(regrouped)).toEqual([undefined, 'h', 'h']);
      expect('groupId' in regrouped.clips[0]!).toBe(false);

      // ungrouping one of two dissolves the group
      const ungrouped = mixProjectReducer(grouped, { type: 'ungroupClips', clipIds: ['c1'] });
      expect(groups(ungrouped)).toEqual([undefined, undefined, undefined]);
      expect(ungrouped.clips.every((c) => !('groupId' in c))).toBe(true);
      expect(mixProjectReducer(project, { type: 'ungroupClips', clipIds: ['c1'] })).toBe(project);

      // a group of three keeps two
      const three = mixProjectReducer(project, { type: 'groupClips', clipIds: ['c1', 'c2', 'c3'], groupId: 'g' });
      expect(groups(mixProjectReducer(three, { type: 'ungroupClips', clipIds: ['c2'] }))).toEqual(['g', undefined, 'g']);
    });

    test('removing clips dissolves groups left with one clip', () => {
      const grouped = mixProjectReducer(makeProject(), { type: 'groupClips', clipIds: ['c1', 'c2'], groupId: 'g' });
      expect(groups(mixProjectReducer(grouped, { type: 'removeClip', clipId: 'c2' }))).toEqual([undefined, undefined]);
      // c2 is the only clip of s2
      expect(groups(mixProjectReducer(grouped, { type: 'removeSource', sourceId: 's2' }))).toEqual([undefined, undefined]);
      const three = mixProjectReducer(makeProject(), { type: 'groupClips', clipIds: ['c1', 'c2', 'c3'], groupId: 'g' });
      expect(groups(mixProjectReducer(three, { type: 'removeClip', clipId: 'c2' }))).toEqual(['g', 'g']);
    });

    test('a duplicate is neither pinned nor grouped, and has no link exception of its own (T36)', () => {
      const project = mixProjectReducer(makeProject(), {
        type: 'batch',
        actions: [
          { type: 'groupClips', clipIds: ['c1', 'c2'], groupId: 'g' },
          { type: 'setClipPinTime', clipId: 'c1', pinTime: 3 },
          { type: 'setClipLink', clipId: 'c1', link: 'force' },
        ],
      });
      const next = mixProjectReducer(project, { type: 'duplicateClip', clipId: 'c1', newId: 'c9' });
      const { pinTime, groupId, link, ...rest } = project.clips[0]!;
      expect(pinTime).toBe(3);
      expect(groupId).toBe('g');
      expect(link).toBe('force');
      expect(next.clips[1]).toEqual({ ...rest, id: 'c9' });
      expect('link' in next.clips[1]!).toBe(false);
    });

    test('dissolveSingleClipGroups keeps the array when nothing changes', () => {
      const clips = [makeClip('a', { groupId: 'g' }), makeClip('b', { groupId: 'g' }), makeClip('c')];
      expect(dissolveSingleClipGroups(clips)).toBe(clips);
    });
  });

  describe('clip links and always-visible sequence (v4)', () => {
    test('setClipLink', () => {
      const project = makeProject();
      const forced = mixProjectReducer(project, { type: 'setClipLink', clipId: 'c2', link: 'force' });
      expect(forced.clips[1]).toEqual({ ...project.clips[1], link: 'force' });
      expect(forced.clips[0]).toBe(project.clips[0]);
      expect(mixProjectReducer(forced, { type: 'setClipLink', clipId: 'c2', link: 'force' })).toBe(forced);
      const cleared = mixProjectReducer(forced, { type: 'setClipLink', clipId: 'c2', link: undefined });
      expect('link' in cleared.clips[1]!).toBe(false);
      expect(mixProjectReducer(project, { type: 'setClipLink', clipId: 'c2', link: undefined })).toBe(project);
    });

    test('setAlwaysVisibleClips: dedupes, drops unknown ids, and is a no-op if unchanged', () => {
      const project = makeProject();
      const set = mixProjectReducer(project, { type: 'setAlwaysVisibleClips', clipIds: ['c3', 'c1', 'c3', 'nope'] });
      expect(set.settings.alwaysVisible.clipIds).toEqual(['c3', 'c1']);
      expect(mixProjectReducer(set, { type: 'setAlwaysVisibleClips', clipIds: ['c3', 'c1'] })).toBe(set);
      expect(mixProjectReducer(project, { type: 'setAlwaysVisibleClips', clipIds: [] })).toBe(project);
    });

    test('removing a clip or its source drops it from the always-visible sequence', () => {
      const withSequence = mixProjectReducer(makeProject(), { type: 'setAlwaysVisibleClips', clipIds: ['c1', 'c2', 'c3'] });
      const afterRemove = mixProjectReducer(withSequence, { type: 'removeClip', clipId: 'c2' });
      expect(afterRemove.settings.alwaysVisible.clipIds).toEqual(['c1', 'c3']);
      // c2 is the only clip of s2
      const afterRemoveSource = mixProjectReducer(withSequence, { type: 'removeSource', sourceId: 's2' });
      expect(afterRemoveSource.settings.alwaysVisible.clipIds).toEqual(['c1', 'c3']);
      // no-op: the settings object is kept when nothing is removed from the sequence
      expect(mixProjectReducer(withSequence, { type: 'removeClip', clipId: 'nope' })).toBe(withSequence);
      const noSequence = makeProject();
      expect(mixProjectReducer(noSequence, { type: 'removeClip', clipId: 'c1' }).settings).toBe(noSequence.settings);
    });
  });

  describe('music playlist (v3)', () => {
    const track = (id: string, overrides: Partial<MixMusicTrack> = {}): MixMusicTrack => ({ id, path: `/${id}.mp3`, absolutePath: `/${id}.mp3`, volumeDb: -12, ...overrides });
    const trackIds = (project: MixProject) => project.settings.musicPlaylist.tracks.map((t) => t.id);
    const withTracks = () => mixProjectReducer(makeProject(), { type: 'addMusicTracks', tracks: [track('a'), track('b'), track('c')] });

    test('addMusicTracks', () => {
      const project = withTracks();
      expect(trackIds(project)).toEqual(['a', 'b', 'c']);
      expect(trackIds(mixProjectReducer(project, { type: 'addMusicTracks', tracks: [track('d'), track('e')], index: 1 }))).toEqual(['a', 'd', 'e', 'b', 'c']);
      expect(() => mixProjectReducer(project, { type: 'addMusicTracks', tracks: [track('a')] })).toThrow('Duplicate music track id');
      expect(() => mixProjectReducer(project, { type: 'addMusicTracks', tracks: [track('d'), track('d')] })).toThrow('Duplicate music track id');
      expect(mixProjectReducer(project, { type: 'addMusicTracks', tracks: [] })).toBe(project);
      // the rest of the settings is kept
      expect(project.settings.musicPlaylist.crossfade).toBe(2);
    });

    test('updateMusicTrack', () => {
      const project = withTracks();
      const next = mixProjectReducer(project, { type: 'updateMusicTrack', trackId: 'b', patch: { volumeDb: -3, path: '/x.mp3', absolutePath: '/x.mp3' } });
      expect(next.settings.musicPlaylist.tracks[1]).toEqual({ id: 'b', path: '/x.mp3', absolutePath: '/x.mp3', volumeDb: -3 });
      expect(next.settings.musicPlaylist.tracks[0]).toBe(project.settings.musicPlaylist.tracks[0]);
      expect(mixProjectReducer(project, { type: 'updateMusicTrack', trackId: 'b', patch: { volumeDb: -12 } })).toBe(project);
      expect(mixProjectReducer(project, { type: 'updateMusicTrack', trackId: 'nope', patch: { volumeDb: 0 } })).toBe(project);
    });

    test('removeMusicTrack', () => {
      const project = withTracks();
      expect(trackIds(mixProjectReducer(project, { type: 'removeMusicTrack', trackId: 'b' }))).toEqual(['a', 'c']);
      expect(mixProjectReducer(project, { type: 'removeMusicTrack', trackId: 'nope' })).toBe(project);
    });

    test('reorderMusicTracks', () => {
      const project = withTracks();
      expect(trackIds(mixProjectReducer(project, { type: 'reorderMusicTracks', ids: ['c', 'a', 'b'] }))).toEqual(['c', 'a', 'b']);
      expect(trackIds(mixProjectReducer(project, { type: 'reorderMusicTracks', ids: ['c', 'x', 'c'] }))).toEqual(['c', 'a', 'b']);
      expect(mixProjectReducer(project, { type: 'reorderMusicTracks', ids: ['a', 'b'] })).toBe(project);
    });

    test('updateMusicPlaylist', () => {
      const project = withTracks();
      const next = mixProjectReducer(project, { type: 'updateMusicPlaylist', patch: { crossfade: 4, loop: false, ducking: { enabled: true, amountDb: -6 } } });
      expect(next.settings.musicPlaylist).toEqual({ tracks: project.settings.musicPlaylist.tracks, crossfade: 4, loop: false, ducking: { enabled: true, amountDb: -6 } });
      expect(mixProjectReducer(project, { type: 'updateMusicPlaylist', patch: { ducking: { enabled: false, amountDb: -10 } } })).toBe(project);
    });
  });

  test('text overlays (v3): update removes cleared optional keys', () => {
    const project = mixProjectReducer(makeProject(), { type: 'addOverlay', overlay: { ...createTextOverlay({ id: 't', name: 'Text', text: 'a' }), shadow: { x: 1, y: 1, color: '#000000' } } });
    const next = mixProjectReducer(project, { type: 'updateOverlay', overlayId: 't', patch: { text: 'a\nb', shadow: undefined, entry: { kind: 'slide', from: 'left', duration: 1 } } });
    expect(next.overlays[0]).toMatchObject({ text: 'a\nb', entry: { kind: 'slide', from: 'left', duration: 1 } });
    expect('shadow' in next.overlays[0]!).toBe(false);
  });

  describe('v5 (T44): keyframes and black bars', () => {
    const kf = (time: number, centerX: number, centerY: number, scale = 1) => ({ time, centerX, centerY, scale });
    const withSize = () => {
      const project = makeProject();
      project.sources[0] = { ...project.sources[0]!, width: 1920, height: 1080 };
      project.clips[0] = { ...project.clips[0]!, maxRect: { x: 480, y: 270, width: 960, height: 540 }, keyframes: [kf(1, 960, 540), kf(3, 600, 400, 0.5)] };
      return project;
    };

    test('updateClip stores keyframes sorted, and an empty list as none', () => {
      const project = makeProject();
      const next = mixProjectReducer(project, { type: 'updateClip', clipId: 'c1', patch: { keyframes: [kf(3, 1, 1), kf(1, 2, 2)] } });
      expect(next.clips[0]!.keyframes).toEqual([kf(1, 2, 2), kf(3, 1, 1)]);
      const cleared = mixProjectReducer(next, { type: 'updateClip', clipId: 'c1', patch: { keyframes: [] } });
      expect('keyframes' in cleared.clips[0]!).toBe(false);
      expect(mixProjectReducer(project, { type: 'updateClip', clipId: 'c1', patch: { keyframes: [] } })).toBe(project);
    });

    test('duplicating a clip copies its keyframes', () => {
      const next = mixProjectReducer(withSize(), { type: 'duplicateClip', clipId: 'c1', newId: 'copy' });
      expect(next.clips[1]!.keyframes).toEqual(next.clips[0]!.keyframes);
      expect(next.clips[1]!.keyframes).not.toBe(next.clips[0]!.keyframes);
    });

    test('rotateClip turns the keyframes with the rects', () => {
      const next = mixProjectReducer(withSize(), { type: 'rotateClip', clipId: 'c1', rotation: 90 });
      expect(next.clips[0]).toMatchObject({ rotation: 90, maxRect: { x: 270, y: 480, width: 540, height: 960 } });
      // centre (x, y) of a 1920×1080 frame → (1080 − y, x)
      expect(next.clips[0]!.keyframes).toEqual([kf(1, 540, 960), kf(3, 680, 600, 0.5)]);
      // and back
      expect(mixProjectReducer(next, { type: 'rotateClip', clipId: 'c1', rotation: 0 }).clips[0]).toEqual(withSize().clips[0]);
    });

    test('relinkSource to another resolution rescales the keyframes (B2)', () => {
      const next = mixProjectReducer(withSize(), { type: 'relinkSource', sourceId: 's1', source: { path: '/v/a2.mp4', absolutePath: '/v/a2.mp4', width: 1280, height: 720 } });
      expect(next.clips[0]!.maxRect).toEqual({ x: 320, y: 180, width: 640, height: 360 });
      expect(next.clips[0]!.keyframes).toEqual([kf(1, 640, 360), kf(3, 400, (400 * 720) / 1080, 0.5)]);
    });

    test('setSourceBlackBars caches or clears the detection', () => {
      const project = makeProject();
      const blackBars = { rect: { x: 0, y: 140, width: 1920, height: 800 }, frame: { width: 1920, height: 1080 }, file: { size: 1, mtimeMs: 2 } };
      const next = mixProjectReducer(project, { type: 'setSourceBlackBars', sourceId: 's1', blackBars });
      expect(next.sources[0]!.blackBars).toEqual(blackBars);
      expect(mixProjectReducer(next, { type: 'setSourceBlackBars', sourceId: 's1', blackBars: structuredClone(blackBars) })).toBe(next);
      expect('blackBars' in mixProjectReducer(next, { type: 'setSourceBlackBars', sourceId: 's1', blackBars: undefined }).sources[0]!).toBe(false);
      expect(mixProjectReducer(project, { type: 'setSourceBlackBars', sourceId: 'nope', blackBars })).toBe(project);
      // relinking keeps it (validity is checked against the file identity, isBlackBarsDetectionValid)
      expect(mixProjectReducer(next, { type: 'relinkSource', sourceId: 's1', source: { path: '/x.mp4', absolutePath: '/x.mp4' } }).sources[0]!.blackBars).toEqual(blackBars);
    });
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
