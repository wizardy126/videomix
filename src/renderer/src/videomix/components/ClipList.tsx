import type { ChangeEventHandler, CSSProperties, FocusEventHandler, KeyboardEventHandler, MouseEventHandler } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FaClone, FaExclamationTriangle, FaGripVertical, FaInfoCircle, FaMinus, FaPlus, FaVolumeMute, FaVolumeUp } from 'react-icons/fa';
import { MdCropLandscape, MdCropPortrait } from 'react-icons/md';
import type { DragEndEvent, DragStartEvent, UniqueIdentifier } from '@dnd-kit/core';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CSS } from '@dnd-kit/utilities';

import useContextMenu from '../../hooks/useContextMenu';
import useUserSettings from '../../hooks/useUserSettings';
import useActionTitle from '../../hooks/useActionTitle';
import { useSegColors } from '../../contexts';
import { segColorsCount } from '../../util/colors';
import { formatDuration } from '../../util/duration';
import { controlsBackground, darkModeTransition, warningColor } from '../../colors';
import type { ContextMenuTemplate } from '../../types';
import type { MixClipPatch } from '../projectReducer';
import type { MixClip, MixSettings, MixSource } from '../types';
import { getClipDuration } from '../project';
import { getOrientation } from '../geometry';
import { clipGainValues, getClipWarnings } from '../clips';

const buttonBaseStyle: CSSProperties = {
  margin: '0 3px', borderRadius: 3, color: 'white', cursor: 'pointer', userSelect: 'none',
};
const disabledButtonStyle: CSSProperties = { color: 'var(--gray-10)', backgroundColor: 'var(--gray-6)' };
const iconStyle: CSSProperties = { flexShrink: 0, verticalAlign: 'middle' };
const plainInputStyle: CSSProperties = { font: 'inherit', color: 'inherit', background: 'transparent', border: '1px solid transparent', borderRadius: '.3em', padding: '0 .2em', minWidth: 0 };

const formatTime = (seconds: number) => formatDuration({ seconds, shorten: true });

const stopPropagation: MouseEventHandler = (e) => e.stopPropagation();

