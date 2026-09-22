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
