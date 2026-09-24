import type { RefObject } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import type { FFprobeStream } from '../../../../common/ffprobe';
import type { MixClip } from '../types';
import type { ClipRects, Size } from '../overlayMath';
import { applyAspect, createDefaultMin, fillFrame, getOrientedSize, getStreamRotation } from '../overlayMath';
import { getDisplaySize, getOrientedSar, parseSampleAspectRatio } from '../sampleAspect';
import RectOverlay from './RectOverlay';
import RectOverlayToolbar from './RectOverlayToolbar';

/**
 * The max/min rects of the selected clip over the <video>, with the aspect/min toolbar (T06 overlay, T07 data).
 * Controlled: the parent applies `onChange` as a transient edit and `onCommit`/`onEdit` as undo steps.
 */
function ClipRectEditor({ videoRef, compatPlayerEnabled, cssRotation, videoStream, clip, color, aspectLock, onAspectLockChange, onChange, onCommit, onEdit }: {
  videoRef: RefObject<HTMLVideoElement | null>,
  compatPlayerEnabled: boolean,
  cssRotation: number | undefined,
  videoStream: FFprobeStream | undefined,
  clip: MixClip,
  /** CSS color of the clip. */
  color: string,
  aspectLock: number | undefined,
  onAspectLockChange: (aspect: number | undefined) => void,
  onChange: (rects: ClipRects) => void,
  onCommit: (rects: ClipRects, info?: { keyboard: boolean }) => void,
  /** Toolbar actions (one undo step each). */
  onEdit: (rects: ClipRects) => void,
}) {
  const [elementSize, setElementSize] = useState<Size>();

  // Chromium's videoWidth/videoHeight already include the rotation metadata and the sample aspect ratio (display pixels)
  useEffect(() => {
    const video = videoRef.current;
    if (video == null) return undefined;
    const update = () => setElementSize((prev) => {
      const { videoWidth: width, videoHeight: height } = video;
      if (width <= 0 || height <= 0) return undefined;
      return prev?.width === width && prev.height === height ? prev : { width, height };
    });
    update();
    video.addEventListener('loadedmetadata', update);
    video.addEventListener('resize', update);
    return () => {
      video.removeEventListener('loadedmetadata', update);
      video.removeEventListener('resize', update);
    };
  }, [videoRef]);

  // The master <video> may be a dummy with the compat player, so use the stream's size instead, in display pixels
  // like videoWidth/videoHeight (B1: with the sample aspect ratio)
  const streamWidth = videoStream?.width;
  const streamHeight = videoStream?.height;
  const streamRotation = videoStream != null ? getStreamRotation(videoStream) : 0;
  const streamSar = videoStream?.sample_aspect_ratio;
  const videoSize = useMemo(() => {
    if (!compatPlayerEnabled) return elementSize;
    if (streamWidth == null || streamHeight == null) return undefined;
    const sar = getOrientedSar(parseSampleAspectRatio(streamSar), streamRotation);
    return getDisplaySize(getOrientedSize({ width: streamWidth, height: streamHeight }, streamRotation), sar);
  }, [compatPlayerEnabled, elementSize, streamHeight, streamRotation, streamSar, streamWidth]);

  const rects = useMemo<ClipRects>(() => ({ maxRect: clip.maxRect, minRect: clip.minRect }), [clip.maxRect, clip.minRect]);

  const handleAspectChange = useCallback((newAspect: number | undefined) => {
    onAspectLockChange(newAspect);
    if (newAspect != null && videoSize != null) onEdit(applyAspect(rects, newAspect, videoSize));
  }, [onAspectLockChange, onEdit, rects, videoSize]);

  const handleAddMin = useCallback(() => onEdit({ ...rects, minRect: createDefaultMin(rects.maxRect) }), [onEdit, rects]);
  const handleClearMin = useCallback(() => onEdit({ maxRect: rects.maxRect }), [onEdit, rects.maxRect]);
  const handleFillFrame = useCallback(() => {
    if (videoSize == null) return;
    onAspectLockChange(undefined);
    onEdit(fillFrame(rects, videoSize));
  }, [onAspectLockChange, onEdit, rects, videoSize]);

  if (videoSize == null) return null;

  return (
    <>
      <RectOverlay maxRect={clip.maxRect} minRect={clip.minRect} videoSize={videoSize} color={color} aspectLock={aspectLock} cssRotation={cssRotation} onChange={onChange} onCommit={onCommit} />
      <div style={{ position: 'absolute', top: '.5em', left: '50%', transform: 'translateX(-50%)' }}>
        <RectOverlayToolbar aspect={aspectLock} hasMin={clip.minRect != null} onAspectChange={handleAspectChange} onAddMin={handleAddMin} onClearMin={handleClearMin} onFillFrame={handleFillFrame} />
      </div>
    </>
  );
}

export default memo(ClipRectEditor);
