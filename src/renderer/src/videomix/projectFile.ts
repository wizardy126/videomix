import JSON5 from 'json5';
import type { PlatformPath } from 'node:path';
import type fsPromises from 'node:fs/promises';

import { parseMixProject } from './project';
import type { MixOverlay, MixProject, OverlayFile } from './types';

// Node modules are passed in (instead of `window.require` here) so this file can be tested with vitest in Node.
export type PathApi = Pick<PlatformPath, 'dirname' | 'resolve' | 'relative' | 'isAbsolute' | 'sep' | 'join' | 'basename'>;
export type FsApi = Pick<typeof fsPromises, 'readFile' | 'writeFile' | 'access' | 'mkdir' | 'readdir' | 'stat' | 'unlink'>;

export interface NodeDeps {
  path: PathApi,
  fs: FsApi,
}

export const mixProjectExtension = 'vmx';

export async function pathExists(fs: Pick<FsApi, 'access'>, path: string) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Path to store in the `.vmx`: relative to `baseDir` (with `/` separators, so projects move between OSes),
 * or absolute if it can't be made relative (e.g. another Windows drive).
 */
export function toProjectRelativePath(path: PathApi, baseDir: string, filePath: string) {
  if (!path.isAbsolute(filePath)) return filePath;
  const relative = path.relative(baseDir, filePath);
  if (relative === '' || path.isAbsolute(relative)) return filePath;
  return path.sep === '\\' ? relative.replaceAll('\\', '/') : relative;
}

export function resolveProjectPath(path: PathApi, baseDir: string | undefined, storedPath: string) {
  if (path.isAbsolute(storedPath) || baseDir == null) return storedPath;
  return path.resolve(baseDir, storedPath);
}

/** Which file of an overlay: its media (image/sound) or the countdown/text font. */
export type OverlayFileKind = 'media' | 'font';

/** The user files of an overlay (the bundled font isn't one). */
export function getOverlayFiles(overlay: MixOverlay): { kind: OverlayFileKind, file: OverlayFile }[] {
  if (overlay.type === 'image' || overlay.type === 'sound') return [{ kind: 'media', file: overlay }];
  if ((overlay.type === 'countdown' || overlay.type === 'text') && overlay.font != null) return [{ kind: 'font', file: overlay.font }];
  return [];
}

/** Applies `fn` to each user file of an overlay (keeping the rest of it). */
export async function mapOverlayFiles(overlay: MixOverlay, fn: (file: OverlayFile, kind: OverlayFileKind) => OverlayFile | Promise<OverlayFile>): Promise<MixOverlay> {
  if (overlay.type === 'image' || overlay.type === 'sound') {
    const { path, absolutePath } = await fn({ path: overlay.path, absolutePath: overlay.absolutePath }, 'media');
    return { ...overlay, path, absolutePath };
  }
  if ((overlay.type === 'countdown' || overlay.type === 'text') && overlay.font != null) return { ...overlay, font: await fn(overlay.font, 'font') };
  return overlay;
}

// Sync variant for saving (the relativization is sync)
function mapOverlayFilesSync(overlay: MixOverlay, fn: (file: OverlayFile) => OverlayFile): MixOverlay {
  if (overlay.type === 'image' || overlay.type === 'sound') return { ...overlay, ...fn({ path: overlay.path, absolutePath: overlay.absolutePath }) };
  if ((overlay.type === 'countdown' || overlay.type === 'text') && overlay.font != null) return { ...overlay, font: fn(overlay.font) };
  return overlay;
}

/**
 * In memory, `path` of sources/music tracks/overlay files is the absolute path in use and `absolutePath` the fallback
 * (the same, unless the file is missing). This converts `path` to relative for writing to `projectFilePath`.
 */
