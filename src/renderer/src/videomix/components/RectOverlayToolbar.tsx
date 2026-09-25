import type { ChangeEventHandler, CSSProperties } from 'react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MdRotate90DegreesCcw, MdRotate90DegreesCw } from 'react-icons/md';
import { FaMagnet } from 'react-icons/fa';

import Button from '../../components/Button';
import Select from '../../components/Select';
import useActionTitle from '../../hooks/useActionTitle';
import { aspectPresets } from '../overlayMath';
import type { MixClipRotation } from '../types';
import { snapFractions } from '../fitFractions';
import type { FitFraction } from '../fitFractions';

const FREE = 'free';

const rotateButtonStyle: CSSProperties = { display: 'flex', alignItems: 'center', fontSize: '1.1em' };
const magnetButtonStyle: CSSProperties = { display: 'flex', alignItems: 'center' };
const magnetOnStyle: CSSProperties = { ...magnetButtonStyle, color: 'white', backgroundColor: 'var(--cyan-9)', borderColor: 'var(--cyan-11)' };

/** Aspect presets for the max rect and quick actions. `aspect` undefined means free. */
function RectOverlayToolbar({ aspect, hasMin, rotation, magnet, onAspectChange, onAddMin, onClearMin, onFillFrame, onRotate, onToggleMagnet, onFitTo, onRemoveBlackBars }: {
  aspect: number | undefined,
  hasMin: boolean,
  /** E9 (T38d): the clip's turn, and turning it by a delta (clockwise degrees). */
  rotation: MixClipRotation,
  /** F2 (T45): the magnet toggle (an app preference). */
  magnet: boolean,
  onAspectChange: (newAspect: number | undefined) => void,
  onAddMin: () => void,
  onClearMin: () => void,
  onFillFrame: () => void,
  onRotate: (delta: number) => void,
  onToggleMagnet: () => void,
  /** F2: "Fit to" a fraction (one undo step). */
  onFitTo: (fraction: FitFraction) => void,
  /** A7 (T47): analyzes the clip's range and cuts the max (and the min) to the picture found, one undo step. */
  onRemoveBlackBars: () => void,
}) {
  const { t } = useTranslation();
  const actionTitle = useActionTitle();

  const selected = aspectPresets.find(({ value }) => value === aspect)?.label ?? FREE;

  const handleAspectChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    e.target.blur();
    onAspectChange(aspectPresets.find(({ label }) => label === e.target.value)?.value);
  }, [onAspectChange]);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.5em', whiteSpace: 'nowrap', padding: '.3em .5em', borderRadius: '.3em', background: 'var(--black-a9)', color: 'var(--gray-12)', fontSize: '.9em' }}>
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

      {/* A7 (T47): analyzes the clip's range and cuts the max (and the min) to the picture found */}
      <Button data-testid="remove-black-bars" onClick={onRemoveBlackBars} title={t('Analyze this clip\'s range and cut the max to the picture found (the min is cut to stay inside it)')}>{t('Remove black bars')}</Button>

      {/* E9 (T38d): turn the clip, the rects turn with the picture */}
      <Button data-testid="rotate-clip-ccw" onClick={() => onRotate(-90)} title={actionTitle(t('Rotate −90°'), 'rotateClipCounterclockwise')} style={rotateButtonStyle}><MdRotate90DegreesCcw /></Button>
      <Button data-testid="rotate-clip-cw" onClick={() => onRotate(90)} title={actionTitle(t('Rotate +90°'), 'rotateClipClockwise')} style={rotateButtonStyle}><MdRotate90DegreesCw /></Button>
      <Button data-testid="rotate-clip-180" onClick={() => onRotate(180)} title={actionTitle(t('Rotate 180°'), 'rotateClip180')}>180°</Button>
      {rotation !== 0 && <span data-testid="clip-rotation" title={t('Rotated {{degrees}}°', { degrees: rotation })}>{`${rotation}°`}</span>}

      {/* F2 (T45): magnet and "Fit to" a fraction of the output */}
      <Button
        data-testid="fit-magnet-toggle"
        aria-pressed={magnet}
        onClick={onToggleMagnet}
        title={magnet
          ? t('Magnet: on. Dragged edges snap to the exact size of 1/3, 1/2 or 2/3 of the output. Hold Alt while dragging to turn it off for that drag')
          : t('Magnet: off. Turn it on to snap dragged edges to the exact size of 1/3, 1/2 or 2/3 of the output. Hold Alt while dragging to turn it on for that drag')}
        style={magnet ? magnetOnStyle : magnetButtonStyle}
      >
        <FaMagnet />
      </Button>
      <span>{t('Fit to')}</span>
      {snapFractions.map((fraction) => (
        <Button key={fraction} data-testid={`fit-to-${fraction.replace('/', '-')}`} onClick={() => onFitTo(fraction)} title={t('Resize the max to exactly {{fraction}} of the output, centered on the min (or on the current max)', { fraction })}>{fraction}</Button>
      ))}
    </div>
  );
}

export default memo(RectOverlayToolbar);
