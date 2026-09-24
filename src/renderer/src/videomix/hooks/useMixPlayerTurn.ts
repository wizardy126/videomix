import type { CSSProperties, RefObject } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { rotateSize } from '../clipRotation';
import type { Size } from '../overlayMath';
import { getTurnedVideoView } from '../overlayMath';
import type { MixClipRotation } from '../types';

/**
 * E9 (T38d): style of the element that wraps the player (the <video> and the compat player) while a turned clip is
 * selected: turned clockwise by the clip's rotation and scaled so that the turned picture fits the container, as the
 * rect overlay expects (overlayMath.getTurnedVideoView). Undefined (no transform at all) for an unturned clip.
 */
export default function useMixPlayerTurn({ containerRef, videoSize, cssRotation, rotation }: {
  containerRef: RefObject<HTMLElement | null>,
  /** Display size of the video, unturned (useMixVideoSize). */
  videoSize: Size | undefined,
  /** The compat player's own CSS rotation (rotation metadata it doesn't decode). */
  cssRotation: number | undefined,
  rotation: MixClipRotation,
}): CSSProperties | undefined {
  const [containerSize, setContainerSize] = useState<Size>();
  const turned = rotation !== 0;

  useEffect(() => {
    const container = containerRef.current;
    if (!turned || container == null) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry == null) return;
      const { width, height } = entry.contentRect;
      setContainerSize((prev) => (prev?.width === width && prev.height === height ? prev : { width, height }));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, turned]);

  return useMemo(() => {
    if (!turned || videoSize == null || containerSize == null) return undefined;
    const view = getTurnedVideoView(containerSize, rotateSize(videoSize, rotation), cssRotation, rotation);
    return view != null ? { transform: `rotate(${rotation}deg) scale(${view.scale})` } : undefined;
  }, [containerSize, cssRotation, rotation, turned, videoSize]);
}
