import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FaAngleDoubleDown, FaAngleDoubleUp, FaArrowDown, FaArrowUp, FaClone, FaExclamationTriangle, FaLink, FaLock, FaObjectUngroup, FaRedo, FaTimes, FaTrash, FaUnlink } from 'react-icons/fa';
import { MdOutlineTimer } from 'react-icons/md';

import Switch from '../../components/Switch';
import { useSegColors } from '../../contexts';
import useUserSettings from '../../hooks/useUserSettings';
import { segColorsCount } from '../../util/colors';
import { controlsBackground, darkModeTransition, warningColor } from '../../colors';
import { formatDuration } from '../../util/duration';
import type { MixBlock, MixBlockDef, MixClip, OverlayAnchor } from '../types';
import type { MissingOverlayFile, OverlayFileKind } from '../projectFile';
import { getBlockDefDuration, getBlockDefTimes, getBlockMemberOverlayId } from '../blocks/expandBlocks';
import { getBlockDefVariables, getMissingVariables } from '../blocks/blockVariables';
import { getAnchorTargets, isBlockDefLocked } from '../blocks/blockUi';
import { getOverlayTimeWarningText, getOverlayTypeLabel } from '../overlayTexts';
import type { UseMixOverlays } from '../hooks/useMixOverlays';
import { AnchorFields } from './OverlayPanel';

// Properties of the block selected in the Mix view (T57, H1, H4, H5, H6, H8): its content (name, colour, members:
// shared by its linked copies) and this instance (anchor, variables, hidden, locked). Like the overlay panel, it takes
// the place of the clip list. Every change is one undo step.

const sectionTitleStyle: CSSProperties = { margin: '.8em 0 .3em', fontSize: '.8em', fontWeight: 600, borderBottom: '1px solid var(--gray-6)', paddingBottom: '.2em' };
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '.4em', marginBottom: '.35em', flexWrap: 'wrap' };
const labelStyle: CSSProperties = { fontSize: '.75em', color: 'var(--gray-11)', minWidth: '5.5em' };
const inputStyle: CSSProperties = { font: 'inherit', fontSize: '.8em', background: 'var(--gray-3)', color: 'var(--gray-12)', border: '1px solid var(--gray-7)', borderRadius: '.3em', padding: '.1em .3em' };
const iconButtonStyle: CSSProperties = { font: 'inherit', fontSize: '.8em', padding: '.2em .4em', border: '1px solid var(--gray-7)', borderRadius: '.3em', background: 'var(--gray-3)', color: 'var(--gray-12)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '.3em' };
const buttonStyle = (disabled: boolean): CSSProperties => (disabled ? { ...iconButtonStyle, opacity: 0.4, cursor: 'default' } : iconButtonStyle);
const fieldsetStyle: CSSProperties = { border: 0, padding: 0, margin: 0, minWidth: 0 };

/** A text field applied on blur or Enter (Escape reverts), so typing is one undo step. */
// eslint-disable-next-line react/display-name
const DraftInput = memo(({ value, placeholder, onCommit, title, testId }: { value: string, placeholder?: string | undefined, onCommit: (text: string) => void, title?: string | undefined, testId?: string | undefined }) => {
  const [draft, setDraft] = useState<string>();
  const commit = useCallback(() => {
    if (draft != null && draft !== value) onCommit(draft);
    setDraft(undefined);
  }, [draft, onCommit, value]);
  const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setDraft(undefined);
  }, [commit]);
  return (
    <input
      data-testid={testId}
      style={{ ...inputStyle, flexGrow: 1, minWidth: 0 }}
      value={draft ?? value}
      placeholder={placeholder}
      title={title}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  );
});

