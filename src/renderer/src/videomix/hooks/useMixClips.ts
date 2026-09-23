import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import i18n from 'i18next';

import getSwal, { errorToast } from '../../swal';
import { isDurationValid } from '../../segments';
import { segColorsCount } from '../../util/colors';
import type { StateSegment } from '../../types';
import type { UseMixProject } from './useMixProject';
import type { MixClipPatch, MixProjectAction } from '../projectReducer';
import type { ClipRects, Size } from '../overlayMath';
import { getSyncStep } from '../clipSegments';
import { createClip, getDefaultClipName, getDuplicateClipName, getNewClipRange, getNextClipColor, getSplitClipAction } from '../clips';

// Commit a merged (transient) edit when nothing happened for this long. See ADR-002.
const TIMELINE_IDLE_COMMIT_MS = 700;
const KEYBOARD_IDLE_COMMIT_MS = 1000;
// After pointerup, wait for the last mousemove's edit to reach the project (it goes through a render + effect)
const POINTER_UP_COMMIT_DELAY_MS = 100;

/**
 * Clips of the VideoMix project (T07): keeps the LosslessCut timeline of the active source in sync with the project
 * clips (the project is the source of truth), the selected clip (= the current timeline segment, if it's a clip),
 * and the clip actions used by the clip list, the rect overlay and the keyboard.
 * See docs/videomix/decisiones/ADR-002-clips-segmentos.md.
 */
