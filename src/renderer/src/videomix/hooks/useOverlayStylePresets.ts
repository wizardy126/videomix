import { useCallback, useState } from 'react';
import { nanoid } from 'nanoid';
import i18n from 'i18next';

import { showOpenDialog } from '../../dialogs';
import type { WithErrorHandling } from '../../hooks/useErrorHandling';
import { UserFacingError } from '../../../errors';
import type { OverlayStylePreset } from '../../../../common/videomix/overlayStyles';
import { parseStylePresetsFile, sanitizeStylePresets, serializeStylePresets } from '../overlayStylePresets';

const remote = window.require('@electron/remote');
const { configStore } = remote.require('./index.js');
const { readFile, writeFile } = window.require('node:fs/promises');

const CONFIG_KEY = 'overlayStylePresets';

function readPresets() {
  try {
    return sanitizeStylePresets(configStore.get(CONFIG_KEY));
  } catch (err) {
    console.error('Failed to read the style presets', err);
    return [];
  }
}

/**
 * Global style presets of the overlays (B2, T26), stored in the app config by main (`overlayStylePresets`). Every change
 * is saved at once (they don't belong to the project, so they aren't undoable). Export/import to a JSON file.
 */
export default function useOverlayStylePresets({ withErrorHandling }: { withErrorHandling: WithErrorHandling }) {
  const [presets, setPresetsState] = useState<OverlayStylePreset[]>(readPresets);

  const save = useCallback((newPresets: OverlayStylePreset[]) => {
    setPresetsState(newPresets);
    try {
      configStore.set(CONFIG_KEY, newPresets);
    } catch (err) {
      console.error('Failed to save the style presets', err);
      throw new UserFacingError(i18n.t('Unable to save your preferences. Try to disable any anti-virus'));
    }
  }, []);

  // Always from the stored list, so two panels (or a panel and the dialog) never overwrite each other's changes
  const update = useCallback((fn: (current: OverlayStylePreset[]) => OverlayStylePreset[]) => save(fn(readPresets())), [save]);

  const addPreset = useCallback((preset: OverlayStylePreset) => update((current) => [...current, preset]), [update]);
  const renamePreset = useCallback((id: string, name: string) => update((current) => current.map((p) => (p.id === id ? { ...p, name } : p))), [update]);
  const removePreset = useCallback((id: string) => update((current) => current.filter((p) => p.id !== id)), [update]);

  const userExportPresets = useCallback(async () => {
    await withErrorHandling(async () => {
      const { canceled, filePath } = await remote.dialog.showSaveDialog({ title: i18n.t('Export styles'), defaultPath: 'videomix-styles.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (canceled || filePath == null) return;
      await writeFile(filePath, serializeStylePresets(readPresets()));
    }, i18n.t('Failed to export the styles'));
  }, [withErrorHandling]);

  /** Adds the presets of a file to the list. Returns how many were imported. */
  const userImportPresets = useCallback(async () => {
    let imported = 0;
    await withErrorHandling(async () => {
      const { canceled, filePaths } = await showOpenDialog({ title: i18n.t('Import styles'), properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
      const [filePath] = filePaths;
      if (canceled || filePath == null) return;
      const text: string = await readFile(filePath, 'utf8');
      let parsed: ReturnType<typeof parseStylePresetsFile>;
      try {
        parsed = parseStylePresetsFile(text, readPresets(), nanoid);
      } catch (err) {
        console.warn('Not a styles file', err);
        throw new UserFacingError(i18n.t('This file doesn\'t contain VideoMix styles'));
      }
      update((current) => [...current, ...parsed.presets]);
      imported = parsed.presets.length;
    }, i18n.t('Failed to import the styles'));
    return imported;
  }, [update, withErrorHandling]);

  return { presets, addPreset, renamePreset, removePreset, userExportPresets, userImportPresets };
}

export type UseOverlayStylePresets = ReturnType<typeof useOverlayStylePresets>;
