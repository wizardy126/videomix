import { describe, test, expect } from 'vitest';

import { resolveOverlayTimes } from './resolveOverlayTimes';
import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay, createSoundOverlay } from './factories';
import type { ColumnPlacement } from '../planner/types';
import type { MixClip, MixOverlay, OverlayAnchor } from '../types';

const clip = (id: string) => ({ id }) as MixClip;
const placement = (clipId: string, startTime: number, endTime: number): ColumnPlacement => ({ clipId, column: 0, startTime, endTime, transitionIn: 0 });

const clips = [clip('c1'), clip('c2'), clip('unplaced')];
const plan = { duration: 20, placements: [placement('c1', 0, 8), placement('c2', 7.5, 20)] };

const at = (anchor: OverlayAnchor) => ({ anchor });
const clipAnchor = (clipId: string, edge: 'start' | 'end', offset = 0): OverlayAnchor => ({ kind: 'clip', clipId, edge, offset });
const elementAnchor = (elementId: string, edge: 'start' | 'end', offset = 0): OverlayAnchor => ({ kind: 'element', elementId, edge, offset });

const image = (id: string, anchor: OverlayAnchor, duration = 2): MixOverlay => ({ ...createImageOverlay({ id, name: id, filePath: '/a.png' }), ...at(anchor), duration });
const countdown = (id: string, anchor: OverlayAnchor, duration = 3): MixOverlay => ({ ...createCountdownOverlay({ id, name: id }), ...at(anchor), duration });
const sound = (id: string, anchor: OverlayAnchor): MixOverlay => ({ ...createSoundOverlay({ id, name: id, filePath: '/a.wav' }), ...at(anchor) });

function resolve(overlays: MixOverlay[], soundDurations: Record<string, number> = {}) {
  return Object.fromEntries(resolveOverlayTimes({ overlays, clips }, plan, { soundDurations }));
}

