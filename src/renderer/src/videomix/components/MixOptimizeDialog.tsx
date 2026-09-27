import type { CSSProperties } from 'react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import * as Dialog from '../../components/Dialog';
import { DialogButton } from '../../components/Button';
import Select from '../../components/Select';
import Warning from '../../components/Warning';
import { formatDuration } from '../../util/duration';
import useMixOptimize from '../hooks/useMixOptimize';
import type { MixOrderMetrics } from '../optimize/optimizeMix';
import type { MixClip, MixSettings } from '../types';

/** I2 (T61): the times the user can give the search (s). */
const OPTIMIZE_TIMES = [5, 15, 60] as const;
const DEFAULT_OPTIMIZE_TIME = 15;

// m:ss.s: the gains can be of a second or less
const formatTime = (seconds: number) => {
  const tenths = Math.round(seconds * 10);
  return `${formatDuration({ seconds: Math.floor(tenths / 10), showFraction: false, shorten: true })}.${tenths % 10}`;
};
/**
 * Fill as seconds of a whole empty frame (fraction of the frame × s), not as a share of the video: a shorter video
 * with less fill could show a larger share.
 */
const formatFill = ({ fill }: Pick<MixOrderMetrics, 'fill'>) => `${fill.toFixed(1)} s`;

const barStyle: CSSProperties = { height: '.6em', borderRadius: '.3em', background: 'var(--gray-6)', overflow: 'hidden' };
const rowStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: '1em', fontSize: '.9em', color: 'var(--gray-11)' };
const cellStyle: CSSProperties = { padding: '.2em .6em', textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

/**
 * "Optimize mix" (I2, T61): searches for a better order of the clip list in the background for 5, 15 or 60 s, with
 * its progress and the best result so far, and Stop (keeps the best). Then compares before and after (duration, fill
 * and time with empty columns) and Apply reorders the clip list in one undo step, or Discard leaves it as it was.
 * While searching, Esc and clicks outside do nothing (only Stop).
 */
function MixOptimizeDialog({ open, onOpenChange, clips, settings, onApply }: {
  open: boolean,
  onOpenChange: (value: boolean) => void,
  clips: MixClip[],
  settings: MixSettings,
  /** Reorders the clip list (one undo step). */
  onApply: (ids: string[]) => void,
}) {
  const { t } = useTranslation();
  const { state, blocker, start, stop, reset, apply } = useMixOptimize({ clips, settings, onApply });
  const [seconds, setSeconds] = useState<number>(DEFAULT_OPTIMIZE_TIME);
  const [changed, setChanged] = useState(false);

  const running = state.phase === 'running';

  const close = useCallback(() => {
    reset();
    setChanged(false);
    onOpenChange(false);
  }, [onOpenChange, reset]);

  const handleOpenChange = useCallback((value: boolean) => {
    if (!value && !running) close();
  }, [close, running]);

  const handleStart = useCallback(() => {
    setChanged(false);
    start(seconds * 1000);
  }, [seconds, start]);

  const handleApply = useCallback(() => {
    if (apply()) close();
    else setChanged(true);
  }, [apply, close]);

  const preventWhileRunning = useCallback((e: Event) => { if (running) e.preventDefault(); }, [running]);

  const blockerTexts = {
    'random-order': t('The clips play in random order: the list order is not used, so there is nothing to optimize.'),
    'no-window': t('The reorder window is 0: no clip can move from its place in the list.'),
    'too-few-clips': t('There are not enough clips that can move.'),
  };
  const blockerText = blocker != null ? blockerTexts[blocker] : undefined;

  const windowText = settings.reorderWindow === 'unlimited'
    ? t('Clips can move anywhere in the list (unlimited reorder window).')
    : t('No clip moves more than {{count}} positions in the list (the reorder window).', { count: settings.reorderWindow });

  let content;
  if (state.phase === 'running') {
    const percent = Math.min(100, (100 * state.elapsedMs) / state.durationMs);
    const { best, initial } = state;
    content = (
      <>
        <div role="progressbar" aria-label={t('Searching')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} style={barStyle}>
          <div style={{ height: '100%', width: `${percent}%`, background: 'var(--cyan-9)', transition: 'width .2s linear' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.2em', marginTop: '.8em' }}>
          <div style={rowStyle}>
            <span>{t('Variants tried')}</span>
            <span data-testid="optimize-evaluations" style={{ fontVariantNumeric: 'tabular-nums' }}>{state.evaluations}</span>
          </div>
          {initial != null && (
            <div style={rowStyle}>
              <span>{t('Current order')}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{`${formatTime(initial.duration)} · ${t('fill')} ${formatFill(initial)}`}</span>
            </div>
          )}
          {best != null && (
            <div style={rowStyle}>
              <span>{t('Best so far')}</span>
              <span data-testid="optimize-best" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--gray-12)' }}>{`${formatTime(best.quality.duration)} · ${t('fill')} ${formatFill(best.quality)}`}</span>
            </div>
          )}
        </div>
        <Dialog.ButtonRow>
          <DialogButton onClick={stop} disabled={state.stopping}>{state.stopping ? t('Stopping…') : t('Stop')}</DialogButton>
        </Dialog.ButtonRow>
      </>
    );
  } else if (state.phase === 'done') {
    const rows: [string, string, string][] = [
      [t('Duration'), formatTime(state.before.duration), formatTime(state.after.duration)],
      [t('Fill (seconds of a whole frame)'), formatFill(state.before), formatFill(state.after)],
      [t('Time with empty columns'), formatTime(state.before.emptyColumnTime), formatTime(state.after.emptyColumnTime)],
    ];
    content = (
      <>
        <table data-testid="optimize-comparison" style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th aria-label={t('Metric')} />
              <th style={cellStyle}>{t('Before')}</th>
              <th style={cellStyle}>{t('After')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, before, after]) => (
              <tr key={label}>
                <td style={{ padding: '.2em 0' }}>{label}</td>
                <td style={cellStyle}>{before}</td>
                <td style={{ ...cellStyle, fontWeight: state.improved && before !== after ? 'bold' : undefined }}>{after}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: '.9em', color: 'var(--gray-11)' }}>
          {state.improved
            ? t('{{count}} clips change their place in the list. You can undo it.', { count: state.moved })
            : t('No better order was found.')}
          {' '}{t('{{count}} variants tried.', { count: state.evaluations })}
        </p>
        {changed && <Warning>{t('The clips or the mix settings changed while optimizing. Run it again.')}</Warning>}
        <Dialog.ButtonRow>
          <DialogButton onClick={close}>{t('Discard')}</DialogButton>
          <DialogButton primary onClick={handleApply} disabled={!state.improved || changed}>{t('Apply')}</DialogButton>
        </Dialog.ButtonRow>
      </>
    );
  } else {
    content = (
      <>
        {state.phase === 'error' && <Warning>{t('The optimization failed: {{message}}', { message: state.message })}</Warning>}
        {blockerText != null ? <p>{blockerText}</p> : (
          <>
            <p style={{ fontSize: '.9em', color: 'var(--gray-11)' }}>{windowText} {t('Pinned clips, groups, chains, the always-visible sequence and the maximum duration are kept.')}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5em' }}>
              {t('Search time')}
              <Select data-testid="optimize-time" aria-label={t('Search time')} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
                {OPTIMIZE_TIMES.map((value) => <option key={value} value={value}>{t('{{seconds}} s', { seconds: value })}</option>)}
              </Select>
            </div>
          </>
        )}
        <Dialog.ButtonRow>
          <DialogButton onClick={close}>{t('Cancel')}</DialogButton>
          {blockerText == null && <DialogButton primary onClick={handleStart}>{t('Start')}</DialogButton>}
        </Dialog.ButtonRow>
      </>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content
          data-testid="optimize-dialog"
          style={{ width: '30em' }}
          onEscapeKeyDown={preventWhileRunning}
          onPointerDownOutside={preventWhileRunning}
          onInteractOutside={preventWhileRunning}
        >
          <Dialog.Title>{t('Optimize mix')}</Dialog.Title>
          <Dialog.Description>
            {t('Searches for a better order of the clip list: it tries thousands of variants with the planner and keeps the best one by the "Prioritize" setting.')}
          </Dialog.Description>
          {content}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default memo(MixOptimizeDialog);
