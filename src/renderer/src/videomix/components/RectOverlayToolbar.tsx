import type { ChangeEventHandler, CSSProperties } from 'react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MdDiamond, MdOutlineDiamond, MdRotate90DegreesCcw, MdRotate90DegreesCw, MdSkipNext, MdSkipPrevious } from 'react-icons/md';
import { FaMagnet, FaStopwatch } from 'react-icons/fa';

import Button from '../../components/Button';
import Select from '../../components/Select';
import useActionTitle from '../../hooks/useActionTitle';
import { aspectPresets } from '../overlayMath';
import type { MixClipRotation, MixKeyframeInterpolation } from '../types';
import { snapFractions } from '../fitFractions';
import type { FitFraction } from '../fitFractions';

const FREE = 'free';

const rotateButtonStyle: CSSProperties = { display: 'flex', alignItems: 'center', fontSize: '1.1em' };
const magnetButtonStyle: CSSProperties = { display: 'flex', alignItems: 'center' };
const magnetOnStyle: CSSProperties = { ...magnetButtonStyle, color: 'white', backgroundColor: 'var(--cyan-9)', borderColor: 'var(--cyan-11)' };
const iconButtonStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '.2em' };
const animateOnStyle: CSSProperties = { ...iconButtonStyle, color: 'white', backgroundColor: 'var(--amber-9)', borderColor: 'var(--amber-11)' };

const keyframeInterpolations: MixKeyframeInterpolation[] = ['smooth', 'linear', 'hold'];

/** A9 (T49): the state of the clip's keyframes at the cursor, for the toolbar. */
export interface ToolbarKeyframes {
  animated: boolean,
  /** The interpolation of the keyframe at the cursor, undefined if the cursor isn't on one. */
  current: MixKeyframeInterpolation | undefined,
  hasPrev: boolean,
  hasNext: boolean,
}

/** Aspect presets for the max rect and quick actions. `aspect` undefined means free. */
function RectOverlayToolbar({ docked = false, aspect, hasMin, rotation, magnet, keyframes, onAspectChange, onAddMin, onClearMin, onFillFrame, onRotate, onToggleMagnet, onFitTo, onRemoveBlackBars, onToggleAnimate, onAddKeyframe, onRemoveKeyframe, onSeekKeyframe, onKeyframeInterpolationChange }: {
  /** T49: in the strip above the player (ClipRectEditor), not over the picture: no background of its own. */
  docked?: boolean | undefined,
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
  /** A9 (T49): the stopwatch ("Animate"), the keyframe at the cursor and the previous/next ones. */
  keyframes: ToolbarKeyframes,
  onToggleAnimate: () => void,
  onAddKeyframe: () => void,
  onRemoveKeyframe: () => void,
  onSeekKeyframe: (direction: -1 | 1) => void,
  onKeyframeInterpolationChange: (interpolation: MixKeyframeInterpolation) => void,
}) {
  const { t } = useTranslation();
  const actionTitle = useActionTitle();

  const selected = aspectPresets.find(({ value }) => value === aspect)?.label ?? FREE;

  const handleAspectChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    e.target.blur();
    onAspectChange(aspectPresets.find(({ label }) => label === e.target.value)?.value);
  }, [onAspectChange]);

  const handleInterpolationChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    e.target.blur();
    const interpolation = keyframeInterpolations.find((v) => v === e.target.value);
    if (interpolation != null) onKeyframeInterpolationChange(interpolation);
  }, [onKeyframeInterpolationChange]);

  const interpolationLabels: Record<MixKeyframeInterpolation, string> = { smooth: t('Smooth'), linear: t('Linear'), hold: t('Hold') };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: '.5em', whiteSpace: 'nowrap', padding: docked ? '.1em 0' : '.3em .5em', borderRadius: '.3em', background: docked ? undefined : 'var(--black-a9)', color: 'var(--gray-12)', fontSize: '.9em' }}>
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

      {/* A9 (T49): keyframes of the framing (pan and zoom), auto-key while animated */}
      <Button
        data-testid="animate-toggle"
        aria-pressed={keyframes.animated}
        onClick={onToggleAnimate}
        title={keyframes.animated
          ? t('Animated: moving or scaling the max adds or updates a keyframe at the cursor. Click to stop animating (removes the keyframes)')
          : t('Animate the framing (pan and zoom): adds a keyframe at the cursor with the current framing; from then on, moving or scaling the max adds or updates a keyframe at the cursor')}
        style={keyframes.animated ? animateOnStyle : iconButtonStyle}
      >
        <FaStopwatch />
        {t('Animate')}
      </Button>
      {keyframes.animated && (
        <>
          <Button data-testid="keyframe-prev" disabled={!keyframes.hasPrev} onClick={() => onSeekKeyframe(-1)} title={actionTitle(t('Previous framing keyframe'), 'seekPreviousClipKeyframe')} style={rotateButtonStyle}><MdSkipPrevious /></Button>
          {keyframes.current != null ? (
            <Button data-testid="keyframe-remove" onClick={onRemoveKeyframe} title={actionTitle(t('Remove the framing keyframe at the cursor'), 'removeClipKeyframe')} style={iconButtonStyle}><MdDiamond style={{ color: 'var(--amber-9)' }} />−</Button>
          ) : (
            <Button data-testid="keyframe-add" onClick={onAddKeyframe} title={t('Add a keyframe at the cursor with the framing shown')} style={iconButtonStyle}><MdOutlineDiamond />+</Button>
          )}
          <Button data-testid="keyframe-next" disabled={!keyframes.hasNext} onClick={() => onSeekKeyframe(1)} title={actionTitle(t('Next framing keyframe'), 'seekNextClipKeyframe')} style={rotateButtonStyle}><MdSkipNext /></Button>
          {keyframes.current != null && (
            <Select data-testid="keyframe-interpolation" value={keyframes.current} onChange={handleInterpolationChange} title={t('Interpolation from this keyframe to the next one')}>
              {keyframeInterpolations.map((interpolation) => <option key={interpolation} value={interpolation}>{interpolationLabels[interpolation]}</option>)}
            </Select>
          )}
        </>
      )}
    </div>
  );
}

export default memo(RectOverlayToolbar);
