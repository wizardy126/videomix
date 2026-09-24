import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { FaCog, FaEye, FaFileExport } from 'react-icons/fa';

import { primaryColor, dangerColor } from '../../colors';
import { withBlur } from '../../util';
import useActionTitle from '../../hooks/useActionTitle';
import styles from '../../components/ExportButton.module.css';
import { exceedsMaxDuration, formatEstimatedDuration, formatMaxDuration } from '../durationEstimate';
import type { MixDurationEstimate } from '../hooks/useMixDuration';

const iconStyle = { verticalAlign: 'middle', marginRight: '.2em' };
const secondaryStyle = { backgroundColor: 'var(--gray-9)', marginRight: '.4em' };

/**
 * VideoMix replacement of LosslessCut's Export button in the bottom bar: mix settings, preview, render and the
 * estimated duration (E3), highlighted with the cut point when it goes over the project's maximum duration (E4).
 */
function MixRenderButtons({ onSettings, onPreview, onRender, disabled, estimate, maxDuration }: {
  onSettings: () => void,
  onPreview: () => void,
  onRender: () => void,
  /** No clips yet. */
  disabled: boolean,
  estimate: MixDurationEstimate,
  /** The project's duration limit (`settings.maxDuration`, T36), if any. */
  maxDuration: number | undefined,
}) {
  const { t } = useTranslation();
  const actionTitle = useActionTitle();
  const disabledStyle = disabled ? { opacity: 0.5, cursor: 'default' } : undefined;

  const estimateLabel = formatEstimatedDuration(estimate.duration);
  const exceeds = exceedsMaxDuration(estimate.duration, maxDuration);

  return (
    <div style={{ display: 'flex', alignItems: 'center', marginLeft: '.4em' }}>
      {estimateLabel != null && (
        <span
          data-testid="mix-duration-estimate"
          title={t('{{count}} clips', { count: estimate.clipCount })}
          style={{ marginRight: '.6em', whiteSpace: 'nowrap', fontFamily: 'monospace', color: exceeds ? dangerColor : 'var(--gray-11)' }}
        >
          {estimateLabel}
          {exceeds && maxDuration != null && (
            <span style={{ marginLeft: '.4em' }}>→ {t('cut at {{time}}', { time: formatMaxDuration(maxDuration) })}</span>
          )}
        </span>
      )}
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
