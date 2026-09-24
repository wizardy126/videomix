import pMap from 'p-map';

import type { FFprobeFormat, FFprobeStream } from '../../../common/ffprobe';
import { parseFfprobeDuration } from '../../../common/util';
import { getRealVideoStreams } from '../util/streams';
import { getOrientedSize, getStreamRotation } from './overlayMath';
import type { Size } from './overlayMath';
import { mixProjectExtension } from './projectFile';
import { getDisplaySize, getOrientedSar, isSameSar, parseSampleAspectRatio } from './sampleAspect';
import type { SampleAspectRatio } from './sampleAspect';
import { DEFAULT_MUSIC_VOLUME_DB } from './types';
import type { MixMusicPlaylist, MixMusicTrack, MixSource } from './types';

// Pure helpers for the multi-source workspace in App.tsx (T05). No React/Electron here, so they can be tested with vitest.

// The VideoMix flag lives in common, so main (menu, default key bindings) can use it too
export { videoMixMode } from '../../../common/videomix/legacyUi';

// Decided by extension only: probing every dropped file would be slow, and the audio-only case is just a suggestion the user confirms.
const audioExtensions = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aif', 'aiff', 'ac3', 'mka']);

// Project/EDL/subtitle files that LosslessCut would import as segments. They make no sense as VideoMix sources.
const unsupportedExtensions = new Set(['llc', 'csv', 'pbf', 'edl', 'cue', 'xml', 'fcpxml', 'otio', 'srt', 'txt', 'vmx-recovery']);

// T16/T17: "Open folder" reads a directory recursively and used to add every unrecognized file (including images) as a
// video source. Images are never valid sources, so they are treated like the unsupported extensions above.
const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'heic', 'heif', 'avif', 'svg']);

const getBaseName = (filePath: string) => filePath.split(/[/\\]/).pop() ?? filePath;

/** Lowercase extension without the dot ('' if none). `.vmx-recovery` counts as one extension. */
export function getFileExtension(filePath: string) {
  const name = getBaseName(filePath).toLowerCase();
  if (name.endsWith('.vmx-recovery')) return 'vmx-recovery';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
}

export interface OpenedPaths {
  projectPaths: string[],
  audioPaths: string[],
  mediaPaths: string[],
  unsupportedPaths: string[],
}

/** Splits files that were dropped / opened into what VideoMix does with each kind (see `userOpenFiles` in App.tsx). */
export function classifyOpenedPaths(filePaths: string[]): OpenedPaths {
  const ret: OpenedPaths = { projectPaths: [], audioPaths: [], mediaPaths: [], unsupportedPaths: [] };
  filePaths.forEach((filePath) => {
    const ext = getFileExtension(filePath);
    if (ext === mixProjectExtension) ret.projectPaths.push(filePath);
    else if (audioExtensions.has(ext)) ret.audioPaths.push(filePath);
    else if (unsupportedExtensions.has(ext) || imageExtensions.has(ext)) ret.unsupportedPaths.push(filePath);
    else ret.mediaPaths.push(filePath);
  });
  return ret;
}

export type SourceMeta = Pick<MixSource, 'width' | 'height' | 'duration' | 'sar'>;

/**
 * The informative cache of a source from the ffprobe meta read by `loadMedia`: display size of the first real video
 * stream (B1: its SAR applied before the rotation, like Chromium's videoWidth/videoHeight), the SAR of the oriented
 * frame (`sar`, square = `{ num: 1, den: 1 }` here so that it can replace a stored one) and the duration.
 */
export function getSourceMeta({ streams, format }: {
  streams: Pick<FFprobeStream, 'codec_type' | 'disposition' | 'width' | 'height' | 'tags' | 'sample_aspect_ratio'>[],
  format: Pick<FFprobeFormat, 'duration'>,
}): SourceMeta {
  const [videoStream] = getRealVideoStreams(streams);
  const duration = parseFfprobeDuration(format.duration);
  let size: Size | undefined;
  let sar: SampleAspectRatio | undefined;
  if (videoStream?.width != null && videoStream.height != null && videoStream.width > 0 && videoStream.height > 0) {
    const rotation = getStreamRotation(videoStream);
    sar = getOrientedSar(parseSampleAspectRatio(videoStream.sample_aspect_ratio), rotation) ?? { num: 1, den: 1 };
    size = getDisplaySize(getOrientedSize({ width: videoStream.width, height: videoStream.height }, rotation), sar);
  }
  return {
    width: size?.width,
    height: size?.height,
    duration: duration != null && Number.isFinite(duration) && duration >= 0 ? duration : undefined,
    sar,
  };
}

