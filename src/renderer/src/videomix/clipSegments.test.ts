import { describe, expect, test } from 'vitest';

import type { StateSegment } from '../types';
import { buildSourceSegments, clipToSegment, getClipActionsFromSegments, getSyncStep, isSegmentsInSync, isTimeOnlyEdit } from './clipSegments';
import { mixProjectReducer } from './projectReducer';
import type { MixProjectAction } from './projectReducer';
import { createEmptyMixProject } from './types';
import type { MixClip, MixProject } from './types';

const source = { id: 's1', name: 'beach.mp4' };
const frameSize = { width: 1920, height: 1080 };
const paletteSize = 19;

const makeClip = (id: string, overrides: Partial<MixClip> = {}): MixClip => ({
  id,
  sourceId: 's1',
  name: `beach #${id}`,
  color: 0,
  start: 1,
  end: 5,
  maxRect: { x: 100, y: 0, width: 608, height: 1080 },
  muted: false,
  gainDb: 0,
  ...overrides,
});

const marker = (segId: string, start: number): StateSegment => ({ segId, start, name: '', segColorIndex: 0, selected: true });

// a timeline segment as LosslessCut creates it (new nanoid, empty name, its own color counter)
const newSegment = (segId: string, start: number, end: number): StateSegment => ({ segId, start, end, name: '', segColorIndex: 7, selected: true });

const clips = [makeClip('1', { color: 0 }), makeClip('x', { sourceId: 's2', name: 'city #1', color: 1 }), makeClip('2', { start: 6, end: 9, color: 2 })];
const sourceClips = clips.filter((c) => c.sourceId === 's1');

const step = (segments: StateSegment[], { segmentsChanged = true, sourceLoaded = true, projectClips = clips, autoCropBlackBars = false } = {}) => (
  getSyncStep({ segments, segmentsChanged, sourceLoaded, source, clips: projectClips, frameSize, autoCropBlackBars, paletteSize })
);

function apply(project: MixProject, actions: MixProjectAction[]) {
  return mixProjectReducer(project, { type: 'batch', actions });
}

describe('project → timeline', () => {
  test('clip segments: id, color and name of the clip', () => {
    expect(clipToSegment(clips[0]!, false)).toEqual({ segId: '1', start: 1, end: 5, name: 'beach #1', segColorIndex: 0, selected: false });
  });

  test('source clips in list order, then the markers; selection kept', () => {
    const segments = buildSourceSegments({ clips: sourceClips, segments: [marker('m', 3), { ...clipToSegment(sourceClips[1]!), selected: false }] });
    expect(segments.map((s) => [s.segId, s.selected])).toEqual([['1', true], ['2', false], ['m', true]]);
    expect(isSegmentsInSync(segments, sourceClips)).toBe(true);
  });

  test('a marker with the id of a clip is replaced by the clip (e.g. undo of removing its end)', () => {
    const segments = buildSourceSegments({ clips: sourceClips, segments: [marker('1', 1)] });
    expect(segments.map((s) => [s.segId, s.end])).toEqual([['1', 5], ['2', 9]]);
  });

  test('a newly loaded source shows its clips (markers of the previous source are not kept)', () => {
    expect(step([marker('m', 1)], { sourceLoaded: false })).toEqual({ type: 'write', segments: sourceClips.map((c) => clipToSegment(c)) });
  });

  test('undo/redo or edits in the clip list rewrite the timeline', () => {
    const segments = sourceClips.map((c) => clipToSegment(c));
    const renamed = clips.map((c) => (c.id === '2' ? { ...c, name: 'renamed', start: 7 } : c));
    const result = step(segments, { segmentsChanged: false, projectClips: renamed });
    expect(result.type).toBe('write');
    expect(result.type === 'write' && result.segments[1]).toMatchObject({ segId: '2', name: 'renamed', start: 7 });
  });

  test('reordering the list reorders the timeline', () => {
    const segments = sourceClips.map((c) => clipToSegment(c));
    const reordered = [clips[2]!, clips[1]!, clips[0]!];
    const result = step(segments, { segmentsChanged: false, projectClips: reordered });
    expect(result.type === 'write' && result.segments.map((s) => s.segId)).toEqual(['2', '1']);
  });

  test('in sync: nothing to do', () => {
    expect(step([...sourceClips.map((c) => clipToSegment(c)), marker('m', 2)])).toEqual({ type: 'none' });
  });
});

