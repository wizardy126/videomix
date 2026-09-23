import { describe, expect, test } from 'vitest';

import { DEFAULT_CLIP_DURATION, createClip, getClipWarnings, getDefaultClipName, getDuplicateClipName, getNewClipRange, getNextClipColor, getNextNumberedName, getSourceBaseName, getSplitClipAction, parseNumberedName } from './clips';
import { mixProjectReducer } from './projectReducer';
import { createEmptyMixProject } from './types';
import type { MixClip } from './types';

const makeClip = (id: string, overrides: Partial<MixClip> = {}): MixClip => ({
  id,
  sourceId: 's1',
  name: id,
  color: 0,
  start: 1,
  end: 5,
  maxRect: { x: 0, y: 0, width: 1920, height: 1080 },
  muted: false,
  gainDb: 0,
  ...overrides,
});

const named = (...names: string[]) => names.map((name) => ({ name }));

describe('names', () => {
  test('getSourceBaseName strips the last extension only', () => {
    expect(getSourceBaseName('holidays.2024.mp4')).toBe('holidays.2024');
    expect(getSourceBaseName('clip')).toBe('clip');
    expect(getSourceBaseName('.hidden')).toBe('.hidden');
  });

  test('parseNumberedName', () => {
    expect(parseNumberedName('a b #12')).toEqual({ prefix: 'a b', n: 12 });
    expect(parseNumberedName('a #x')).toBeUndefined();
    expect(parseNumberedName('a#1')).toBeUndefined();
  });

  test('getNextNumberedName uses max + 1 of the same prefix', () => {
    expect(getNextNumberedName('v', [])).toBe('v #1');
    expect(getNextNumberedName('v', ['v #1', 'v #3', 'w #7', 'v #x'])).toBe('v #4');
    // a removed clip's number isn't reused while a higher one exists
    expect(getNextNumberedName('v', ['v #2'])).toBe('v #3');
    expect(getNextNumberedName('Intro', ['Intro'])).toBe('Intro #2');
  });

  test('getDefaultClipName: <source without extension> #n over all clips', () => {
    expect(getDefaultClipName({ name: 'beach.mp4' }, [])).toBe('beach #1');
    expect(getDefaultClipName({ name: 'beach.mp4' }, named('beach #1', 'beach #2', 'city #5'))).toBe('beach #3');
    // same file name in another folder: numbering continues instead of repeating names
    expect(getDefaultClipName({ name: 'beach.mov' }, named('beach #1'))).toBe('beach #2');
  });

  test('getDuplicateClipName', () => {
    expect(getDuplicateClipName('beach #2', named('beach #1', 'beach #2'))).toBe('beach #3');
    expect(getDuplicateClipName('Intro', named('Intro'))).toBe('Intro #2');
    expect(getDuplicateClipName('Intro', named('Intro', 'Intro #2'))).toBe('Intro #3');
  });
});

describe('getNextClipColor', () => {
  test('least used color, lowest index first', () => {
    expect(getNextClipColor([], 4)).toBe(0);
    expect(getNextClipColor([{ color: 0 }, { color: 1 }], 4)).toBe(2);
    expect(getNextClipColor([{ color: 0 }, { color: 1 }, { color: 2 }, { color: 3 }], 4)).toBe(0);
    // a removed clip frees its color
    expect(getNextClipColor([{ color: 0 }, { color: 2 }], 4)).toBe(1);
    // out of range indexes wrap like getSegColor
    expect(getNextClipColor([{ color: 4 }], 4)).toBe(1);
  });
});

describe('createClip', () => {
  test('whole (even) frame as max, no min, audio defaults', () => {
    expect(createClip({ id: 'c', sourceId: 's', name: 'n', color: 2, start: 1, end: 3, frameSize: { width: 1081, height: 720 } })).toEqual({
      id: 'c', sourceId: 's', name: 'n', color: 2, start: 1, end: 3, maxRect: { x: 0, y: 0, width: 1080, height: 720 }, muted: false, gainDb: 0,
    });
  });
});

describe('getNewClipRange', () => {
  test('default duration from the playhead', () => {
    expect(getNewClipRange({ time: 2, duration: 60 })).toEqual({ start: 2, end: 2 + DEFAULT_CLIP_DURATION, fromMarker: false });
  });

  test('moved back near the end, clamped to short files', () => {
    expect(getNewClipRange({ time: 58, duration: 60 })).toEqual({ start: 60 - DEFAULT_CLIP_DURATION, end: 60, fromMarker: false });
    expect(getNewClipRange({ time: 99, duration: 60 })).toEqual({ start: 60 - DEFAULT_CLIP_DURATION, end: 60, fromMarker: false });
    expect(getNewClipRange({ time: 1, duration: 3 })).toEqual({ start: 0, end: 3, fromMarker: false });
    expect(getNewClipRange({ time: 0, duration: 0 })).toBeUndefined();
  });

  test('from a marked start to the playhead', () => {
    expect(getNewClipRange({ time: 7, duration: 60, marker: { start: 3 } })).toEqual({ start: 3, end: 7, fromMarker: true });
    // playhead before (or at) the marker: a new clip instead
    expect(getNewClipRange({ time: 3, duration: 60, marker: { start: 3 } })).toEqual({ start: 3, end: 3 + DEFAULT_CLIP_DURATION, fromMarker: false });
  });
});

describe('getSplitClipAction', () => {
  test('second part is a copy right after, one batch', () => {
    const clips = [makeClip('a', { name: 'v #1', minRect: { x: 10, y: 10, width: 100, height: 100 }, gainDb: 3 }), makeClip('b')];
    const [first] = clips;
    const action = getSplitClipAction({ clip: first!, time: 2, newId: 'n', clips });
    expect(action?.type).toBe('batch');
    const project = mixProjectReducer({ ...createEmptyMixProject(), clips }, action!);
    expect(project.clips.map((c) => [c.id, c.name, c.start, c.end])).toEqual([['a', 'v #1', 1, 2], ['n', 'v #2', 2, 5], ['b', 'b', 1, 5]]);
    expect(project.clips[1]!.minRect).toEqual(first!.minRect);
    expect(project.clips[1]!.gainDb).toBe(3);
  });

  test('not at the edges', () => {
    const clips = [makeClip('a')];
    expect(getSplitClipAction({ clip: clips[0]!, time: 1, newId: 'n', clips })).toBeUndefined();
    expect(getSplitClipAction({ clip: clips[0]!, time: 5.05, newId: 'n', clips })).toBeUndefined();
  });
});

describe('getClipWarnings', () => {
  test('too short and no min', () => {
    const transition = { type: 'fade', duration: 0.5 } as const;
    expect(getClipWarnings(makeClip('a', { start: 0, end: 1 }), { transition })).toEqual({ tooShort: true, noMin: true });
    expect(getClipWarnings(makeClip('a', { start: 0, end: 1.1, minRect: { x: 0, y: 0, width: 16, height: 16 } }), { transition })).toEqual({ tooShort: false, noMin: false });
  });
});
