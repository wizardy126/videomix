import type { DragEventHandler, MouseEventHandler } from 'react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FaExclamationTriangle, FaFileVideo, FaPlus, FaTimes } from 'react-icons/fa';

import { controlsBackground, dangerColor, darkModeTransition, primaryColor, primaryTextColor, warningColor } from '../../colors';
import { formatDuration } from '../../util/duration';
import type { MixSource } from '../types';

const iconButtonStyle = {
  flexShrink: 0,
  cursor: 'pointer',
  padding: '.3em',
};

// eslint-disable-next-line react/display-name
const SourceRow = memo(({ source, index, isActive, isMissing, numClips, onActivate, onRemove, onLocate }: {
  source: MixSource,
  index: number,
  isActive: boolean,
  isMissing: boolean,
  numClips: number,
  onActivate: (id: string) => void,
  onRemove: (id: string) => void,
  onLocate: (id: string) => void,
}) => {
  const { t } = useTranslation();

  const handleClick = useCallback<MouseEventHandler<HTMLDivElement>>((e) => {
    e.currentTarget.blur();
    if (isMissing) onLocate(source.id);
    else onActivate(source.id);
  }, [isMissing, onActivate, onLocate, source.id]);

  const handleRemoveClick = useCallback<MouseEventHandler<SVGElement>>((e) => {
    e.stopPropagation();
    onRemove(source.id);
  }, [onRemove, source.id]);

  const handleLocateClick = useCallback<MouseEventHandler<HTMLButtonElement>>((e) => {
    e.stopPropagation();
    onLocate(source.id);
  }, [onLocate, source.id]);

  return (
    <div
      role="button"
      tabIndex={-1}
      title={isMissing ? source.absolutePath : source.path}
      onClick={handleClick}
      style={{ fontSize: 13, padding: '.3em .2em .3em .4em', display: 'flex', alignItems: 'center', gap: '.3em', cursor: 'pointer', background: isActive ? 'var(--gray-6)' : undefined, borderRight: `.3em solid ${isActive ? primaryColor : 'transparent'}` }}
    >
      {isMissing
        ? <FaExclamationTriangle style={{ color: warningColor, flexShrink: 0 }} />
        : <FaFileVideo style={{ color: isActive ? primaryTextColor : undefined, flexShrink: 0 }} />}

      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity: isMissing ? 0.7 : undefined }}>{index + 1}. {source.name}</div>
        <div style={{ fontSize: '.85em', opacity: 0.7, display: 'flex', gap: '.6em', alignItems: 'center' }}>
          {isMissing ? (
            <>
              <span style={{ color: warningColor }}>{t('File not found')}</span>
              <button type="button" onClick={handleLocateClick} style={{ font: 'inherit', padding: 0, border: 'none', background: 'none', color: primaryTextColor, cursor: 'pointer', textDecoration: 'underline' }}>{t('Locate...')}</button>
            </>
          ) : (
            <>
              {source.duration != null && <span>{formatDuration({ seconds: source.duration, shorten: true, showFraction: false })}</span>}
              <span>{t('{{count}} clips', { count: numClips })}</span>
            </>
          )}
        </div>
      </div>

      <FaTimes role="button" title={t('Remove source')} style={{ ...iconButtonStyle, color: dangerColor, fontSize: '.9em' }} onClick={handleRemoveClick} />
    </div>
  );
});

/** Left panel: the sources of the VideoMix project (replaces BatchFilesList in the layout). */
function SourceList({ width, sources, currentSourceId, missingSourceIds, clipCountBySource, onActivate, onRemove, onLocate, onAdd, onDrop }: {
  width: number,
  sources: MixSource[],
  currentSourceId: string | undefined,
  missingSourceIds: ReadonlySet<string>,
  clipCountBySource: ReadonlyMap<string, number>,
  onActivate: (id: string) => void,
  onRemove: (id: string) => void,
  onLocate: (id: string) => void,
  onAdd: () => void,
  onDrop: DragEventHandler<HTMLDivElement>,
}) {
  const { t } = useTranslation();

  return (
    <div
      className="no-user-select"
      style={{ width, flexShrink: 0, background: controlsBackground, color: 'var(--gray-12)', borderRight: '1px solid var(--gray-7)', transition: darkModeTransition, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      onDrop={onDrop}
    >
      <div style={{ padding: '.2em 0 .3em .5em', display: 'flex', alignItems: 'center', gap: '.2em' }}>
        <div style={{ fontSize: '.8em', flexGrow: 1 }}>{t('Sources')}{sources.length > 0 && ` (${sources.length})`}</div>
        <FaPlus role="button" title={t('Add videos')} style={{ ...iconButtonStyle, color: 'white', background: primaryColor, borderRadius: '.5em', marginRight: '.3em' }} onClick={onAdd} />
      </div>

      <div style={{ overflowX: 'hidden', overflowY: 'auto', flexGrow: 1 }}>
        {sources.map((source, index) => (
          <SourceRow
            key={source.id}
            source={source}
            index={index}
            isActive={source.id === currentSourceId}
            isMissing={missingSourceIds.has(source.id)}
            numClips={clipCountBySource.get(source.id) ?? 0}
            onActivate={onActivate}
            onRemove={onRemove}
            onLocate={onLocate}
          />
        ))}

        {sources.length === 0 && (
          <div role="button" tabIndex={-1} onClick={onAdd} style={{ padding: '1em .5em', fontSize: '.85em', opacity: 0.7, textAlign: 'center', cursor: 'pointer' }}>
            {t('Drop videos here or click + to add them to the project')}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(SourceList);
