import type { ChangeEventHandler, CSSProperties, FocusEventHandler, KeyboardEventHandler, MouseEventHandler } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FaClone, FaExclamationTriangle, FaEye, FaGripVertical, FaInfoCircle, FaLink, FaMinus, FaPlus, FaThumbtack, FaTimes, FaUnlink, FaVolumeMute, FaVolumeUp } from 'react-icons/fa';
import { MdCropLandscape, MdCropPortrait, MdOpenInFull, MdRotate90DegreesCw } from 'react-icons/md';
import type { DragEndEvent, DragOverEvent, DragStartEvent, UniqueIdentifier } from '@dnd-kit/core';
import { DndContext, closestCenter, PointerSensor, useDroppable, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
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
import { getClipSelectModifiers } from '../hooks/useMixClipPins';
import { canExtendBeyondMax } from '../planner/plannerInput';
import type { ClipSelectModifiers, UseMixClipPins } from '../hooks/useMixClipPins';
import type { ClipLinkInfo } from '../clipLinks';

const buttonBaseStyle: CSSProperties = {
  margin: '0 3px', borderRadius: 3, color: 'white', cursor: 'pointer', userSelect: 'none',
};
const disabledButtonStyle: CSSProperties = { color: 'var(--gray-10)', backgroundColor: 'var(--gray-6)' };
const iconStyle: CSSProperties = { flexShrink: 0, verticalAlign: 'middle' };
const plainInputStyle: CSSProperties = { font: 'inherit', color: 'inherit', background: 'transparent', border: '1px solid transparent', borderRadius: '.3em', padding: '0 .2em', minWidth: 0 };

const formatTime = (seconds: number) => formatDuration({ seconds, shorten: true });

const stopPropagation: MouseEventHandler = (e) => e.stopPropagation();

const thumbnailStyle: CSSProperties = { width: 30, height: 30, flexShrink: 0, objectFit: 'cover', borderRadius: 3 };

// eslint-disable-next-line react/display-name
const ClipRow = memo(({ clip, index, source, thumbnailUrl, isSelected, pinTime, groupColor, linkInfo, sequenceIndex, getClipMenu, onSetLink, dragging, settings, onSelect, onUpdate, onDuplicate, onRemove, onGoToSource }: {
  clip: MixClip,
  index: number,
  source: MixSource | undefined,
  /** Start frame cropped to the clip's max rect (A2, T31), from `useClipThumbnails`. Undefined while it's generating. */
  thumbnailUrl: string | undefined,
  isSelected: boolean,
  /** A4 (T30): its pin time (its own or its group's) and its group's colour. */
  pinTime: number | undefined,
  groupColor: string | undefined,
  /** E2 (T39): its place in a chain of linked clips (undefined: it can't be in one). */
  linkInfo: ClipLinkInfo | undefined,
  /** E5 (T39): its index in the always-visible sequence. */
  sequenceIndex: number | undefined,
  getClipMenu: UseMixClipPins['getClipMenu'],
  onSetLink: UseMixClipPins['userSetClipLink'],
  dragging?: boolean | undefined,
  settings: Pick<MixSettings, 'transition'>,
  onSelect: (id: string, modifiers?: ClipSelectModifiers) => void,
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
    ...getClipMenu(clip),
  ], [clip, getClipMenu, onDuplicate, onGoToSource, onRemove, t]);

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
    // group colour (A4)
    ...(groupColor != null && { borderLeft: `3px solid ${groupColor}` }),
    borderRadius: 5,
    fontSize: 13,
    color: 'var(--gray-12)',
    cursor: 'pointer',
  }), [groupColor, isSelected, sortable.isDragging, sortable.transform, sortable.transition]);

  const handleClick = useCallback<MouseEventHandler<HTMLDivElement>>((e) => {
    // give the focus back to the body, so the keyboard shortcuts keep working
    e.currentTarget.blur();
    onSelect(clip.id, getClipSelectModifiers(e));
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
  // E7 (T38b): on by default, only `false` is stored
  const extendBeyondMax = canExtendBeyondMax(clip);
  const handleExtendClick = useCallback<MouseEventHandler>((e) => {
    e.stopPropagation();
    onUpdate(clip.id, { extendBeyondMax: extendBeyondMax ? false : undefined });
  }, [clip.id, extendBeyondMax, onUpdate]);

  const MuteIcon = clip.muted ? FaVolumeMute : FaVolumeUp;

  // E2 (T39): the link with the previous clip of its source can be broken (or made again) from its indicator
  const handleLinkClick = useCallback<MouseEventHandler>((e) => {
    e.stopPropagation();
    if (linkInfo != null) onSetLink(clip.id, !linkInfo.linked);
  }, [clip.id, linkInfo, onSetLink]);

  return (
    <div ref={setRef} role="button" tabIndex={-1} data-testid="clip-row" onClick={handleClick} style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.3em' }}>
        <div
          // eslint-disable-next-line react/jsx-props-no-spreading
          {...sortable.attributes}
          // eslint-disable-next-line react/jsx-props-no-spreading
          {...sortable.listeners}
          role="button"
          tabIndex={-1}
          data-testid="clip-drag-handle"
          style={{ cursor: dragging ? 'grabbing' : 'grab', display: 'flex', alignItems: 'center', opacity: 0.5 }}
        >
          <FaGripVertical style={{ fontSize: '.8em' }} />
        </div>

        {thumbnailUrl != null ? <img src={thumbnailUrl} alt="" draggable={false} style={thumbnailStyle} /> : <div style={thumbnailStyle} />}

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
          style={{ ...plainInputStyle, flexGrow: 1, minWidth: '3em' }}
        />
        {/* E5 (T39): in the always-visible sequence */}
        {sequenceIndex != null && (
          <span data-testid="clip-sequence-indicator" title={t('In the always-visible sequence (number {{number}}): always on screen, in a slot of its own', { number: sequenceIndex + 1 })} style={{ display: 'flex', alignItems: 'center', gap: '.15em', whiteSpace: 'nowrap', fontSize: '.8em', color: 'var(--grass-11)', flexShrink: 0 }}>
            <FaEye style={iconStyle} />
            {sequenceIndex + 1}
          </span>
        )}
        {/* E2 (T39): linked with the previous clip of its source (a chain; its icon breaks the link), or a link broken by hand */}
        {linkInfo != null && linkInfo.length > 1 && (
          <span
            data-testid="clip-link-indicator"
            title={linkInfo.linked
              ? t('Linked with the previous clip of its source ({{position}} of {{length}} in the chain): they play one after the other in the same slot. Click to break the link', { position: linkInfo.position, length: linkInfo.length })
              : t('Starts a chain of {{length}} linked clips of its source: they play one after the other in the same slot', { length: linkInfo.length })}
            style={{ display: 'flex', alignItems: 'center', gap: '.15em', whiteSpace: 'nowrap', fontSize: '.8em', color: 'var(--blue-11)', opacity: linkInfo.linked ? 1 : 0.7, flexShrink: 0 }}
          >
            <FaLink role={linkInfo.linked ? 'button' : undefined} data-testid={linkInfo.linked ? 'clip-link-toggle' : undefined} onClick={linkInfo.linked ? handleLinkClick : undefined} style={{ ...iconStyle, cursor: linkInfo.linked ? 'pointer' : undefined }} />
            {`${linkInfo.position}/${linkInfo.length}`}
          </span>
        )}
        {linkInfo != null && !linkInfo.linked && linkInfo.previousId != null && (clip.link === 'break' || linkInfo.autoLinked) && (
          <FaUnlink role="button" data-testid="clip-unlinked-indicator" onClick={handleLinkClick} title={t('Link with the previous clip broken. Click to link it again')} style={{ ...iconStyle, cursor: 'pointer', opacity: 0.6, fontSize: '.8em' }} />
        )}
      </div>

      {/* T34: moved down from the first row (with the drag handle, thumbnail, color badge and name) so the name field has the whole row's width */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5em', fontSize: '.8em', opacity: 0.8, marginTop: '.15em', paddingLeft: '1.1em' }}>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 0 }} title={source?.path}>{source?.name ?? '?'}</span>
        <span style={{ whiteSpace: 'nowrap' }}>{formatTime(clip.start)} – {formatTime(clip.end)}</span>
        <span style={{ whiteSpace: 'nowrap', fontWeight: 'bold' }}>{formatDuration({ seconds: duration, shorten: true })}</span>
        <MuteIcon role="button" title={clip.muted ? t('Unmute clip') : t('Mute clip')} onClick={handleMuteClick} style={{ ...iconStyle, cursor: 'pointer', opacity: clip.muted ? 1 : 0.6, color: clip.muted ? warningColor : undefined }} />
        <MdOpenInFull
          role="switch"
          aria-checked={extendBeyondMax}
          data-testid="clip-extend-toggle"
          title={extendBeyondMax
            ? t('Extend beyond the max if needed: on. To avoid fill, the clip may show more of its source than its max rectangle. Click to turn it off')
            : t('Extend beyond the max if needed: off. Click to turn it on')}
          onClick={handleExtendClick}
          style={{ ...iconStyle, cursor: 'pointer', opacity: extendBeyondMax ? 0.6 : 0.25 }}
        />
        <select value={clip.gainDb} title={t('Clip gain (dB)')} onChange={handleGainChange} onClick={stopPropagation} style={{ ...plainInputStyle, border: '1px solid var(--gray-7)', fontSize: '.85em', flexShrink: 0 }}>
          {clipGainValues.map((v) => <option key={v} value={v}>{v > 0 ? `+${v}` : v} dB</option>)}
        </select>
        <div style={{ flexGrow: 1 }} />
        {pinTime != null && <FaThumbtack style={{ ...iconStyle, color: 'var(--cyan-11)' }} title={t('Pinned at {{time}} of the video', { time: formatTime(pinTime) })} />}
        {/* E9 (T38d): the clip is turned (its orientation is that of the turned frame) */}
        {clip.rotation != null && clip.rotation !== 0 && (
          <span data-testid="clip-rotation-indicator" title={t('Rotated {{degrees}}°', { degrees: clip.rotation })} style={{ display: 'flex', alignItems: 'center', gap: '.1em', whiteSpace: 'nowrap' }}>
            <MdRotate90DegreesCw style={iconStyle} />
            {`${clip.rotation}°`}
          </span>
        )}
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

// E5 (T39): the always-visible sequence's items share the list's DndContext with prefixed ids (a clip is in both)
const SEQUENCE_ITEM_PREFIX = 'sequence:';
const SEQUENCE_DROP_ZONE = 'sequence-drop-zone';
const toSequenceItemId = (clipId: string) => `${SEQUENCE_ITEM_PREFIX}${clipId}`;
const fromSequenceItemId = (id: UniqueIdentifier) => (String(id).startsWith(SEQUENCE_ITEM_PREFIX) ? String(id).slice(SEQUENCE_ITEM_PREFIX.length) : undefined);

const sequenceThumbnailStyle: CSSProperties = { width: 20, height: 20, flexShrink: 0, objectFit: 'cover', borderRadius: 2 };

/** A clip of the always-visible sequence: sortable in the sequence, removable, click selects it. */
// eslint-disable-next-line react/display-name
const SequenceRow = memo(({ clip, index, thumbnailUrl, isSelected, dragging, onSelect, onRemove }: {
  clip: MixClip,
  index: number,
  thumbnailUrl: string | undefined,
  isSelected: boolean,
  dragging?: boolean | undefined,
  onSelect: (id: string, modifiers?: ClipSelectModifiers) => void,
  onRemove: (clipIds: string[]) => void,
}) => {
  const { t } = useTranslation();
  const sortable = useSortable({ id: toSequenceItemId(clip.id), transition: { duration: 150, easing: 'ease-in-out' } });
  const style = useMemo<CSSProperties>(() => ({
    visibility: sortable.isDragging ? 'hidden' : undefined,
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    display: 'flex',
    alignItems: 'center',
    gap: '.3em',
    padding: '1px 4px',
    background: 'var(--gray-1)',
    border: `1px solid ${isSelected ? 'var(--gray-10)' : 'transparent'}`,
    borderRadius: 4,
    fontSize: 12,
    color: 'var(--gray-12)',
    cursor: 'pointer',
  }), [isSelected, sortable.isDragging, sortable.transform, sortable.transition]);
  const handleClick = useCallback<MouseEventHandler<HTMLDivElement>>((e) => {
    e.currentTarget.blur();
    onSelect(clip.id, getClipSelectModifiers(e));
  }, [clip.id, onSelect]);
  const handleRemove = useCallback<MouseEventHandler>((e) => {
    e.stopPropagation();
    onRemove([clip.id]);
  }, [clip.id, onRemove]);
  const setRef = useCallback((node: HTMLDivElement | null) => sortable.setNodeRef(node), [sortable]);
  return (
    <div ref={setRef} role="button" tabIndex={-1} data-testid="sequence-row" onClick={handleClick} style={style}>
      <div
        // eslint-disable-next-line react/jsx-props-no-spreading
        {...sortable.attributes}
        // eslint-disable-next-line react/jsx-props-no-spreading
        {...sortable.listeners}
        role="button"
        tabIndex={-1}
        data-testid="sequence-drag-handle"
        style={{ cursor: dragging ? 'grabbing' : 'grab', display: 'flex', alignItems: 'center', opacity: 0.5 }}
      >
        <FaGripVertical style={{ fontSize: '.8em' }} />
      </div>
      <span style={{ opacity: 0.7, minWidth: '1.2em' }}>{index + 1}</span>
      {thumbnailUrl != null ? <img src={thumbnailUrl} alt="" draggable={false} style={sequenceThumbnailStyle} /> : <div style={sequenceThumbnailStyle} />}
      <span style={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip.name}</span>
      <span style={{ opacity: 0.7 }}>{formatTime(getClipDuration(clip))}</span>
      <FaTimes role="button" data-testid="sequence-remove" title={t('Remove from the always-visible sequence')} onClick={handleRemove} style={{ ...iconStyle, cursor: 'pointer', opacity: 0.6 }} />
    </div>
  );
});

/**
 * E5 (T39): the always-visible sequence, above the clip list. Its clips play one after the other in a slot of their
 * own, always on screen. Clips are added by dragging them here from the list (or with their context menu), sorted by
 * dragging, and removed with their ×.
 */
// eslint-disable-next-line react/display-name
const SequenceSection = memo(({ clips, thumbnailUrls, selectedClipIds, dropActive, onSelect, onRemove }: {
  /** The sequence's clips, in order. */
  clips: MixClip[],
  thumbnailUrls: ReadonlyMap<string, string>,
  selectedClipIds: ReadonlySet<string>,
  /** A clip of the list is being dragged over the section. */
  dropActive: boolean,
  onSelect: (id: string, modifiers?: ClipSelectModifiers) => void,
  onRemove: (clipIds: string[]) => void,
}) => {
  const { t } = useTranslation();
  const droppable = useDroppable({ id: SEQUENCE_DROP_ZONE });
  const setRef = useCallback((node: HTMLDivElement | null) => droppable.setNodeRef(node), [droppable]);
  const duration = useMemo(() => clips.reduce((acc, clip) => acc + getClipDuration(clip), 0), [clips]);
  return (
    <div
      ref={setRef}
      data-testid="sequence-section"
      style={{ margin: '0 .2em .3em .5em', padding: '.2em', borderRadius: 5, border: `1px dashed ${dropActive ? 'var(--grass-9)' : 'var(--gray-7)'}`, background: dropActive ? 'var(--grass-a3)' : undefined }}
    >
      <div
        className="no-user-select"
        title={t('Clips of the always-visible sequence play one after the other in a slot of their own, so one of them is always on screen. The mix lasts at least as long as the sequence.')}
        style={{ display: 'flex', alignItems: 'center', gap: '.4em', fontSize: '.75em', color: 'var(--gray-12)', padding: '0 .2em' }}
      >
        <FaEye style={{ ...iconStyle, color: 'var(--grass-11)' }} />
        <span style={{ flexGrow: 1 }}>{t('Always visible')}{clips.length > 0 && ` (${clips.length})`}</span>
        {clips.length > 0 && <span>{formatDuration({ seconds: duration, shorten: true, showFraction: false })}</span>}
      </div>
      <SortableContext items={clips.map((clip) => toSequenceItemId(clip.id))} strategy={verticalListSortingStrategy}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 130, overflowY: 'auto', marginTop: clips.length > 0 ? 2 : 0 }} className="consistent-scrollbar">
          {clips.map((clip, index) => (
            <SequenceRow key={clip.id} clip={clip} index={index} thumbnailUrl={thumbnailUrls.get(clip.id)} isSelected={selectedClipIds.has(clip.id)} onSelect={onSelect} onRemove={onRemove} />
          ))}
        </div>
      </SortableContext>
      {clips.length === 0 && (
        <div className="no-user-select" style={{ fontSize: '.7em', opacity: 0.7, padding: '.1em .2em', textAlign: 'center' }}>
          {t('Drag clips here to keep one of them always on screen')}
        </div>
      )}
    </div>
  );
});

/** Right panel: all the clips of the project, of any source, in list (= mix) order. Replaces SegmentList in VideoMix. */
function ClipList({ width, clips, sources, thumbnailUrls, settings, selectedClipId, clipPins, onSelect, onUpdate, onReorder, onAdd, onDuplicate, onRemove, onGoToSource }: {
  width: number,
  clips: MixClip[],
  sources: MixSource[],
  /** From `useClipThumbnails` (A2, T31), shared with `MixPlanView`. */
  thumbnailUrls: ReadonlyMap<string, string>,
  settings: Pick<MixSettings, 'transition'>,
  selectedClipId: string | undefined,
  /** Multi-selection, pins and groups (A4, T30); chains and the always-visible sequence (T39). */
  clipPins: Pick<UseMixClipPins, 'selectedClipIds' | 'pinTimes' | 'groupColors' | 'getClipMenu' | 'linkInfos' | 'userSetClipLink' | 'sequence' | 'sequenceIndexes' | 'userAddToSequence' | 'userRemoveFromSequence' | 'userReorderSequence'>,
  /** With modifiers: Ctrl/Cmd-click and Shift-click multi-selection. */
  onSelect: (id: string, modifiers?: ClipSelectModifiers) => void,
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

  const { sequence, userAddToSequence, userReorderSequence, userRemoveFromSequence } = clipPins;
  const clipsById = useMemo(() => new Map(clips.map((c) => [c.id, c])), [clips]);
  const sequenceClips = useMemo(() => sequence.flatMap((id) => clipsById.get(id) ?? []), [clipsById, sequence]);
  // a clip of the list over the sequence section (or one of its rows): it's added there on drop
  const [overSequence, setOverSequence] = useState(false);

  const handleDragStart = useCallback((event: DragStartEvent) => setDraggingId(event.active.id), []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    setOverSequence(fromSequenceItemId(active.id) == null && over != null && (over.id === SEQUENCE_DROP_ZONE || fromSequenceItemId(over.id) != null));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setDraggingId(undefined);
    setOverSequence(false);
    const { active, over } = event;
    if (over == null || active.id === over.id) return;
    const activeSequenceId = fromSequenceItemId(active.id);
    const overSequenceId = fromSequenceItemId(over.id);
    // E5 (T39): sorting the sequence, or adding a clip of the list to it
    if (activeSequenceId != null) {
      if (overSequenceId != null) userReorderSequence(arrayMove(sequence, sequence.indexOf(activeSequenceId), sequence.indexOf(overSequenceId)));
      return;
    }
    if (over.id === SEQUENCE_DROP_ZONE) {
      userAddToSequence([String(active.id)]);
      return;
    }
    if (overSequenceId != null) {
      userAddToSequence([String(active.id)], sequence.indexOf(overSequenceId));
      return;
    }
    const ids = clips.map((c) => c.id);
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  }, [clips, onReorder, sequence, userAddToSequence, userReorderSequence]);

  const handleDragCancel = useCallback(() => {
    setDraggingId(undefined);
    setOverSequence(false);
  }, []);

  const draggingSequenceId = draggingId != null ? fromSequenceItemId(draggingId) : undefined;
  const draggingIndex = clips.findIndex((c) => c.id === draggingId);
  const draggingClip = clips[draggingIndex];
  const draggingSequenceClip = draggingSequenceId != null ? clipsById.get(draggingSequenceId) : undefined;

  const renderRow = (clip: MixClip, index: number, dragging?: boolean) => (
    <ClipRow
      clip={clip}
      index={index}
      source={sourcesById.get(clip.sourceId)}
      thumbnailUrl={thumbnailUrls.get(clip.id)}
      isSelected={clipPins.selectedClipIds.has(clip.id)}
      pinTime={clipPins.pinTimes.get(clip.id)}
      groupColor={clip.groupId != null ? clipPins.groupColors.get(clip.groupId) : undefined}
      linkInfo={clipPins.linkInfos.get(clip.id)}
      sequenceIndex={clipPins.sequenceIndexes.get(clip.id)}
      getClipMenu={clipPins.getClipMenu}
      onSetLink={clipPins.userSetClipLink}
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
    <div data-testid="clip-list" style={{ width, flexShrink: 0, background: controlsBackground, borderLeft: '1px solid var(--gray-7)', color: 'var(--gray-11)', transition: darkModeTransition, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="no-user-select" style={{ padding: '.2em .5em', color: 'var(--gray-12)', display: 'flex', alignItems: 'center', gap: '.5em', fontSize: '.8em' }}>
        <span style={{ flexGrow: 1 }}>{t('Clips')}{clips.length > 0 && ` (${clips.length})`}</span>
        {clips.length > 0 && <span title={t('Total duration of the clips')}>{formatDuration({ seconds: totalDuration, shorten: true, showFraction: false })}</span>}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel} modifiers={[restrictToVerticalAxis]}>
        <SequenceSection clips={sequenceClips} thumbnailUrls={thumbnailUrls} selectedClipIds={clipPins.selectedClipIds} dropActive={overSequence} onSelect={onSelect} onRemove={userRemoveFromSequence} />

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
          {draggingSequenceClip != null && (
            <SequenceRow clip={draggingSequenceClip} index={sequence.indexOf(draggingSequenceClip.id)} thumbnailUrl={thumbnailUrls.get(draggingSequenceClip.id)} isSelected={false} dragging onSelect={onSelect} onRemove={userRemoveFromSequence} />
          )}
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
