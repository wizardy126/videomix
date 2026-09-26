import type fsPromises from 'node:fs/promises';

import type { MixOverlay, OverlayFile } from '../types';
import { getOverlayFiles, pathExists, toProjectRelativePath } from '../projectFile';
import type { OverlayFileKind, PathApi } from '../projectFile';
import { createVmxBlockFile, parseVmxBlockFile, serializeVmxBlockFile, vmxBlockExtension } from './vmxBlockFile';
import type { VmxBlockExport, VmxBlockTemplate } from './vmxBlockFile';

// Files of the `.vmxblock` templates (H2, H3, T58): writing one ("Include files" copies the user files into a folder
// next to it), reading one (paths relative to it, missing files), and the template library (a folder of `.vmxblock`
// files). Node modules are passed in, like projectFile.ts, so this is tested with vitest in Node.

export type BlockFsApi = Pick<typeof fsPromises, 'readFile' | 'writeFile' | 'mkdir' | 'readdir' | 'access' | 'copyFile'>;

export interface BlockFileDeps {
  path: PathApi,
  fs: BlockFsApi,
}

const extensionSuffix = `.${vmxBlockExtension}`;

/** `name.vmxblock` → `name` (any other name is kept). */
export const getVmxBlockBaseName = (path: Pick<PathApi, 'basename'>, blockFilePath: string) => {
  const base = path.basename(blockFilePath);
  return base.toLowerCase().endsWith(extensionSuffix) ? base.slice(0, -extensionSuffix.length) : base;
};

/** "Include files": the folder next to the `.vmxblock` the user files are copied into (`<name>_files`, like a saved web page). */
export const getIncludedFilesDirName = (path: Pick<PathApi, 'basename'>, blockFilePath: string) => `${getVmxBlockBaseName(path, blockFilePath)}_files`;

/** `name` → `name (2)`… before the extension, until `isFree`. */
export function getUniqueFileName(fileName: string, isFree: (name: string) => boolean) {
  if (isFree(fileName)) return fileName;
  const dot = fileName.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [fileName.slice(0, dot), fileName.slice(dot)] : [fileName, ''];
  for (let i = 2; ; i += 1) {
    const candidate = `${stem} (${i})${ext}`;
    if (isFree(candidate)) return candidate;
  }
}

/** The distinct user files of some overlays (by absolute path in use), with their kind. */
export function getUserFiles(members: readonly MixOverlay[]) {
  const byPath = new Map<string, { kind: OverlayFileKind, file: OverlayFile }>();
  for (const member of members) {
    for (const entry of getOverlayFiles(member)) {
      if (!byPath.has(entry.file.path)) byPath.set(entry.file.path, entry);
    }
  }
  return [...byPath.values()];
}

/** What "Export selection" and "Save to library" act on: a block, or loose overlays (grouped into one on export). */
export type BlockTemplateSelection = { blockId: string } | { overlayIds: string[] };

/** One block, or loose overlays only (blocks can't be nested, so a block with other things isn't a template). */
export function getTemplateSelection(blockIds: readonly string[], overlayIds: readonly string[]): BlockTemplateSelection | undefined {
  if (blockIds.length === 1 && overlayIds.length === 0) return { blockId: blockIds[0]! };
  if (blockIds.length === 0 && overlayIds.length > 0) return { overlayIds: [...overlayIds] };
  return undefined;
}

export interface VmxBlockFileCopy { from: string, to: string }

/**
 * Where each user file of `members` goes in a `.vmxblock` saved at `blockFilePath`: with `includeFiles`, a copy into
 * the `<name>_files` folder next to it (distinct files with the same name get `name (2).png`…); without, the file where
 * it is, stored relative to the `.vmxblock` (or absolute, e.g. on another Windows drive). `toFilePath` is for
 * `createVmxBlockFile`.
 */
export function planVmxBlockFiles(path: PathApi, { blockFilePath, members, includeFiles }: {
  blockFilePath: string,
  members: readonly MixOverlay[],
  includeFiles: boolean,
}): { copies: VmxBlockFileCopy[], toFilePath: (file: OverlayFile) => string } {
  const baseDir = path.dirname(blockFilePath);
  if (!includeFiles) return { copies: [], toFilePath: (file) => toProjectRelativePath(path, baseDir, file.path) };

  const dirName = getIncludedFilesDirName(path, blockFilePath);
  const names = new Map<string, string>();
  const used = new Set<string>();
  const copies: VmxBlockFileCopy[] = [];
  for (const { file } of getUserFiles(members)) {
    // case-insensitive, so the copies don't overwrite each other on Windows/macOS
    const name = getUniqueFileName(path.basename(file.path), (n) => !used.has(n.toLowerCase()));
    used.add(name.toLowerCase());
    names.set(file.path, name);
    copies.push({ from: file.path, to: path.join(baseDir, dirName, name) });
  }
  return {
    copies,
    toFilePath: (file) => {
      const name = names.get(file.path);
      return name != null ? `${dirName}/${name}` : toProjectRelativePath(path, baseDir, file.path);
    },
  };
}

/** Some files to include in a `.vmxblock` don't exist: nothing was written. */
export class MissingVmxBlockFilesError extends Error {
  missing: string[];

  constructor(missing: string[]) {
    super(`Files not found: ${missing.join(', ')}`);
    this.name = 'MissingVmxBlockFilesError';
    this.missing = missing;
  }
}

/**
 * Writes the `.vmxblock` of `data` at `blockFilePath` (copying its files first with `includeFiles`). Throws before
 * writing anything if a file to include doesn't exist (`missing` of the error).
 */
