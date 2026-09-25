import type { StateSegment } from '../types';
import type { MixClipPatch, MixProjectAction } from './projectReducer';
import type { MixClip, MixSource } from './types';
import type { Size } from './overlayMath';
import { getFrameRect } from './overlayMath';
import { createClip, getDefaultClipName, getNextClipColor } from './clips';
import { getNewClipMaxRect } from './blackBars';

// Pure sync between the project clips (source of truth) and the LosslessCut segments of the active source's timeline.
// See docs/videomix/decisiones/ADR-002-clips-segmentos.md.

/** A timeline segment that is (or becomes) a clip: it has an end and isn't LosslessCut's whole-file placeholder. Markers are not clips. */
export const isClipSegment = (segment: Pick<StateSegment, 'end' | 'initial'>) => segment.end != null && !segment.initial;

/** The timeline view of a clip: `segId` is the clip id and `segColorIndex` its color, so both lists show the same color. */
export const clipToSegment = (clip: MixClip, selected = true): StateSegment => ({
  segId: clip.id,
  start: clip.start,
  end: clip.end,
  name: clip.name,
  segColorIndex: clip.color,
  selected,
});

/**
 * Segments for the timeline of a source: its clips in list order, then the markers already in the timeline (markers
 * aren't project data, they're kept only while the source stays active). A marker with the id of a clip is replaced
 * by the clip (e.g. undo after its end was removed). LosslessCut's "selected" checkbox is kept per segment.
 */
export function buildSourceSegments({ clips, segments }: { clips: MixClip[], segments: StateSegment[] }): StateSegment[] {
  const selectedById = new Map(segments.map((s) => [s.segId, s.selected]));
  const clipIds = new Set(clips.map((c) => c.id));
  return [
    ...clips.map((clip) => clipToSegment(clip, selectedById.get(clip.id) ?? true)),
    ...segments.filter((s) => s.end == null && !clipIds.has(s.segId)),
  ];
}

/** True if the clip segments of the timeline show exactly `clips` (same order, times, name and color). Markers are ignored. */
export function isSegmentsInSync(segments: StateSegment[], clips: MixClip[]) {
  const clipSegments = segments.filter((s) => isClipSegment(s));
  if (clipSegments.length !== clips.length) return false;
  return clipSegments.every((s, i) => {
    const clip = clips[i];
    return clip != null && s.segId === clip.id && s.start === clip.start && s.end === clip.end && s.name === clip.name && s.segColorIndex === clip.color;
  });
}

/**
 * Project edits that bring the clips of `source` in line with the timeline after the user edited it:
 * - a clip whose segment changed start/end/name is updated (an empty segment name keeps the clip name);
 * - a clip whose segment is gone, or became a marker, is removed;
 * - a new segment with an end (not the placeholder) becomes a new clip with the segment's id, the default name and next
 *   color, and its max rect the source's picture rect with `autoCropBlackBars` (A7, T47), else the whole frame. Needs
 *   `frameSize`; without it (no video) the segment is not added.
 * New clips are appended to the list, in timeline order.
 */
