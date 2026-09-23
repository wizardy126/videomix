import type { ChangeEventHandler, CSSProperties } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FaFileExport, FaFileImport, FaSave, FaTrash } from 'react-icons/fa';
import { nanoid } from 'nanoid';

import * as Dialog from '../../components/Dialog';
import { DialogButton } from '../../components/Button';
import Select from '../../components/Select';
import type { OverlayStylePreset, OverlayStylePresetType } from '../../../../common/videomix/overlayStyles';
import type { MixOverlayPatch } from '../projectReducer';
import { askForStylePresetName } from '../dialogs';
import { createStylePreset, getStylePresetPatch } from '../overlayStylePresets';
import type { StyledOverlay } from '../overlayStylePresets';
import { getOverlayTypeLabel } from '../overlayTexts';
import useOverlayStylePresets from '../hooks/useOverlayStylePresets';
import type { WithErrorHandling } from '../../hooks/useErrorHandling';

// Style presets in the properties panel (B2, T26): apply one of the overlay's type, save the overlay's style as a new
// one, and a dialog to rename, delete, export and import them. They are global (app config), not part of the project.

const buttonStyle: CSSProperties = { font: 'inherit', fontSize: '.8em', padding: '.2em .4em', border: '1px solid var(--gray-7)', borderRadius: '.3em', background: 'var(--gray-3)', color: 'var(--gray-12)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '.3em' };
const inputStyle: CSSProperties = { font: 'inherit', fontSize: '.9em', flexGrow: 1, minWidth: 0, background: 'var(--gray-3)', color: 'var(--gray-12)', border: '1px solid var(--gray-7)', borderRadius: '.3em', padding: '.15em .4em' };
const presetTypes: OverlayStylePresetType[] = ['text', 'countdown', 'progressBar'];

/** A preset's name, renamed on blur or Enter (Escape reverts). */
// eslint-disable-next-line react/display-name
const PresetRow = memo(({ preset, onRename, onRemove }: { preset: OverlayStylePreset, onRename: (id: string, name: string) => void, onRemove: (id: string) => void }) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string>();
  const commit = useCallback(() => {
    if (draft != null && draft.trim() !== '' && draft !== preset.name) onRename(preset.id, draft.trim());
    setDraft(undefined);
  }, [draft, onRename, preset.id, preset.name]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.4em', marginBottom: '.3em' }}>
      <input
        style={inputStyle}
        value={draft ?? preset.name}
        title={t('Name')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(undefined); }}
      />
      <button type="button" style={buttonStyle} title={t('Delete')} onClick={() => onRemove(preset.id)}><FaTrash /></button>
    </div>
  );
});

function OverlayStylePresets({ overlay, withErrorHandling, onApply }: {
  overlay: StyledOverlay,
  withErrorHandling: WithErrorHandling,
  onApply: (patch: MixOverlayPatch) => void,
}) {
  const { t } = useTranslation();
  const { presets, addPreset, renamePreset, removePreset, userExportPresets, userImportPresets } = useOverlayStylePresets({ withErrorHandling });
  const [manageOpen, setManageOpen] = useState(false);
  const [importedCount, setImportedCount] = useState<number>();

  const ofType = useMemo(() => presets.filter((p) => p.type === overlay.type), [overlay.type, presets]);

  const handleApply = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    const preset = ofType.find((p) => p.id === e.target.value);
    const patch = preset != null ? getStylePresetPatch(overlay, preset) : undefined;
    if (patch != null) onApply(patch);
  }, [ofType, onApply, overlay]);

  const handleSave = useCallback(async () => {
    await withErrorHandling(async () => {
      const name = await askForStylePresetName(overlay.name);
      if (name == null) return;
      addPreset(createStylePreset(overlay, { id: nanoid(), name }));
    }, t('Failed to save the style'));
  }, [addPreset, overlay, t, withErrorHandling]);

  const handleImport = useCallback(async () => setImportedCount(await userImportPresets()), [userImportPresets]);

  const handleManageOpenChange = useCallback((open: boolean) => {
    setManageOpen(open);
    setImportedCount(undefined);
  }, []);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.3em', marginBottom: '.35em', flexWrap: 'wrap' }}>
        {/* value "": always shows the placeholder, applying is an action, not a state */}
        <Select style={{ fontSize: '.8em', maxWidth: '100%' }} value="" onChange={handleApply} disabled={ofType.length === 0} title={ofType.length === 0 ? t('No saved styles for this type yet') : undefined}>
          <option value="">{t('Apply style…')}</option>
          {ofType.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.3em', marginBottom: '.35em', flexWrap: 'wrap' }}>
        <button type="button" style={buttonStyle} onClick={handleSave} title={t('Saves the colors, font, border, shadow, fades and animation (not the position, times or text)')}><FaSave />{t('Save style…')}</button>
        <button type="button" style={buttonStyle} onClick={() => handleManageOpenChange(true)}>{t('Manage styles…')}</button>
      </div>

      <Dialog.Root open={manageOpen} onOpenChange={handleManageOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content style={{ width: '30em', maxHeight: '85vh', overflowY: 'auto' }} aria-describedby={undefined}>
            <Dialog.Title>{t('Styles')}</Dialog.Title>
            <div style={{ fontSize: '.85em', opacity: 0.75, marginBottom: '1em' }}>{t('Saved styles are shared by all your projects.')}</div>
            {presets.length === 0 && <div style={{ opacity: 0.75, marginBottom: '1em' }}>{t('No saved styles yet. Use "Save style…" in the properties of a text, countdown or progress bar.')}</div>}
            {presetTypes.map((type) => {
              const list = presets.filter((p) => p.type === type);
              if (list.length === 0) return null;
              return (
                <div key={type} style={{ marginBottom: '1em' }}>
                  <h4 style={{ margin: '0 0 .4em 0', borderBottom: '1px solid var(--gray-6)', paddingBottom: '.2em' }}>{getOverlayTypeLabel(type)}</h4>
                  {list.map((preset) => <PresetRow key={preset.id} preset={preset} onRename={renamePreset} onRemove={removePreset} />)}
                </div>
              );
            })}
            {importedCount != null && <div style={{ fontSize: '.85em', marginBottom: '.5em' }}>{t('{{count}} style(s) imported', { count: importedCount })}</div>}
            <div style={{ display: 'flex', gap: '.5em', flexWrap: 'wrap' }}>
              <button type="button" style={buttonStyle} onClick={userExportPresets} disabled={presets.length === 0}><FaFileExport />{t('Export…')}</button>
              <button type="button" style={buttonStyle} onClick={handleImport}><FaFileImport />{t('Import…')}</button>
            </div>
            <Dialog.ButtonRow>
              <Dialog.Close asChild>
                <DialogButton primary>{t('Done')}</DialogButton>
              </Dialog.Close>
            </Dialog.ButtonRow>
            <Dialog.CloseButton />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

export default memo(OverlayStylePresets);
