import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { MixClip } from '../types';
import type { ClipRects, Size } from '../overlayMath';
import { applyAspect, createDefaultMin, fillFrame } from '../overlayMath';
import { getClipRotation, rotateSize } from '../clipRotation';
import { fitMaxRectToFraction, getFractionFits } from '../fitFractions';
import type { FitFraction, FitLayout } from '../fitFractions';
import { canExtendBeyondMax } from '../planner/plannerInput';
import useFitMagnet from '../hooks/useFitMagnet';
import getSwal from '../../swal';
import RectOverlay from './RectOverlay';
import RectOverlayToolbar from './RectOverlayToolbar';

/**
 * The max/min rects of the selected clip over the <video>, with the aspect/min toolbar (T06 overlay, T07 data).
 * Controlled: the parent applies `onChange` as a transient edit and `onCommit`/`onEdit` as undo steps.
 * E9 (T38d): a turned clip's rects live in the turned frame; the parent turns the player (useMixPlayerTurn) and the
 * overlay works on the turned picture.
 */
function ClipRectEditor({ videoSize, cssRotation, clip, color, aspectLock, fitLayout, onAspectLockChange, onChange, onCommit, onEdit, onRotate, onRemoveBlackBars }: {
  /** Display size of the video, unturned (useMixVideoSize). */
  videoSize: Size | undefined,
  cssRotation: number | undefined,
  clip: MixClip,
  /** CSS color of the clip. */
  color: string,
  aspectLock: number | undefined,
  /** F1/F2 (T45): the output layout of the fit chips, the magnet and "Fit to" (useFitLayout). */
  fitLayout: FitLayout,
  onAspectLockChange: (aspect: number | undefined) => void,
  onChange: (rects: ClipRects) => void,
  onCommit: (rects: ClipRects, info?: { keyboard: boolean }) => void,
  /** Toolbar actions (one undo step each). */
  onEdit: (rects: ClipRects) => void,
  /** E9: turn the clip by `delta` degrees (clockwise). */
  onRotate: (delta: number) => void,
  /** A7 (T47): "Remove black bars" (useBlackBars's userRemoveBlackBars, already bound to this clip). */
  onRemoveBlackBars: () => void,
}) {
  const { t } = useTranslation();
  const { magnet, toggleMagnet } = useFitMagnet();
  const rotation = getClipRotation(clip);
  // the frame of the clip's rects
  const frameSize = useMemo(() => (videoSize != null ? rotateSize(videoSize, rotation) : undefined), [rotation, videoSize]);

  const rects = useMemo<ClipRects>(() => ({ maxRect: clip.maxRect, minRect: clip.minRect }), [clip.maxRect, clip.minRect]);

  const handleAspectChange = useCallback((newAspect: number | undefined) => {
    onAspectLockChange(newAspect);
    if (newAspect != null && frameSize != null) onEdit(applyAspect(rects, newAspect, frameSize));
  }, [onAspectLockChange, onEdit, rects, frameSize]);

  const handleAddMin = useCallback(() => onEdit({ ...rects, minRect: createDefaultMin(rects.maxRect) }), [onEdit, rects]);
  const handleClearMin = useCallback(() => onEdit({ maxRect: rects.maxRect }), [onEdit, rects.maxRect]);
  const handleFillFrame = useCallback(() => {
    if (frameSize == null) return;
    onAspectLockChange(undefined);
    onEdit(fillFrame(rects, frameSize));
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

  if (frameSize == null) return null;

  return (
    <>
      <RectOverlay maxRect={clip.maxRect} minRect={clip.minRect} videoSize={frameSize} color={color} aspectLock={aspectLock} cssRotation={cssRotation} clipRotation={rotation} fits={fits} fitLayout={fitLayout} magnet={magnet} onChange={onChange} onCommit={onCommit} />
      <div style={{ position: 'absolute', top: '.5em', left: '50%', transform: 'translateX(-50%)', width: 'max-content', maxWidth: 'calc(100% - 1em)' }}>
        <RectOverlayToolbar aspect={aspectLock} hasMin={clip.minRect != null} rotation={rotation} onAspectChange={handleAspectChange} onAddMin={handleAddMin} onClearMin={handleClearMin} onFillFrame={handleFillFrame} onRotate={onRotate} magnet={magnet} onToggleMagnet={toggleMagnet} onFitTo={handleFitTo} onRemoveBlackBars={onRemoveBlackBars} />
      </div>
    </>
  );
}

export default memo(ClipRectEditor);