// eslint-disable-next-line react/display-name
const ClipRow = memo(({ clip, index, source, isSelected, dragging, settings, onSelect, onUpdate, onDuplicate, onRemove, onGoToSource }: {
  clip: MixClip,
  index: number,
  source: MixSource | undefined,
  isSelected: boolean,
  dragging?: boolean | undefined,
  settings: Pick<MixSettings, 'transition'>,
  onSelect: (id: string) => void,
  onUpdate: (id: string, patch: MixClipPatch) => void,
  onDuplicate: (id: string) => void,
  onRemove: (id: string) => void,
  onGoToSource: (id: string) => void,
}) => {
  const { t } = useTranslation();
  const { darkMode } = useUserSettings();
  const { getSegColor } = useSegColors();
  const ref = useRef<HTMLDivElement | null>(null);

  const [nameDraft, setNameDraft] = useState<string>();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const contextMenuTemplate = useMemo<ContextMenuTemplate>(() => [
    { label: t('Duplicate clip'), click: () => onDuplicate(clip.id) },
    { label: t('Remove clip'), click: () => onRemove(clip.id) },
    { type: 'separator' },
    { label: t('Go to source'), click: () => onGoToSource(clip.id) },
  ], [clip.id, onDuplicate, onGoToSource, onRemove, t]);

  useContextMenu(ref, contextMenuTemplate);

  const sortable = useSortable({ id: clip.id, transition: { duration: 150, easing: 'ease-in-out' } });

  const setRef = useCallback((node: HTMLDivElement | null) => {
    sortable.setNodeRef(node);
    ref.current = node;
  }, [sortable]);

  const getBadgeColor = useCallback((color: number) => getSegColor({ segColorIndex: color }).desaturate(0.25).lightness(darkMode ? 35 : 55).string(), [darkMode, getSegColor]);

  const duration = getClipDuration(clip);
  const warnings = useMemo(() => getClipWarnings(clip, settings), [clip, settings]);
  const orientation = getOrientation(clip.maxRect);

  const style = useMemo<CSSProperties>(() => ({
    visibility: sortable.isDragging ? 'hidden' : undefined,
    padding: '3px 5px',
    boxSizing: 'border-box',
    position: 'relative',
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    background: 'var(--gray-1)',
    border: `1px solid ${isSelected ? 'var(--gray-10)' : 'transparent'}`,
    borderRadius: 5,
    fontSize: 13,
    color: 'var(--gray-12)',
    cursor: 'pointer',
  }), [isSelected, sortable.isDragging, sortable.transform, sortable.transition]);

  const handleClick = useCallback<MouseEventHandler<HTMLDivElement>>((e) => {
    // give the focus back to the body, so the keyboard shortcuts keep working
    e.currentTarget.blur();
    onSelect(clip.id);
  }, [clip.id, onSelect]);

  const handleNameChange = useCallback<ChangeEventHandler<HTMLInputElement>>((e) => setNameDraft(e.target.value), []);
  const handleNameBlur = useCallback<FocusEventHandler<HTMLInputElement>>(() => {
    if (nameDraft != null && nameDraft.trim() !== '' && nameDraft !== clip.name) onUpdate(clip.id, { name: nameDraft.trim() });
    setNameDraft(undefined);
  }, [clip.id, clip.name, nameDraft, onUpdate]);
  const handleNameKeyDown = useCallback<KeyboardEventHandler<HTMLInputElement>>((e) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      setNameDraft(undefined);
      // blur after the draft is dropped, so nothing is saved
      const input = e.currentTarget;
      setTimeout(() => input.blur(), 0);
    }
  }, []);

  const handleBadgeClick = useCallback<MouseEventHandler>((e) => {
    e.stopPropagation();
    setPaletteOpen((v) => !v);
  }, []);

  const handleColorClick = useCallback((color: number) => {
    setPaletteOpen(false);
    onUpdate(clip.id, { color });
  }, [clip.id, onUpdate]);

  const handleMuteClick = useCallback<MouseEventHandler>((e) => {
    e.stopPropagation();
    onUpdate(clip.id, { muted: !clip.muted });
  }, [clip.id, clip.muted, onUpdate]);

  const handleGainChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    e.target.blur();
    onUpdate(clip.id, { gainDb: parseInt(e.target.value, 10) });
  }, [clip.id, onUpdate]);

  const OrientationIcon = orientation === 'horizontal' ? MdCropLandscape : MdCropPortrait;
  const MuteIcon = clip.muted ? FaVolumeMute : FaVolumeUp;

  return (
    <div ref={setRef} role="button" tabIndex={-1} onClick={handleClick} style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.3em' }}>
        <div
          // eslint-disable-next-line react/jsx-props-no-spreading
          {...sortable.attributes}
          // eslint-disable-next-line react/jsx-props-no-spreading
          {...sortable.listeners}
          role="button"
          tabIndex={-1}
          style={{ cursor: dragging ? 'grabbing' : 'grab', display: 'flex', alignItems: 'center', opacity: 0.5 }}
        >
          <FaGripVertical style={{ fontSize: '.8em' }} />
        </div>

        <b
          role="button"
          title={t('Change color')}
          onClick={handleBadgeClick}
          style={{ color: 'white', padding: '0 .3em', background: getBadgeColor(clip.color), borderRadius: '.35em', fontSize: '.8em', flexShrink: 0 }}
        >
          {index + 1}
        </b>

        <input
          value={nameDraft ?? clip.name}
          title={t('Clip name')}
          onChange={handleNameChange}
          onBlur={handleNameBlur}
          onKeyDown={handleNameKeyDown}
          onClick={stopPropagation}
          style={{ ...plainInputStyle, flexGrow: 1 }}
        />

        <MuteIcon role="button" title={clip.muted ? t('Unmute clip') : t('Mute clip')} onClick={handleMuteClick} style={{ ...iconStyle, cursor: 'pointer', opacity: clip.muted ? 1 : 0.6, color: clip.muted ? warningColor : undefined }} />

        <select value={clip.gainDb} title={t('Clip gain (dB)')} onChange={handleGainChange} onClick={stopPropagation} style={{ ...plainInputStyle, border: '1px solid var(--gray-7)', fontSize: '.85em', flexShrink: 0 }}>
          {clipGainValues.map((v) => <option key={v} value={v}>{v > 0 ? `+${v}` : v} dB</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '.5em', fontSize: '.8em', opacity: 0.8, marginTop: '.15em', paddingLeft: '1.1em' }}>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 0 }} title={source?.path}>{source?.name ?? '?'}</span>
        <span style={{ whiteSpace: 'nowrap' }}>{formatTime(clip.start)} – {formatTime(clip.end)}</span>
        <span style={{ whiteSpace: 'nowrap', fontWeight: 'bold' }}>{formatDuration({ seconds: duration, shorten: true })}</span>
        <div style={{ flexGrow: 1 }} />
        <OrientationIcon style={iconStyle} title={`${orientation === 'horizontal' ? t('Horizontal') : t('Vertical')} ${clip.maxRect.width}×${clip.maxRect.height}`} />
        {warnings.noMin && <FaInfoCircle style={{ ...iconStyle, opacity: 0.6 }} title={t('No min rectangle: the clip can only be shown with its max rectangle, it will not be cropped any further')} />}
        {warnings.tooShort && <FaExclamationTriangle style={{ ...iconStyle, color: warningColor }} title={t('The clip is not longer than two transitions ({{duration}} s), its transitions will be shortened', { duration: 2 * settings.transition.duration })} />}
      </div>

      {paletteOpen && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25em', marginTop: '.3em', paddingLeft: '1.1em' }}>
          {Array.from({ length: segColorsCount }, (_, color) => (
            <div
              key={color}
              role="button"
              tabIndex={-1}
              title={t('Change color')}
              onClick={(e) => { e.stopPropagation(); handleColorClick(color); }}
              style={{ width: '1.1em', height: '1.1em', borderRadius: '.25em', background: getBadgeColor(color), border: `2px solid ${color === clip.color ? 'var(--gray-12)' : 'transparent'}`, cursor: 'pointer' }}
            />
          ))}
        </div>
      )}
    </div>
  );
});

