import type { CSSProperties } from 'react';
import { useState } from 'react';
import i18n from 'i18next';

import getSwal from '../../swal';

// Dialogs of the blocks of overlays (T57): "Repeat…" (H5) and "Block duration…" (H6).

export type BlockRepeatAnswer = { kind: 'interval', times: number, interval: number } | { kind: 'clips' };

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '.5em', margin: '.6em 0', flexWrap: 'wrap' };
const numberStyle: CSSProperties = { width: '5em', font: 'inherit', padding: '.1em .3em' };

interface RepeatDraft { kind: 'interval' | 'clips', times: string, interval: string }

function RepeatForm({ draft, clipCount }: { draft: RepeatDraft, clipCount: number }) {
  // the draft object is read by the dialog's preConfirm; the state only re-renders the form
  const [, setVersion] = useState(0);
  const change = (patch: Partial<RepeatDraft>) => {
    Object.assign(draft, patch);
    setVersion((v) => v + 1);
  };
  return (
    <div style={{ textAlign: 'left' }}>
      <div style={rowStyle}>
        <input type="radio" name="block-repeat-kind" data-testid="block-repeat-interval-kind" aria-label={i18n.t('Times')} checked={draft.kind === 'interval'} onChange={() => change({ kind: 'interval' })} />
        <span>{i18n.t('Times')}</span>
        <input type="number" data-testid="block-repeat-times" aria-label={i18n.t('Times')} style={numberStyle} min={2} step={1} value={draft.times} onChange={(e) => change({ kind: 'interval', times: e.target.value })} />
        <span>{i18n.t('every')}</span>
        <input type="number" data-testid="block-repeat-interval" aria-label={i18n.t('Interval (s)')} style={numberStyle} min={0.1} step={0.5} value={draft.interval} onChange={(e) => change({ kind: 'interval', interval: e.target.value })} />
        <span>{i18n.t('s')}</span>
      </div>
      <div style={{ ...rowStyle, opacity: clipCount > 0 ? 1 : 0.5 }}>
        <input type="radio" name="block-repeat-kind" data-testid="block-repeat-clips" aria-label={i18n.t('At the start of each selected clip')} disabled={clipCount === 0} checked={draft.kind === 'clips'} onChange={() => change({ kind: 'clips' })} />
        <span>{clipCount > 0 ? i18n.t('At the start of each selected clip ({{count}})', { count: clipCount }) : i18n.t('At the start of each selected clip (select clips first)')}</span>
      </div>
      <div style={{ fontSize: '.85em', opacity: 0.8 }}>
        {i18n.t('The block counts as the first one. The copies are linked to it: editing the content of one changes all of them ("Unlink" makes one independent).')}
      </div>
    </div>
  );
}

/** H5 "Repeat…": N times every X s (the block is the first one), or at the start of each selected clip. */
export async function askForBlockRepeat({ clipCount, defaultInterval }: { clipCount: number, defaultInterval: number }): Promise<BlockRepeatAnswer | undefined> {
  const draft: RepeatDraft = { kind: 'interval', times: '2', interval: String(Math.max(0.1, Math.round(defaultInterval * 100) / 100)) };
  const { isConfirmed, value } = await getSwal().ReactSwal.fire<BlockRepeatAnswer>({
    title: i18n.t('Repeat block'),
    html: <RepeatForm draft={draft} clipCount={clipCount} />,
    showCancelButton: true,
    confirmButtonText: i18n.t('Repeat'),
    cancelButtonText: i18n.t('Cancel'),
    preConfirm: () => {
      if (draft.kind === 'clips') return { kind: 'clips' };
      const times = Number(draft.times);
      const interval = Number(draft.interval);
      if (!Number.isInteger(times) || times < 2 || times > 1000) {
        getSwal().Swal.showValidationMessage(i18n.t('Enter a whole number of times, 2 or more'));
        return false;
      }
      if (!(interval > 0) || !Number.isFinite(interval)) {
        getSwal().Swal.showValidationMessage(i18n.t('Enter an interval greater than 0 s'));
        return false;
      }
      return { kind: 'interval', times, interval };
    },
  });
  return isConfirmed ? value : undefined;
}

/** H6 "Block duration…": the new length (s), or undefined if cancelled. */
export async function askForBlockDuration(current: number): Promise<number | undefined> {
  const { isConfirmed, value } = await getSwal().Swal.fire<string>({
    title: i18n.t('Block duration'),
    text: i18n.t('Its times and durations are scaled to last this long. Fades, entry animations and sounds keep their length. Linked copies change too.'),
    input: 'number',
    inputValue: String(Math.round(current * 100) / 100),
    inputAttributes: { min: '0.1', step: '0.1' },
    showCancelButton: true,
    confirmButtonText: i18n.t('Apply'),
    cancelButtonText: i18n.t('Cancel'),
    inputValidator: (v) => (Number(v) > 0 && Number.isFinite(Number(v)) ? null : i18n.t('Enter a duration greater than 0 s')),
  });
  return isConfirmed && value != null ? Math.round(Number(value) * 100) / 100 : undefined;
}
