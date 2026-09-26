import type { CSSProperties } from 'react';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { MixClip, MixKeyframeInterpolation } from '../types';
import type { MixClipPatch } from '../projectReducer';
import type { ClipRects, Size } from '../overlayMath';
import { applyAspect, createDefaultMin, fillFrame } from '../overlayMath';
import { getClipRotation, rotateSize } from '../clipRotation';
import { fitMaxRectToFraction, getFractionFits } from '../fitFractions';
import type { FitFraction, FitLayout } from '../fitFractions';
import { findKeyframeIndex, getAnimatedRectsEdit, getClipRectsAt, getKeyframeInterpolation, getNextKeyframe, getPrevKeyframe, isClipAnimated } from '../clipKeyframes';
import { canExtendBeyondMax } from '../planner/plannerInput';
import useFitMagnet from '../hooks/useFitMagnet';
import getSwal from '../../swal';
import RectOverlay from './RectOverlay';
import RectOverlayToolbar from './RectOverlayToolbar';
import type { ToolbarKeyframes } from './RectOverlayToolbar';

const dockedToolbarStyle: CSSProperties = { display: 'flex', justifyContent: 'center', padding: '.2em .5em', background: 'var(--gray-3)', borderBottom: '1px solid var(--gray-6)' };

/** A9 (T49): what an overlay gesture (a drag, or an arrow key nudge) edits: the clip and its rects shown when it started. */
interface Gesture {
  clip: MixClip,
  time: number,
  shown: ClipRects,
}

/**
 * The max/min rects of the selected clip over the <video>, with the aspect/min toolbar (T06 overlay, T07 data).
 * Controlled: the parent applies `onChange` as a transient edit and `onCommit`/`onEdit` as undo steps.
 * E9 (T38d): a turned clip's rects live in the turned frame; the parent turns the player (useMixPlayerTurn) and the
 * overlay works on the turned picture.
 *
 * A9 (T49): an animated clip (with keyframes) shows its rects at `time` (the cursor), and moving or scaling the max
 * adds or updates the keyframe there (auto-key), always with the base proportion; editing the min edits the base min
 * (relative to the max, so it changes in every keyframe). The toolbar's actions (aspect, "Fit to", "Fill frame",
 * min) edit the base rects: every keyframe keeps its centre and its size relative to the base max.
 */
