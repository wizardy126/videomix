import type { MusicOccurrence } from '../render/buildAudioGraph';
import type { RenderTimeline } from '../render/renderTimeline';

// Which media elements the live preview (A1, T32) needs at a time, and how they map onto a pool of reusable elements.
// Pure: the engine (previewEngine.ts) creates, loads and seeks the actual <video>/<audio> elements.

/** Clips (and music tracks) starting within this many seconds are loaded ahead, paused at their first frame. */
export const PRELOAD_AHEAD = 2;

export interface PreviewMediaRequest {
  /** Stable while the same clip/track occurrence is needed: `p<placement index>` or `m<occurrence index>`. */
  key: string,
  /** What the element loads: a source id (video) or a track id (music). Elements with the same one are reused first. */
  sourceId: string,
  /** Position in the file (s) the element must be at now; a preloaded one waits at its start. */
  mediaTime: number,
  /** Playing now (visible or audible); otherwise preloaded, paused and silent. */
  active: boolean,
}

/**
 * Output frame shown at `time` (s): frame n is on screen during [n / fps, (n + 1) / fps) (ADR-001: f = round(t·fps) is
 * where a time *starts*). The epsilon keeps n / fps itself on frame n despite float noise.
 */
export const getPreviewFrameIndex = (time: number, fps: number) => Math.floor(time * fps + 1e-6);

/**
 * Videos needed at `time`: every placement on screen at that frame (its media position follows the render: frame f of
 * the video is `clip.start + (f − f0) / fps` of the source) and, preloaded at its start, every placement starting
 * within `preloadAhead` s (the next clip of each column, and the first clip of a column about to appear).
 */
export function getPreviewVideoRequests({ tl, clips, time, preloadAhead = PRELOAD_AHEAD }: {
  tl: Pick<RenderTimeline, 'placements' | 'settings'>,
  clips: ReadonlyMap<string, { sourceId: string, start: number }>,
  time: number,
  preloadAhead?: number | undefined,
}): PreviewMediaRequest[] {
  const { fps } = tl.settings;
  const frame = getPreviewFrameIndex(time, fps);
  const requests: PreviewMediaRequest[] = [];
  tl.placements.forEach((p) => {
    const clip = clips.get(p.placement.clipId);
    if (clip == null || p.f1 <= p.f0) return;
    const active = p.f0 <= frame && frame < p.f1;
    const upcoming = p.f0 > frame && p.f0 / fps - time <= preloadAhead;
    if (active || upcoming) {
      const offset = Math.min(Math.max(0, time - p.f0 / fps), (p.f1 - p.f0) / fps);
      requests.push({ key: `p${p.index}`, sourceId: clip.sourceId, mediaTime: clip.start + (active ? offset : 0), active });
    }
  });
  return requests;
}

/**
 * Music tracks needed at `time` (`getMusicSchedule`'s occurrences): the ones playing (two during a crossfade) and the
 * next one if it starts within `preloadAhead` s. An occurrence of unknown duration plays to the end of the video
 * (its element loops if the list does; `mediaTime` then keeps growing and the engine wraps it).
 */
export function getPreviewMusicRequests({ occurrences, time, totalDuration, preloadAhead = PRELOAD_AHEAD }: {
  occurrences: readonly Pick<MusicOccurrence, 'track' | 'start' | 'duration'>[],
  time: number,
  totalDuration: number,
  preloadAhead?: number | undefined,
}): PreviewMediaRequest[] {
  const requests: PreviewMediaRequest[] = [];
  occurrences.forEach(({ track, start, duration }, i) => {
    const end = Math.min(start + duration, totalDuration);
    const active = start <= time && time < end;
    const upcoming = start > time && start - time <= preloadAhead;
    if (active || upcoming) requests.push({ key: `m${i}`, sourceId: track.id, mediaTime: active ? time - start : 0, active });
  });
  return requests;
}

/** A pooled media element: what it's used for now (`key`, undefined when idle) and what it has loaded. */
export interface PoolSlot {
  id: number,
  key: string | undefined,
  sourceId: string | undefined,
}

/** Idle elements kept for reuse; more are destroyed (each <video> holds a decoder). */
export const MAX_IDLE_SLOTS = 2;

/**
 * Assigns the requests to pooled elements: a request keeps its element while it's needed; a new one takes an idle
 * element that already has its file loaded (no reload: consecutive clips of the same source only seek), then any idle
 * element, then a new one. Idle elements beyond `maxIdle` are removed (the oldest first).
 */
export function assignPreviewPool(slots: readonly PoolSlot[], requests: readonly Pick<PreviewMediaRequest, 'key' | 'sourceId'>[], { maxIdle = MAX_IDLE_SLOTS } = {}) {
  const wanted = new Map(requests.map((r) => [r.key, r.sourceId]));
  // a kept key may now load another file (the plan changed under the same placement index): the caller reloads it
  const result: PoolSlot[] = slots.map((slot) => {
    const sourceId = slot.key != null ? wanted.get(slot.key) : undefined;
    return sourceId != null ? { ...slot, sourceId } : { ...slot, key: undefined };
  });
  const assigned = new Set(result.flatMap((slot) => (slot.key != null ? [slot.key] : [])));
  let nextId = slots.reduce((acc, slot) => Math.max(acc, slot.id + 1), 0);
  const created: number[] = [];

  const take = (request: Pick<PreviewMediaRequest, 'key' | 'sourceId'>, slot: PoolSlot) => {
    // eslint-disable-next-line no-param-reassign
    slot.key = request.key;
    // eslint-disable-next-line no-param-reassign
    slot.sourceId = request.sourceId;
    assigned.add(request.key);
  };
  // first the requests that find their file already loaded, then the others
  for (const request of requests) {
    const slot = result.find((s) => s.key == null && s.sourceId === request.sourceId);
    if (!assigned.has(request.key) && slot != null) take(request, slot);
  }
  for (const request of requests.filter((r) => !assigned.has(r.key))) {
    const slot = result.find((s) => s.key == null);
    if (slot != null) {
      take(request, slot);
    } else {
      result.push({ id: nextId, key: request.key, sourceId: request.sourceId });
      created.push(nextId);
      assigned.add(request.key);
      nextId += 1;
    }
  }

  const idle = result.filter((slot) => slot.key == null);
  const removed = new Set(idle.slice(0, Math.max(0, idle.length - maxIdle)).map((slot) => slot.id));
  return { slots: result.filter((slot) => !removed.has(slot.id)), created, removed: [...removed] };
}
