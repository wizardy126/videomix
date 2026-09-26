import { useCallback, useMemo } from 'react';
import i18n from 'i18next';

import getSwal from '../../swal';
import type { MixProjectAction } from '../projectReducer';
import type { MixClip, MixKeyframeInterpolation, MixSource } from '../types';
import { getClipFrame } from '../clipRotation';
import {
  clampTransform, findKeyframeIndex, getBaseTransform, getClipRectsAt, getKeyframeTransformAt, getNextKeyframe, getPrevKeyframe,
  isClipAnimated, removeKeyframe, setKeyframe, setKeyframeInterpolation,
} from '../clipKeyframes';
import { askForStopAnimating } from '../dialogs';

/**
 * A9 (T49): the keyframes of the selected clip's framing, edited at the cursor (source time): the stopwatch
 * ("Animate"), add / remove the keyframe at the cursor, its interpolation and going to the previous / next one. Each
 * edit is one undo step. Auto-key (moving the rects) is in ClipRectEditor.
 */
export default function useClipKeyframes({ clip, sources, getRelevantTime, seekAbs, dispatchStep }: {
  /** The selected clip. */
  clip: MixClip | undefined,
  sources: MixSource[],
  getRelevantTime: () => number,
  seekAbs: (time: number) => void,
  dispatchStep: (action: MixProjectAction) => void,
}) {
  const source = useMemo(() => (clip != null ? sources.find((s) => s.id === clip.sourceId) : undefined), [clip, sources]);
  // the frame the animated rects are kept inside
  const frame = useMemo(() => (clip != null ? getClipFrame(clip, source) : undefined), [clip, source]);

  /**
   * Without keyframes, the framing shown at `time` becomes the clip's rects (what the user sees stays), e.g. when
   * the animation is turned off or its last keyframe is removed.
   */
  const getStopAnimatingAction = useCallback((c: MixClip, time: number): MixProjectAction => {
    const { maxRect, minRect } = getClipRectsAt(c, time, frame);
    return { type: 'updateClip', clipId: c.id, patch: { keyframes: undefined, maxRect, minRect } };
  }, [frame]);

  /** "Animate": the first keyframe at the cursor with the current framing; off: removes them all (confirmed). */
  const userToggleAnimate = useCallback(async () => {
    if (clip == null) return;
    const time = getRelevantTime();
    if (!isClipAnimated(clip)) {
      dispatchStep({ type: 'updateClip', clipId: clip.id, patch: { keyframes: setKeyframe(undefined, time, getBaseTransform(clip.maxRect)) } });
      return;
    }
    if (!(await askForStopAnimating(clip.keyframes?.length ?? 0))) return;
    dispatchStep(getStopAnimatingAction(clip, time));
  }, [clip, dispatchStep, getRelevantTime, getStopAnimatingAction]);

  /** A keyframe at the cursor with the framing shown there (e.g. to hold it until then). */
  const userAddKeyframe = useCallback(() => {
    if (clip == null || !isClipAnimated(clip)) return;
    const time = getRelevantTime();
    const transform = getKeyframeTransformAt(clip.keyframes, time);
    if (transform == null) return;
    dispatchStep({ type: 'updateClip', clipId: clip.id, patch: { keyframes: setKeyframe(clip.keyframes, time, clampTransform(clip.maxRect, transform, frame)) } });
  }, [clip, dispatchStep, frame, getRelevantTime]);

  const userRemoveKeyframe = useCallback(() => {
    if (clip == null || !isClipAnimated(clip)) return;
    const time = getRelevantTime();
    if (findKeyframeIndex(clip.keyframes, time) === -1) {
      getSwal().toast.fire({ icon: 'info', title: i18n.t('There is no framing keyframe at the cursor') });
      return;
    }
    const keyframes = removeKeyframe(clip.keyframes, time);
    // the last one: not animated any more, it keeps that framing
    if (keyframes == null) dispatchStep(getStopAnimatingAction(clip, time));
    else dispatchStep({ type: 'updateClip', clipId: clip.id, patch: { keyframes } });
  }, [clip, dispatchStep, getRelevantTime, getStopAnimatingAction]);

  const userSetKeyframeInterpolation = useCallback((interpolation: MixKeyframeInterpolation) => {
    if (clip == null) return;
    const time = getRelevantTime();
    if (findKeyframeIndex(clip.keyframes, time) === -1) return;
    dispatchStep({ type: 'updateClip', clipId: clip.id, patch: { keyframes: setKeyframeInterpolation(clip.keyframes, time, interpolation) } });
  }, [clip, dispatchStep, getRelevantTime]);

  /** Seeks to the previous (-1) or next (1) keyframe of the clip. */
  const userSeekKeyframe = useCallback((direction: -1 | 1) => {
    if (clip == null) return;
    const time = getRelevantTime();
    const keyframe = direction < 0 ? getPrevKeyframe(clip.keyframes, time) : getNextKeyframe(clip.keyframes, time);
    if (keyframe != null) seekAbs(keyframe.time);
  }, [clip, getRelevantTime, seekAbs]);

  return {
    userToggleAnimate,
    userAddKeyframe,
    userRemoveKeyframe,
    userSetKeyframeInterpolation,
    userSeekKeyframe,
  };
}

export type UseClipKeyframes = ReturnType<typeof useClipKeyframes>;
