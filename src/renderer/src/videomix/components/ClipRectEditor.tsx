import { memo, useCallback, useMemo } from 'react';

import type { MixClip } from '../types';
import type { ClipRects, Size } from '../overlayMath';
import { applyAspect, createDefaultMin, fillFrame } from '../overlayMath';
import { getClipRotation, rotateSize } from '../clipRotation';
import RectOverlay from './RectOverlay';
import RectOverlayToolbar from './RectOverlayToolbar';

/**
 * The max/min rects of the selected clip over the <video>, with the aspect/min toolbar (T06 overlay, T07 data).
 * Controlled: the parent applies `onChange` as a transient edit and `onCommit`/`onEdit` as undo steps.
 * E9 (T38d): a turned clip's rects live in the turned frame; the parent turns the player (useMixPlayerTurn) and the
 * overlay works on the turned picture.
 */
function ClipRectEditor({ videoSize, cssRotation, clip, color, aspectLock, onAspectLockChange, onChange, onCommit, onEdit, onRotate }: {
  /** Display size of the video, unturned (useMixVideoSize). */
  videoSize: Size | undefined,
  cssRotation: number | undefined,
  clip: MixClip,
  /** CSS color of the clip. */
  color: string,
  aspectLock: number | undefined,
  onAspectLockChange: (aspect: number | undefined) => void,
  onChange: (rects: ClipRects) => void,
  onCommit: (rects: ClipRects, info?: { keyboard: boolean }) => void,
  /** Toolbar actions (one undo step each). */
  onEdit: (rects: ClipRects) => void,
  /** E9: turn the clip by `delta` degrees (clockwise). */
  onRotate: (delta: number) => void,
}) {
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

  if (frameSize == null) return null;

  return (
    <>
      <RectOverlay maxRect={clip.maxRect} minRect={clip.minRect} videoSize={frameSize} color={color} aspectLock={aspectLock} cssRotation={cssRotation} clipRotation={rotation} onChange={onChange} onCommit={onCommit} />
      <div style={{ position: 'absolute', top: '.5em', left: '50%', transform: 'translateX(-50%)' }}>
        <RectOverlayToolbar aspect={aspectLock} hasMin={clip.minRect != null} rotation={rotation} onAspectChange={handleAspectChange} onAddMin={handleAddMin} onClearMin={handleClearMin} onFillFrame={handleFillFrame} onRotate={onRotate} />
      </div>
    </>
  );
}

export default memo(ClipRectEditor);