describe('timeline → project', () => {
  const inSync = () => sourceClips.map((c) => clipToSegment(c));

  test('dragging a cut point updates the clip (transient)', () => {
    const segments = inSync();
    segments[0] = { ...segments[0]!, start: 2 };
    expect(step(segments)).toEqual({ type: 'dispatch', actions: [{ type: 'updateClip', clipId: '1', patch: { start: 2 } }], transient: true });
  });

  test('labeling a segment renames the clip (not transient); an empty label keeps the name', () => {
    const segments = inSync();
    segments[1] = { ...segments[1]!, name: 'sunset' };
    segments[0] = { ...segments[0]!, name: '' };
    expect(step(segments)).toEqual({ type: 'dispatch', actions: [{ type: 'updateClip', clipId: '2', patch: { name: 'sunset' } }], transient: false });
  });

  test('removing a segment, or its end (marker), removes the clip', () => {
    const [first, second] = inSync();
    expect(step([second!])).toEqual({ type: 'dispatch', actions: [{ type: 'removeClip', clipId: '1' }], transient: false });
    expect(step([{ ...first!, end: undefined }, second!])).toEqual({ type: 'dispatch', actions: [{ type: 'removeClip', clipId: '1' }], transient: false });
  });

  test('markers are not clips', () => {
    expect(step([...inSync(), marker('m', 3)])).toEqual({ type: 'none' });
  });

  test('a new segment with an end becomes a clip: default name, next color, whole frame', () => {
    const result = step([...inSync(), newSegment('n', 10, 12)]);
    expect(result).toEqual({
      type: 'dispatch',
      transient: false,
      actions: [{
        type: 'addClip',
        clip: { id: 'n', sourceId: 's1', name: 'beach #3', color: 3, start: 10, end: 12, maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, muted: false, gainDb: 0 },
      }],
    });
  });

  test('setting the end of a marker turns it into a clip with the same id', () => {
    const actions = getClipActionsFromSegments({ segments: [...inSync(), newSegment('m', 3, 4)], source, clips, frameSize, autoCropBlackBars: false, paletteSize });
    expect(actions).toMatchObject([{ type: 'addClip', clip: { id: 'm', start: 3, end: 4 } }]);
  });

  test('several new segments get consecutive names and colors; a named segment keeps its name', () => {
    const actions = getClipActionsFromSegments({ segments: [newSegment('a', 0, 1), { ...newSegment('b', 1, 2), name: 'Named' }, newSegment('c', 2, 3)], source, clips: [], frameSize, autoCropBlackBars: false, paletteSize });
    expect(actions.map((a) => (a.type === 'addClip' ? [a.clip.name, a.clip.color] : undefined))).toEqual([['beach #1', 0], ['Named', 1], ['beach #2', 2]]);
  });

  test('LosslessCut split (two new segments replace one): new clips with unique names', () => {
    const [, second] = inSync();
    const actions = getClipActionsFromSegments({ segments: [newSegment('a', 1, 3), newSegment('b', 3, 5), second!], source, clips, frameSize, autoCropBlackBars: false, paletteSize });
    expect(actions.map((a) => a.type)).toEqual(['removeClip', 'addClip', 'addClip']);
    expect(actions.flatMap((a) => (a.type === 'addClip' ? [a.clip.name] : []))).toEqual(['beach #3', 'beach #4']);
  });

  // E6 "New clip from here": the new action always appends a marker (like `addSegment`), even with the cursor inside
  // an existing clip's range; "Mark end" then gives it an end that may overlap that clip. The sync must create a new
  // clip for it without touching the clip it overlaps (01-requisitos §11 E6, ADR-002).
  test('a new segment that overlaps an existing clip becomes its own clip; the overlapped clip is untouched', () => {
    // clip '1' is start:1, end:5; this marker was added at 2 (inside it) and closed at 4 (still inside it)
    const actions = getClipActionsFromSegments({ segments: [...inSync(), newSegment('n', 2, 4)], source, clips, frameSize, autoCropBlackBars: false, paletteSize });
    expect(actions).toEqual([{
      type: 'addClip',
      clip: { id: 'n', sourceId: 's1', name: 'beach #3', color: 3, start: 2, end: 4, maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, muted: false, gainDb: 0 },
    }]);
    // no action at all for clip '1', which fully contains the overlap
    expect(actions.some((a) => (a.type === 'updateClip' || a.type === 'removeClip') && a.clipId === '1')).toBe(false);
  });

  test('without the frame size (no video) new segments are not added', () => {
    expect(getClipActionsFromSegments({ segments: [newSegment('n', 1, 2)], source, clips: [], frameSize: undefined, autoCropBlackBars: false, paletteSize })).toEqual([]);
  });

  // A7 (T47): new clips of a source use its cached black bars detection with autoCropBlackBars, like createClip
  test('autoCropBlackBars (A7): a new segment gets the source\'s picture rect, not the whole frame', () => {
    const letterboxSource = { ...source, width: 1920, height: 1080, blackBars: { rect: { x: 0, y: 140, width: 1920, height: 800 }, frame: frameSize, file: { size: 1, mtimeMs: 1 } } };
    const cropped = getClipActionsFromSegments({ segments: [newSegment('n', 1, 2)], source: letterboxSource, clips: [], frameSize, autoCropBlackBars: true, paletteSize });
    expect(cropped).toMatchObject([{ type: 'addClip', clip: { maxRect: { x: 0, y: 140, width: 1920, height: 800 } } }]);
    // off: the whole frame, even with a cached detection
    const uncropped = getClipActionsFromSegments({ segments: [newSegment('n', 1, 2)], source: letterboxSource, clips: [], frameSize, autoCropBlackBars: false, paletteSize });
    expect(uncropped).toMatchObject([{ type: 'addClip', clip: { maxRect: { x: 0, y: 0, width: 1920, height: 1080 } } }]);
  });

  test("the placeholder segment and other sources' clips are ignored", () => {
    const placeholder: StateSegment = { ...newSegment('p', 0, 30), initial: true };
    expect(getClipActionsFromSegments({ segments: [...inSync(), placeholder, newSegment('x', 0, 1)], source, clips, frameSize, autoCropBlackBars: false, paletteSize })).toEqual([]);
  });

  test('isTimeOnlyEdit', () => {
    expect(isTimeOnlyEdit([{ type: 'updateClip', clipId: 'a', patch: { start: 1, end: 2 } }])).toBe(true);
    expect(isTimeOnlyEdit([{ type: 'updateClip', clipId: 'a', patch: { start: 1, name: 'x' } }])).toBe(false);
    expect(isTimeOnlyEdit([{ type: 'updateClip', clipId: 'a', patch: { start: 1 } }, { type: 'updateClip', clipId: 'b', patch: { start: 1 } }])).toBe(false);
    expect(isTimeOnlyEdit([{ type: 'removeClip', clipId: 'a' }])).toBe(false);
  });
});

