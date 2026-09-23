import { describe, expect, test } from 'vitest';

import { getOverlaysDetachedBy, getRemovedRefs, prepareOverlayRemoval, withRemovalTimes } from './overlayRemoval';
import { createMixSource, mixProjectReducer } from './projectReducer';
import type { MixProjectAction } from './projectReducer';
import { createEmptyMixProject } from './types';
import type { MixClip, MixOverlay, MixProject } from './types';
import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay } from './overlays/factories';
import { planRender } from './render/renderOutput';

function makeClip(id: string, sourceId: string): MixClip {
  return { id, sourceId, name: id, color: 0, start: 0, end: 4, maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, muted: false, gainDb: 0 };
}

function makeProject(): MixProject {
  const overlays: MixOverlay[] = [
    { ...createImageOverlay({ id: 'logo', name: 'Logo', filePath: '/logo.png' }), anchor: { kind: 'clip', clipId: 'c2', edge: 'start', offset: 1 } },
    { ...createCountdownOverlay({ id: 'cd', name: 'Countdown' }), anchor: { kind: 'clip', clipId: 'c1', edge: 'end', offset: 0.5 } },
    createProgressBarOverlay({ id: 'bar', name: 'Bar', linkedCountdownId: 'cd' }),
    createImageOverlay({ id: 'free', name: 'Free', filePath: '/free.png', start: 2 }),
  ];
  return {
    ...createEmptyMixProject(),
    sources: [createMixSource({ id: 's1', filePath: '/v/a.mp4', name: 'a.mp4' }), createMixSource({ id: 's2', filePath: '/v/b.mp4', name: 'b.mp4' })],
    clips: [makeClip('c1', 's1'), makeClip('c2', 's2'), makeClip('c3', 's1')],
    overlays,
  };
}

const ids = (overlays: MixOverlay[]) => overlays.map((o) => o.id);

describe('overlay removal', () => {
  test('removed refs, also in batches and through sources', () => {
    const project = makeProject();
    const refs = getRemovedRefs(project, { type: 'batch', actions: [{ type: 'removeSource', sourceId: 's1' }, { type: 'removeOverlay', overlayId: 'x' }] });
    expect([...refs.clipIds]).toEqual(['c1', 'c3']);
    expect([...refs.overlayIds]).toEqual(['x']);
  });

  test('detached overlays: anchored to a removed clip or overlay, or linked to a removed countdown', () => {
    const project = makeProject();
    expect(ids(getOverlaysDetachedBy(project, { type: 'removeClip', clipId: 'c2' }))).toEqual(['logo']);
    expect(ids(getOverlaysDetachedBy(project, { type: 'removeSource', sourceId: 's1' }))).toEqual(['cd']);
    expect(ids(getOverlaysDetachedBy(project, { type: 'removeOverlay', overlayId: 'cd' }))).toEqual(['bar']);
    expect(ids(getOverlaysDetachedBy(project, { type: 'removeClip', clipId: 'c3' }))).toEqual([]);
    expect(ids(getOverlaysDetachedBy(project, { type: 'updateSettings', patch: { maxColumns: 2 } }))).toEqual([]);
    // removed together: not reported as detached
    expect(ids(getOverlaysDetachedBy(project, { type: 'batch', actions: [{ type: 'removeOverlay', overlayId: 'cd' }, { type: 'removeOverlay', overlayId: 'bar' }] }))).toEqual([]);
  });

  test('withRemovalTimes sets resolved on removals only, keeping an explicit one', () => {
    const resolved = new Map();
    const explicit = new Map();
    const action: MixProjectAction = {
      type: 'batch',
      actions: [
        { type: 'updateClip', clipId: 'c1', patch: { end: 3 } },
        { type: 'removeClip', clipId: 'c1' },
        { type: 'removeOverlay', overlayId: 'cd', resolved: explicit },
      ],
    };
    const ret = withRemovalTimes(action, resolved);
    expect(ret).toEqual({
      type: 'batch',
      actions: [
        { type: 'updateClip', clipId: 'c1', patch: { end: 3 } },
        { type: 'removeClip', clipId: 'c1', resolved },
        { type: 'removeOverlay', overlayId: 'cd', resolved: explicit },
      ],
    });
    expect(ret.type === 'batch' && ret.actions[2]?.type === 'removeOverlay' && ret.actions[2].resolved).toBe(explicit);
  });

  test('prepareOverlayRemoval: the anchored overlay keeps its current start after the clip is removed', () => {
    const project = makeProject();
    const { plan } = planRender(project);
    const c2 = plan.placements.find((p) => p.clipId === 'c2');
    expect(c2).toBeDefined();

    const { action, detached } = prepareOverlayRemoval(project, { type: 'removeClip', clipId: 'c2' }, {});
    expect(ids(detached)).toEqual(['logo']);
    const next = mixProjectReducer(project, action);
    expect(next.overlays.find((o) => o.id === 'logo')?.anchor).toEqual({ kind: 'absolute', time: c2!.startTime + 1 });
  });

  test('prepareOverlayRemoval returns the same action when nothing depends on the removal', () => {
    const project = makeProject();
    const action: MixProjectAction = { type: 'removeClip', clipId: 'c3' };
    expect(prepareOverlayRemoval(project, action, {}).action).toBe(action);
    const noOverlays = { ...project, overlays: [] };
    expect(prepareOverlayRemoval(noOverlays, { type: 'removeClip', clipId: 'c2' }, {})).toEqual({ action: { type: 'removeClip', clipId: 'c2' }, detached: [] });
  });

  test('a bar linked to a removed countdown keeps its start and duration', () => {
    const project = makeProject();
    const { action } = prepareOverlayRemoval(project, { type: 'removeOverlay', overlayId: 'cd' }, {});
    const next = mixProjectReducer(project, action);
    const { plan } = planRender(project);
    const c1 = plan.placements.find((p) => p.clipId === 'c1')!;
    expect(next.overlays.find((o) => o.id === 'bar')).toMatchObject({ anchor: { kind: 'absolute', time: c1.endTime + 0.5 }, duration: 10 });
    expect(next.overlays.find((o) => o.id === 'bar')).not.toHaveProperty('linkedCountdownId');
  });
});
