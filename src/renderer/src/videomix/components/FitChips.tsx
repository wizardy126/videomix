import type { CSSProperties } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { FitFraction, FractionFit, FractionFitStatus } from '../fitFractions';

// F1 (T45): the fit of a clip in the fractions of the output's main axis, as chips over the crop (and texts shared
// with the clip list's compact label).

export const fitStatusSymbols: Record<FractionFitStatus, string> = { fits: '✓', extends: '↔', no: '✗' };

/** Short name of a fraction ("1/3", "Full"). */
export const getFractionName = (fraction: FitFraction, t: TFunction) => (fraction === 'full' ? t('Full') : fraction);

/** "12 px short" / "8 px over" for a fraction the clip doesn't fit, else undefined. */
export function getFitAmount({ missing, excess }: Pick<FractionFit, 'missing' | 'excess'>, t: TFunction) {
  if (missing != null) return t('{{pixels}} px short', { pixels: missing });
  if (excess != null) return t('{{pixels}} px over', { pixels: excess });
  return undefined;
}

/** One line per fraction, for tooltips: "1/2: fits", "2/3: doesn't fit (12 px short)"… */
export function getFitDescription(fit: FractionFit, t: TFunction) {
  const name = getFractionName(fit.fraction, t);
  if (fit.status === 'fits') return t('{{fraction}}: fits', { fraction: name });
  if (fit.status === 'extends') return t('{{fraction}}: fits by showing more of the source than the max', { fraction: name });
  const amount = getFitAmount(fit, t);
  return amount != null ? t('{{fraction}}: doesn\'t fit ({{amount}})', { fraction: name, amount }) : t('{{fraction}}: doesn\'t fit', { fraction: name });
}

// Fixed colours on a dark chip: readable over any picture, in both themes
const symbolColors: Record<FractionFitStatus, string> = { fits: 'var(--grass-9)', extends: 'var(--amber-9)', no: 'var(--red-9)' };

const chipStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '.3em',
  padding: '.1em .45em',
  borderRadius: '.7em',
  whiteSpace: 'nowrap',
  background: 'rgba(0,0,0,0.75)',
  color: 'white',
  fontSize: 11,
  lineHeight: 1.4,
  border: '1px solid rgba(255,255,255,0.25)',
};

/** Chips of the fractions: ✓ fits, ↔ fits by extending beyond the max (E7), ✗ doesn't (with the px short or over). */
function FitChips({ fits, snapped, style }: {
  fits: FractionFit[],
  /** The fraction the magnet is holding the dragged edge at (highlighted). */
  snapped?: FitFraction | undefined,
  style?: CSSProperties | undefined,
}) {
  const { t } = useTranslation();
  return (
    <div data-testid="fit-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: '.3em', pointerEvents: 'none', userSelect: 'none', ...style }}>
      {fits.map((fit) => {
        const amount = getFitAmount(fit, t);
        return (
          <div
            key={fit.fraction}
            data-testid={`fit-chip-${fit.fraction.replace('/', '-')}`}
            data-status={fit.status}
            style={{ ...chipStyle, ...(fit.fraction === snapped && { borderColor: 'white', boxShadow: '0 0 0 1px white' }) }}
          >
            <span>{getFractionName(fit.fraction, t)}</span>
            <b style={{ color: symbolColors[fit.status] }}>{fitStatusSymbols[fit.status]}</b>
            {amount != null && <span style={{ opacity: 0.85 }}>{amount}</span>}
          </div>
        );
      })}
    </div>
  );
}

export default memo(FitChips);
