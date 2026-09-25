import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import i18n from 'i18next';

import getSwal from '../../swal';
import type { SetWorking } from '../../hooks/useLoading';
import type { WithErrorHandling } from '../../hooks/useErrorHandling';
import { getClipRotation, getSourceFrame, rotateRect } from '../clipRotation';
import { createBlackBarsDetection, cropDetectToDisplayRect, getPictureRect, isBlackBarsDetectionValid, removeBlackBarsFromRects } from '../blackBars';
import type { CropDetectRect } from '../blackBars';
import type { MixProjectAction } from '../projectReducer';
import type { BlackBarsDetection, MixClip, MixSource } from '../types';

export interface BlackBarsDeps {
  stat: (path: string) => Promise<{ mtimeMs: number, size: number }>,
  /** src/main/videomix/blackBars.ts, via @electron/remote (same pattern as loudness.ts's measureLoudness). */
  detect: (params: { filePath: string, start: number, end: number, abortSignal?: AbortSignal | undefined }) => Promise<CropDetectRect | undefined>,
}

// Lazy, so that the pure part (blackBars.ts) can be tested in Node.
const getElectronDeps = (): BlackBarsDeps => ({
  stat: window.require('node:fs/promises').stat,
  detect: window.require('@electron/remote').require('./index.js').videomix.detectBlackBars,
});

/**
 * A7 (v4, T47): black bars detection glue (Electron/ffmpeg via main, over the pure logic of `blackBars.ts`, T44).
 *
 * - **Per-source background cache** (A7 (3)): once a source's display size is known, `autoCropBlackBars` is on and
 *   its cached detection isn't valid for that size (`isBlackBarsDetectionValid`), detects over the whole source and
 *   caches the result (`setSourceBlackBars`: no undo step, doesn't make the project dirty). New clips of that source
 *   then use `getNewClipMaxRect`; while the detection is still running, they're created as before (the whole frame).
 *   Fire-and-forget, like `refreshSourcesMeta`: a failure is only logged, and doesn't retry on its own (the source's
 *   size hasn't changed, so the effect wouldn't run again either — a later activation that re-probes it does).
 * - **"Remove black bars" button** (A7 (1)): detects fresh on the clip's own range (not the source-wide cache, which
 *   may still be missing or wrong for a shorter, cleaner sub-range), fits the max to the picture found and the min
 *   inside it (`removeBlackBarsFromRects`), one undo step. Warns instead if there's nothing to remove.
 */
export default function useBlackBars({ sources, clips, autoCropBlackBars, setSourceBlackBars, dispatchStep, workingRef, setWorking, withErrorHandling, deps = getElectronDeps() }: {
  sources: MixSource[],
  clips: MixClip[],
  /** A7 (2): gates both the background caching below and whether new clips use it (useMixClips's userAddClip). */
  autoCropBlackBars: boolean,
  setSourceBlackBars: (sourceId: string, detection: BlackBarsDetection | undefined) => void,
  dispatchStep: (action: MixProjectAction) => void,
  workingRef: RefObject<boolean>,
  setWorking: SetWorking,
  withErrorHandling: WithErrorHandling,
  deps?: BlackBarsDeps | undefined,
}) {
  // Sources currently being detected, so a re-run of the effect (e.g. an unrelated project edit) doesn't start a
  // second detection for the same one while it's still running.
  const detectingRef = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!autoCropBlackBars) return;
    sources.forEach((source) => {
      if (source.width == null || source.height == null) return;
      if (detectingRef.current.has(source.id) || isBlackBarsDetectionValid(source.blackBars, source)) return;
      const { id: sourceId, absolutePath, duration, sar } = source;
      const frame = { width: source.width!, height: source.height! };
      detectingRef.current = new Set(detectingRef.current).add(sourceId);
      (async () => {
        try {
          const file = await deps.stat(absolutePath);
          const rect = duration != null && duration > 0 ? await deps.detect({ filePath: absolutePath, start: 0, end: duration }) : undefined;
          const display = rect != null ? cropDetectToDisplayRect({ rect, sar, displayFrame: frame }) : undefined;
          setSourceBlackBars(sourceId, createBlackBarsDetection({ rect: display, frame, file }));
        } catch (err) {
          console.warn('Failed to detect black bars in the background', absolutePath, err);
        } finally {
          const next = new Set(detectingRef.current);
          next.delete(sourceId);
          detectingRef.current = next;
        }
      })();
    });
  }, [autoCropBlackBars, deps, setSourceBlackBars, sources]);

  const userRemoveBlackBars = useCallback((clipId: string | undefined) => {
    const clip = clips.find((c) => c.id === clipId);
    const source = clip != null ? sources.find((s) => s.id === clip.sourceId) : undefined;
    const sourceFrame = getSourceFrame(source);
    if (clip == null || source == null || sourceFrame == null || workingRef.current) return;
    withErrorHandling(async () => {
      setWorking({ text: i18n.t('Detecting black bars') });
      try {
        // A fresh detection on the clip's own range, not the source-wide cache (T47's contract)
        const rect = await deps.detect({ filePath: source.absolutePath, start: clip.start, end: clip.end });
        const display = rect != null ? cropDetectToDisplayRect({ rect, sar: source.sar, displayFrame: sourceFrame }) : undefined;
        const picture = display != null ? getPictureRect(display, sourceFrame) : undefined;
        const clipPicture = picture != null ? rotateRect(picture, sourceFrame, getClipRotation(clip)) : undefined;
        const rects = clipPicture != null ? removeBlackBarsFromRects({ maxRect: clip.maxRect, minRect: clip.minRect }, clipPicture) : undefined;
        if (rects == null) {
          getSwal().toast.fire({ icon: 'info', title: i18n.t('No black bars found in this clip') });
          return;
        }
        dispatchStep({ type: 'updateClip', clipId: clip.id, patch: { maxRect: rects.maxRect, minRect: rects.minRect } });
      } finally {
        setWorking(undefined);
      }
    }, i18n.t('Failed to detect black bars'));
  }, [clips, deps, dispatchStep, setWorking, sources, withErrorHandling, workingRef]);

  return { userRemoveBlackBars };
}

export type UseBlackBars = ReturnType<typeof useBlackBars>;
