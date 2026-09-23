import i18n from 'i18next';

import getSwal from '../swal';

export type UnsavedChangesResponse = 'save' | 'discard' | 'cancel';

export async function askForUnsavedChanges(): Promise<UnsavedChangesResponse> {
  const { isConfirmed, isDenied } = await getSwal().Swal.fire({
    icon: 'warning',
    title: i18n.t('Unsaved changes'),
    text: i18n.t('The project has unsaved changes. Do you want to save them?'),
    showDenyButton: true,
    showCancelButton: true,
    confirmButtonText: i18n.t('Save'),
    denyButtonText: i18n.t('Discard'),
    cancelButtonText: i18n.t('Cancel'),
  });
  if (isConfirmed) return 'save';
  if (isDenied) return 'discard';
  return 'cancel';
}

export type RecoverProjectResponse = 'restore' | 'discard' | 'later';

/** Offered at startup for each recovery file left by a previous session (e.g. after a crash). */
export async function askForRecoverProject({ projectName, savedAt, numSources, numClips }: {
  projectName: string,
  savedAt: number,
  numSources: number,
  numClips: number,
}): Promise<RecoverProjectResponse> {
  const { isConfirmed, isDenied } = await getSwal().Swal.fire({
    icon: 'question',
    title: i18n.t('Restore unsaved project?'),
    text: i18n.t('A previous session left unsaved changes in project "{{projectName}}" ({{numSources}} sources, {{numClips}} clips, {{date}}). Do you want to restore them?', {
      projectName, numSources, numClips, date: new Date(savedAt).toLocaleString(),
    }),
    showDenyButton: true,
    showCancelButton: true,
    confirmButtonText: i18n.t('Restore'),
    denyButtonText: i18n.t('Discard'),
    cancelButtonText: i18n.t('Later'),
  });
  if (isConfirmed) return 'restore';
  if (isDenied) return 'discard';
  return 'later';
}

/** Name of a new overlay style preset (T26). Undefined if cancelled. */
export async function askForStylePresetName(defaultName: string): Promise<string | undefined> {
  const { value } = await getSwal().Swal.fire<string>({
    title: i18n.t('Save style'),
    text: i18n.t('The style can then be applied to other overlays of the same type, in any project.'),
    input: 'text',
    inputValue: defaultName,
    showCancelButton: true,
    confirmButtonText: i18n.t('Save'),
    cancelButtonText: i18n.t('Cancel'),
    inputValidator: (v) => (v.trim() === '' ? i18n.t('Enter a name') : null),
  });
  return value != null ? value.trim() : undefined;
}
