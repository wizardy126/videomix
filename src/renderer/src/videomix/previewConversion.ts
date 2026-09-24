import type { PathLike } from './render/renderOutput';
import { sha256Hex } from './render/renderCache';

// T42: the files that html5ify makes so the player can show a source it doesn't support (preview only, never used by
// the render) go into the saved project's cache folder instead of next to the source.

/** Subfolder of the project cache root (`.<name>.vmx.cache`) with the converted previews. */
export const PREVIEW_CONVERSION_DIR_NAME = 'converted';

/**
 * Folder for the converted previews of one source: `<cacheRoot>/converted/<short hash of its absolute path>`.
 * One folder per source, so two sources with the same file name in different folders don't collide (the converted
 * file name is derived from the source file name). The render cache pruning only looks at the files directly inside
 * the subfolders of the cache root, so it never counts or removes these.
 */
export async function getPreviewConversionDir(path: PathLike, cacheRoot: string, sourceAbsolutePath: string) {
  const hash = (await sha256Hex(sourceAbsolutePath)).slice(0, 16);
  return path.join(cacheRoot, PREVIEW_CONVERSION_DIR_NAME, hash);
}