describe('resolveOverlayTimes', () => {
  test('absolute and clip anchors', () => {
    const r = resolve([
      image('a', { kind: 'absolute', time: 1 }),
      image('b', clipAnchor('c2', 'start', 0.5)),
      image('c', clipAnchor('c1', 'end', -1)),
    ]);
    expect(r['a']).toEqual({ start: 1, end: 3, rawStart: 1, rawEnd: 3, warnings: [] });
    expect(r['b']).toMatchObject({ start: 8, end: 10, warnings: [] });
    expect(r['c']).toMatchObject({ start: 7, end: 9, warnings: [] });
  });

  test('chains of element anchors, in any list order', () => {
    const r = resolve([
      sound('beep', elementAnchor('cd', 'end')),
      image('after', elementAnchor('beep', 'end', 1)),
      countdown('cd', elementAnchor('logo', 'start', 2), 5),
      image('logo', clipAnchor('c1', 'start', 1)),
    ], { beep: 0.5 });
    expect(r['logo']).toMatchObject({ start: 1, end: 3 });
    expect(r['cd']).toMatchObject({ start: 3, end: 8 });
    expect(r['beep']).toMatchObject({ start: 8, end: 8.5, warnings: [] });
    expect(r['after']).toMatchObject({ start: 9.5, end: 11.5 });
  });

  test('progress bar linked to a countdown', () => {
    const r = resolve([
      countdown('cd', clipAnchor('c2', 'start'), 4),
      { ...createProgressBarOverlay({ id: 'bar', name: 'bar', linkedCountdownId: 'cd' }), duration: 99 },
      { ...createProgressBarOverlay({ id: 'lonely', name: 'bar', start: 2, linkedCountdownId: 'nope' }), duration: 1 },
    ]);
    expect(r['bar']).toMatchObject({ start: 7.5, end: 11.5, warnings: [] });
    expect(r['lonely']).toMatchObject({ start: 2, end: 3, warnings: [{ type: 'missing-linked-countdown', countdownId: 'nope' }] });
  });

  test('cycles fall back to absolute offsets; dependents of a cycle still resolve', () => {
    const r = resolve([
      image('a', elementAnchor('b', 'end', 1)),
      image('b', elementAnchor('a', 'start', 2)),
      image('c', elementAnchor('a', 'end', 1)),
      image('self', elementAnchor('self', 'start', -3)),
    ]);
    expect(r['a']).toMatchObject({ start: 1, end: 3, warnings: [{ type: 'cycle' }] });
    expect(r['b']).toMatchObject({ start: 2, end: 4, warnings: [{ type: 'cycle' }] });
    expect(r['c']).toMatchObject({ start: 4, end: 6, warnings: [] });
    expect(r['self']).toMatchObject({ start: 0, end: 2, warnings: [{ type: 'cycle' }] });
  });

  test('a bar linked to a countdown that is anchored to the bar is a cycle', () => {
    const r = resolve([
      countdown('cd', elementAnchor('bar', 'end', 1)),
      createProgressBarOverlay({ id: 'bar', name: 'bar', linkedCountdownId: 'cd' }),
    ]);
    expect(r['cd']!.warnings).toEqual([{ type: 'cycle' }]);
    expect(r['bar']!.warnings).toEqual([{ type: 'cycle' }]);
  });

  test('broken references', () => {
    const r = resolve([
      image('a', clipAnchor('deleted', 'start', 2)),
      image('b', clipAnchor('unplaced', 'start', -1)),
      image('c', elementAnchor('deleted', 'end', 3)),
    ]);
    expect(r['a']).toMatchObject({ start: 2, warnings: [{ type: 'missing-clip', clipId: 'deleted' }] });
    expect(r['b']).toMatchObject({ start: 0, warnings: [{ type: 'missing-clip', clipId: 'unplaced' }] });
    expect(r['c']).toMatchObject({ start: 3, warnings: [{ type: 'missing-element', elementId: 'deleted' }] });
  });

  test('sounds without a known duration', () => {
    expect(resolve([sound('s', { kind: 'absolute', time: 4 })])['s']).toEqual({ start: 4, end: 4, rawStart: 4, rawEnd: 4, warnings: [{ type: 'unknown-duration' }] });
  });

  test('cut to the video, keeping the raw times for anchors', () => {
    const r = resolve([
      image('early', clipAnchor('c1', 'start', -1)),
      image('late', clipAnchor('c2', 'end', -1)),
      image('outside', clipAnchor('c2', 'end', 1)),
      image('afterLate', elementAnchor('late', 'end', -2)),
    ]);
    expect(r['early']).toEqual({ start: 0, end: 1, rawStart: -1, rawEnd: 1, warnings: [{ type: 'clipped' }] });
    expect(r['late']).toEqual({ start: 19, end: 20, rawStart: 19, rawEnd: 21, warnings: [{ type: 'clipped' }] });
    expect(r['outside']).toEqual({ start: 20, end: 20, rawStart: 21, rawEnd: 23, warnings: [{ type: 'outside-video' }] });
    expect(r['afterLate']).toMatchObject({ start: 19, end: 20, rawEnd: 21 });
  });

  test('empty plan', () => {
    const r = Object.fromEntries(resolveOverlayTimes({ overlays: [image('a', { kind: 'absolute', time: 0 })], clips: [] }, { duration: 0, placements: [] }));
    expect(r['a']).toMatchObject({ start: 0, end: 0, warnings: [{ type: 'outside-video' }] });
  });

  test('is fast for many overlays', () => {
    // A long chain in reverse order plus many clip anchors
    const overlays: MixOverlay[] = [];
    for (let i = 0; i < 2000; i += 1) overlays.push(image(`e${i}`, i === 1999 ? clipAnchor('c1', 'start') : elementAnchor(`e${i + 1}`, 'start', 0.001)));
    const t0 = performance.now();
    const r = resolveOverlayTimes({ overlays, clips }, plan);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(r.get('e0')!.rawStart).toBeCloseTo(1.999);
  });
});
