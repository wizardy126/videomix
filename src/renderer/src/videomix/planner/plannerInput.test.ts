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
    width: 1280, height: 720, maxColumns: 3, gap: 0, reorderWindow: 3, order: { mode: 'list', seed: 0 }, transitionDuration: 0.5,
  });
  expect(input.clips).toHaveLength(1);
  expect(input.clips[0]).toMatchObject({ id: 'a', duration: 10, aspectRange: { min: 1080 / 1920, max: 1, preferred: 1080 / 1920 } });
});
