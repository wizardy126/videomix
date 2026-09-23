import { describe, test, expect } from 'vitest';

import { canOverlayDependOn, detachOverlayReferences, findOverlayCycleIds, getDependentOverlays } from './anchors';
import { createCountdownOverlay, createProgressBarOverlay, createSoundOverlay } from './factories';
import type { MixOverlay, OverlayAnchor } from '../types';

const elementAnchor = (elementId: string, offset = 0): OverlayAnchor => ({ kind: 'element', elementId, edge: 'end', offset });
const countdown = (id: string, anchor?: OverlayAnchor): MixOverlay => ({ ...createCountdownOverlay({ id, name: id }), anchor: anchor ?? { kind: 'absolute', time: 0 } });
const sound = (id: string, anchor: OverlayAnchor): MixOverlay => ({ ...createSoundOverlay({ id, name: id, filePath: '/a.wav' }), anchor });

describe('anchor graph', () => {
  test('findOverlayCycleIds', () => {
    const overlays = [
      countdown('a', elementAnchor('b')),
      countdown('b', elementAnchor('c')),
      countdown('c', elementAnchor('a')),
      countdown('d', elementAnchor('a')),
      countdown('e'),
      sound('f', elementAnchor('e')),
    ];
    expect([...findOverlayCycleIds(overlays)].sort()).toEqual(['a', 'b', 'c']);
    expect(findOverlayCycleIds([])).toEqual(new Set());
  });

  test('canOverlayDependOn', () => {
    const overlays = [countdown('a'), sound('b', elementAnchor('a')), sound('c', elementAnchor('b'))];
    expect(canOverlayDependOn(overlays, 'a', 'c')).toBe(false);
    expect(canOverlayDependOn(overlays, 'a', 'a')).toBe(false);
    expect(canOverlayDependOn(overlays, 'c', 'a')).toBe(true);
    expect(canOverlayDependOn(overlays, 'b', 'c')).toBe(false);
    // through a linked bar
    const withBar = [countdown('cd'), createProgressBarOverlay({ id: 'bar', name: '', linkedCountdownId: 'cd' })];
    expect(canOverlayDependOn(withBar, 'cd', 'bar')).toBe(false);
  });

  test('getDependentOverlays', () => {
    const overlays = [
      countdown('a', { kind: 'clip', clipId: 'c1', edge: 'start', offset: 0 }),
      sound('b', elementAnchor('a')),
      createProgressBarOverlay({ id: 'bar', name: '', linkedCountdownId: 'a' }),
    ];
    expect(getDependentOverlays(overlays, { clipId: 'c1' }).map((o) => o.id)).toEqual(['a']);
    expect(getDependentOverlays(overlays, { overlayId: 'a' }).map((o) => o.id)).toEqual(['b', 'bar']);
  });
});

describe('detachOverlayReferences', () => {
  const overlays: MixOverlay[] = [
    countdown('cd', { kind: 'clip', clipId: 'c1', edge: 'end', offset: -2 }),
    sound('beep', elementAnchor('cd', 0.5)),
    createProgressBarOverlay({ id: 'bar', name: '', linkedCountdownId: 'cd' }),
    sound('other', { kind: 'clip', clipId: 'c2', edge: 'start', offset: 1 }),
  ];
  const resolved = new Map([
    ['cd', { rawStart: 6, rawEnd: 16 }],
    ['beep', { rawStart: 16.5, rawEnd: 17 }],
    ['bar', { rawStart: 6, rawEnd: 16 }],
  ]);

  test('removed clip: anchors become absolute at their resolved start', () => {
    const ret = detachOverlayReferences(overlays, { clipIds: new Set(['c1']), resolved });
    expect(ret[0]!.anchor).toEqual({ kind: 'absolute', time: 6 });
    expect(ret.slice(1)).toEqual(overlays.slice(1));
    expect(ret[1]).toBe(overlays[1]);
  });

  test('removed countdown: dependents absolute, linked bars unlinked with its times', () => {
    const ret = detachOverlayReferences(overlays, { overlayIds: new Set(['cd']), resolved });
    expect(ret[1]!.anchor).toEqual({ kind: 'absolute', time: 16.5 });
    const bar = ret[2]!;
    expect(bar.type === 'progressBar' && bar).toMatchObject({ anchor: { kind: 'absolute', time: 6 }, duration: 10 });
    expect('linkedCountdownId' in bar).toBe(false);
  });

  test('without resolved times: max(0, offset), and linked bars keep their own anchor and duration', () => {
    const ret = detachOverlayReferences(overlays, { clipIds: new Set(['c1']), overlayIds: new Set(['cd']) });
    expect(ret[0]!.anchor).toEqual({ kind: 'absolute', time: 0 });
    expect(ret[1]!.anchor).toEqual({ kind: 'absolute', time: 0.5 });
    expect(ret[2]).toMatchObject({ anchor: { kind: 'absolute', time: 0 }, duration: 10 });
    expect('linkedCountdownId' in ret[2]!).toBe(false);
  });

  test('nothing to detach returns the same array', () => {
    expect(detachOverlayReferences(overlays, { clipIds: new Set(['zzz']) })).toBe(overlays);
  });
});
