import { useEffect, useMemo, useRef, useState } from 'react';

import { getClipRotation } from '../clipRotation';
import { ThumbnailQueue, THUMBNAIL_DIR_NAME, captureThumbnail, getThumbnailCacheKey, getThumbnailCrop, getThumbnailFileName } from '../thumbnails';
import type { MixClip, MixSource } from '../types';

const path = window.require('node:path');
const fs = window.require('node:fs/promises');
const remote = window.require('@electron/remote');
const { pathToFileURL } = remote.require('./index.js');

const CONCURRENCY = 2;
// Typing `start`/dragging the crop shouldn't spawn a generation per keystroke/pointer move.
const DEBOUNCE_MS = 400;
const CLEANUP_DEBOUNCE_MS = 3000;

const getCacheDir = () => path.join(remote.app.getPath('userData'), THUMBNAIL_DIR_NAME);

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export interface UseClipThumbnails {
  /** Clip id → thumbnail file URL, only for the clips whose thumbnail is ready. */
  thumbnailUrls: ReadonlyMap<string, string>,
}

/**
 * Thumbnails of the project's clips (A2, T31): the frame at each clip's `start`, cropped to its `maxRect`, cached as
 * JPEGs in `userData/videomix-thumbs/` and generated on demand by main's ffmpeg (`captureThumbnail`). Used by
 * `ClipList`'s rows and the Mix view's blocks (`MixPlanView`); App.tsx calls this hook once and hands both the same
 * map, so a clip's thumbnail is generated only once even though both can be visible together.
 *
 * - The cache key (thumbnails.ts's `getThumbnailCacheKey`) is the file name: an existing file is the cache hit, and
 *   changing the source file, `start` or `maxRect` gets a new key. Recomputing it is debounced per clip.
 * - Generations go through a small concurrency-limited queue (`ThumbnailQueue`), so opening a project with many
 *   clips (or a fast drag through several) doesn't spawn dozens of ffmpeg processes at once.
 * - Cache files no longer referenced by any current clip are removed after a debounced cleanup pass.
 */
export default function useClipThumbnails({ clips, sources, enabled = true }: {
  clips: Pick<MixClip, 'id' | 'sourceId' | 'start' | 'maxRect' | 'rotation'>[],
  sources: Pick<MixSource, 'id' | 'absolutePath' | 'width' | 'height' | 'sar'>[],
  enabled?: boolean | undefined,
}): UseClipThumbnails {
  const [paths, setPaths] = useState<Map<string, string>>(new Map());
  const queueRef = useRef<ThumbnailQueue>(undefined);
  if (queueRef.current == null) queueRef.current = new ThumbnailQueue(CONCURRENCY);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const activeKeysRef = useRef(new Set<string>());
  const lastSpecsRef = useRef(new Map<string, string>());
  const currentIdsRef = useRef(new Set<string>());

  // Unmount: drop everything pending, there's no component left to receive the state updates.
  useEffect(() => () => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
    if (cleanupTimerRef.current != null) clearTimeout(cleanupTimerRef.current);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const sourcesById = new Map(sources.map((s) => [s.id, s]));
    const timers = timersRef.current;
    const lastSpecs = lastSpecsRef.current;
    const queue = queueRef.current!;

    const scheduleCleanup = () => {
      if (cleanupTimerRef.current != null) clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = setTimeout(() => {
        (async () => {
          const dir = getCacheDir();
          try {
            const names: string[] = await fs.readdir(dir);
            const keep = new Set([...activeKeysRef.current].map((key) => getThumbnailFileName(key)));
            await Promise.all(names.filter((name) => !keep.has(name)).map((name) => fs.unlink(path.join(dir, name)).catch(() => undefined)));
          } catch {
            // cache dir doesn't exist yet (no thumbnail generated so far): nothing to clean up
          }
          // also drop the paths of clips removed from the project since (deferred, not synchronously in the effect)
          setPaths((prev) => {
            let changed = false;
            const next = new Map(prev);
            [...next.keys()].forEach((id) => {
              if (currentIdsRef.current.has(id)) return;
              next.delete(id);
              changed = true;
            });
            return changed ? next : prev;
          });
        })();
      }, CLEANUP_DEBOUNCE_MS);
    };

    clips.forEach((clip) => {
      const source = sourcesById.get(clip.sourceId);
      if (source == null) return;
      // the SAR (B1) changes the crop in coded pixels, e.g. when the meta of a source cached before T35 is refreshed
      const rotation = getClipRotation(clip);
      const spec = `${source.absolutePath}\n${clip.start}\n${clip.maxRect.x},${clip.maxRect.y},${clip.maxRect.width},${clip.maxRect.height}\n${source.sar?.num}:${source.sar?.den}\n${rotation}`;
      if (lastSpecs.get(clip.id) === spec) return; // unrelated change (name, color, gain…): keep the current thumbnail
      lastSpecs.set(clip.id, spec);

      const existingTimer = timers.get(clip.id);
      if (existingTimer != null) clearTimeout(existingTimer);
      timers.set(clip.id, setTimeout(() => {
        timers.delete(clip.id);
        (async () => {
          try {
            const { mtimeMs, size } = await fs.stat(source.absolutePath);
            const key = await getThumbnailCacheKey({ absolutePath: source.absolutePath, mtimeMs, size, start: clip.start, maxRect: clip.maxRect, sar: source.sar, rotation });
            activeKeysRef.current.add(key);
            const outPath = path.join(getCacheDir(), getThumbnailFileName(key));
            if (await pathExists(outPath)) {
              setPaths((prev) => (prev.get(clip.id) === outPath ? prev : new Map(prev).set(clip.id, outPath)));
              scheduleCleanup();
              return;
            }
            queue.enqueue(key, async () => {
              try {
                await fs.mkdir(getCacheDir(), { recursive: true });
                await captureThumbnail({ filePath: source.absolutePath, timestamp: clip.start, ...getThumbnailCrop(clip.maxRect, source, rotation), outPath });
                setPaths((prev) => new Map(prev).set(clip.id, outPath));
              } catch (err) {
                console.warn('captureThumbnail failed', clip.id, err);
              } finally {
                scheduleCleanup();
              }
            });
          } catch (err) {
            console.warn('Thumbnail cache key failed', clip.id, err);
          }
        })();
      }, DEBOUNCE_MS));
    });

    // Clips removed from the project (undo can bring them back): drop their pending timer/spec, so they're
    // rescheduled from scratch instead of being seen as unchanged. `paths` itself is pruned by the cleanup pass
    // above (deferred), not here, to avoid a setState call directly in the effect body.
    const currentIds = new Set(clips.map((c) => c.id));
    currentIdsRef.current = currentIds;
    [...lastSpecs.keys()].forEach((id) => {
      if (currentIds.has(id)) return;
      lastSpecs.delete(id);
      const timer = timers.get(id);
      if (timer != null) { clearTimeout(timer); timers.delete(id); }
    });
  }, [clips, sources, enabled]);

  const thumbnailUrls = useMemo(() => new Map([...paths].map(([id, filePath]) => [id, pathToFileURL(filePath).href as string])), [paths]);

  return { thumbnailUrls };
}
