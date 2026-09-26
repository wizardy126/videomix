import { test, expect } from 'vitest';

import { createEmptyMixProject } from '../types';
import type { MixClip } from '../types';
import { getPlannerInput } from './plannerInput';

const clip = (id: string, start: number, end: number): MixClip => ({
  id,
  sourceId: 's',
  name: id,
  color: 0,
  start,
  end,
  muted: false,
  gainDb: 0,
  maxRect: { x: 0, y: 0, width: 1080, height: 1920 },
  minRect: { x: 0, y: 320, width: 1080, height: 1080 },
});

test('getPlannerInput', () => {
  const project = { ...createEmptyMixProject(), clips: [clip('a', 1, 11), clip('bad', 5, 5)] };
  project.settings.output = { aspect: '16:9', resolution: '720' };
  const input = getPlannerInput(project);
  expect(input.settings).toEqual({
    width: 1280, height: 720, maxColumns: 3, gap: 0, reorderWindow: 3, order: { mode: 'list', seed: 0 }, priority: 'duration', transitionDuration: 0.5, linkTransition: 'cut',
  });
  expect(input).not.toHaveProperty('chains');
  expect(input).not.toHaveProperty('sequence');
  expect(input.clips).toHaveLength(1);
  expect(input.clips[0]).toMatchObject({ id: 'a', duration: 10, aspectRange: { min: 1080 / 1920, max: 1, preferred: 1080 / 1920 } });
});

test('getPlannerInput passes pins and groups (A4)', () => {
  const project = { ...createEmptyMixProject(), clips: [{ ...clip('a', 1, 11), pinTime: 4, groupId: 'g' }, clip('b', 0, 3)] };
  const [a, b] = getPlannerInput(project).clips;
  expect(a).toMatchObject({ pinTime: 4, groupId: 'g' });
  expect(b).not.toHaveProperty('pinTime');
  expect(b).not.toHaveProperty('groupId');
});

test('getPlannerInput passes chains, the sequence, the link transition and the maximum duration (T38)', () => {
  const project = {
    ...createEmptyMixProject(),
    clips: [clip('a', 0, 10), clip('b', 12, 20), clip('bad', 21, 21), clip('c', 22, 30), clip('s', 40, 50), clip('x', 100, 110)],
  };
  project.settings.links = { maxGap: 5, transition: 'global' };
  project.settings.maxDuration = 60;
  project.settings.alwaysVisible = { clipIds: ['s', 'bad', 'gone'] };
  const input = getPlannerInput(project);
  // 'bad' (no duration) is left out before linking, so b and c are still chained; 's' is the sequence
  expect(input.chains).toEqual([['a', 'b', 'c']]);
  expect(input.sequence).toEqual(['s']);
  expect(input.settings).toMatchObject({ linkTransition: 'global', maxDuration: 60 });
});

test('getPlannerInput passes the source size of the clips that may extend beyond their max (E7, T38b)', () => {
  const project = {
    ...createEmptyMixProject(),
    sources: [{ id: 's', path: 's.mp4', absolutePath: '/s.mp4', name: 's.mp4', width: 1080, height: 1920 }],
    clips: [clip('a', 0, 5), { ...clip('off', 0, 5), extendBeyondMax: false }, { ...clip('on', 0, 5), extendBeyondMax: true }, { ...clip('nosize', 0, 5), sourceId: 'x' }],
  };
  const [a, off, on, nosize] = getPlannerInput(project).clips;
  expect(a).toMatchObject({ extendBeyondMax: { frame: { width: 1080, height: 1920 } } });
  expect(on).toMatchObject({ extendBeyondMax: { frame: { width: 1080, height: 1920 } } });
  expect(off).not.toHaveProperty('extendBeyondMax');
  expect(nosize).not.toHaveProperty('extendBeyondMax');
  // without sources (e.g. the duration estimate) no clip extends
  expect(getPlannerInput({ clips: project.clips, settings: project.settings }).clips.some((c) => c.extendBeyondMax != null)).toBe(false);
});