export async function writeVmxBlockFile({ path, fs }: BlockFileDeps, { blockFilePath, data, includeFiles }: {
  blockFilePath: string,
  data: VmxBlockExport,
  includeFiles: boolean,
}) {
  const { copies, toFilePath } = planVmxBlockFiles(path, { blockFilePath, members: data.def.members, includeFiles });
  const missing: string[] = [];
  for (const { from } of copies) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await pathExists(fs, from))) missing.push(from);
  }
  if (missing.length > 0) throw new MissingVmxBlockFilesError(missing);
  if (copies.length > 0) await fs.mkdir(path.join(path.dirname(blockFilePath), getIncludedFilesDirName(path, blockFilePath)), { recursive: true });
  for (const { from, to } of copies) {
    // eslint-disable-next-line no-await-in-loop
    if (from !== to) await fs.copyFile(from, to);
  }
  const file = createVmxBlockFile({ ...data, toFilePath });
  await fs.writeFile(blockFilePath, serializeVmxBlockFile(file));
  return { file, copies };
}

/** A stored path of a `.vmxblock` (relative to it, or absolute) as an overlay file (both paths absolute). */
export function resolveVmxBlockFilePath(path: PathApi, blockFilePath: string, stored: string): OverlayFile {
  const absolute = path.isAbsolute(stored) ? stored : path.resolve(path.dirname(blockFilePath), stored);
  return { path: absolute, absolutePath: absolute };
}

/** Reads and parses a `.vmxblock` (throws `VmxBlockParseError` if it's not valid; nothing is imported then). */
export async function readVmxBlockFile({ path, fs }: BlockFileDeps, blockFilePath: string): Promise<VmxBlockTemplate> {
  const text = await fs.readFile(blockFilePath, 'utf8');
  return parseVmxBlockFile(text, { resolveFile: (stored) => resolveVmxBlockFilePath(path, blockFilePath, stored) });
}

/** The user files of a template that don't exist, by path (each one once, whatever the number of members using it). */
export async function findMissingTemplateFiles(fs: Pick<BlockFsApi, 'access'>, template: Pick<VmxBlockTemplate, 'members'>) {
  const files = getUserFiles(template.members);
  const exists = await Promise.all(files.map(async ({ file }) => pathExists(fs, file.path)));
  return files.filter((_f, i) => !exists[i]).map(({ kind, file }) => ({ kind, path: file.path }));
}

/** "Locate…" a missing file of a template: every member using `oldPath` gets `newPath`. */
export function relinkTemplateFile<T extends Pick<VmxBlockTemplate, 'members'>>(template: T, oldPath: string, newPath: string): T {
  const relink = (file: OverlayFile): OverlayFile => (file.path === oldPath ? { path: newPath, absolutePath: newPath } : file);
  return {
    ...template,
    members: template.members.map((member): MixOverlay => {
      if (member.type === 'image' || member.type === 'sound') return { ...member, ...relink(member) };
      if ((member.type === 'countdown' || member.type === 'text') && member.font != null) return { ...member, font: relink(member.font) };
      return member;
    }),
  };
}

// ---- library (H3)

/** Folder of the template library, in the app's user data. */
export const BLOCK_LIBRARY_DIR_NAME = 'block-library';

export const getBlockLibraryDir = (path: Pick<PathApi, 'join'>, userDataDir: string) => path.join(userDataDir, BLOCK_LIBRARY_DIR_NAME);

/** A block name as a file name (characters Windows doesn't allow replaced; never empty). */
export function toBlockFileName(name: string) {
  // eslint-disable-next-line no-control-regex
  const safe = name.replaceAll(/[<>:"/\\|?*\u0000-\u001F]/g, '_').replace(/[. ]+$/, '').trim();
  return `${safe !== '' ? safe : 'Block'}${extensionSuffix}`;
}

/** Where "Save to library" writes a block: its name, made unique in the library. */
export async function getNewLibraryFilePath({ path, fs }: BlockFileDeps, libraryDir: string, name: string) {
  const existing = new Set((await fs.readdir(libraryDir).catch(() => [] as string[])).map((n) => n.toLowerCase()));
  // the "_files" folder of the name must be free too
  const fileName = getUniqueFileName(toBlockFileName(name), (n) => !existing.has(n.toLowerCase()) && !existing.has(getIncludedFilesDirName(path, n).toLowerCase()));
  return path.join(libraryDir, fileName);
}

export type BlockLibraryEntry =
  | { filePath: string, fileName: string, template: VmxBlockTemplate, error?: undefined }
  /** A file that isn't a valid block: listed with its problem, so the user can fix it. */
  | { filePath: string, fileName: string, template?: undefined, error: string };

/** The `.vmxblock` files of the library folder (sorted by name; none if it doesn't exist yet). */
export async function listBlockLibrary(deps: BlockFileDeps, libraryDir: string): Promise<BlockLibraryEntry[]> {
  const { path, fs } = deps;
  let names: string[];
  try {
    names = await fs.readdir(libraryDir);
  } catch {
    return [];
  }
  const blockNames = names.filter((n) => n.toLowerCase().endsWith(extensionSuffix)).sort((a, b) => a.localeCompare(b));
  return Promise.all(blockNames.map(async (fileName): Promise<BlockLibraryEntry> => {
    const filePath = path.join(libraryDir, fileName);
    try {
      return { filePath, fileName, template: await readVmxBlockFile(deps, filePath) };
    } catch (err) {
      return { filePath, fileName, error: err instanceof Error ? err.message : String(err) };
    }
  }));
}
