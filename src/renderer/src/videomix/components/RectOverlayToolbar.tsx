import type { ChangeEventHandler, CSSProperties } from 'react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MdRotate90DegreesCcw, MdRotate90DegreesCw } from 'react-icons/md';

import Button from '../../components/Button';
import Select from '../../components/Select';
import useActionTitle from '../../hooks/useActionTitle';
import { aspectPresets } from '../overlayMath';
import type { MixClipRotation } from '../types';

const FREE = 'free';

const rotateButtonStyle: CSSProperties = { display: 'flex', alignItems: 'center', fontSize: '1.1em' };

/** Aspect presets for the max rect and quick actions. `aspect` undefined means free. */
function RectOverlayToolbar({ aspect, hasMin, rotation, onAspectChange, onAddMin, onClearMin, onFillFrame, onRotate }: {
  aspect: number | undefined,
  hasMin: boolean,
  /** E9 (T38d): the clip's turn, and turning it by a delta (clockwise degrees). */
  rotation: MixClipRotation,
  onAspectChange: (newAspect: number | undefined) => void,
  onAddMin: () => void,
  onClearMin: () => void,
  onFillFrame: () => void,
  onRotate: (delta: number) => void,
}) {
  const { t } = useTranslation();
  const actionTitle = useActionTitle();

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

      {/* E9 (T38d): turn the clip, the rects turn with the picture */}
      <Button data-testid="rotate-clip-ccw" onClick={() => onRotate(-90)} title={actionTitle(t('Rotate −90°'), 'rotateClipCounterclockwise')} style={rotateButtonStyle}><MdRotate90DegreesCcw /></Button>
      <Button data-testid="rotate-clip-cw" onClick={() => onRotate(90)} title={actionTitle(t('Rotate +90°'), 'rotateClipClockwise')} style={rotateButtonStyle}><MdRotate90DegreesCw /></Button>
      <Button data-testid="rotate-clip-180" onClick={() => onRotate(180)} title={actionTitle(t('Rotate 180°'), 'rotateClip180')}>180°</Button>
      {rotation !== 0 && <span data-testid="clip-rotation" title={t('Rotated {{degrees}}°', { degrees: rotation })}>{`${rotation}°`}</span>}
    </div>
  );
}

export default memo(RectOverlayToolbar);