function BlockPanel({ width, block, def, clips, selectedClipIds, missingFiles, mixOverlays, onLocate }: {
  width: number,
  block: MixBlock,
  def: MixBlockDef,
  clips: MixClip[],
  /** Selected clips, in video order, for "Repeat… at the start of each selected clip". */
  selectedClipIds: readonly string[],
  /** Files of its members not found when opening the project. */
  missingFiles: readonly MissingOverlayFile[],
  mixOverlays: UseMixOverlays,
  onLocate: (memberId: string, kind: OverlayFileKind, blockDefId: string) => void,
}) {
  const { t } = useTranslation();
  const { darkMode } = useUserSettings();
  const { getSegColor } = useSegColors();
  const { project, resolved, blockTimes, clearOverlaySelection, selectBlockMember, userUpdateBlock, userUpdateBlockDef, userDuplicateBlock, userRemoveBlock, userUngroupBlock, userUnlinkBlock, userRepeatBlock, userStretchBlock, userMoveBlockLayer } = mixOverlays;
  const { id } = block;
  const locked = block.locked === true;
  const contentLocked = isBlockDefLocked(project, def.id);
  const linkedCount = project.blocks.filter((b) => b.defId === def.id).length;
  const times = blockTimes.get(id);
  const duration = useMemo(() => getBlockDefDuration(def), [def]);
  const memberTimes = useMemo(() => getBlockDefTimes(def), [def]);
  const variables = useMemo(() => getBlockDefVariables(def), [def]);
  const missingVariables = useMemo(() => getMissingVariables(def, block.variables), [block.variables, def]);
  const anchorTargets = useMemo(() => getAnchorTargets(project, { blockId: id }), [id, project]);
  const targets = useMemo(() => {
    const { anchor } = block;
    if (anchor.kind !== 'element' || anchorTargets.some((target) => target.id === anchor.elementId)) return anchorTargets;
    return [...anchorTargets, { id: anchor.elementId, name: t('(missing)') }];
  }, [anchorTargets, block, t]);

  const getColor = useCallback((color: number) => getSegColor({ segColorIndex: color }).desaturate(0.1).lightness(darkMode ? 40 : 55).string(), [darkMode, getSegColor]);

  const handleAnchorChange = useCallback((anchor: OverlayAnchor) => userUpdateBlock(id, { anchor }), [id, userUpdateBlock]);
  const setVariable = useCallback((name: string, value: string) => {
    // an empty field means no value: the default of the text applies
    const next = Object.fromEntries(Object.entries(block.variables ?? {}).filter(([key]) => key !== name));
    userUpdateBlock(id, { variables: value === '' ? next : { ...next, [name]: value } });
  }, [block.variables, id, userUpdateBlock]);

  const warnings = times?.warnings ?? [];

  return (
    <div className="consistent-scrollbar" data-testid="block-panel" style={{ width, flexShrink: 0, overflowY: 'auto', background: controlsBackground, transition: darkModeTransition, padding: '.5em .6em', boxSizing: 'border-box', borderLeft: '1px solid var(--gray-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.3em' }}>
        <span style={{ fontSize: '.75em', color: 'var(--gray-11)', flexGrow: 1 }}>{t('Block')}</span>
        <button type="button" style={{ ...iconButtonStyle, border: 'none', background: 'transparent' }} title={t('Close')} onClick={clearOverlaySelection}><FaTimes /></button>
      </div>

      <fieldset disabled={contentLocked} style={{ ...fieldsetStyle, ...(contentLocked && { opacity: 0.6 }) }}>
        <div style={{ ...rowStyle, marginBottom: '.4em' }}>
          <DraftInput testId="block-name" value={def.name} title={t('Name')} onCommit={(name) => userUpdateBlockDef(def.id, { name })} />
        </div>
        <div style={{ ...rowStyle, gap: '.15em' }} title={t('Color')}>
          {Array.from({ length: segColorsCount }, (_, color) => (
            <button
              // eslint-disable-next-line react/no-array-index-key
              key={color}
              type="button"
              aria-label={t('Color {{number}}', { number: color + 1 })}
              onClick={() => userUpdateBlockDef(def.id, { color })}
              style={{ width: '1em', height: '1em', padding: 0, borderRadius: 2, background: getColor(color), border: color === def.color % segColorsCount ? '2px solid var(--gray-12)' : '1px solid transparent', cursor: 'pointer' }}
            />
          ))}
        </div>
      </fieldset>

      {linkedCount > 1 && (
        <div data-testid="block-linked" style={{ ...rowStyle, fontSize: '.75em', color: 'var(--amber-11)' }}>
          <FaLink />
          <span style={{ flexGrow: 1 }}>{t('Linked: {{count}} copies share its content', { count: linkedCount })}</span>
          <button type="button" style={buttonStyle(locked)} disabled={locked} onClick={() => userUnlinkBlock(id)} title={t('Make this copy independent: its own content, which can be edited alone')}><FaUnlink />{t('Unlink')}</button>
        </div>
      )}

      <div style={rowStyle}>
        <span style={labelStyle}>{t('Hidden')}</span>
        <Switch aria-label={t('Hidden')} checked={block.hidden === true} onCheckedChange={(checked) => userUpdateBlock(id, { hidden: checked || undefined })} />
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>{t('Locked')}</span>
        <Switch aria-label={t('Locked')} checked={locked} onCheckedChange={(checked) => userUpdateBlock(id, { locked: checked || undefined })} />
      </div>
      {block.hidden && <div style={{ fontSize: '.7em', opacity: 0.7, marginBottom: '.3em' }}>{t('Not shown in the preview or the video (still in the project).')}</div>}
      {(locked || contentLocked) && (
        <div style={{ fontSize: '.75em', display: 'flex', gap: '.3em', marginBottom: '.3em' }}>
          <FaLock style={{ flexShrink: 0, marginTop: '.15em' }} />
          <span>{locked ? t('Locked: it can\'t be moved or edited') : t('A linked copy is locked: the content can\'t be edited')}</span>
        </div>
      )}

      <div style={{ ...rowStyle, gap: '.25em' }}>
        <button type="button" style={iconButtonStyle} title={t('Duplicate (an independent copy)')} onClick={() => userDuplicateBlock(id)}><FaClone /></button>
        <button type="button" data-testid="block-repeat" style={buttonStyle(locked)} disabled={locked} title={t('Repeat…')} onClick={() => userRepeatBlock(id, selectedClipIds)}><FaRedo /></button>
        <button type="button" data-testid="block-stretch" style={buttonStyle(contentLocked || !(duration > 0))} disabled={contentLocked || !(duration > 0)} title={t('Block duration…')} onClick={() => userStretchBlock(id)}><MdOutlineTimer /></button>
        <button type="button" data-testid="block-ungroup" style={buttonStyle(locked || block.hidden === true)} disabled={locked || block.hidden === true} title={block.hidden ? t('Show the block before ungrouping it: its overlays would appear in the video') : t('Ungroup')} onClick={() => userUngroupBlock(id)}><FaObjectUngroup /></button>
        <button type="button" style={buttonStyle(locked)} disabled={locked} title={t('Delete')} onClick={() => userRemoveBlock(id)}><FaTrash /></button>
      </div>
      <div style={{ ...rowStyle, gap: '.25em' }}>
        <button type="button" style={buttonStyle(locked)} disabled={locked} title={t('Bring forward')} onClick={() => userMoveBlockLayer(id, 'up')}><FaArrowUp /></button>
        <button type="button" style={buttonStyle(locked)} disabled={locked} title={t('Send backward')} onClick={() => userMoveBlockLayer(id, 'down')}><FaArrowDown /></button>
        <button type="button" style={buttonStyle(locked)} disabled={locked} title={t('Bring to front')} onClick={() => userMoveBlockLayer(id, 'front')}><FaAngleDoubleUp /></button>
        <button type="button" style={buttonStyle(locked)} disabled={locked} title={t('Send to back')} onClick={() => userMoveBlockLayer(id, 'back')}><FaAngleDoubleDown /></button>
      </div>
      <div style={{ fontSize: '.7em', opacity: 0.7, marginBottom: '.3em' }}>{t('Blocks are drawn above the loose overlays, in this order.')}</div>

      {(warnings.length > 0 || missingFiles.length > 0 || missingVariables.length > 0) && (
        <div style={{ fontSize: '.75em', margin: '.4em 0' }}>
          {warnings.map((w) => (
            <div key={w.type} style={{ display: 'flex', gap: '.3em', marginBottom: '.2em' }}>
              <FaExclamationTriangle style={{ color: warningColor, flexShrink: 0, marginTop: '.15em' }} />
              <span>{getOverlayTimeWarningText(w)}</span>
            </div>
          ))}
          {missingFiles.map((m) => (
            <div key={`${m.overlayId}-${m.kind}`} style={{ display: 'flex', alignItems: 'center', gap: '.3em', marginBottom: '.2em' }}>
              <FaExclamationTriangle style={{ color: warningColor, flexShrink: 0 }} />
              <span style={{ flexGrow: 1 }}>{t('"{{name}}": file not found', { name: def.members.find((member) => member.id === m.overlayId)?.name ?? m.overlayId })}</span>
              <button type="button" style={buttonStyle(contentLocked)} disabled={contentLocked} onClick={() => onLocate(m.overlayId, m.kind, def.id)}>{t('Locate...')}</button>
            </div>
          ))}
          {missingVariables.length > 0 && (
            <div style={{ display: 'flex', gap: '.3em', marginBottom: '.2em' }}>
              <FaExclamationTriangle style={{ color: warningColor, flexShrink: 0, marginTop: '.15em' }} />
              <span>{t('Variables without a value: {{names}}', { names: missingVariables.join(', ') })}</span>
            </div>
          )}
        </div>
      )}

      <fieldset disabled={locked} style={{ ...fieldsetStyle, ...(locked && { opacity: 0.6 }) }}>
        <h4 style={sectionTitleStyle}>{t('Time')}</h4>
        {times != null && (
          <div style={{ fontSize: '.75em', opacity: 0.8, marginBottom: '.4em' }}>
            {t('{{start}} to {{end}}', { start: formatDuration({ seconds: times.start, shorten: true }), end: formatDuration({ seconds: times.end, shorten: true }) })}
          </div>
        )}
        <AnchorFields anchor={block.anchor} targets={targets} clips={clips} rawStart={times?.rawStart ?? 0} onChange={handleAnchorChange} />
        <div style={rowStyle}>
          <span style={labelStyle}>{t('Duration')}</span>
          <span data-testid="block-duration" style={{ fontSize: '.8em' }}>{formatDuration({ seconds: duration, shorten: true })}</span>
        </div>

        {variables.length > 0 && (
          <>
            <h4 style={sectionTitleStyle}>{t('Variables')}</h4>
            {variables.map(({ name, defaultValue }) => (
              <div key={name} style={rowStyle}>
                <span style={{ ...labelStyle, overflow: 'hidden', textOverflow: 'ellipsis' }} title={name}>{name}</span>
                <DraftInput testId={`block-variable-${name}`} value={block.variables?.[name] ?? ''} placeholder={defaultValue} onCommit={(value) => setVariable(name, value)} />
              </div>
            ))}
            <div style={{ fontSize: '.7em', opacity: 0.7 }}>{t('The values of this copy. Empty: the default value of the text.')}</div>
          </>
        )}
      </fieldset>

      <h4 style={sectionTitleStyle}>{t('Overlays in the block')}</h4>
      {def.members.length === 0 && <div style={{ fontSize: '.75em', opacity: 0.7 }}>{t('The block is empty.')}</div>}
      {def.members.map((member) => {
        const memberTime = memberTimes.get(member.id);
        const memberWarnings = resolved.get(getBlockMemberOverlayId(id, member.id))?.warnings ?? [];
        return (
          <button
            key={member.id}
            type="button"
            data-testid="block-member-row"
            onClick={() => selectBlockMember(id, member.id)}
            title={t('Edit this overlay')}
            style={{ ...iconButtonStyle, display: 'flex', width: '100%', marginBottom: '.2em', textAlign: 'left', justifyContent: 'flex-start' }}
          >
            <span style={{ opacity: 0.7, flexShrink: 0 }}>{getOverlayTypeLabel(member.type)}</span>
            <span style={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.name}</span>
            {memberTime != null && <span style={{ opacity: 0.7, flexShrink: 0 }}>+{formatDuration({ seconds: memberTime.start, shorten: true })}</span>}
            {(memberWarnings.length > 0 || missingFiles.some((m) => m.overlayId === member.id)) && <FaExclamationTriangle style={{ color: warningColor, flexShrink: 0 }} />}
          </button>
        );
      })}
      <div style={{ fontSize: '.7em', opacity: 0.7, marginTop: '.3em' }}>
        {linkedCount > 1 ? t('Editing an overlay changes all the linked copies.') : t('Times inside the block are relative to its start.')}
      </div>
    </div>
  );
}

export default memo(BlockPanel);