/** True if `meta` has something the source doesn't have yet (or different). Undefined values never erase the cache. */
export const isSourceMetaChanged = (source: MixSource, meta: SourceMeta) => (['width', 'height', 'duration'] as const)
  .some((key) => meta[key] != null && meta[key] !== source[key]) || (meta.sar != null && !isSameSar(meta.sar, source.sar));

export interface RefreshSourcesMetaDeps {
  /** Whether the source's file still exists (skip it otherwise: nothing to probe). */
  pathExists: (path: string) => Promise<boolean>,
  /** ffprobe of the file, e.g. `readFileFfprobeMeta` (injected so this stays Electron-free and testable in Node). */
  probe: (path: string) => Promise<Parameters<typeof getSourceMeta>[0]>,
}

/**
 * Refreshes the cached meta (display size + SAR, T35) of every source whose file still exists, up to `concurrency`
 * probes in parallel, calling `onMeta` only for the ones whose meta actually changed (`isSourceMetaChanged`); a
 * missing file or a failed probe is skipped (only logged), so one bad source doesn't stop the others.
 *
 * Used at startup, in the background, for every source of the project (T39 point 5), and before rendering, awaited,
 * for only the used ones (T35b) — so a project whose anamorphic source wasn't reactivated this session doesn't fail
 * validation with `max-rect-outside-frame`. `onMeta` is expected to apply the change like `setSourceMeta`
 * (useMixProject): a cache update, not an undo step, which also rescales the clip rects of a resized source
 * (`sourceResize.ts`, B2) following T35's no-rescale rule.
 */
export async function refreshSourcesMeta(
  sources: readonly MixSource[],
  { pathExists, probe }: RefreshSourcesMetaDeps,
  onMeta: (source: MixSource, meta: SourceMeta) => void,
  { concurrency = 3 }: { concurrency?: number } = {},
): Promise<void> {
  await pMap(sources, async (source) => {
    try {
      if (!(await pathExists(source.absolutePath))) return;
      const meta = getSourceMeta(await probe(source.absolutePath));
      if (isSourceMetaChanged(source, meta)) onMeta(source, meta);
    } catch (err) {
      console.warn('Failed to refresh the meta of source', source.absolutePath, err);
    }
  }, { concurrency });
}

/** The sources actually used by at least one clip (T35b/T39 point 5: only these need refreshing before rendering). */
export function getUsedSources<S extends Pick<MixSource, 'id'>>(sources: readonly S[], clips: readonly { sourceId: string }[]): S[] {
  const usedIds = new Set(clips.map((clip) => clip.sourceId));
  return sources.filter((source) => usedIds.has(source.id));
}

/** A music track for a file, at the default background volume (T12b). `filePath` must be absolute. */
export function createMusicTrack({ id, filePath, volumeDb = DEFAULT_MUSIC_VOLUME_DB }: { id: string, filePath: string, volumeDb?: number | undefined }): MixMusicTrack {
  return { id, path: filePath, absolutePath: filePath, volumeDb };
}

/**
 * The playlist with `tracks` added at the end (C2, opened audio files). Music that is new (no tracks yet) doesn't loop,
 * as a single opened music file didn't before the playlist (T24).
 */
export function appendMusicTracks(playlist: MixMusicPlaylist, tracks: MixMusicTrack[]): MixMusicPlaylist {
  return playlist.tracks.length > 0 ? { ...playlist, tracks: [...playlist.tracks, ...tracks] } : { ...playlist, tracks, loop: false };
}

/** Window title part for the project: file name without extension (or `untitledName`), plus `*` if there are unsaved changes. */
export function getMixProjectTitle({ projectPath, dirty, untitledName }: { projectPath: string | undefined, dirty: boolean, untitledName: string }) {
  const name = projectPath != null ? getBaseName(projectPath).replace(new RegExp(`\\.${mixProjectExtension}$`, 'i'), '') : untitledName;
  return `${name}${dirty ? '*' : ''}`;
}

/** Number of clips of each source. */
export function countClipsBySource(clips: { sourceId: string }[]) {
  const counts = new Map<string, number>();
  clips.forEach(({ sourceId }) => counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1));
  return counts;
}
