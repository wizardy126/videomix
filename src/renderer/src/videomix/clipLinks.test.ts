import { describe, test, expect } from 'vitest';

import { getAlwaysVisibleAction, getClipLinkInfos, getSetClipLinkAction } from './clipLinks';
import { mixProjectReducer } from './projectReducer';
import { getPlannerInput } from './planner/plannerInput';
import { createEmptyMixProject } from './types';
import type { MixClip, MixProject } from './types';

const clip = (id: string, start: number, end: number, overrides: Partial<MixClip> = {}): MixClip => ({
  id, sourceId: 's1', name: id, color: 0, start, end, maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, muted: false, gainDb: 0, ...overrides,
});

const project = (clips: MixClip[], settings: Partial<MixProject['settings']> = {}): MixProject => {
  const empty = createEmptyMixProject();
  return { ...empty, clips, settings: { ...empty.settings, ...settings } };
};

describe('getClipLinkInfos', () => {
  test('position in the chain, previous clip and automatic rule', () => {
    // a → b (1 s apart), c 20 s later, d overlaps c; x of another source
    const p = project([clip('b', 5, 9), clip('a', 0, 4), clip('c', 29, 33), clip('d', 32, 36), clip('x', 0, 4, { sourceId: 's2' })]);
    const infos = getClipLinkInfos(p);
    expect(infos.get('a')).toEqual({ previousId: undefined, linked: false, autoLinked: false, position: 1, length: 2 });
    expect(infos.get('b')).toEqual({ previousId: 'a', linked: true, autoLinked: true, position: 2, length: 2 });
    expect(infos.get('c')).toEqual({ previousId: 'b', linked: false, autoLinked: false, position: 1, length: 1 });
    expect(infos.get('d')).toEqual({ previousId: 'c', linked: false, autoLinked: false, position: 1, length: 1 });
    expect(infos.get('x')).toMatchObject({ previousId: undefined, linked: false, length: 1 });
  });

  test('the same chains as the planner', () => {
    const p = project([clip('a', 0, 4), clip('b', 5, 9, { link: 'break' }), clip('c', 9, 12), clip('d', 30, 32, { link: 'force' }), clip('e', 12, 12)]);
    const infos = getClipLinkInfos(p);
    const chains = getPlannerInput(p).chains ?? [];
    expect(chains).toEqual([['b', 'c', 'd']]);
    chains.forEach((chain) => chain.forEach((id, i) => expect(infos.get(id)).toMatchObject({ position: i + 1, length: chain.length })));
    expect(infos.get('b')).toMatchObject({ previousId: 'a', linked: false, autoLinked: true });
    expect(infos.get('d')).toMatchObject({ previousId: 'c', linked: true, autoLinked: false });
    // a clip without duration isn't planned
    expect(infos.has('e')).toBe(false);
  });

  test('pinned, grouped and always-visible clips are not in chains', () => {
    const p = project([clip('a', 0, 4), clip('b', 5, 9, { pinTime: 3 }), clip('c', 10, 12, { groupId: 'g' }), clip('d', 12, 14)], { alwaysVisible: { clipIds: ['a'] } });
    const infos = getClipLinkInfos(p);
    expect([...infos.keys()]).toEqual(['d']);
    expect(infos.get('d')).toMatchObject({ previousId: undefined });
  });
});

describe('getSetClipLinkAction', () => {
  const p = project([clip('a', 0, 4), clip('b', 5, 9), clip('c', 30, 32)]);
  const infos = getClipLinkInfos(p);
  const apply = (proj: MixProject, clipId: string, linked: boolean) => {
    const action = getSetClipLinkAction(proj.clips.find((c) => c.id === clipId)!, getClipLinkInfos(proj).get(clipId), linked);
    return action != null ? mixProjectReducer(proj, action) : proj;
  };

  test('breaking an automatic link stores "break", linking again removes it', () => {
    expect(getSetClipLinkAction(p.clips[1]!, infos.get('b'), false)).toEqual({ type: 'setClipLink', clipId: 'b', link: 'break' });
    const broken = apply(p, 'b', false);
    expect(getClipLinkInfos(broken).get('b')).toMatchObject({ linked: false });
    const relinked = apply(broken, 'b', true);
    expect(relinked.clips[1]).not.toHaveProperty('link');
    expect(getClipLinkInfos(relinked).get('b')).toMatchObject({ linked: true });
  });

  test('forcing a link stores "force", breaking it removes it', () => {
    const forced = apply(p, 'c', true);
    expect(forced.clips[2]!.link).toBe('force');
    expect(getClipLinkInfos(forced).get('c')).toMatchObject({ linked: true, position: 3, length: 3 });
    expect(apply(forced, 'c', false).clips[2]).not.toHaveProperty('link');
  });

  test('nothing to do', () => {
    // already linked, first clip of its source, not in chains
    expect(getSetClipLinkAction(p.clips[1]!, infos.get('b'), true)).toBeUndefined();
    expect(getSetClipLinkAction(p.clips[0]!, infos.get('a'), true)).toBeUndefined();
    expect(getSetClipLinkAction(p.clips[0]!, undefined, true)).toBeUndefined();
  });
});

describe('getAlwaysVisibleAction', () => {
  test('add at the end or at an index, move, remove', () => {
    expect(getAlwaysVisibleAction([], ['a'], { add: true })).toEqual({ type: 'setAlwaysVisibleClips', clipIds: ['a'] });
    expect(getAlwaysVisibleAction(['a', 'b'], ['c'], { add: true, index: 1 })).toEqual({ type: 'setAlwaysVisibleClips', clipIds: ['a', 'c', 'b'] });
    // moving "a" before "c" (index in the sequence as it is)
    expect(getAlwaysVisibleAction(['a', 'b', 'c'], ['a'], { add: true, index: 2 })).toEqual({ type: 'setAlwaysVisibleClips', clipIds: ['b', 'a', 'c'] });
    expect(getAlwaysVisibleAction(['a', 'b', 'c'], ['c', 'x'], { add: true, index: 0 })).toEqual({ type: 'setAlwaysVisibleClips', clipIds: ['c', 'x', 'a', 'b'] });
    expect(getAlwaysVisibleAction(['a', 'b'], ['a'], { add: false })).toEqual({ type: 'setAlwaysVisibleClips', clipIds: ['b'] });
  });

  test('nothing to do', () => {
    expect(getAlwaysVisibleAction(['a', 'b'], ['b'], { add: true })).toBeUndefined();
    expect(getAlwaysVisibleAction(['a', 'b'], ['a'], { add: true, index: 0 })).toBeUndefined();
    expect(getAlwaysVisibleAction(['a'], ['b'], { add: false })).toBeUndefined();
  });
});
