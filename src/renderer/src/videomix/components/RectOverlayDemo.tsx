import type { RefObject } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import type { FFprobeStream } from '../../../../common/ffprobe';
import type { ClipRects, Size } from '../overlayMath';
import { applyAspect, createDefaultMin, fillFrame, getFrameRect, getOrientedSize, getStreamRotation } from '../overlayMath';
import RectOverlay from './RectOverlay';
import RectOverlayToolbar from './RectOverlayToolbar';

// Temporary harness for T06 with local state; T07 replaces it with the selected clip's data.
// Enable from the devtools console: localStorage.setItem('videomix.rectOverlayDemo', '1'), then reload.

function isEnabled() {
  try {
    return window.localStorage.getItem('videomix.rectOverlayDemo') === '1';
  } catch {
    return false;
  }
}

function RectOverlayDemo({ videoRef, compatPlayerEnabled, cssRotation, videoStream, manualRotation }: {
  videoRef: RefObject<HTMLVideoElement | null>,
  compatPlayerEnabled: boolean,
  cssRotation: number | undefined,
  videoStream: FFprobeStream | undefined,
  /** LosslessCut's manual rotation doesn't exist in the rendered output, so the overlay would be wrong. */
  manualRotation: boolean,
}) {
  const [enabled] = useState(isEnabled);
  const [elementSize, setElementSize] = useState<Size>();
  const [rects, setRects] = useState<ClipRects>();
  const [aspect, setAspect] = useState<number>();

  // Chromium's videoWidth/videoHeight already include the rotation metadata
  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || video == null) return undefined;
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
  }, [enabled, videoRef]);

  // The master <video> may be a dummy with the compat player, so use the stream's size instead
  const streamWidth = videoStream?.width;
  const streamHeight = videoStream?.height;
  const streamRotation = videoStream != null ? getStreamRotation(videoStream) : 0;
  const videoSize = useMemo(() => {
    if (!compatPlayerEnabled) return elementSize;
    if (streamWidth == null || streamHeight == null) return undefined;
    return getOrientedSize({ width: streamWidth, height: streamHeight }, streamRotation);
  }, [compatPlayerEnabled, elementSize, streamHeight, streamRotation, streamWidth]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRects(videoSize != null ? { maxRect: getFrameRect(videoSize) } : undefined);
    setAspect(undefined);
  }, [videoSize]);

  const handleCommit = useCallback((next: ClipRects) => {
    console.log('RectOverlay commit', next);
    setRects(next);
  }, []);

  const handleAspectChange = useCallback((newAspect: number | undefined) => {
    setAspect(newAspect);
    if (newAspect != null && videoSize != null) setRects((r) => (r != null ? applyAspect(r, newAspect, videoSize) : r));
  }, [videoSize]);

  const handleAddMin = useCallback(() => setRects((r) => (r != null ? { ...r, minRect: createDefaultMin(r.maxRect) } : r)), []);
  const handleClearMin = useCallback(() => setRects((r) => (r != null ? { maxRect: r.maxRect } : r)), []);
  const handleFillFrame = useCallback(() => {
    if (videoSize == null) return;
    setAspect(undefined);
    setRects((r) => (r != null ? fillFrame(r, videoSize) : r));
  }, [videoSize]);

  if (!enabled || manualRotation || videoSize == null || rects == null) return null;

  return (
    <>
      <RectOverlay maxRect={rects.maxRect} minRect={rects.minRect} videoSize={videoSize} aspectLock={aspect} cssRotation={cssRotation} onChange={setRects} onCommit={handleCommit} />
      <div style={{ position: 'absolute', top: '.5em', left: '50%', transform: 'translateX(-50%)' }}>
        <RectOverlayToolbar aspect={aspect} hasMin={rects.minRect != null} onAspectChange={handleAspectChange} onAddMin={handleAddMin} onClearMin={handleClearMin} onFillFrame={handleFillFrame} />
      </div>
    </>
  );
}

export default memo(RectOverlayDemo);