/** Right panel: all the clips of the project, of any source, in list (= mix) order. Replaces SegmentList in VideoMix. */
function ClipList({ width, clips, sources, settings, selectedClipId, onSelect, onUpdate, onReorder, onAdd, onDuplicate, onRemove, onGoToSource }: {
  width: number,
  clips: MixClip[],
  sources: MixSource[],
  settings: Pick<MixSettings, 'transition'>,
  selectedClipId: string | undefined,
  onSelect: (id: string) => void,
  onUpdate: (id: string, patch: MixClipPatch) => void,
  onReorder: (ids: string[]) => void,
  onAdd: () => void,
  onDuplicate: (id: string) => void,
  onRemove: (id: string) => void,
  onGoToSource: (id: string) => void,
}) {
  const { t } = useTranslation();
  const actionTitle = useActionTitle();
  const [draggingId, setDraggingId] = useState<UniqueIdentifier>();

  const sourcesById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const totalDuration = useMemo(() => clips.reduce((acc, clip) => acc + getClipDuration(clip), 0), [clips]);

  const scrollerRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 10 } }));

  // todo https://github.com/TanStack/virtual/issues/1119
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: clips.length,
    gap: 5,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => 48,
    overscan: 5,
    getItemKey: (index) => clips[index]!.id,
  });

  const selectedIndex = useMemo(() => clips.findIndex((c) => c.id === selectedClipId), [clips, selectedClipId]);
  useEffect(() => {
    if (selectedIndex !== -1) rowVirtualizer.scrollToIndex(selectedIndex, { behavior: 'smooth', align: 'auto' });
  }, [rowVirtualizer, selectedIndex]);

  const handleDragStart = useCallback((event: DragStartEvent) => setDraggingId(event.active.id), []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setDraggingId(undefined);
    const { active, over } = event;
    if (over == null || active.id === over.id) return;
    const ids = clips.map((c) => c.id);
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  }, [clips, onReorder]);

  const draggingIndex = clips.findIndex((c) => c.id === draggingId);
  const draggingClip = clips[draggingIndex];

  const renderRow = (clip: MixClip, index: number, dragging?: boolean) => (
    <ClipRow
      clip={clip}
      index={index}
      source={sourcesById.get(clip.sourceId)}
      isSelected={clip.id === selectedClipId}
      dragging={dragging}
      settings={settings}
      onSelect={onSelect}
      onUpdate={onUpdate}
      onDuplicate={onDuplicate}
      onRemove={onRemove}
      onGoToSource={onGoToSource}
    />
  );

  const hasSelection = selectedClipId != null;

  return (
    <div style={{ width, flexShrink: 0, background: controlsBackground, borderLeft: '1px solid var(--gray-7)', color: 'var(--gray-11)', transition: darkModeTransition, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="no-user-select" style={{ padding: '.2em .5em', color: 'var(--gray-12)', display: 'flex', alignItems: 'center', gap: '.5em', fontSize: '.8em' }}>
        <span style={{ flexGrow: 1 }}>{t('Clips')}{clips.length > 0 && ` (${clips.length})`}</span>
        {clips.length > 0 && <span title={t('Total duration of the clips')}>{formatDuration({ seconds: totalDuration, shorten: true, showFraction: false })}</span>}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
        <SortableContext items={clips} strategy={verticalListSortingStrategy}>
          <div ref={scrollerRef} style={{ padding: '0 .2em 0 .5em', overflowX: 'hidden', overflowY: 'scroll', flexGrow: 1 }} className="consistent-scrollbar">
            <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', overflow: 'hidden' }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const clip = clips[virtualRow.index]!;
                return (
                  <div
                    key={clip.id}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {renderRow(clip, virtualRow.index)}
                  </div>
                );
              })}
            </div>

            {clips.length === 0 && (
              <div className="no-user-select" style={{ padding: '1em .5em', fontSize: '.85em', opacity: 0.8, textAlign: 'center' }}>
                {t('No clips yet. Mark a start and an end in the timeline of a source, or click + to add a clip at the playhead.')}
              </div>
            )}
          </div>
        </SortableContext>

        <DragOverlay>
          {draggingClip != null ? renderRow(draggingClip, draggingIndex, true) : null}
        </DragOverlay>
      </DndContext>

      <div className="no-user-select" style={{ display: 'flex', padding: '5px 0', alignItems: 'center', justifyContent: 'center', borderTop: '1px solid var(--gray-6)' }}>
        <FaPlus size={24} role="button" title={actionTitle(t('Add clip'), 'addClip')} style={{ ...buttonBaseStyle, background: 'var(--cyan-9)', padding: 2 }} onClick={onAdd} />
        <FaClone size={24} role="button" title={actionTitle(t('Duplicate clip'), 'duplicateCurrentClip')} style={{ ...buttonBaseStyle, padding: 4, ...(hasSelection ? { background: 'var(--gray-9)' } : disabledButtonStyle) }} onClick={() => selectedClipId != null && onDuplicate(selectedClipId)} />
        <FaMinus size={24} role="button" title={actionTitle(t('Remove clip'), 'removeCurrentClip')} style={{ ...buttonBaseStyle, padding: 2, ...(hasSelection ? { background: 'var(--red-9)' } : disabledButtonStyle) }} onClick={() => selectedClipId != null && onRemove(selectedClipId)} />
      </div>
    </div>
  );
}

export default memo(ClipList);
