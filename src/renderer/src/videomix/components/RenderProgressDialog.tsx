import type { CSSProperties } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useInterval from 'react-use/lib/useInterval';

import * as Dialog from '../../components/Dialog';
import { DialogButton } from '../../components/Button';
import { formatDuration } from '../../util/duration';
import type { EtaSample, RenderEtaState } from '../render/renderEta';
import { addRenderEtaSample, createRenderEta, getRenderEtaRemainingMs, rebaseRenderEta } from '../render/renderEta';
import type { MixRenderStatus } from '../render/renderStatus';

// m:ss (h:mm:ss from an hour on)
const formatTime = (ms: number, round: (v: number) => number) => formatDuration({ seconds: round(Math.max(0, ms) / 1000), showFraction: false, shorten: true });

const barStyle: CSSProperties = { height: '.6em', borderRadius: '.3em', background: 'var(--gray-6)', overflow: 'hidden' };
const rowStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: '1em', fontSize: '.9em', color: 'var(--gray-11)' };

/**
 * Progress of a render or preview of the mix (T41), instead of the Working overlay: phase, progress bar, elapsed and
 * remaining time, and Cancel (the same abort as Working's). It can't be dismissed: Esc and clicks outside do nothing,
 * only Cancel stops the render. Hidden while the render asks something (phase 'confirm').
 */
function RenderProgressDialog({ status, progress, onCancel }: {
  status: MixRenderStatus,
  progress: number | undefined,
  onCancel: () => void,
}) {
  const { t } = useTranslation();

  const [now, setNow] = useState(() => Date.now());

  const [cancelling, setCancelling] = useState(false);

  // Remaining time: only from the render phase (the loudness analysis is usually short and says nothing about the
  // render's speed); starts over with each phase (e.g. a retry with software encoding)
  const etaRef = useRef<{ phaseStartedAt: number, baseline: EtaSample | undefined, state: RenderEtaState }>(undefined);
  const { phase, phaseStartedAt, etaBaseline } = status;
  useEffect(() => {
    if (phase !== 'render') return;
    const current = etaRef.current?.phaseStartedAt === phaseStartedAt ? etaRef.current : { phaseStartedAt, baseline: undefined, state: createRenderEta() };
    let { state } = current;
    if (progress != null) state = addRenderEtaSample(state, { time: Date.now(), progress });
    if (etaBaseline != null && etaBaseline !== current.baseline) state = rebaseRenderEta(etaBaseline);
    etaRef.current = { phaseStartedAt, baseline: etaBaseline, state };
  }, [etaBaseline, phase, phaseStartedAt, progress]);

  // Its own clock, so the times move on smoothly between progress events
  const [remainingMs, setRemainingMs] = useState<number>();
  useInterval(() => {
    const time = Date.now();
    setNow(time);
    const eta = etaRef.current;
    setRemainingMs(eta != null && eta.phaseStartedAt === phaseStartedAt ? getRenderEtaRemainingMs(eta.state, time) : undefined);
  }, 250);
  const percent = Math.round(Math.min(1, Math.max(0, progress ?? 0)) * 1000) / 10;

  const handleCancel = useCallback(() => {
    setCancelling(true);
    onCancel();
  }, [onCancel]);

  // The Cancel button doesn't take the focus: a key press meant for something else mustn't cancel the render
  const handleOpenAutoFocus = useCallback((e: Event) => {
    e.preventDefault();
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus();
  }, []);
  const preventDefault = useCallback((e: Event) => e.preventDefault(), []);

  const phaseText = phase === 'loudness' ? t('Analyzing audio loudness') : t('Rendering video and audio');

  return (
    <Dialog.Root open={phase !== 'confirm'}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content
          data-testid="render-progress"
          aria-describedby={undefined}
          style={{ width: '26em' }}
          onOpenAutoFocus={handleOpenAutoFocus}
          onEscapeKeyDown={preventDefault}
          onPointerDownOutside={preventDefault}
          onInteractOutside={preventDefault}
        >
          <Dialog.Title>{status.kind === 'preview' ? t('Rendering the preview') : t('Rendering the mix')}</Dialog.Title>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1em', marginBottom: '.4em' }}>
            <span data-testid="render-progress-phase">{phaseText}</span>
            <span data-testid="render-progress-percent" style={{ fontVariantNumeric: 'tabular-nums', fontSize: '1.2em' }}>{`${percent.toFixed(1)} %`}</span>
          </div>

          <div role="progressbar" aria-label={phaseText} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} style={barStyle}>
            <div style={{ height: '100%', width: `${percent}%`, background: 'var(--cyan-9)', transition: 'width .3s ease-out' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '.2em', marginTop: '.8em' }}>
            <div style={rowStyle}>
              <span>{t('Elapsed')}</span>
              <span data-testid="render-progress-elapsed" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTime(now - status.startedAt, Math.floor)}</span>
            </div>
            <div style={rowStyle}>
              <span>{t('Remaining')}</span>
              <span data-testid="render-progress-remaining" style={{ fontVariantNumeric: 'tabular-nums' }}>{phase === 'render' && remainingMs != null ? `≈ ${formatTime(remainingMs, Math.ceil)}` : t('Calculating…')}</span>
            </div>
          </div>

          <Dialog.ButtonRow>
            <DialogButton onClick={handleCancel} disabled={cancelling}>{cancelling ? t('Cancelling…') : t('Cancel')}</DialogButton>
          </Dialog.ButtonRow>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default memo(RenderProgressDialog);
