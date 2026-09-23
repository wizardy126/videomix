import { describe, test, expect } from 'vitest';

import { getClipPinTime, getGroupColors, getPinClipAction, getSelectionRange, getUnpinClipAction } from './clipGroups';
import { mixProjectReducer } from './projectReducer';
import { createEmptyMixProject } from './types';
import type { MixClip, MixProject } from './types';

const makeClip = (id: string, overrides: Partial<MixClip> = {}): MixClip => ({
  id, sourceId: 's1', name: id, color: 0, start: 1, end: 5, maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, muted: false, gainDb: 0, ...overrides,
});

const project = (clips: MixClip[]): MixProject => ({ ...createEmptyMixProject(), clips });

describe('clipGroups', () => {
  test('group colours in list order, only for groups of 2 or more', () => {
    const colors = getGroupColors([{ groupId: 'b' }, {}, { groupId: 'a' }, { groupId: 'b' }, { groupId: 'lonely' }, { groupId: 'a' }]);
    expect([...colors.keys()]).toEqual(['b', 'a']);
    expect(colors.get('b')).not.toBe(colors.get('a'));
  });

  test('shift-click range in list order, either direction', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(getSelectionRange(ids, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(getSelectionRange(ids, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(getSelectionRange(ids, undefined, 'c')).toEqual(['c']);
    expect(getSelectionRange(ids, 'a', 'x')).toEqual([]);
  });

  test('pin a clip; in a group the pin moves to it', () => {
    const p = project([makeClip('a', { groupId: 'g', pinTime: 3 }), makeClip('b', { groupId: 'g' }), makeClip('c')]);
    const pinned = mixProjectReducer(p, getPinClipAction(p.clips, 'b', 7.5)!);
    expect(pinned.clips.map((c) => c.pinTime)).toEqual([undefined, 7.5, undefined]);
    expect(pinned.clips[0]).not.toHaveProperty('pinTime');
    // never before the start of the video
    expect(mixProjectReducer(p, getPinClipAction(p.clips, 'c', -2)!).clips[2]!.pinTime).toBe(0);
    expect(getPinClipAction(p.clips, 'nope', 1)).toBeUndefined();
  });

  test('unpin a clip and its group; nothing to do when nothing is pinned', () => {
    const p = project([makeClip('a', { groupId: 'g' }), makeClip('b', { groupId: 'g', pinTime: 4 }), makeClip('c')]);
    // from a member without its own pin: the group was pinned through b
    expect(getClipPinTime(p.clips, p.clips[0]!)).toBe(4);
    const unpinned = mixProjectReducer(p, getUnpinClipAction(p.clips, 'a')!);
    expect(unpinned.clips.every((c) => c.pinTime == null)).toBe(true);
    expect(getUnpinClipAction(p.clips, 'c')).toBeUndefined();
    expect(getClipPinTime(p.clips, p.clips[2]!)).toBeUndefined();
  });
});