export default function useMixClips({ mixProject, currentSourceId, activateSource, cutSegments, setCutSegments, currentCutSeg, setCurrentSegIndex, fileDuration, getRelevantTime, seekAbs }: {
  mixProject: UseMixProject,
  currentSourceId: string | undefined,
  activateSource: (sourceId: string) => Promise<void>,
  cutSegments: StateSegment[],
  /** Raw setter of the timeline segments. */
  setCutSegments: (segments: StateSegment[]) => void,
  currentCutSeg: StateSegment | undefined,
  setCurrentSegIndex: (index: number) => void,
  fileDuration: number | undefined,
  getRelevantTime: () => number,
  seekAbs: (time: number | undefined) => void,
}) {
  const { project, dispatch, commitTransient } = mixProject;

  const currentSource = useMemo(() => project.sources.find((s) => s.id === currentSourceId), [currentSourceId, project.sources]);
  const sourceWidth = currentSource?.width;
  const sourceHeight = currentSource?.height;
  const frameSize = useMemo<Size | undefined>(() => (sourceWidth != null && sourceHeight != null ? { width: sourceWidth, height: sourceHeight } : undefined), [sourceHeight, sourceWidth]);

  const currentSegId = currentCutSeg?.segId;
  const selectedClip = useMemo(() => (
    currentSegId != null && currentSourceId != null ? project.clips.find((c) => c.id === currentSegId && c.sourceId === currentSourceId) : undefined
  ), [currentSegId, currentSourceId, project.clips]);
  const selectedClipId = selectedClip?.id;

  // Merging repeated edits into one undo step (timeline drags, "Set start/end" presses, arrow key nudges): they are
  // applied as transient history edits under a key, and committed when another kind of edit starts, the pointer is
  // released or nothing happened for a while.
  const pendingTransientRef = useRef<string>(undefined);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pointerDownRef = useRef(false);

  const flushTransient = useCallback(() => {
    clearTimeout(commitTimerRef.current);
    commitTimerRef.current = undefined;
    if (pendingTransientRef.current == null) return;
    pendingTransientRef.current = undefined;
    commitTransient();
  }, [commitTransient]);

  const scheduleFlush = useCallback((delayMs: number) => {
    clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      // a drag is still going on: the pointerup schedules the commit
      if (!pointerDownRef.current) flushTransient();
    }, delayMs);
  }, [flushTransient]);

  const dispatchMerged = useCallback((key: string, action: MixProjectAction, idleMs: number) => {
    if (pendingTransientRef.current !== key) flushTransient();
    pendingTransientRef.current = key;
    dispatch(action, { transient: true });
    scheduleFlush(idleMs);
  }, [dispatch, flushTransient, scheduleFlush]);

  /** A normal edit: one undo step. */
  const dispatchStep = useCallback((action: MixProjectAction) => {
    flushTransient();
    dispatch(action);
  }, [dispatch, flushTransient]);

  useEffect(() => {
    const handlePointerDown = () => { pointerDownRef.current = true; };
    const handlePointerUp = () => {
      pointerDownRef.current = false;
      if (pendingTransientRef.current != null) scheduleFlush(POINTER_UP_COMMIT_DELAY_MS);
    };
    // capture: the timeline and the overlay stop propagation of some pointer events
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerUp, true);
    window.addEventListener('blur', handlePointerUp);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerUp, true);
      window.removeEventListener('blur', handlePointerUp);
    };
  }, [scheduleFlush]);

  useEffect(() => () => clearTimeout(commitTimerRef.current), []);

  const undo = useCallback(() => {
    flushTransient();
    mixProject.undo();
  }, [flushTransient, mixProject]);

  const redo = useCallback(() => {
    flushTransient();
    mixProject.redo();
  }, [flushTransient, mixProject]);

  // Clip to show as the current segment once its source's timeline is written (and where to seek once the media is ready)
  const pendingSelectRef = useRef<{ clipId: string, sourceId: string, seekTo?: number | undefined }>(undefined);

  // The segments last seen for the active source; `undefined` until the timeline of the source has been written
  const syncRef = useRef<{ sourceId: string, segments: StateSegment[] }>(undefined);

  // Two-way sync between the timeline of the active source and the project clips (logic in clipSegments.ts)
  useEffect(() => {
    if (currentSource == null) {
      syncRef.current = undefined;
      return;
    }
    const prev = syncRef.current?.sourceId === currentSource.id ? syncRef.current : undefined;
    const step = getSyncStep({
      segments: cutSegments,
      segmentsChanged: prev != null && prev.segments !== cutSegments,
      sourceLoaded: prev != null,
      source: currentSource,
      clips: project.clips,
      frameSize,
      paletteSize: segColorsCount,
    });
    syncRef.current = { sourceId: currentSource.id, segments: cutSegments };

    if (step.type === 'dispatch') {
      const action: MixProjectAction = { type: 'batch', actions: step.actions };
      const [first] = step.actions;
      if (step.transient && first?.type === 'updateClip') dispatchMerged(`times:${first.clipId}`, action, TIMELINE_IDLE_COMMIT_MS);
      else dispatchStep(action);
      return;
    }

    if (step.type === 'write') {
      setCutSegments(step.segments);
      // The segments may be in another order now: keep the current one by id (or show the clip that was asked for)
      const pending = pendingSelectRef.current?.sourceId === currentSource.id ? pendingSelectRef.current : undefined;
      const preferredId = pending?.clipId ?? (prev != null ? currentSegId : undefined);
      const index = preferredId != null ? step.segments.findIndex((s) => s.segId === preferredId) : -1;
      if (index !== -1) {
        setCurrentSegIndex(index);
        if (pending?.seekTo == null && pending?.clipId === preferredId) pendingSelectRef.current = undefined;
      } else if (prev == null) {
        setCurrentSegIndex(0);
      }
    }
  }, [cutSegments, currentSegId, currentSource, dispatchMerged, dispatchStep, frameSize, project.clips, setCurrentSegIndex, setCutSegments]);

  // Seek to the clip selected in another source once that source is loaded (before, the <video> has no duration)
  const mediaReady = isDurationValid(fileDuration);
  useEffect(() => {
    const pending = pendingSelectRef.current;
    if (!mediaReady || pending?.seekTo == null || pending.sourceId !== currentSourceId || syncRef.current?.sourceId !== currentSourceId) return;
    pendingSelectRef.current = undefined;
    seekAbs(pending.seekTo);
  }, [currentSourceId, mediaReady, seekAbs]);

  /** Select a clip of any source: activates its source if needed, seeks to its start and makes it the current segment. */
  const userSelectClip = useCallback(async (clipId: string) => {
    const clip = project.clips.find((c) => c.id === clipId);
    if (clip == null) return;
    if (clip.sourceId === currentSourceId && syncRef.current?.sourceId === currentSourceId) {
      const index = cutSegments.findIndex((s) => s.segId === clipId);
      if (index !== -1) setCurrentSegIndex(index);
      seekAbs(clip.start);
      return;
    }
    pendingSelectRef.current = { clipId, sourceId: clip.sourceId, seekTo: clip.start };
    await activateSource(clip.sourceId);
  }, [activateSource, currentSourceId, cutSegments, project.clips, seekAbs, setCurrentSegIndex]);

  /** "Add clip": from the marked start to the playhead, or a new clip at the playhead (see getNewClipRange). */
  const userAddClip = useCallback(() => {
    if (currentSource == null || !isDurationValid(fileDuration)) {
      getSwal().toast.fire({ icon: 'info', title: i18n.t('Select a source first') });
      return;
    }
    if (frameSize == null) {
      errorToast(i18n.t('This source has no video'));
      return;
    }
    const marker = currentCutSeg != null && currentCutSeg.end == null ? currentCutSeg : undefined;
    const range = getNewClipRange({ time: getRelevantTime(), duration: fileDuration, marker });
    if (range == null) return;
    const id = range.fromMarker && marker != null ? marker.segId : nanoid();
    const clip = createClip({
      id,
      sourceId: currentSource.id,
      name: getDefaultClipName(currentSource, project.clips),
      color: getNextClipColor(project.clips, segColorsCount),
      start: range.start,
      end: range.end,
      frameSize,
    });
    pendingSelectRef.current = { clipId: id, sourceId: currentSource.id };
    dispatchStep({ type: 'addClip', clip });
  }, [currentCutSeg, currentSource, dispatchStep, fileDuration, frameSize, getRelevantTime, project.clips]);

  const userDuplicateClip = useCallback((clipId: string | undefined) => {
    const clip = project.clips.find((c) => c.id === clipId);
    if (clip == null) return;
    const newId = nanoid();
    if (clip.sourceId === currentSourceId) pendingSelectRef.current = { clipId: newId, sourceId: clip.sourceId };
    dispatchStep({ type: 'duplicateClip', clipId: clip.id, newId, name: getDuplicateClipName(clip.name, project.clips) });
  }, [currentSourceId, dispatchStep, project.clips]);

  const userRemoveClip = useCallback((clipId: string | undefined) => {
    if (clipId == null) return;
    dispatchStep({ type: 'removeClip', clipId });
  }, [dispatchStep]);

  /** Split the clip under the playhead (the selected one first); both parts keep the rects and audio settings. */
  const userSplitClip = useCallback(() => {
    const time = getRelevantTime();
    const contains = (c: { start: number, end: number }) => c.start < time && time < c.end;
    const clip = selectedClip != null && contains(selectedClip) ? selectedClip : project.clips.find((c) => c.sourceId === currentSourceId && contains(c));
    const newId = nanoid();
    const action = clip != null ? getSplitClipAction({ clip, time, newId, clips: project.clips }) : undefined;
    if (clip == null || action == null) {
      errorToast(i18n.t('No clip to split. Please move cursor over the clip you want to split'));
      return;
    }
    pendingSelectRef.current = { clipId: newId, sourceId: clip.sourceId };
    dispatchStep(action);
  }, [currentSourceId, dispatchStep, getRelevantTime, project.clips, selectedClip]);

  const userUpdateClip = useCallback((clipId: string, patch: MixClipPatch) => dispatchStep({ type: 'updateClip', clipId, patch }), [dispatchStep]);
  const userReorderClips = useCallback((ids: string[]) => dispatchStep({ type: 'reorderClips', ids }), [dispatchStep]);

  // Aspect lock of the max rect, per clip (UI state of this session, not saved)
  const [aspectLocks, setAspectLocks] = useState<ReadonlyMap<string, number>>(() => new Map());
  const aspectLock = selectedClipId != null ? aspectLocks.get(selectedClipId) : undefined;
  const setAspectLock = useCallback((aspect: number | undefined) => {
    if (selectedClipId == null) return;
    setAspectLocks((existing) => {
      const ret = new Map(existing);
      if (aspect == null) ret.delete(selectedClipId);
      else ret.set(selectedClipId, aspect);
      return ret;
    });
  }, [selectedClipId]);

  const getRectsAction = useCallback((clipId: string, rects: ClipRects): MixProjectAction => (
    { type: 'updateClip', clipId, patch: { maxRect: rects.maxRect, minRect: rects.minRect } }
  ), []);

  /** Every step of a rect drag: transient, the drag's commit makes it one undo step. */
  const handleRectsChange = useCallback((rects: ClipRects) => {
    if (selectedClipId == null) return;
    // don't merge the drag with pending keyboard nudges
    if (pendingTransientRef.current != null) flushTransient();
    dispatch(getRectsAction(selectedClipId, rects), { transient: true });
  }, [dispatch, flushTransient, getRectsAction, selectedClipId]);

  const handleRectsCommit = useCallback((rects: ClipRects, info?: { keyboard: boolean }) => {
    if (selectedClipId == null) return;
    const action = getRectsAction(selectedClipId, rects);
    // repeated arrow key nudges of the same clip become one undo step
    if (info?.keyboard) dispatchMerged(`rects:${selectedClipId}`, action, KEYBOARD_IDLE_COMMIT_MS);
    else dispatchStep(action);
  }, [dispatchMerged, dispatchStep, getRectsAction, selectedClipId]);

  const handleRectsEdit = useCallback((rects: ClipRects) => {
    if (selectedClipId == null) return;
    dispatchStep(getRectsAction(selectedClipId, rects));
  }, [dispatchStep, getRectsAction, selectedClipId]);

  return {
    selectedClip,
    selectedClipId,
    undo,
    redo,
    userSelectClip,
    userAddClip,
    userDuplicateClip,
    userRemoveClip,
    userSplitClip,
    userUpdateClip,
    userReorderClips,
    aspectLock,
    setAspectLock,
    handleRectsChange,
    handleRectsCommit,
    handleRectsEdit,
  };
}

export type UseMixClips = ReturnType<typeof useMixClips>;
