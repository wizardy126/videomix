import { describe, expect, test } from 'vitest';

import { getRenderTimeline } from '../render/renderTimeline';
import { testClips, testPlans } from '../render/renderTestFixtures';
import { getMusicSchedule } from '../render/buildAudioGraph';
import { assignPreviewPool, getPreviewFrameIndex, getPreviewMusicRequests, getPreviewVideoRequests } from './previewSchedule';
import type { PoolSlot } from './previewSchedule';

const clips = new Map(testClips.map((c) => [c.id, c]));
const tl = getRenderTimeline(testPlans.substitutions, { fps: 30, gap: 8, transitionDuration: 0.5 });

describe('getPreviewFrameIndex', () => {
  test('frame n is shown during [n/fps, (n+1)/fps)', () => {
    expect(getPreviewFrameIndex(0, 30)).toBe(0);
    expect(getPreviewFrameIndex(1 / 30, 30)).toBe(1);
    expect(getPreviewFrameIndex(0.1, 30)).toBe(3);
    expect(getPreviewFrameIndex(2.4999, 30)).toBe(74);
  });
});

describe('getPreviewVideoRequests', () => {
  test('visible clips with their media time, and the next clip preloaded at its start', () => {
    // b (col 0, source v1080 from 0) and a (col 1, source h1080 from 1) play; c starts at 2.5 in column 1
    expect(getPreviewVideoRequests({ tl, clips, time: 1 })).toEqual([
      { key: 'p0', sourceId: 'v1080', mediaTime: 1, active: true },
      { key: 'p1', sourceId: 'h1080', mediaTime: 2, active: true },
      { key: 'p2', sourceId: 'h720', mediaTime: 0, active: false },
    ]);
    expect(getPreviewVideoRequests({ tl, clips, time: 0.2 }).map((r) => r.key)).toEqual(['p0', 'p1']);
  });

  test('during a crossfade both clips play', () => {
    const requests = getPreviewVideoRequests({ tl, clips, time: 2.75 });
    expect(requests.filter((r) => r.active).map((r) => r.key)).toEqual(['p0', 'p1', 'p2']);
    expect(requests.find((r) => r.key === 'p2')!.mediaTime).toBeCloseTo(0.25);
  });

  test('a clip is gone after its last frame', () => {
    expect(getPreviewVideoRequests({ tl, clips, time: 4.6 }).map((r) => r.key)).toEqual(['p2']);
    expect(getPreviewVideoRequests({ tl, clips, time: 6 })).toEqual([]);
  });
});

describe('getPreviewMusicRequests', () => {
  const track = (id: string) => ({ id, path: `${id}.mp3`, absolutePath: `/${id}.mp3`, volumeDb: 0 });
  const occurrences = getMusicSchedule({ playlist: { tracks: [track('t1'), track('t2')], crossfade: 2, loop: false }, durations: { t1: 10, t2: 30 }, totalDuration: 20 });

  test('the playing tracks (two during a crossfade) and the next one preloaded', () => {
    expect(getPreviewMusicRequests({ occurrences, time: 5, totalDuration: 20 })).toEqual([{ key: 'm0', sourceId: 't1', mediaTime: 5, active: true }]);
    expect(getPreviewMusicRequests({ occurrences, time: 7, totalDuration: 20 })).toEqual([
      { key: 'm0', sourceId: 't1', mediaTime: 7, active: true },
      { key: 'm1', sourceId: 't2', mediaTime: 0, active: false },
    ]);
    expect(getPreviewMusicRequests({ occurrences, time: 9, totalDuration: 20 }).map((r) => [r.key, r.active, r.mediaTime])).toEqual([['m0', true, 9], ['m1', true, 1]]);
    expect(getPreviewMusicRequests({ occurrences, time: 20, totalDuration: 20 })).toEqual([]);
  });
});

describe('assignPreviewPool', () => {
  test('keeps the element of a request, reuses idle ones (same source first), creates the rest', () => {
    let slots: PoolSlot[] = [];
    let res = assignPreviewPool(slots, [{ key: 'p0', sourceId: 'A' }, { key: 'p1', sourceId: 'B' }]);
    expect(res.created).toEqual([0, 1]);
    slots = res.slots;

    // p0 ends; p2 (source C) and p3 (source A) start: p3 takes p0's element (A already loaded), p2 a new one
    res = assignPreviewPool(slots, [{ key: 'p1', sourceId: 'B' }, { key: 'p2', sourceId: 'C' }, { key: 'p3', sourceId: 'A' }]);
    expect(res.slots).toEqual([
      { id: 0, key: 'p3', sourceId: 'A' },
      { id: 1, key: 'p1', sourceId: 'B' },
      { id: 2, key: 'p2', sourceId: 'C' },
    ]);
    expect(res.created).toEqual([2]);
    expect(res.removed).toEqual([]);
    slots = res.slots;

    // nothing needed: two idle elements are kept, the oldest one goes
    res = assignPreviewPool(slots, []);
    expect(res.removed).toEqual([0]);
    expect(res.slots.map((s) => [s.id, s.key])).toEqual([[1, undefined], [2, undefined]]);

    // an idle element of another source is reused rather than creating one
    res = assignPreviewPool(res.slots, [{ key: 'p9', sourceId: 'D' }]);
    expect(res.created).toEqual([]);
    expect(res.slots.find((s) => s.key === 'p9')).toEqual({ id: 1, key: 'p9', sourceId: 'D' });
  });
});
