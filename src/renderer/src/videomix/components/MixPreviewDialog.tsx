import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import * as Dialog from '../../components/Dialog';
import { DialogButton } from '../../components/Button';
import type { ShowGenericDialog } from '../../components/GenericDialog';

const { pathToFileURL } = window.require('@electron/remote').require('./index.js');

const videoStyle = { display: 'block', width: '100%', aspectRatio: '16 / 9', backgroundColor: 'black' };

/** Plays the low-resolution preview render (04-diseno §6.6). Content of a generic dialog (see showMixPreviewDialog). */
function MixPreviewDialog({ filePath }: { filePath: string }) {
  const { t } = useTranslation();

  return (
    <Dialog.Content aria-describedby={undefined} style={{ width: '80vw', maxWidth: '100em' }}>
      <Dialog.Title>{t('Mix preview')}</Dialog.Title>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video src={pathToFileURL(filePath).href} style={videoStyle} controls autoPlay />

      <Dialog.ButtonRow>
        <Dialog.Close asChild>
          <DialogButton primary>{t('Close')}</DialogButton>
        </Dialog.Close>
      </Dialog.ButtonRow>
    </Dialog.Content>
  );
}

const MemoMixPreviewDialog = memo(MixPreviewDialog);

export default MemoMixPreviewDialog;

/** Opens the preview in the app's generic dialog. `onClose` runs when it closes (remove the preview file). */
export function showMixPreviewDialog(showGenericDialog: ShowGenericDialog, { filePath, onClose }: { filePath: string, onClose: () => void }) {
  showGenericDialog({
    render: () => <MemoMixPreviewDialog filePath={filePath} />,
    onClose,
  });
}
