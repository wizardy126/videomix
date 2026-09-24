import type { RefObject } from 'react';
import { useEffect, useMemo, useState } from 'react';

import type { FFprobeStream } from '../../../../common/ffprobe';
import type { Size } from '../overlayMath';
import { getOrientedSize, getStreamRotation } from '../overlayMath';
import { getDisplaySize, getOrientedSar, parseSampleAspectRatio } from '../sampleAspect';

/**
 * Display size of the video in the player (the frame of the clip rects before a clip's own turn, E9): Chromium's
 * videoWidth/videoHeight, which already include the rotation metadata and the sample aspect ratio. With the compat
 * player the master <video> may be a dummy, so the stream's size is used instead, in the same display pixels (B1).
 * Moved out of ClipRectEditor (T38d): the player's turn needs it too.
 */
export default function useMixVideoSize({ videoRef, compatPlayerEnabled, videoStream }: {
  videoRef: RefObject<HTMLVideoElement | null>,
  compatPlayerEnabled: boolean,
  videoStream: FFprobeStream | undefined,
}): Size | undefined {
  const [elementSize, setElementSize] = useState<Size>();

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

  const streamWidth = videoStream?.width;
  const streamHeight = videoStream?.height;
  const streamRotation = videoStream != null ? getStreamRotation(videoStream) : 0;
  const streamSar = videoStream?.sample_aspect_ratio;
  return useMemo(() => {
    if (!compatPlayerEnabled) return elementSize;
    if (streamWidth == null || streamHeight == null) return undefined;
    const sar = getOrientedSar(parseSampleAspectRatio(streamSar), streamRotation);
    return getDisplaySize(getOrientedSize({ width: streamWidth, height: streamHeight }, streamRotation), sar);
  }, [compatPlayerEnabled, elementSize, streamHeight, streamRotation, streamSar, streamWidth]);
}
