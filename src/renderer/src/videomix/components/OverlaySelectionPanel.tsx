import type { CSSProperties } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FaFileExport, FaObjectGroup, FaTimes, FaTrash } from 'react-icons/fa';

import { controlsBackground, darkModeTransition } from '../../colors';
import type { MixClip } from '../types';
import type { MissingOverlayFile, OverlayFileKind } from '../projectFile';
import { getBlockDefTimes } from '../blocks/expandBlocks';
import { getAnchorTargets, getBlockLabel, isBlockDefLocked } from '../blocks/blockUi';
import type { UseMixOverlays } from '../hooks/useMixOverlays';
import type { UseBlockTemplates } from '../hooks/useBlockTemplates';
import OverlayPanel from './OverlayPanel';
import BlockPanel from './BlockPanel';

// T57: what replaces the clip list while something is selected in the Mix view: the properties of a loose overlay
// (T22), of a block, of a member edited inside its block, or the actions on a multi-selection.

const iconButtonStyle: CSSProperties = { font: 'inherit', fontSize: '.8em', padding: '.2em .4em', border: '1px solid var(--gray-7)', borderRadius: '.3em', background: 'var(--gray-3)', color: 'var(--gray-12)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '.3em' };

// eslint-disable-next-line react/display-name
const MultiSelectionPanel = memo(({ width, mixOverlays, blockTemplates }: { width: number, mixOverlays: UseMixOverlays, blockTemplates: Pick<UseBlockTemplates, 'userExportBlock'> }) => {
  const { t } = useTranslation();
  const { project, selectedIds, selectedLooseOverlayIds, selectedBlockIds, clearOverlaySelection, userGroupSelection, userRemoveSelection } = mixOverlays;
  const names = useMemo(() => selectedIds.map((id) => {
    const overlay = project.overlays.find((o) => o.id === id);
    if (overlay != null) return { id, name: overlay.name, block: false };
    const block = project.blocks.find((b) => b.id === id);
    return { id, name: block != null ? getBlockLabel(project, block) : id, block: true };
  }), [project, selectedIds]);
  // no nested blocks: only loose overlays can be grouped
  const canGroup = selectedBlockIds.length === 0 && selectedLooseOverlayIds.length > 0;
  return (
    <div className="consistent-scrollbar" data-testid="overlay-selection-panel" style={{ width, flexShrink: 0, overflowY: 'auto', background: controlsBackground, transition: darkModeTransition, padding: '.5em .6em', boxSizing: 'border-box', borderLeft: '1px solid var(--gray-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.3em' }}>
        <span style={{ fontSize: '.75em', color: 'var(--gray-11)', flexGrow: 1 }}>{t('{{count}} selected', { count: selectedIds.length })}</span>
        <button type="button" style={{ ...iconButtonStyle, border: 'none', background: 'transparent' }} title={t('Close')} onClick={clearOverlaySelection}><FaTimes /></button>
      </div>
      <ul style={{ fontSize: '.8em', paddingLeft: '1.2em', margin: '.4em 0' }}>
        {names.map(({ id, name, block }) => <li key={id}>{block ? `${name} (${t('Block')})` : name}</li>)}
      </ul>
      <div style={{ display: 'flex', gap: '.3em', flexWrap: 'wrap' }}>
        <button type="button" data-testid="group-overlays" style={{ ...iconButtonStyle, ...(!canGroup && { opacity: 0.5, cursor: 'default' }) }} disabled={!canGroup} title={canGroup ? t('They move as one piece and keep their times') : t('Only loose overlays can be grouped (a block can\'t contain blocks)')} onClick={userGroupSelection}><FaObjectGroup />{t('Group into block')}</button>
        <button type="button" data-testid="export-selection" style={{ ...iconButtonStyle, ...(!canGroup && { opacity: 0.5, cursor: 'default' }) }} disabled={!canGroup} title={canGroup ? t('Export selection as a block') : t('Only loose overlays can be exported (select a single block from its own panel instead)')} onClick={() => blockTemplates.userExportBlock({ overlayIds: selectedLooseOverlayIds })}><FaFileExport />{t('Export selection…')}</button>
        <button type="button" style={iconButtonStyle} onClick={userRemoveSelection} title={t('Locked blocks are kept')}><FaTrash />{t('Delete')}</button>
      </div>
      <div style={{ fontSize: '.7em', opacity: 0.7, marginTop: '.5em' }}>{t('Ctrl+click adds or removes an overlay or block from the selection, Shift+click adds it.')}</div>
    </div>
  );
});

function OverlaySelectionPanel({ width, clips, selectedClipIds, missingOverlayFiles, mixOverlays, onLocate, blockTemplates }: {
  width: number,
  clips: MixClip[],
  /** For "Repeat… at the start of each selected clip". */
  selectedClipIds: ReadonlySet<string>,
  missingOverlayFiles: readonly MissingOverlayFile[],
  mixOverlays: UseMixOverlays,
  /** `blockDefId` for a member of a block (`overlayId` is then its member id). */
  onLocate: (overlayId: string, kind: OverlayFileKind, blockDefId?: string | undefined) => void,
  /** For "Export selection…" on a multi-selection of loose overlays (T58's "Export selection" of H2). */
  blockTemplates: Pick<UseBlockTemplates, 'userExportBlock'>,
}) {
  const { project, plan, resolved, selectedOverlay, selectedBlock, selectedMember, selectedIds } = mixOverlays;

  const looseTargets = useMemo(() => (selectedOverlay != null && project.blocks.length > 0 ? getAnchorTargets(project, { overlayId: selectedOverlay.id }) : undefined), [project, selectedOverlay]);

  // the selected clips in video order (else list order)
  const orderedClipIds = useMemo(() => {
    const starts = new Map(plan?.placements.map((p) => [p.clipId, p.startTime]) ?? []);
    const order = new Map(clips.map((c, i) => [c.id, i]));
    return [...selectedClipIds].filter((id) => order.has(id)).sort((a, b) => (starts.get(a) ?? Infinity) - (starts.get(b) ?? Infinity) || order.get(a)! - order.get(b)!);
  }, [clips, plan, selectedClipIds]);

  const memberRelativeStart = useMemo(() => (selectedMember != null ? getBlockDefTimes(selectedMember.def).get(selectedMember.member.id)?.start ?? 0 : 0), [selectedMember]);

  if (selectedMember != null) {
    const { block, def, member, overlayId } = selectedMember;
    return (
      <OverlayPanel
        width={width}
        overlay={member}
        overlays={def.members}
        clips={clips}
        resolved={resolved}
        missingKinds={missingOverlayFiles.filter((m) => m.blockDefId === def.id && m.overlayId === member.id).map((m) => m.kind)}
        mixOverlays={mixOverlays}
        onLocate={(memberId, kind) => onLocate(memberId, kind, def.id)}
        member={{
          blockId: block.id,
          defId: def.id,
          overlayId,
          blockName: getBlockLabel(project, block),
          linkedCount: project.blocks.filter((b) => b.defId === def.id).length,
          locked: isBlockDefLocked(project, def.id),
          relativeStart: memberRelativeStart,
        }}
      />
    );
  }
  if (selectedOverlay != null) {
    return (
      <OverlayPanel
        width={width}
        overlay={selectedOverlay}
        overlays={project.overlays}
        clips={clips}
        resolved={resolved}
        missingKinds={missingOverlayFiles.filter((m) => m.blockDefId == null && m.overlayId === selectedOverlay.id).map((m) => m.kind)}
        mixOverlays={mixOverlays}
        onLocate={onLocate}
        elementTargets={looseTargets}
      />
    );
  }
  if (selectedBlock != null) {
    const def = project.blockDefs.find((d) => d.id === selectedBlock.defId);
    if (def == null) return null;
    return (
      <BlockPanel
        width={width}
        block={selectedBlock}
        def={def}
        clips={clips}
        selectedClipIds={orderedClipIds}
        missingFiles={missingOverlayFiles.filter((m) => m.blockDefId === def.id)}
        mixOverlays={mixOverlays}
        onLocate={onLocate}
      />
    );
  }
  if (selectedIds.length > 1) return <MultiSelectionPanel width={width} mixOverlays={mixOverlays} blockTemplates={blockTemplates} />;
  return null;
}

export default memo(OverlaySelectionPanel);
