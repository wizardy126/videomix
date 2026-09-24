import { useCallback } from 'react';

import { findExistingHtml5FriendlyFile } from '../../util';
import { getProjectCacheRoot } from '../render/renderCache';
import { getPreviewConversionDir } from '../previewConversion';

const path = window.require('node:path');
const fs = window.require('node:fs/promises');

/**
 * T42: with a saved project, the files that html5ify makes for the preview of a source live in the project cache
 * (`.<name>.vmx.cache/converted/<hash>/`). Without a saved project (or outside VideoMix) every function returns
 * undefined, and the inherited LosslessCut behaviour (next to the source, or in `customOutDir`) applies.
 */
export default function usePreviewConversion({ enabled, getProjectPath }: {
  enabled: boolean,
  /** Reads a ref: right after opening a project its first source is loaded before the next render. */
  getProjectPath: () => string | undefined,
}) {
  const getConversionDir = useCallback(async (filePath: string) => {
    const projectPath = getProjectPath();
    if (!enabled || projectPath == null) return undefined;
    return getPreviewConversionDir(path, getProjectCacheRoot(path, projectPath), filePath);
  }, [enabled, getProjectPath]);

  /** Output folder for converting `filePath`, created if needed. If it can't be created, the inherited location is used. */
  const ensureConversionOutDir = useCallback(async (filePath: string) => {
    const dir = await getConversionDir(filePath);
    if (dir == null) return undefined;
    try {
      await fs.mkdir(dir, { recursive: true });
      return dir;
    } catch (err) {
      console.warn('Failed to create the preview conversion folder, converting to the default location', dir, err);
      return undefined;
    }
  }, [getConversionDir]);

  /** A converted preview of `filePath` already in the project cache (undefined if none, or no saved project). */
  const findExistingConvertedFile = useCallback(async (filePath: string) => {
    const dir = await getConversionDir(filePath);
    if (dir == null) return undefined;
    try {
      await fs.access(dir);
    } catch {
      return undefined;
    }
    return findExistingHtml5FriendlyFile(filePath, dir);
  }, [getConversionDir]);

  return { ensureConversionOutDir, findExistingConvertedFile };
}
