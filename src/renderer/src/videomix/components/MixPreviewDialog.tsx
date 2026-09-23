import type { ReactEventHandler } from 'react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import * as Dialog from '../../components/Dialog';
import { DialogButton } from '../../components/Button';
import type { ShowGenericDialog } from '../../components/GenericDialog';

const { pathToFileURL } = window.require('@electron/remote').require('./index.js');

/** The video fits in this height, so a vertical (9:16) or square preview is shown whole (T29). */
const MAX_VIDEO_HEIGHT = '75vh';

/** Plays the low-resolution preview render (04-diseno §6.6). Content of a generic dialog (see showMixPreviewDialog). */
function MixPreviewDialog({ filePath }: { filePath: string }) {
  const { t } = useTranslation();
  // 16:9 until the video tells its size: the output may be vertical or square
  const [aspect, setAspect] = useState(16 / 9);

  const handleLoadedMetadata = useCallback<ReactEventHandler<HTMLVideoElement>>((e) => {
    const { videoWidth, videoHeight } = e.currentTarget;
    if (videoWidth > 0 && videoHeight > 0) setAspect(videoWidth / videoHeight);
  }, []);

  return (
    <Dialog.Content aria-describedby={undefined} style={{ width: `min(80vw, calc(${MAX_VIDEO_HEIGHT} * ${aspect} + 3em))`, maxWidth: '100em' }}>
      <Dialog.Title>{t('Mix preview')}</Dialog.Title>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video src={pathToFileURL(filePath).href} style={{ display: 'block', width: '100%', aspectRatio: aspect, maxHeight: MAX_VIDEO_HEIGHT, backgroundColor: 'black' }} controls autoPlay onLoadedMetadata={handleLoadedMetadata} />

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