describe('round trip', () => {
  test('after applying a timeline edit, the next step finds both in sync (no loop)', () => {
    let project: MixProject = { ...createEmptyMixProject(), clips };
    const segments = [...sourceClips.map((c) => clipToSegment(c)), newSegment('n', 10, 12)];
    segments[0] = { ...segments[0]!, end: 4 };
    const first = step(segments, { projectClips: project.clips });
    expect(first.type).toBe('dispatch');
    project = apply(project, first.type === 'dispatch' ? first.actions : []);

    // the new clip gets its own color, so the timeline is rewritten once to show it
    const second = step(segments, { segmentsChanged: false, projectClips: project.clips });
    expect(second.type).toBe('write');
    const written = second.type === 'write' ? second.segments : [];
    expect(written.map((s) => [s.segId, s.end, s.segColorIndex])).toEqual([['1', 4, 0], ['2', 9, 2], ['n', 12, 3]]);

    expect(step(written, { projectClips: project.clips })).toEqual({ type: 'none' });
  });

  test('undo after removing a clip brings its segment back', () => {
    const before: MixProject = { ...createEmptyMixProject(), clips };
    const segments = [clipToSegment(sourceClips[1]!)];
    const removal = step(segments, { projectClips: before.clips });
    const after = apply(before, removal.type === 'dispatch' ? removal.actions : []);
    expect(after.clips.map((c) => c.id)).toEqual(['x', '2']);

    // undo = the project goes back to `before`, the timeline didn't change
    const restore = step(segments, { segmentsChanged: false, projectClips: before.clips });
    expect(restore.type === 'write' && restore.segments.map((s) => s.segId)).toEqual(['1', '2']);
  });
});
