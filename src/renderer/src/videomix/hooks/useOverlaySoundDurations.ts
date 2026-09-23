import { useEffect, useMemo, useState } from 'react';

import { getDuration } from '../../ffmpeg';
import type { MixOverlay } from '../types';

// Durations of the sound overlays' files, for resolveOverlayTimes in the UI (T22). The render gets them from its own
// loudness measurement (T21); the UI can't wait for that, so each file is probed once with ffprobe (lazily, when a
// sound shows up in the project) and cached in memory for the session, by path. Missing/unreadable files stay unknown
// (resolveOverlayTimes then warns "unknown duration").

const durationByPath = new Map<string, number | null>();
const pending = new Map<string, Promise<void>>();

function toDurations(overlays: readonly MixOverlay[]) {
  const ret: Record<string, number> = {};
  overlays.forEach((o) => {
    if (o.type !== 'sound') return;
    const duration = durationByPath.get(o.path);
    if (duration != null) ret[o.id] = duration;
  });
  return ret;
}

/** Durations already probed (overlay id → s), synchronously, e.g. to resolve times before a removal. */
export const getKnownSoundDurations = (overlays: readonly MixOverlay[]) => toDurations(overlays);

/** Overlay id → duration (s) of the sound overlays whose file has been probed; re-renders when a probe finishes. */
export default function useOverlaySoundDurations(overlays: readonly MixOverlay[]) {
  const [version, setVersion] = useState(0);

  // A string key, so the effect doesn't rerun on every overlay edit (e.g. each step of a drag)
  const pathsKey = useMemo(() => [...new Set(overlays.flatMap((o) => (o.type === 'sound' ? [o.path] : [])))].join('\n'), [overlays]);

  useEffect(() => {
    let mounted = true;
    const paths = pathsKey !== '' ? pathsKey.split('\n') : [];
    const waits = paths.filter((p) => !durationByPath.has(p)).map((path) => {
      let promise = pending.get(path);
      if (promise == null) {
        promise = (async () => {
          try {
            const duration: number | undefined = await getDuration(path);
            durationByPath.set(path, duration != null && Number.isFinite(duration) && duration > 0 ? duration : null);
          } catch (err) {
            // a relinked file has a new path, so caching the failure doesn't hide it later
            console.warn('Failed to read the duration of', path, err);
            durationByPath.set(path, null);
          } finally {
            pending.delete(path);
          }
        })();
        pending.set(path, promise);
      }
      return promise;
    });
    if (waits.length > 0) {
      Promise.all(waits).then(() => {
        if (mounted) setVersion((v) => v + 1);
      });
    }
    return () => { mounted = false; };
  }, [pathsKey]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => toDurations(overlays), [overlays, version]);
}