function ClipRectEditor({ videoSize, cssRotation, clip, time, color, aspectLock, fitLayout, toolbarContainer, onAspectLockChange, onChange, onCommit, onEdit, onRotate, onRemoveBlackBars, onToggleAnimate, onAddKeyframe, onRemoveKeyframe, onSeekKeyframe, onKeyframeInterpolationChange }: {
  /** Display size of the video, unturned (useMixVideoSize). */
  videoSize: Size | undefined,
  cssRotation: number | undefined,
  clip: MixClip,
  /** A9: the cursor (source seconds), where an animated clip is shown and edited. */
  time: number,
  /** CSS color of the clip. */
  color: string,
  aspectLock: number | undefined,
  /** F1/F2 (T45): the output layout of the fit chips, the magnet and "Fit to" (useFitLayout). */
  fitLayout: FitLayout,
  /** Where to put the toolbar (T49: a strip above the picture, so it never covers the rects); over the picture if unset. */
  toolbarContainer?: HTMLElement | null | undefined,
  onAspectLockChange: (aspect: number | undefined) => void,
  onChange: (patch: MixClipPatch) => void,
  onCommit: (patch: MixClipPatch, info?: { keyboard: boolean }) => void,
  /** Toolbar actions (one undo step each). */
  onEdit: (patch: MixClipPatch) => void,
  /** E9: turn the clip by `delta` degrees (clockwise). */
  onRotate: (delta: number) => void,
  /** A7 (T47): "Remove black bars" (useBlackBars's userRemoveBlackBars, already bound to this clip). */
  onRemoveBlackBars: () => void,
  /** A9 (T49): the keyframe actions at the cursor (useClipKeyframes). */
  onToggleAnimate: () => void,
  onAddKeyframe: () => void,
  onRemoveKeyframe: () => void,
  onSeekKeyframe: (direction: -1 | 1) => void,
  onKeyframeInterpolationChange: (interpolation: MixKeyframeInterpolation) => void,
}) {
  const { t } = useTranslation();
  const { magnet, toggleMagnet } = useFitMagnet();
  const rotation = getClipRotation(clip);
  // the frame of the clip's rects
  const frameSize = useMemo(() => (videoSize != null ? rotateSize(videoSize, rotation) : undefined), [rotation, videoSize]);

  // the base rects (what the toolbar edits, the fit and the planner use)
  const rects = useMemo<ClipRects>(() => ({ maxRect: clip.maxRect, minRect: clip.minRect }), [clip.maxRect, clip.minRect]);

  // A9: during a gesture the clip is shown (and keyed) at the time it started, even if the cursor moves (playback)
  const gestureRef = useRef<Gesture>(undefined);
  const [gestureTime, setGestureTime] = useState<number>();
  const animated = isClipAnimated(clip);
  const shownTime = animated ? (gestureTime ?? time) : 0;
  const shown = useMemo<ClipRects>(() => (animated ? getClipRectsAt(clip, shownTime, frameSize) : rects), [animated, clip, frameSize, rects, shownTime]);

  /** The clip's change for rects edited in the overlay during `gesture`. */
  const getPatch = useCallback((edited: ClipRects, gesture: Gesture): MixClipPatch => {
    if (!isClipAnimated(gesture.clip)) return { maxRect: edited.maxRect, minRect: edited.minRect };
    return getAnimatedRectsEdit({ clip: gesture.clip, time: gesture.time, shown: gesture.shown, edited });
  }, []);

  const handleChange = useCallback((edited: ClipRects) => {
    if (gestureRef.current == null) {
      gestureRef.current = { clip, time, shown };
      setGestureTime(time);
    }
    onChange(getPatch(edited, gestureRef.current));
  }, [clip, getPatch, onChange, shown, time]);

  // a drag's commit (its gesture started on its first change), or an arrow key nudge (a gesture of its own)
  const handleCommit = useCallback((edited: ClipRects, info?: { keyboard: boolean }) => {
    onCommit(getPatch(edited, gestureRef.current ?? { clip, time, shown }), info);
  }, [clip, getPatch, onCommit, shown, time]);

  const handleDragEnd = useCallback(() => {
    gestureRef.current = undefined;
    setGestureTime(undefined);
  }, []);

  const handleAspectChange = useCallback((newAspect: number | undefined) => {
    onAspectLockChange(newAspect);
    if (newAspect != null && frameSize != null) onEdit(applyAspect(rects, newAspect, frameSize));
  }, [onAspectLockChange, onEdit, rects, frameSize]);

  const handleAddMin = useCallback(() => onEdit({ ...rects, minRect: createDefaultMin(rects.maxRect) }), [onEdit, rects]);
  const handleClearMin = useCallback(() => onEdit({ maxRect: rects.maxRect, minRect: undefined }), [onEdit, rects.maxRect]);
  const handleFillFrame = useCallback(() => {
    if (frameSize == null) return;
    onAspectLockChange(undefined);
    const filled = fillFrame(rects, frameSize);
    onEdit({ maxRect: filled.maxRect, minRect: filled.minRect });
  }, [onAspectLockChange, onEdit, rects, frameSize]);

  // F1: live, from the rects being dragged (the parent applies each step of a drag)
  const extendBeyondMax = canExtendBeyondMax(clip);
  const fits = useMemo(() => (frameSize != null ? getFractionFits({ maxRect: clip.maxRect, minRect: clip.minRect, frame: frameSize, extendBeyondMax, layout: fitLayout }) : undefined), [clip.maxRect, clip.minRect, extendBeyondMax, fitLayout, frameSize]);

  const handleFitTo = useCallback((fraction: FitFraction) => {
    if (frameSize == null) return;
    const result = fitMaxRectToFraction({ maxRect: rects.maxRect, minRect: rects.minRect, frame: frameSize, fraction, layout: fitLayout });
    if (!result.ok) {
      // the only failure: the min doesn't fit in a max of that proportion inside the frame
      getSwal().toast.fire({ icon: 'warning', timer: 6000, title: t('Cannot fit the max to {{fraction}}: the min rectangle does not fit in a rectangle of that proportion inside the frame. Make the min smaller', { fraction }) });
      return;
    }
    // the new proportion replaces a locked one
    onAspectLockChange(undefined);
    onEdit({ maxRect: result.maxRect, minRect: rects.minRect });
  }, [fitLayout, frameSize, onAspectLockChange, onEdit, rects, t]);

  const toolbarKeyframes = useMemo<ToolbarKeyframes>(() => {
    const current = clip.keyframes?.[findKeyframeIndex(clip.keyframes, time)];
    return {
      animated,
      current: current != null ? getKeyframeInterpolation(current) : undefined,
      hasPrev: getPrevKeyframe(clip.keyframes, time) != null,
      hasNext: getNextKeyframe(clip.keyframes, time) != null,
    };
  }, [animated, clip.keyframes, time]);

  if (frameSize == null) return null;

  const toolbar = (
    <RectOverlayToolbar
      docked={toolbarContainer != null}
      aspect={aspectLock}
      hasMin={clip.minRect != null}
      rotation={rotation}
      onAspectChange={handleAspectChange}
      onAddMin={handleAddMin}
      onClearMin={handleClearMin}
      onFillFrame={handleFillFrame}
      onRotate={onRotate}
      magnet={magnet}
      onToggleMagnet={toggleMagnet}
      onFitTo={handleFitTo}
      onRemoveBlackBars={onRemoveBlackBars}
      keyframes={toolbarKeyframes}
      onToggleAnimate={onToggleAnimate}
      onAddKeyframe={onAddKeyframe}
      onRemoveKeyframe={onRemoveKeyframe}
      onSeekKeyframe={onSeekKeyframe}
      onKeyframeInterpolationChange={onKeyframeInterpolationChange}
    />
  );

  return (
    <>
      <RectOverlay
        maxRect={shown.maxRect}
        minRect={shown.minRect}
        videoSize={frameSize}
        color={color}
        // A9: an animated max only moves and scales (its proportion is the base one), which also keeps the magnet off it
        aspectLock={animated ? clip.maxRect.width / clip.maxRect.height : aspectLock}
        cssRotation={cssRotation}
        clipRotation={rotation}
        fits={fits}
        fitLayout={fitLayout}
        magnet={magnet}
        onChange={handleChange}
        onCommit={handleCommit}
        onDragEnd={handleDragEnd}
      />
      {toolbarContainer != null ? createPortal(<div style={dockedToolbarStyle}>{toolbar}</div>, toolbarContainer) : (
        <div style={{ position: 'absolute', top: '.5em', left: '50%', transform: 'translateX(-50%)', width: 'max-content', maxWidth: 'calc(100% - 1em)' }}>
          {toolbar}
        </div>
      )}
    </>
  );
}

export default memo(ClipRectEditor);
