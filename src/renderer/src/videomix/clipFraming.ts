import { getClipRotation, getSourceFrame, rotateSize } from './clipRotation';
import { rescaleKeyframes, shiftKeyframes } from './clipKeyframes';
import type { Size } from './overlayMath';
import type { MixClipPatch, MixProjectAction } from './projectReducer';
import { getFrameChange, rescaleClipRects } from './sourceResize';
import type { MixClip, MixClipKeyframe, MixClipRotation, MixProject, MixSource, Rect } from './types';

// A5 (v4, T44): copy a clip's framing (max + min + turn, and its keyframes) and paste it on other clips, scaled
// proportionally when their source has another size (like relinking a source, B2). "Extend beyond max" (E7) and the
// audio settings are not part of the framing. See 04-diseno §10.4.

/** What "Copy framing" keeps (an app-internal clipboard, not stored in the project). */
export interface ClipFraming {
  maxRect: Rect,
  /** Missing = min = max. Pasting it clears the target's min. */
  minRect?: Rect | undefined,
  rotation: MixClipRotation,
  /** A9: missing = not animated. Pasting it clears the target's keyframes. */
  keyframes?: MixClipKeyframe[] | undefined,
  /** The copied clip's (turned) frame, where the rects and keyframes live. */
  frame: Size,
  /** The copied clip's start (source s): pasted keyframes keep their offset from the clip start. */
  start: number,
}

/** The framing of `clip`, or undefined if the size of its source isn't known (the rects can't be scaled without it). */
export function copyClipFraming(clip: MixClip, source: Pick<MixSource, 'width' | 'height'> | undefined): ClipFraming | undefined {
  const sourceFrame = getSourceFrame(source);
  if (sourceFrame == null) return undefined;
  const rotation = getClipRotation(clip);
  return {
    maxRect: structuredClone(clip.maxRect),
    ...(clip.minRect != null && { minRect: structuredClone(clip.minRect) }),
    rotation,
    ...(clip.keyframes != null && clip.keyframes.length > 0 && { keyframes: structuredClone(clip.keyframes) }),
    frame: rotateSize(sourceFrame, rotation),
    start: clip.start,
  };
}

/**
 * The patch that pastes `framing` on `target` (whose source is `targetSource`), or undefined if the size of that source
 * isn't known. The target takes the framing's turn; if its turned frame has another size, the rects are scaled like B2
 * (`rescaleClipRects`: same proportion → with the frame; else uniformly, fitted into the frame, `aspectChanged`) and so
 * are the keyframes' centres (`rescaleKeyframes`). Keyframes are moved in time by `target.start − framing.start`.
 * The patch always sets all four fields (`undefined` clears the target's min, turn or keyframes).
 */
export function getPasteFramingPatch(framing: ClipFraming, target: Pick<MixClip, 'start'>, targetSource: Pick<MixSource, 'width' | 'height'> | undefined): { patch: MixClipPatch, aspectChanged: boolean } | undefined {
  const sourceFrame = getSourceFrame(targetSource);
  if (sourceFrame == null) return undefined;
  const frame = rotateSize(sourceFrame, framing.rotation);
  const change = getFrameChange(framing.frame, frame);
  const rects = change != null ? rescaleClipRects(framing, change) : { maxRect: framing.maxRect, minRect: framing.minRect };
  const keyframes = shiftKeyframes(change != null ? rescaleKeyframes(framing.keyframes, change) : framing.keyframes, target.start - framing.start);
  return {
    patch: {
      maxRect: structuredClone(rects.maxRect),
      minRect: rects.minRect != null ? structuredClone(rects.minRect) : undefined,
      rotation: framing.rotation !== 0 ? framing.rotation : undefined,
      keyframes: keyframes != null ? structuredClone(keyframes) : undefined,
    },
    aspectChanged: change?.aspectChanged ?? false,
  };
}

/**
 * "Paste framing" on several clips as one undo step: a `batch` of `updateClip` (undefined if nothing can be pasted).
 * `aspectChangedClipIds`: clips whose frame had another proportion (the framing was fitted, the UI warns).
 * `skippedClipIds`: unknown clips, or whose source size isn't known.
 */
export function getPasteFramingAction({ project, framing, clipIds }: {
  project: Pick<MixProject, 'clips' | 'sources'>,
  framing: ClipFraming,
  clipIds: string[],
}): { action: MixProjectAction | undefined, aspectChangedClipIds: string[], skippedClipIds: string[] } {
  const clipsById = new Map(project.clips.map((clip) => [clip.id, clip]));
  const sourcesById = new Map(project.sources.map((source) => [source.id, source]));
  const actions: MixProjectAction[] = [];
  const aspectChangedClipIds: string[] = [];
  const skippedClipIds: string[] = [];
  [...new Set(clipIds)].forEach((clipId) => {
    const clip = clipsById.get(clipId);
    const pasted = clip != null ? getPasteFramingPatch(framing, clip, sourcesById.get(clip.sourceId)) : undefined;
    if (pasted == null) {
      skippedClipIds.push(clipId);
      return;
    }
    if (pasted.aspectChanged) aspectChangedClipIds.push(clipId);
    actions.push({ type: 'updateClip', clipId, patch: pasted.patch });
  });
  return { action: actions.length > 0 ? { type: 'batch', actions } : undefined, aspectChangedClipIds, skippedClipIds };
}
