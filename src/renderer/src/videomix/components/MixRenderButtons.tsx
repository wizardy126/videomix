import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { FaCog, FaEye, FaFileExport } from 'react-icons/fa';

import { primaryColor } from '../../colors';
import { withBlur } from '../../util';
import useActionTitle from '../../hooks/useActionTitle';
import styles from '../../components/ExportButton.module.css';

const iconStyle = { verticalAlign: 'middle', marginRight: '.2em' };
const secondaryStyle = { backgroundColor: 'var(--gray-9)', marginRight: '.4em' };

/** VideoMix replacement of LosslessCut's Export button in the bottom bar: mix settings, preview and render. */
function MixRenderButtons({ onSettings, onPreview, onRender, disabled }: {
  onSettings: () => void,
  onPreview: () => void,
  onRender: () => void,
  /** No clips yet. */
  disabled: boolean,
}) {
  const { t } = useTranslation();
  const actionTitle = useActionTitle();
  const disabledStyle = disabled ? { opacity: 0.5, cursor: 'default' } : undefined;

  return (
    <div style={{ display: 'flex', alignItems: 'center', marginLeft: '.4em' }}>
      <button type="button" className={styles['exportButton']} style={secondaryStyle} onClick={withBlur(onSettings)} title={actionTitle(t('Mix settings'), 'showMixSettings')}>
        <FaCog style={iconStyle} />{t('Settings')}
      </button>
      <button type="button" className={styles['exportButton']} style={{ ...secondaryStyle, ...disabledStyle }} onClick={withBlur(onPreview)} disabled={disabled} title={actionTitle(t('Render a quick low-resolution preview of the mix'), 'previewMix')}>
        <FaEye style={iconStyle} />{t('Preview')}
      </button>
      <button type="button" className={styles['exportButton']} style={{ backgroundColor: primaryColor, ...disabledStyle }} onClick={withBlur(onRender)} disabled={disabled} title={actionTitle(t('Render the mix to an MP4 file'), 'renderMix')}>
        <FaFileExport style={iconStyle} />{t('Render')}
      </button>
    </div>
  );
}

export default memo(MixRenderButtons);
