import type { ChangeEventHandler } from 'react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import Button from '../../components/Button';
import Select from '../../components/Select';
import { aspectPresets } from '../overlayMath';

const FREE = 'free';

/** Aspect presets for the max rect and quick actions. `aspect` undefined means free. */
function RectOverlayToolbar({ aspect, hasMin, onAspectChange, onAddMin, onClearMin, onFillFrame }: {
  aspect: number | undefined,
  hasMin: boolean,
  onAspectChange: (newAspect: number | undefined) => void,
  onAddMin: () => void,
  onClearMin: () => void,
  onFillFrame: () => void,
}) {
  const { t } = useTranslation();

  const selected = aspectPresets.find(({ value }) => value === aspect)?.label ?? FREE;

  const handleAspectChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    e.target.blur();
    onAspectChange(aspectPresets.find(({ label }) => label === e.target.value)?.value);
  }, [onAspectChange]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.5em', padding: '.3em .5em', borderRadius: '.3em', background: 'var(--black-a9)', color: 'var(--gray-12)', fontSize: '.9em' }}>
      <span>{t('Max aspect ratio')}</span>
      <Select value={selected} onChange={handleAspectChange}>
        <option value={FREE}>{t('Free')}</option>
        {aspectPresets.map(({ label }) => <option key={label} value={label}>{label}</option>)}
      </Select>

      {hasMin ? (
        <Button onClick={onClearMin} title={t('Remove the min rectangle (min = max)')}>{t('Min = Max')}</Button>
      ) : (
        <Button onClick={onAddMin} title={t('Define a min rectangle: the area that must always be visible')}>{t('Add min')}</Button>
      )}

      <Button onClick={onFillFrame}>{t('Fill frame')}</Button>
    </div>
  );
}

export default memo(RectOverlayToolbar);