export function getClipActionsFromSegments({ segments, source, clips, frameSize, autoCropBlackBars, paletteSize }: {
  segments: StateSegment[],
  source: Pick<MixSource, 'id' | 'name' | 'width' | 'height' | 'blackBars'>,
  /** All project clips (for names and colors). */
  clips: MixClip[],
  frameSize: Size | undefined,
  /** A7 (T47): see `getNewClipMaxRect`. */
  autoCropBlackBars: boolean,
  paletteSize: number,
}): MixProjectAction[] {
  const actions: MixProjectAction[] = [];
  const clipSegments = segments.filter((s) => isClipSegment(s));
  const segmentsById = new Map(clipSegments.map((s) => [s.segId, s]));
  const sourceClips = clips.filter((c) => c.sourceId === source.id);
  const sourceClipIds = new Set(sourceClips.map((c) => c.id));
  // Ids of other sources' clips can't show up here, but never let a segment take over one
  const otherClipIds = new Set(clips.filter((c) => c.sourceId !== source.id).map((c) => c.id));

  sourceClips.forEach((clip) => {
    const segment = segmentsById.get(clip.id);
    if (segment?.end == null) {
      actions.push({ type: 'removeClip', clipId: clip.id });
      return;
    }
    const patch: MixClipPatch = {};
    if (segment.start !== clip.start) patch.start = segment.start;
    if (segment.end !== clip.end) patch.end = segment.end;
    if (segment.name !== '' && segment.name !== clip.name) patch.name = segment.name;
    if (Object.keys(patch).length > 0) actions.push({ type: 'updateClip', clipId: clip.id, patch });
  });

  if (frameSize != null) {
    const maxRect = getNewClipMaxRect({ source, autoCropBlackBars }) ?? getFrameRect(frameSize);
    const remaining = clips.filter((c) => c.sourceId !== source.id || segmentsById.get(c.id)?.end != null);
    clipSegments.forEach((segment) => {
      if (sourceClipIds.has(segment.segId) || otherClipIds.has(segment.segId) || segment.end == null) return;
      const clip = createClip({
        id: segment.segId,
        sourceId: source.id,
        name: segment.name !== '' ? segment.name : getDefaultClipName(source, remaining),
        color: getNextClipColor(remaining, paletteSize),
        start: segment.start,
        end: segment.end,
        maxRect,
      });
      remaining.push(clip);
      actions.push({ type: 'addClip', clip });
    });
  }

  return actions;
}

/**
 * Only the start/end of one clip changed (dragging a cut point, "Set start"/"Set end"): such edits are applied as a
 * transient history edit, so a whole drag becomes one undo step.
 */
export function isTimeOnlyEdit(actions: MixProjectAction[]) {
  const [action] = actions;
  return actions.length === 1 && action?.type === 'updateClip' && Object.keys(action.patch).every((key) => key === 'start' || key === 'end');
}

export type SyncStep =
  | { type: 'none' }
  /** The timeline changed: apply these edits to the project. */
  | { type: 'dispatch', actions: MixProjectAction[], transient: boolean }
  /** The project changed (or a source was just loaded): show these segments in the timeline. */
  | { type: 'write', segments: StateSegment[] };

/**
 * One step of the two-way sync, decided from what changed since the previous step:
 * - `sourceLoaded` false (the source was just loaded in the player): the timeline shows its clips;
 * - the segments changed (a user edit in the timeline): the edits go to the project;
 * - otherwise, if the timeline doesn't show the project clips (undo/redo, an edit in the clip list, reorder...), it's rewritten.
 * After a `dispatch` the next step normally finds both in sync; if only the order differs, it rewrites the timeline.
 */
export function getSyncStep({ segments, segmentsChanged, sourceLoaded, source, clips, frameSize, autoCropBlackBars, paletteSize }: {
  segments: StateSegment[],
  segmentsChanged: boolean,
  sourceLoaded: boolean,
  source: Pick<MixSource, 'id' | 'name' | 'width' | 'height' | 'blackBars'>,
  clips: MixClip[],
  frameSize: Size | undefined,
  /** A7 (T47): see `getNewClipMaxRect`. */
  autoCropBlackBars: boolean,
  paletteSize: number,
}): SyncStep {
  const sourceClips = clips.filter((c) => c.sourceId === source.id);
  if (!sourceLoaded) return { type: 'write', segments: buildSourceSegments({ clips: sourceClips, segments: [] }) };

  if (segmentsChanged) {
    const actions = getClipActionsFromSegments({ segments, source, clips, frameSize, autoCropBlackBars, paletteSize });
    if (actions.length > 0) return { type: 'dispatch', actions, transient: isTimeOnlyEdit(actions) };
  }

  if (!isSegmentsInSync(segments, sourceClips)) return { type: 'write', segments: buildSourceSegments({ clips: sourceClips, segments }) };
  return { type: 'none' };
}
