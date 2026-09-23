import type { FFprobeFormat, FFprobeStream } from '../../../common/ffprobe';
import { parseFfprobeDuration } from '../../../common/util';
import { getRealVideoStreams } from '../util/streams';
import { getOrientedSize, getStreamRotation } from './overlayMath';
import { mixProjectExtension } from './projectFile';
import { DEFAULT_MUSIC_VOLUME_DB } from './types';
import type { MixMusic, MixSource } from './types';

// Pure helpers for the multi-source workspace in App.tsx (T05). No React/Electron here, so they can be tested with vitest.

// The VideoMix flag lives in common, so main (menu, default key bindings) can use it too
export { videoMixMode } from '../../../common/videomix/legacyUi';

// Decided by extension only: probing every dropped file would be slow, and the audio-only case is just a suggestion the user confirms.
const audioExtensions = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aif', 'aiff', 'ac3', 'mka']);

// Project/EDL/subtitle files that LosslessCut would import as segments. They make no sense as VideoMix sources.
const unsupportedExtensions = new Set(['llc', 'csv', 'pbf', 'edl', 'cue', 'xml', 'fcpxml', 'otio', 'srt', 'txt', 'vmx-recovery']);

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
    else if (unsupportedExtensions.has(ext)) ret.unsupportedPaths.push(filePath);
    else ret.mediaPaths.push(filePath);
  });
  return ret;
}

export type SourceMeta = Pick<MixSource, 'width' | 'height' | 'duration'>;

/** The informative cache of a source (oriented size of the first real video stream, duration) from the ffprobe meta read by `loadMedia`. */
export function getSourceMeta({ streams, format }: {
  streams: Pick<FFprobeStream, 'codec_type' | 'disposition' | 'width' | 'height' | 'tags'>[],
  format: Pick<FFprobeFormat, 'duration'>,
}): SourceMeta {
  const [videoStream] = getRealVideoStreams(streams);
  const duration = parseFfprobeDuration(format.duration);
  const size = videoStream?.width != null && videoStream.height != null && videoStream.width > 0 && videoStream.height > 0
    ? getOrientedSize({ width: videoStream.width, height: videoStream.height }, getStreamRotation(videoStream))
    : undefined;
  return {
    width: size?.width,
    height: size?.height,
    duration: duration != null && Number.isFinite(duration) && duration >= 0 ? duration : undefined,
  };
}

/** True if `meta` has something the source doesn't have yet (or different). Undefined values never erase the cache. */
export const isSourceMetaChanged = (source: MixSource, meta: SourceMeta) => (['width', 'height', 'duration'] as const)
  .some((key) => meta[key] != null && meta[key] !== source[key]);

/** Music settings for a new music file, keeping the volume/loop of the music it replaces. */
export function createMusic(filePath: string, previous: MixMusic | undefined): MixMusic {
  return { path: filePath, absolutePath: filePath, volumeDb: previous?.volumeDb ?? DEFAULT_MUSIC_VOLUME_DB, loop: previous?.loop ?? false };
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