export function toSavedMixProject(path: PathApi, projectFilePath: string, project: MixProject): MixProject {
  const baseDir = path.dirname(projectFilePath);
  const { musicPlaylist } = project.settings;
  return {
    ...project,
    sources: project.sources.map((source) => ({ ...source, path: toProjectRelativePath(path, baseDir, source.path) })),
    overlays: project.overlays.map((overlay) => mapOverlayFilesSync(overlay, (file) => ({ ...file, path: toProjectRelativePath(path, baseDir, file.path) }))),
    settings: {
      ...project.settings,
      musicPlaylist: { ...musicPlaylist, tracks: musicPlaylist.tracks.map((track) => ({ ...track, path: toProjectRelativePath(path, baseDir, track.path) })) },
    },
  };
}

export interface MissingOverlayFile { overlayId: string, kind: OverlayFileKind }

/**
 * Resolve the stored paths of a loaded project: the relative path first, then the absolute fallback.
 * Found files get both `path` and `absolutePath` set to the found absolute path.
 * Missing ones keep the resolved relative path in `path` and the stored `absolutePath`.
 * `baseDir` is the directory of the `.vmx` (undefined if the paths are already absolute, e.g. a recovery file).
 */
export async function resolveMixProjectPaths({ path, fs }: NodeDeps, baseDir: string | undefined, project: MixProject) {
  async function resolveFile<T extends { path: string, absolutePath: string }>(file: T): Promise<{ file: T, found: boolean }> {
    const candidates = [resolveProjectPath(path, baseDir, file.path), file.absolutePath];
    for (const candidate of candidates) {
      // eslint-disable-next-line no-await-in-loop
      if (await pathExists(fs, candidate)) return { file: { ...file, path: candidate, absolutePath: candidate }, found: true };
    }
    return { file: { ...file, path: candidates[0]! }, found: false };
  }

  const resolvedSources = await Promise.all(project.sources.map(async (source) => resolveFile(source)));
  const { musicPlaylist } = project.settings;
  const resolvedTracks = await Promise.all(musicPlaylist.tracks.map(async (track) => resolveFile(track)));

  const resolvedOverlays = await Promise.all(project.overlays.map(async (overlay) => {
    const missing: MissingOverlayFile[] = [];
    const resolved = await mapOverlayFiles(overlay, async (file, kind) => {
      const ret = await resolveFile(file);
      if (!ret.found) missing.push({ overlayId: overlay.id, kind });
      return ret.file;
    });
    return { overlay: resolved, missing };
  }));

  const resolvedProject: MixProject = {
    ...project,
    sources: resolvedSources.map(({ file }) => file),
    overlays: resolvedOverlays.map(({ overlay }) => overlay),
    settings: {
      ...project.settings,
      musicPlaylist: { ...musicPlaylist, tracks: resolvedTracks.map(({ file }) => file) },
    },
  };

  return {
    project: resolvedProject,
    missingSourceIds: resolvedSources.filter(({ found }) => !found).map(({ file }) => file.id),
    /** In play order. Relink with `relinkMusicTrack` (useMixProject). */
    missingMusicTrackIds: resolvedTracks.filter(({ found }) => !found).map(({ file }) => file.id),
    /** In layer order. Relink with `relinkOverlayFile` (useMixProject). */
    missingOverlayFiles: resolvedOverlays.flatMap(({ missing }) => missing),
  };
}

export type LoadedMixProject = Awaited<ReturnType<typeof resolveMixProjectPaths>>;

export const serializeMixProject = (project: MixProject) => `${JSON5.stringify(project, null, 2)}\n`;

export const deserializeMixProject = (text: string) => parseMixProject(JSON5.parse(text));

export async function saveMixProject(deps: NodeDeps, projectFilePath: string, project: MixProject) {
  await deps.fs.writeFile(projectFilePath, serializeMixProject(toSavedMixProject(deps.path, projectFilePath, project)));
}

/** Throws if the file can't be read or isn't a valid project. Missing media files are reported, not thrown. */
export async function loadMixProject(deps: NodeDeps, projectFilePath: string): Promise<LoadedMixProject> {
  const project = deserializeMixProject(await deps.fs.readFile(projectFilePath, 'utf8'));
  return resolveMixProjectPaths(deps, deps.path.dirname(projectFilePath), project);
}
