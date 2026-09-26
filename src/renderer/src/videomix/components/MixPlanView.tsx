import type { CSSProperties, MouseEventHandler, PointerEvent as ReactPointerEvent, PointerEventHandler, ReactNode, RefObject } from 'react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { FaCaretDown, FaCaretRight, FaCut, FaExclamationTriangle, FaEye, FaEyeSlash, FaFont, FaImage, FaLink, FaLock, FaPlus, FaSearchMinus, FaSearchPlus, FaStopwatch, FaThumbtack, FaVolumeUp } from 'react-icons/fa';
import { MdLinearScale, MdOpenInFull } from 'react-icons/md';

import { useSegColors } from '../../contexts';
import useUserSettings from '../../hooks/useUserSettings';
import { controlsBackground, darkModeTransition, timelineBackground, warningColor } from '../../colors';
import { formatDuration } from '../../util/duration';
import type { MixBlock, MixBlockDef, MixClip, MixOverlay, MixSettings, OverlayAnchor } from '../types';
import { getCellRect } from '../geometry';
import { getPlanAxis } from '../planner/types';
import type { ColumnPlacement, MixPlan, PlanWarning } from '../planner/types';
import { getColumnsAtFrame, getFillSpansAtFrame, getRenderTimeline } from '../render/renderTimeline';
import { getColumnFillSpans, getMixLanes, getPlacementAt, getPlacementWarnings, timeToPercent } from '../mixPlanLayout';
import { clampMixZoom, getAnchoredScrollLeft, getFollowScrollLeft, getMaxMixZoom, getTimeTicks, getWheelPixels, getWheelZoomFactor, MIX_ZOOM_STEP } from '../mixPlanZoom';
import type { UseMixOverlays } from '../hooks/useMixOverlays';
import type { MissingOverlayFile } from '../projectFile';
import type { DragHandle } from '../overlayMath';
import { resizeHandles } from '../overlayMath';
import { applyOverlayBoxDrag, getOverlayFrameBoxes, getOverlayMovePatch, getOverlayResizePatch, layoutOverlayLanes, pixelsToSeconds } from '../overlayTimeline';
import type { OverlayFrameBox, OverlayLaneItem } from '../overlayTimeline';
import { getOverlayLaneLabel, getOverlayTimeWarningText } from '../overlayTexts';
import { getLinkedCountdown } from '../overlays/anchors';
import { getCountdownTextAt, getOverlayFrames } from '../overlays/overlayFrames';
import { getSlideOffset, getTextEntryFrames, getTextFontSizeForBox, getTextOpacity, getTextOverlayFontSize, getTypewriterCount, splitGraphemes, splitTextLines } from '../overlays/textLayout';
import styles from './MixPlanView.module.css';
import { getClipSelectModifiers } from '../hooks/useMixClipPins';
import { getBlockDefTimes } from '../blocks/expandBlocks';
import { getBlockMoveAnchor, getSelectionMode, isBlockDefLocked, layoutBlockLane } from '../blocks/blockUi';
import type { BlockLaneItem } from '../blocks/blockUi';
import type { MixOverlayPatch } from '../projectReducer';
import type { ClipSelectModifiers, UseMixClipPins } from '../hooks/useMixClipPins';
import BlockTemplateButtons from './BlockTemplateButtons';
import type { UseBlockTemplates } from '../hooks/useBlockTemplates';

const { pathToFileURL } = window.require('@electron/remote').require('./index.js');

// Timeline of the mix plan (T15, 04-diseno §6.6): an alternative to the source Timeline that shows the MixPlan
// instead of the active source. A lane per column, the mini frame view and the fill/warning markers reuse the exact
// geometry the render uses (render/renderTimeline.ts), so what's shown here matches T13's render.
// T22 adds the overlay lanes (images, countdowns/bars, sounds) with draggable blocks, the Mix view cursor where new
// overlays are added, and the overlay boxes on the mini frame, which can be moved/resized there.
// T26 adds the texts (in the countdowns/bars lane), drawn on the mini frame with their fades and entry animation.
// T53: columns that don't coincide in time share a lane (G3), and the lanes zoom and scroll horizontally (A3), with a
// time axis above them.
// T57: overlay multi-selection (Ctrl/Shift+click) and a lane of blocks of overlays: each block is one piece that drags
// as a whole, with its members (unless collapsed) below it, which can be selected and edited inside the block.

const LANE_HEIGHT = 22;
const OVERLAY_ROW_HEIGHT = 16;
const MAX_LANES_HEIGHT = 170;
const TIME_AXIS_HEIGHT = 14;
/** The mini frame fits in this box with the output's aspect: 192×108 in 16:9, 84×150 in 9:16, 150×150 in 1:1. */
const FRAME_MAX_WIDTH = 192;
const FRAME_MAX_HEIGHT = 150;
/** A 0 s block (e.g. a sound whose duration isn't known yet) still gets this share of the axis, to be clickable. */
const MIN_BLOCK_FRACTION = 0.01;

const fillStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  background: 'repeating-linear-gradient(45deg, var(--gray-6) 0, var(--gray-6) 4px, transparent 4px, transparent 8px)',
};

const relayoutBandStyle: CSSProperties = { position: 'absolute', top: 0, bottom: 0, background: 'var(--gray-8)', opacity: 0.35, pointerEvents: 'none' };

const overlayColors: Record<MixOverlay['type'], string> = {
  image: 'var(--blue-9)',
  countdown: 'var(--orange-9)',
  progressBar: 'var(--grass-9)',
  sound: 'var(--purple-9)',
  text: 'var(--amber-9)',
};

const disabledButtonStyle: CSSProperties = { opacity: 0.5, cursor: 'default' };

const toolbarButtonStyle: CSSProperties = { font: 'inherit', fontSize: '.75em', padding: '.1em .5em', border: '1px solid var(--gray-7)', borderRadius: '.3em', background: 'var(--gray-3)', color: 'var(--gray-12)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '.3em', whiteSpace: 'nowrap' };

function warningTooltip(t: TFunction, warnings: PlanWarning[], rows: boolean) {
  return warnings.map((w) => {
    if (w.type === 'upscale') return t('Enlarged more than the recommended limit');
    // a lane is a row in a vertical plan (T29)
    if (w.type === 'pillarbox' || w.type === 'letterbox') return rows ? t('Gets fill around it in this row') : t('Gets fill around it in this column');
    // A4 (T30)
    if (w.type === 'pin-shifted') return t('Pinned at {{pinTime}} but starts at {{time}}: there is no room for it then', { pinTime: formatDuration({ seconds: w.pinTime, shorten: true }), time: formatDuration({ seconds: w.time, shorten: true }) });
    if (w.type === 'group-split') return t('Its group doesn\'t start together: it has more clips than columns, or there is no room for all of them');
    // E7 (T38b)
    if (w.type === 'extended') {
      const range = { from: formatDuration({ seconds: w.time, shorten: true }), to: formatDuration({ seconds: w.endTime, shorten: true }) };
      return rows
        ? t('Shows {{pixels}} px above and below its max rectangle from {{from}} to {{to}}, to avoid fill', { pixels: w.pixels, ...range })
        : t('Shows {{pixels}} px beside its max rectangle from {{from}} to {{to}}, to avoid fill', { pixels: w.pixels, ...range });
    }
    // E4 (T39): cut at the maximum duration
    if (w.type === 'truncated') return t('Cut at {{time}}: the mix reaches its maximum duration', { time: formatDuration({ seconds: w.time, shorten: true }) });
    return t('Its transition is shortened');
  }).join('; ');
}

// eslint-disable-next-line react/display-name
const Block = memo(({ placement, clip, laneWidthPercent, color, name, thumbnailUrl, warnings, isSelected, rows, pinned, groupColor, linked, sequenceIndex, dragging, openClipMenu, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: {
  placement: ColumnPlacement,
  clip: MixClip | undefined,
  laneWidthPercent: { left: number, width: number },
  color: string,
  name: string,
  /** From `useClipThumbnails` (A2, T31), shown only if the block is wide enough (MixPlanView.module.css). */
  thumbnailUrl: string | undefined,
  warnings: PlanWarning[],
  isSelected: boolean,
  rows: boolean,
  /** A4 (T30): pinned (its own pin or its group's), its group's colour, the clip menu and the drag that pins it. */
  pinned: boolean,
  groupColor: string | undefined,
  /** E2 (T39): linked with the previous clip of its chain (right before it in the same lane). */
  linked: boolean,
  /** E5 (T39): its index in the always-visible sequence. */
  sequenceIndex: number | undefined,
  dragging: boolean,
  openClipMenu: UseMixClipPins['openClipMenu'],
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>, p: ColumnPlacement) => void,
  onPointerMove: PointerEventHandler<HTMLDivElement>,
  onPointerUp: PointerEventHandler<HTMLDivElement>,
  onPointerCancel: PointerEventHandler<HTMLDivElement>,
}) => {
  const { t } = useTranslation();
  const handleContextMenu = useCallback<MouseEventHandler<HTMLDivElement>>((e) => {
    e.preventDefault();
    if (clip != null) openClipMenu(clip);
  }, [clip, openClipMenu]);
  const handlePointerDown = useCallback<PointerEventHandler<HTMLDivElement>>((e) => onPointerDown(e, placement), [onPointerDown, placement]);
  const duration = placement.endTime - placement.startTime;
  // Crossfade with the previous/next clip of the column, as a fraction of this block's own width (visual only).
  const inFrac = duration > 0 ? Math.min(1, placement.transitionIn / duration) : 0;
  const outFrac = duration > 0 ? Math.min(1, (placement.transitionOut ?? 0) / duration) : 0;

  const style = useMemo<CSSProperties>(() => ({
    position: 'absolute',
    top: 1,
    bottom: 1,
    left: `${laneWidthPercent.left}%`,
    width: `${laneWidthPercent.width}%`,
    background: color,
    // a chain's blocks are joined (no rounded corner at the link)
    borderRadius: linked ? '0 3px 3px 0' : 3,
    overflow: 'hidden',
    border: `1px solid ${isSelected ? 'var(--gray-12)' : 'transparent'}`,
    ...(linked && !isSelected && { borderLeft: '1px dashed rgba(255,255,255,.6)' }),
    boxSizing: 'border-box',
    cursor: dragging ? 'grabbing' : 'pointer',
    containerType: 'inline-size',
    touchAction: 'none',
    ...(dragging && { opacity: 0.8, zIndex: 1 }),
  }), [color, dragging, isSelected, laneWidthPercent.left, laneWidthPercent.width, linked]);

  return (
    <div
      style={style}
      data-testid="mix-block"
      data-clip-id={placement.clipId}
      data-sequence={sequenceIndex != null ? sequenceIndex + 1 : undefined}
      data-linked={linked || undefined}
      data-selected={isSelected || undefined}
      title={[
        `${name}${pinned ? ` — ${t('Pinned')}` : ''}${warnings.length > 0 ? ` — ${warningTooltip(t, warnings, rows)}` : ''}`,
        ...(sequenceIndex != null ? [t('Always-visible sequence, number {{number}}', { number: sequenceIndex + 1 })] : []),
        ...(linked ? [t('Linked with the previous clip of its source')] : []),
        t('Drag to pin it at another time'),
      ].join('\n')}
      onPointerDown={handlePointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={handleContextMenu}
    >
      {thumbnailUrl != null && (
        <div className={styles['thumbWrap']}>
          <img src={thumbnailUrl} alt="" draggable={false} className={styles['thumbImg']} />
          <div className={styles['thumbTint']} style={{ background: color, opacity: 0.55 }} />
        </div>
      )}
      {inFrac > 0 && <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${inFrac * 100}%`, background: 'linear-gradient(90deg, rgba(255,255,255,.4), transparent)', pointerEvents: 'none' }} />}
      {outFrac > 0 && <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: `${outFrac * 100}%`, background: 'linear-gradient(90deg, transparent, rgba(0,0,0,.4))', pointerEvents: 'none' }} />}
      <div className="no-user-select" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: '.2em', padding: '0 .3em', fontSize: '.75em', color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', pointerEvents: 'none' }}>
        {linked && <FaLink style={{ flexShrink: 0, opacity: 0.8 }} />}
        {sequenceIndex != null && <FaEye style={{ flexShrink: 0 }} />}
        {pinned && <FaThumbtack style={{ flexShrink: 0 }} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
        {/* E7 (T38b): extended beyond its max (informative), apart from the real warnings */}
        {warnings.some((w) => w.type === 'extended') && <MdOpenInFull data-testid="clip-extended" style={{ flexShrink: 0 }} />}
        {warnings.some((w) => w.type !== 'extended') && <FaExclamationTriangle style={{ flexShrink: 0, color: warningColor }} />}
      </div>
      {groupColor != null && <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: groupColor, pointerEvents: 'none' }} />}
      {/* E5 (T39): the sequence's slot */}
      {sequenceIndex != null && <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, background: 'var(--grass-9)', pointerEvents: 'none' }} />}
    </div>
  );
});

type BlockDragMode = 'move' | 'resize';

const stopPropagation: MouseEventHandler = (e) => e.stopPropagation();

/** An overlay's block in its lane. Pointer handlers come from the view, which runs the drag (pointer capture on this element). */
// eslint-disable-next-line react/display-name
const OverlayBlock = memo(({ overlay, item, duration, isSelected, canMove, canResize, tooltip, hasWarning, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: {
  overlay: MixOverlay,
  item: OverlayLaneItem,
  duration: number,
  isSelected: boolean,
  canMove: boolean,
  canResize: boolean,
  tooltip: string,
  hasWarning: boolean,
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>, overlayId: string, mode: BlockDragMode) => void,
  onPointerMove: PointerEventHandler<HTMLDivElement>,
  onPointerUp: PointerEventHandler<HTMLDivElement>,
  onPointerCancel: PointerEventHandler<HTMLDivElement>,
}) => {
  const left = timeToPercent(item.start, duration);
  const width = Math.max(MIN_BLOCK_FRACTION * 100, timeToPercent(item.end, duration) - left);
  const handleMovePointerDown = useCallback<PointerEventHandler<HTMLDivElement>>((e) => onPointerDown(e, overlay.id, 'move'), [onPointerDown, overlay.id]);
  const handleResizePointerDown = useCallback<PointerEventHandler<HTMLDivElement>>((e) => onPointerDown(e, overlay.id, 'resize'), [onPointerDown, overlay.id]);
  return (
    <div
      role="button"
      tabIndex={-1}
      data-testid="overlay-block"
      data-overlay-type={overlay.type}
      data-overlay-id={overlay.id}
      data-selected={isSelected || undefined}
      title={tooltip}
      onPointerDown={handleMovePointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      // the lane's click deselects the overlay
      onClick={stopPropagation}
      style={{
        position: 'absolute',
        top: item.row * OVERLAY_ROW_HEIGHT + 1,
        height: OVERLAY_ROW_HEIGHT - 2,
        left: `${Math.min(left, 100 - MIN_BLOCK_FRACTION * 100)}%`,
        width: `${width}%`,
        background: overlayColors[overlay.type],
        opacity: item.end > item.start ? 1 : 0.6,
        borderRadius: 3,
        border: `1px solid ${isSelected ? 'var(--gray-12)' : 'transparent'}`,
        boxSizing: 'border-box',
        overflow: 'hidden',
        cursor: canMove ? 'grab' : 'pointer',
        touchAction: 'none',
      }}
    >
      <div className="no-user-select" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: '.2em', padding: '0 .3em', fontSize: '.7em', color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', pointerEvents: 'none' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{overlay.name}</span>
        {hasWarning && <FaExclamationTriangle style={{ flexShrink: 0, color: warningColor }} />}
      </div>
      {canResize && (
        <div
          onPointerDown={handleResizePointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 6, cursor: 'ew-resize', background: 'rgba(255,255,255,.35)', touchAction: 'none' }}
        />
      )}
    </div>
  );
});

/** A block of overlays in the blocks lane (T57): its piece, dragged as a whole, with the collapse toggle. */
// eslint-disable-next-line react/display-name
const BlockPiece = memo(({ block, def, item, duration, color, isSelected, linkedCount, tooltip, hasWarning, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onToggleCollapsed }: {
  block: MixBlock,
  def: MixBlockDef,
  item: BlockLaneItem,
  duration: number,
  color: string,
  isSelected: boolean,
  linkedCount: number,
  tooltip: string,
  hasWarning: boolean,
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>, blockId: string) => void,
  onPointerMove: PointerEventHandler<HTMLDivElement>,
  onPointerUp: PointerEventHandler<HTMLDivElement>,
  onPointerCancel: PointerEventHandler<HTMLDivElement>,
  onToggleCollapsed: (blockId: string) => void,
}) => {
  const { t } = useTranslation();
  const left = timeToPercent(item.start, duration);
  const width = Math.max(MIN_BLOCK_FRACTION * 100, timeToPercent(item.end, duration) - left);
  const handlePointerDown = useCallback<PointerEventHandler<HTMLDivElement>>((e) => onPointerDown(e, block.id), [block.id, onPointerDown]);
  const handleToggle = useCallback<MouseEventHandler<HTMLButtonElement>>((e) => {
    e.stopPropagation();
    onToggleCollapsed(block.id);
  }, [block.id, onToggleCollapsed]);
  const commonStyle: CSSProperties = { position: 'absolute', left: `${Math.min(left, 100 - MIN_BLOCK_FRACTION * 100)}%`, width: `${width}%`, boxSizing: 'border-box' };
  return (
    <>
      {/* the block's area (piece and member rows), so its members read as a group */}
      {item.rows > 1 && <div style={{ ...commonStyle, top: item.row * OVERLAY_ROW_HEIGHT, height: item.rows * OVERLAY_ROW_HEIGHT, background: color, opacity: 0.18, borderRadius: 3, pointerEvents: 'none' }} />}
      <div
        role="button"
        tabIndex={-1}
        data-testid="block-piece"
        data-block-id={block.id}
        data-selected={isSelected || undefined}
        data-hidden={block.hidden || undefined}
        data-locked={block.locked || undefined}
        title={tooltip}
        onPointerDown={handlePointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={stopPropagation}
        style={{
          ...commonStyle,
          top: item.row * OVERLAY_ROW_HEIGHT + 1,
          height: OVERLAY_ROW_HEIGHT - 2,
          background: block.hidden ? `repeating-linear-gradient(45deg, ${color} 0, ${color} 4px, transparent 4px, transparent 7px)` : color,
          opacity: block.hidden ? 0.6 : 1,
          borderRadius: 3,
          border: `1px solid ${isSelected ? 'var(--gray-12)' : 'transparent'}`,
          overflow: 'hidden',
          cursor: block.locked ? 'pointer' : 'grab',
          touchAction: 'none',
        }}
      >
        <div className="no-user-select" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: '.2em', padding: '0 .2em', fontSize: '.7em', color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', pointerEvents: 'none', fontWeight: 600 }}>
          <button
            type="button"
            data-testid="block-collapse"
            title={block.collapsed ? t('Expand') : t('Collapse')}
            onPointerDown={stopPropagation}
            onClick={handleToggle}
            style={{ pointerEvents: 'auto', font: 'inherit', color: 'inherit', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', flexShrink: 0 }}
          >
            {block.collapsed ? <FaCaretRight /> : <FaCaretDown />}
          </button>
          {block.locked && <FaLock style={{ flexShrink: 0 }} />}
          {block.hidden && <FaEyeSlash style={{ flexShrink: 0 }} />}
          {linkedCount > 1 && <FaLink style={{ flexShrink: 0 }} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{def.name}</span>
          {hasWarning && <FaExclamationTriangle style={{ flexShrink: 0, color: warningColor }} />}
        </div>
      </div>
    </>
  );
});

/** Content of an overlay's box on the mini frame: roughly what the render draws (image, countdown text, bar fill). */
// eslint-disable-next-line react/display-name
const OverlayBoxContent = memo(({ frameBox, fps }: { frameBox: OverlayFrameBox, fps: number }) => {
  const { overlay, progress, elapsed, times } = frameBox;
  if (overlay.type === 'image') {
    return <img src={pathToFileURL(overlay.path).href} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }} />;
  }
  if (overlay.type === 'countdown') {
    // Same text as the render (overlayFrames.getCountdownTextAt): clamped to the visible range, so the selected
    // overlay still shows a value when it's placed outside the time it's on screen.
    const frames = times != null ? getOverlayFrames(times, fps) : undefined;
    const frame = frames != null && frames.end > frames.start
      ? Math.min(Math.max(Math.round(elapsed * fps) + frames.start, frames.start), frames.end - 1)
      : 0;
    const text = frames != null ? (getCountdownTextAt(overlay, frames, frame, fps) ?? '') : '';
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: { left: 'flex-start', center: 'center', right: 'flex-end' }[overlay.align], color: overlay.color, fontSize: `${overlay.box.height * 100}cqh`, lineHeight: 1, whiteSpace: 'nowrap', fontWeight: 600, textShadow: overlay.border.width > 0 ? `0 0 1px ${overlay.border.color}, 0 0 1px ${overlay.border.color}` : undefined }}>
        {text}
      </div>
    );
  }
  if (overlay.type === 'text') {
    // Approximate (system font, border as a soft shadow), but with the render's layout (textLayout: lines centered in
    // cells of the font size, the block centered in the box), fades and entry animation at that frame
    // When it isn't on screen at that time (shown because it's selected, to place it): as it looks once fully in
    const frames = times != null && frameBox.visible ? getOverlayFrames(times, fps) : undefined;
    const frame = frames != null ? Math.round(elapsed * fps) : Infinity;
    const entry = frames != null ? overlay.entry : { kind: 'none' as const, duration: 0 };
    const lines = splitTextLines(overlay.text).map((line) => splitGraphemes(line.trimEnd()));
    const total = lines.reduce((acc, l) => acc + l.length, 0);
    const shown = entry.kind === 'typewriter' ? getTypewriterCount(frame, total, getTextEntryFrames(entry, fps)) : total;
    // characters before each line
    const before = lines.map((_, i) => lines.slice(0, i).reduce((acc, l) => acc + l.length, 0));
    const { dx, dy } = getSlideOffset({ box: overlay.box, entry }, frame, fps);
    const fontSize = getTextOverlayFontSize(overlay);
    const lineHeight = 1 + overlay.lineSpacing;
    return (
      <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', transform: `translate(${dx * 100}cqw, calc(-50% + ${dy * 100}cqh))`, opacity: frames != null ? getTextOpacity(overlay, frame, frames.rawEnd - frames.rawStart, fps) : 1, textAlign: overlay.align, color: overlay.color, fontSize: `${fontSize * 100}cqh`, lineHeight, whiteSpace: 'pre', fontWeight: 600, textShadow: overlay.border.width > 0 ? `0 0 1px ${overlay.border.color}, 0 0 1px ${overlay.border.color}` : undefined, pointerEvents: 'none' }}>
        {lines.map((chars, i) => {
          // typewriter: the hidden part keeps its place, so the visible one is where the render draws it
          const count = Math.max(0, shown - before[i]!);
          const visible = chars.slice(0, count).join('');
          const hidden = chars.slice(count).join('');
          return (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} style={{ height: `${lineHeight}em` }}>{visible}{hidden !== '' && <span style={{ visibility: 'hidden' }}>{hidden}</span>}</div>
          );
        })}
      </div>
    );
  }
  const fraction = overlay.mode === 'fill' ? progress : 1 - progress;
  const horizontal = overlay.direction === 'ltr' || overlay.direction === 'rtl';
  const fillStyleForDirection: CSSProperties = {
    position: 'absolute',
    background: overlay.fillColor,
    ...(horizontal ? { top: 0, bottom: 0, width: `${fraction * 100}%` } : { left: 0, right: 0, height: `${fraction * 100}%` }),
    ...(overlay.direction === 'ltr' && { left: 0 }),
    ...(overlay.direction === 'rtl' && { right: 0 }),
    ...(overlay.direction === 'ttb' && { top: 0 }),
    ...(overlay.direction === 'btt' && { bottom: 0 }),
  };
  return (
    <div style={{ position: 'absolute', inset: 0, background: overlay.backgroundColor, boxShadow: overlay.border.width > 0 ? `inset 0 0 0 1px ${overlay.border.color}` : undefined }}>
      <div style={fillStyleForDirection} />
    </div>
  );
});

const boxPercentStyle = ({ x, y, width, height }: { x: number, y: number, width: number, height: number }): CSSProperties => ({
  position: 'absolute', left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%`,
});

function handlePosition(handle: DragHandle): CSSProperties {
  const x = handle.includes('w') ? 0 : (handle.includes('e') ? 100 : 50);
  const y = handle.includes('n') ? 0 : (handle.includes('s') ? 100 : 50);
  return { position: 'absolute', left: `${x}%`, top: `${y}%`, width: 7, height: 7, transform: 'translate(-50%, -50%)', background: 'white', border: '1px solid var(--gray-12)', boxSizing: 'border-box', cursor: `${handle}-resize`, touchAction: 'none' };
}

/**
 * Mini view of the output frame at `time` (real column widths, no video): matches the render's per-frame geometry.
 * Columns side by side, or rows stacked in a vertical plan (T29).
 */
// eslint-disable-next-line react/display-name
const FramePreview = memo(({ plan, tl, time, clipsById, getColor, children }: {
  plan: Pick<MixPlan, 'width' | 'height' | 'axis' | 'placements'>,
  tl: ReturnType<typeof getRenderTimeline>,
  time: number,
  clipsById: Map<string, MixClip>,
  getColor: (clip: MixClip) => string,
  children?: ReactNode,
}) => {
  const frame = Math.round(time * tl.settings.fps);
  const columns = getColumnsAtFrame(tl, frame);
  const fills = getFillSpansAtFrame(tl, columns);
  const placementAt = (column: number) => plan.placements.find((p) => p.column === column && time >= p.startTime && time < p.endTime);
  const axis = getPlanAxis(plan);
  // main-axis span → percentages of the frame
  const cellStyle = ({ x, width }: { x: number, width: number }): CSSProperties => {
    const rect = getCellRect(axis, { offset: x, length: width }, plan);
    return { position: 'absolute', left: `${(rect.x / plan.width) * 100}%`, top: `${(rect.y / plan.height) * 100}%`, width: `${(rect.width / plan.width) * 100}%`, height: `${(rect.height / plan.height) * 100}%` };
  };

  return (
    // container-type: the countdown text is sized in `cqh` (a fraction of the frame height, like the render)
    <div style={{ position: 'relative', width: '100%', aspectRatio: `${plan.width} / ${plan.height}`, background: 'var(--gray-3)', overflow: 'hidden', borderRadius: 3, containerType: 'size' }}>
      {[...fills.values()].map((f) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={`${f.x}-${f.width}`} style={{ ...fillStyle, ...cellStyle(f) }} />
      ))}
      {[...columns.entries()].map(([column, geom]) => {
        const placement = placementAt(column);
        const clip = placement != null ? clipsById.get(placement.clipId) : undefined;
        return (
          <div
            key={column}
            style={{ ...cellStyle(geom), background: clip != null ? getColor(clip) : 'var(--gray-6)' }}
          />
        );
      })}
      {children}
    </div>
  );
});

/**
 * Time axis above the lanes (A3, T53), with the cursor. Only the ticks of the visible range are drawn (a zoomed axis
 * can be very wide), so it follows the scroller's scroll and size itself instead of re-rendering the whole view.
 */
// eslint-disable-next-line react/display-name
const TimeAxis = memo(({ scrollerRef, duration, zoom, cursorTime, onPointerDown }: {
  scrollerRef: RefObject<HTMLDivElement | null>,
  duration: number,
  zoom: number,
  cursorTime: number,
  onPointerDown: PointerEventHandler<HTMLDivElement>,
}) => {
  const [view, setView] = useState({ scrollLeft: 0, width: 0 });
  useEffect(() => {
    const el = scrollerRef.current;
    if (el == null) return undefined;
    const update = () => setView((v) => (v.scrollLeft === el.scrollLeft && v.width === el.clientWidth ? v : { scrollLeft: el.scrollLeft, width: el.clientWidth }));
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [scrollerRef]);

  const pixelsPerSecond = duration > 0 ? (view.width * zoom) / duration : 0;
  // a label starts at its tick: include the one just before the visible range
  const { ticks } = getTimeTicks({ duration, pixelsPerSecond, from: pixelsPerSecond > 0 ? view.scrollLeft / pixelsPerSecond - 60 / pixelsPerSecond : 0, to: pixelsPerSecond > 0 ? (view.scrollLeft + view.width) / pixelsPerSecond : 0 });

  return (
    <div
      role="presentation"
      data-testid="mix-time-axis"
      onPointerDown={onPointerDown}
      className="no-user-select"
      style={{ position: 'sticky', top: 0, zIndex: 2, height: TIME_AXIS_HEIGHT, background: controlsBackground, borderBottom: '1px solid var(--gray-6)', overflow: 'hidden', cursor: 'pointer' }}
    >
      {ticks.map((time) => (
        <div key={time} data-testid="mix-time-tick" style={{ position: 'absolute', left: `${timeToPercent(time, duration)}%`, bottom: 0, height: TIME_AXIS_HEIGHT, borderLeft: '1px solid var(--gray-8)', paddingLeft: 2, fontSize: 9, lineHeight: `${TIME_AXIS_HEIGHT - 2}px`, color: 'var(--gray-11)', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          {formatDuration({ seconds: time, shorten: true })}
        </div>
      ))}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${timeToPercent(cursorTime, duration)}%`, width: 1, background: 'var(--red-9)', pointerEvents: 'none' }} />
    </div>
  );
});

/** T57: a loose overlay, or a member of a block definition (edited inside the block: every linked copy changes). */
type DragTarget = { kind: 'overlay' } | { kind: 'member', defId: string, members: MixOverlay[] };
interface BlockDrag { pointerId: number, mode: BlockDragMode, startX: number, axisWidth: number, start: MixOverlay, rawStart: number, moved: boolean, target: DragTarget }
interface BoxDrag { pointerId: number, handle: DragHandle, startX: number, startY: number, scale: number, start: Exclude<MixOverlay, { type: 'sound' }>, moved: boolean, target: DragTarget }
interface PieceDrag { pointerId: number, blockId: string, startX: number, axisWidth: number, anchor: OverlayAnchor, rawStart: number, moved: boolean }

function MixPlanView({ clips, settings, clipPins, onSelect, thumbnailUrls, mixOverlays, overlays, missingOverlayFiles, blockTemplates }: {
  clips: MixClip[],
  settings: MixSettings,
  /** Selection (with the multi-selection), pins and groups (A4, T30). */
  clipPins: Pick<UseMixClipPins, 'selectedClipIds' | 'pinTimes' | 'groupColors' | 'openClipMenu' | 'userPinClip' | 'linkInfos' | 'sequenceIndexes'>,
  /** With modifiers: Ctrl/Cmd-click and Shift-click multi-selection. */
  onSelect: (clipId: string, modifiers?: ClipSelectModifiers) => void,
  /** From `useClipThumbnails` (A2, T31), shared with `ClipList`. */
  thumbnailUrls: ReadonlyMap<string, string>,
  mixOverlays: UseMixOverlays,
  overlays: MixOverlay[],
  missingOverlayFiles: readonly MissingOverlayFile[],
  /** "Insert block…" and "Import block…" (T58). */
  blockTemplates?: Pick<UseBlockTemplates, 'userInsertBlockFromLibrary' | 'userImportBlock'> | undefined,
}) {
  const { t } = useTranslation();
  const { darkMode } = useUserSettings();
  const { getSegColor } = useSegColors();
  const [hoverTime, setHoverTime] = useState<number>();

  const { plan, resolved, setSelectedOverlayId, cursorTime, setCursorTime, update, commitTransient, cancelTransient, userAddImage, userAddCountdown, userAddProgressBar, userAddText, userAddSound } = mixOverlays;
  // T57: blocks and the multi-selection
  const { project, expanded, blockTimes, selectedIds, selectedMember, selectedFrameOverlayId, selectOverlayItem, selectBlockMember, clearOverlaySelection, userUpdateBlock, userUpdateBlockMember } = mixOverlays;
  const { blocks, blockDefs } = project;

  const clipsById = useMemo(() => new Map(clips.map((clip) => [clip.id, clip])), [clips]);
  const getColor = useCallback((clip: MixClip) => getSegColor({ segColorIndex: clip.color }).desaturate(0.1).lightness(darkMode ? 40 : 55).string(), [darkMode, getSegColor]);

  // G3 (T53): columns that don't coincide in time share a lane
  const lanes = useMemo(() => (plan != null ? getMixLanes(plan) : []), [plan]);
  const relayouts = useMemo(() => (plan != null ? plan.layouts.filter((l) => l.transitionDuration > 0) : []), [plan]);

  // E4 (T39): the plan is cut at the maximum duration
  const truncated = useMemo(() => plan?.warnings.find((w) => w.type === 'truncated'), [plan]);

  const tl = useMemo(() => (plan != null ? getRenderTimeline(plan, { fps: settings.fps, gap: settings.gap.width, transitionDuration: settings.transition.duration }) : undefined), [plan, settings.fps, settings.gap.width, settings.transition.duration]);

  const overlayLanes = useMemo(() => (plan != null ? layoutOverlayLanes(overlays, resolved, { minDuration: plan.duration * MIN_BLOCK_FRACTION }) : []), [overlays, plan, resolved]);
  const overlaysById = useMemo(() => new Map(overlays.map((o) => [o.id, o])), [overlays]);
  const missingOverlayIds = useMemo(() => new Set(missingOverlayFiles.filter((m) => m.blockDefId == null).map((m) => m.overlayId)), [missingOverlayFiles]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // T57: blocks lane
  const blockDefsById = useMemo(() => new Map(blockDefs.map((d) => [d.id, d])), [blockDefs]);
  const blocksById = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);
  const blockLane = useMemo(() => (plan != null ? layoutBlockLane({ blocks, blockDefs }, blockTimes, resolved, plan.duration, { minDuration: plan.duration * MIN_BLOCK_FRACTION }) : { rows: 0, items: [] }), [blockDefs, blockTimes, blocks, plan, resolved]);
  const expandedById = useMemo(() => new Map(expanded.all.map((o) => [o.id, o])), [expanded.all]);
  /** Member files not found, by `defId/memberId`. */
  const missingMemberKeys = useMemo(() => new Set(missingOverlayFiles.flatMap((m) => (m.blockDefId != null ? [`${m.blockDefId}/${m.overlayId}`] : []))), [missingOverlayFiles]);
  const getBlockColor = useCallback((color: number) => getSegColor({ segColorIndex: color }).desaturate(0.1).lightness(darkMode ? 40 : 55).string(), [darkMode, getSegColor]);

  const lanesRef = useRef<HTMLDivElement>(null);

  const timeAtClientX = useCallback((clientX: number) => {
    const el = lanesRef.current;
    if (plan == null || el == null) return 0;
    const rect = el.getBoundingClientRect();
    const frac = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return Math.min(plan.duration, Math.max(0, frac * plan.duration));
  }, [plan]);

  const handleMouseMove = useCallback<MouseEventHandler<HTMLDivElement>>((e) => setHoverTime(timeAtClientX(e.clientX)), [timeAtClientX]);
  const handleMouseLeave = useCallback(() => setHoverTime(undefined), []);

  // A click anywhere on the lanes (blocks stop it) moves the Mix view cursor, where new overlays are added
  const handleLanesPointerDown = useCallback<PointerEventHandler<HTMLDivElement>>((e) => {
    if (e.button !== 0) return;
    setCursorTime(timeAtClientX(e.clientX));
  }, [setCursorTime, timeAtClientX]);

  // Clip block drags pin the clip where it's dropped (A4, T30): the block follows the pointer, one undo step on release
  const clipDragRef = useRef<{ pointerId: number, clipId: string, startX: number, axisWidth: number, startTime: number, moved: boolean }>(undefined);
  const [clipDrag, setClipDrag] = useState<{ clipId: string, time: number }>();
  const justDraggedRef = useRef(false);

  const handleClipPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>, placement: ColumnPlacement) => {
    // no stopPropagation: the press also moves the cursor, and a click without drag selects the clip
    justDraggedRef.current = false;
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    clipDragRef.current = { pointerId: e.pointerId, clipId: placement.clipId, startX: e.clientX, axisWidth: lanesRef.current?.getBoundingClientRect().width ?? 0, startTime: placement.startTime, moved: false };
  }, []);

  const handleClipPointerMove = useCallback<PointerEventHandler<HTMLDivElement>>((e) => {
    const drag = clipDragRef.current;
    if (drag == null || drag.pointerId !== e.pointerId || plan == null) return;
    if (!drag.moved && Math.abs(e.clientX - drag.startX) < 3) return;
    drag.moved = true;
    setClipDrag({ clipId: drag.clipId, time: Math.max(0, drag.startTime + pixelsToSeconds(e.clientX - drag.startX, drag.axisWidth, plan.duration)) });
  }, [plan]);

  const handleClipPointerUp = useCallback<PointerEventHandler<HTMLDivElement>>((e) => {
    const drag = clipDragRef.current;
    if (drag == null || drag.pointerId !== e.pointerId) return;
    clipDragRef.current = undefined;
    setClipDrag(undefined);
    if (!drag.moved || plan == null) return;
    justDraggedRef.current = true;
    clipPins.userPinClip(drag.clipId, Math.max(0, drag.startTime + pixelsToSeconds(e.clientX - drag.startX, drag.axisWidth, plan.duration)));
  }, [clipPins, plan]);

  const handleClipPointerCancel = useCallback<PointerEventHandler<HTMLDivElement>>((e) => {
    if (clipDragRef.current?.pointerId !== e.pointerId) return;
    clipDragRef.current = undefined;
    setClipDrag(undefined);
  }, []);

  const handleLaneClick = useCallback((laneIndex: number): MouseEventHandler<HTMLDivElement> => (e) => {
    if (plan == null) return;
    // the click that ends a block drag doesn't select
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    const placement = getPlacementAt(plan, lanes, laneIndex, timeAtClientX(e.clientX));
    if (placement != null) onSelect(placement.clipId, getClipSelectModifiers(e));
  }, [lanes, onSelect, plan, timeAtClientX]);

  const handleOverlayLaneClick = useCallback(() => clearOverlaySelection(), [clearOverlaySelection]);

  /**
   * T57: what a press on an overlay (loose or a block's member, by its expanded id) selects, and how it can be dragged.
   * With Ctrl/Cmd or Shift it only changes the multi-selection (a member stands for its block). Undefined: no drag
   * (a member of a locked block, or a multi-selection click).
   */
  const pressOverlay = useCallback((e: ReactPointerEvent, overlayId: string): { start: MixOverlay, rawStart: number, target: DragTarget } | undefined => {
    const mode = getSelectionMode(e);
    const origin = expanded.origins.get(overlayId);
    if (origin == null) {
      if (mode !== 'replace') {
        selectOverlayItem(overlayId, mode);
        return undefined;
      }
      setSelectedOverlayId(overlayId);
      const overlay = overlaysById.get(overlayId);
      const times = resolved.get(overlayId);
      return overlay != null && times != null ? { start: overlay, rawStart: times.rawStart, target: { kind: 'overlay' } } : undefined;
    }
    if (mode !== 'replace') {
      selectOverlayItem(origin.blockId, mode);
      return undefined;
    }
    selectBlockMember(origin.blockId, origin.memberId);
    const def = blockDefsById.get(blocksById.get(origin.blockId)?.defId ?? '');
    const member = def?.members.find((m) => m.id === origin.memberId);
    if (def == null || member == null || isBlockDefLocked(project, def.id)) return undefined;
    // times inside the block: its anchor is relative to the block's start
    return { start: member, rawStart: getBlockDefTimes(def).get(member.id)?.start ?? 0, target: { kind: 'member', defId: def.id, members: def.members } };
  }, [blockDefsById, blocksById, expanded.origins, overlaysById, project, resolved, selectBlockMember, selectOverlayItem, setSelectedOverlayId]);

  const applyDragPatch = useCallback((target: DragTarget, overlayId: string, patch: MixOverlayPatch) => {
    if (target.kind === 'member') userUpdateBlockMember(target.defId, overlayId, patch, { transient: true });
    else update(overlayId, patch, { transient: true });
  }, [update, userUpdateBlockMember]);

  // Block drags: transient edits while moving, one undo step on release (T04), computed from the state at pointer down
  const blockDragRef = useRef<BlockDrag>(undefined);

  const handleBlockPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>, overlayId: string, mode: BlockDragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const pressed = pressOverlay(e, overlayId);
    const axisWidth = lanesRef.current?.getBoundingClientRect().width ?? 0;
    if (pressed == null) return;
    // don't merge the drag with a pending transient edit (e.g. arrow key nudges of a clip rect)
    commitTransient();
    e.currentTarget.setPointerCapture(e.pointerId);
    blockDragRef.current = { pointerId: e.pointerId, mode, startX: e.clientX, axisWidth, ...pressed, moved: false };
  }, [commitTransient, pressOverlay]);

  const handleBlockPointerMove = useCallback<PointerEventHandler<HTMLDivElement>>((e) => {
    const drag = blockDragRef.current;
    if (drag == null || drag.pointerId !== e.pointerId || plan == null) return;
    e.stopPropagation();
    const dt = pixelsToSeconds(e.clientX - drag.startX, drag.axisWidth, plan.duration);
    const siblings = drag.target.kind === 'member' ? drag.target.members : overlays;
    const patch = drag.mode === 'move'
      ? getOverlayMovePatch({ start: drag.start, rawStart: drag.rawStart, dt, overlays: siblings })
      : getOverlayResizePatch({ start: drag.start, dt, overlays: siblings });
    if (patch == null || (!drag.moved && Math.abs(e.clientX - drag.startX) < 2)) return;
    drag.moved = true;
    applyDragPatch(drag.target, drag.start.id, patch);
  }, [applyDragPatch, overlays, plan]);

  const handleBlockPointerUp = useCallback<PointerEventHandler<HTMLDivElement>>((e) => {
    const drag = blockDragRef.current;
    if (drag == null || drag.pointerId !== e.pointerId) return;
    blockDragRef.current = undefined;
    if (drag.moved) commitTransient();
  }, [commitTransient]);

  const handleBlockPointerCancel = useCallback<PointerEventHandler<HTMLDivElement>>((e) => {
    const drag = blockDragRef.current;
    if (drag == null || drag.pointerId !== e.pointerId) return;
    blockDragRef.current = undefined;
    if (drag.moved) cancelTransient();
  }, [cancelTransient]);

  // T57: a block's piece drags the whole block (its anchor), like an overlay's; a locked block is only selected
  const pieceDragRef = useRef<PieceDrag>(undefined);

  const handlePiecePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>, blockId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const mode = getSelectionMode(e);
    selectOverlayItem(blockId, mode);
    const block = blocksById.get(blockId);
    const times = blockTimes.get(blockId);
    if (mode !== 'replace' || block == null || times == null || block.locked) return;
    commitTransient();
    e.currentTarget.setPointerCapture(e.pointerId);
    pieceDragRef.current = { pointerId: e.pointerId, blockId, startX: e.clientX, axisWidth: lanesRef.current?.getBoundingClientRect().width ?? 0, anchor: block.anchor, rawStart: times.rawStart, moved: false };
  }, [blockTimes, blocksById, commitTransient, selectOverlayItem]);

  const handlePiecePointerMove = useCallback<PointerEventHandler<HTMLDivElement>>((e) => {
    const drag = pieceDragRef.current;
    if (drag == null || drag.pointerId !== e.pointerId || plan == null) return;
    e.stopPropagation();
    if (!drag.moved && Math.abs(e.clientX - drag.startX) < 2) return;
    drag.moved = true;
    const dt = pixelsToSeconds(e.clientX - drag.startX, drag.axisWidth, plan.duration);
    userUpdateBlock(drag.blockId, { anchor: getBlockMoveAnchor({ anchor: drag.anchor, rawStart: drag.rawStart, dt }) }, { transient: true });
  }, [plan, userUpdateBlock]);

  const handlePiecePointerUp = useCallback<PointerEventHandler<HTMLDivElement>>((e) => {
    const drag = pieceDragRef.current;
    if (drag == null || drag.pointerId !== e.pointerId) return;
    pieceDragRef.current = undefined;
    if (drag.moved) commitTransient();
  }, [commitTransient]);

  const handlePiecePointerCancel = useCallback<PointerEventHandler<HTMLDivElement>>((e) => {
    const drag = pieceDragRef.current;
    if (drag == null || drag.pointerId !== e.pointerId) return;
    pieceDragRef.current = undefined;
    if (drag.moved) cancelTransient();
  }, [cancelTransient]);

  const handleToggleCollapsed = useCallback((blockId: string) => {
    const block = blocksById.get(blockId);
    if (block != null) userUpdateBlock(blockId, { collapsed: block.collapsed ? undefined : true });
  }, [blocksById, userUpdateBlock]);

  // Box drags on the mini frame, in output px (overlayMath), same transient/commit pattern
  const boxDragRef = useRef<BoxDrag>(undefined);
  const frameRef = useRef<HTMLDivElement>(null);

  const handleBoxPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>, overlayId: string, handle: DragHandle) => {
    if (e.button !== 0 || plan == null) return;
    e.stopPropagation();
    const pressed = pressOverlay(e, overlayId);
    const frameWidth = frameRef.current?.getBoundingClientRect().width ?? 0;
    if (pressed == null || pressed.start.type === 'sound' || frameWidth <= 0) return;
    commitTransient();
    e.currentTarget.setPointerCapture(e.pointerId);
    boxDragRef.current = { pointerId: e.pointerId, handle, startX: e.clientX, startY: e.clientY, scale: plan.width / frameWidth, start: pressed.start, moved: false, target: pressed.target };
  }, [commitTransient, plan, pressOverlay]);

  const handleBoxPointerMove = useCallback<PointerEventHandler<HTMLDivElement>>((e) => {
    const drag = boxDragRef.current;
    if (drag == null || drag.pointerId !== e.pointerId || plan == null) return;
    e.stopPropagation();
    const { start } = drag;
    const frame = { width: plan.width, height: plan.height };
    // Images keep their proportion unless Shift is held; the other overlays are free unless Shift is held
    const lockAspect = (start.type === 'image') !== e.shiftKey;
    const aspect = lockAspect && start.box.height > 0 ? (start.box.width * frame.width) / (start.box.height * frame.height) : undefined;
    const box = applyOverlayBoxDrag({ start: start.box, handle: drag.handle, dx: (e.clientX - drag.startX) * drag.scale, dy: (e.clientY - drag.startY) * drag.scale, frame, aspect });
    drag.moved = true;
    // A text's size follows its box height (its lines fill it), like the countdown's
    if (start.type === 'text' && box.height !== start.box.height) applyDragPatch(drag.target, start.id, { box, fontSize: getTextFontSizeForBox(start.text, start.lineSpacing, box.height) });
    else applyDragPatch(drag.target, start.id, { box });
  }, [applyDragPatch, plan]);

  const handleBoxPointerUp = useCallback<PointerEventHandler<HTMLDivElement>>((e) => {
    const drag = boxDragRef.current;
    if (drag == null || drag.pointerId !== e.pointerId) return;
    boxDragRef.current = undefined;
    if (drag.moved) commitTransient();
  }, [commitTransient]);

  const handleBoxPointerCancel = useCallback<PointerEventHandler<HTMLDivElement>>((e) => {
    const drag = boxDragRef.current;
    if (drag == null || drag.pointerId !== e.pointerId) return;
    boxDragRef.current = undefined;
    if (drag.moved) cancelTransient();
  }, [cancelTransient]);

  // A3 (T53): zoom (session only, not in the project) and horizontal scroll. The lanes (`lanesRef`) are `zoom` times
  // as wide as the scroller, so every position stays a percentage of the duration and the hit testing/drags don't change.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const duration = plan?.duration ?? 0;
  const [zoomState, setZoom] = useState(1);
  const zoom = clampMixZoom(zoomState, duration);
  const maxZoom = getMaxMixZoom(duration);
  /** Time to keep under `anchorX` (px from the scroller's left) once the new zoom is laid out. */
  const zoomAnchorRef = useRef<{ time: number, anchorX: number }>(undefined);

  const zoomBy = useCallback((factor: number, clientX?: number) => {
    const el = scrollerRef.current;
    if (el == null) return;
    const newZoom = clampMixZoom(zoom * factor, duration);
    if (newZoom === zoom) return;
    const rect = el.getBoundingClientRect();
    // centred on the mouse, or on the middle of the view (buttons)
    const anchorX = clientX != null ? clientX - rect.left : el.clientWidth / 2;
    zoomAnchorRef.current = { time: timeAtClientX(rect.left + anchorX), anchorX };
    setZoom(newZoom);
  }, [duration, timeAtClientX, zoom]);

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const el = scrollerRef.current;
    const lanesEl = lanesRef.current;
    zoomAnchorRef.current = undefined;
    if (anchor == null || el == null || lanesEl == null) return;
    el.scrollLeft = getAnchoredScrollLeft({ ...anchor, duration, contentWidth: lanesEl.offsetWidth, viewportWidth: el.clientWidth });
  }, [duration, zoom]);

  const handleZoomIn = useCallback(() => zoomBy(MIX_ZOOM_STEP), [zoomBy]);
  const handleZoomOut = useCallback(() => zoomBy(1 / MIX_ZOOM_STEP), [zoomBy]);
  const handleZoomFit = useCallback(() => setZoom(1), []);

  // Ctrl + wheel zooms on the mouse; the wheel (or Shift + wheel) scrolls sideways once zoomed. Not zoomed, the wheel
  // keeps its default (the lanes' vertical scroll). A native listener: React's wheel listeners are passive.
  const hasPlan = plan != null;
  useEffect(() => {
    const el = scrollerRef.current;
    if (el == null) return undefined;
    const handleWheel = (e: WheelEvent) => {
      const { x, y } = getWheelPixels(e);
      if (e.ctrlKey) {
        e.preventDefault();
        zoomBy(getWheelZoomFactor(y), e.clientX);
        return;
      }
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += x + y;
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [hasPlan, zoomBy]);

  // Zoomed, the view follows the cursor when it moves out of sight (playing the live preview moves it)
  const followedCursorRef = useRef(cursorTime);
  useLayoutEffect(() => {
    if (followedCursorRef.current === cursorTime) return;
    followedCursorRef.current = cursorTime;
    const el = scrollerRef.current;
    const lanesEl = lanesRef.current;
    if (el == null || lanesEl == null) return;
    const scrollLeft = getFollowScrollLeft({ time: cursorTime, duration, contentWidth: lanesEl.offsetWidth, viewportWidth: el.clientWidth, scrollLeft: el.scrollLeft });
    if (scrollLeft != null) el.scrollLeft = scrollLeft;
  }, [cursorTime, duration]);

  const frameTime = hoverTime ?? cursorTime;
  // T57: the blocks' visible members too (layer order: above the loose overlays)
  const frameBoxes = useMemo(() => getOverlayFrameBoxes(expanded.visible, resolved, frameTime, selectedFrameOverlayId), [expanded.visible, frameTime, resolved, selectedFrameOverlayId]);
  const selectedFrameBox = frameBoxes.find((b) => b.overlay.id === selectedFrameOverlayId);
  /** Boxes of the multi-selection (loose overlays, members of selected blocks): outlined. */
  const isBoxInSelection = useCallback((overlayId: string) => selectedIdSet.has(expanded.origins.get(overlayId)?.blockId ?? overlayId), [expanded.origins, selectedIdSet]);

  const clipLanesHeight = Math.max(LANE_HEIGHT, lanes.length * LANE_HEIGHT);
  // Overlay lanes go below the clip lanes, each as tall as its rows (+1 px border)
  const overlayLaneTops = overlayLanes.map((_, i) => clipLanesHeight + overlayLanes.slice(0, i).reduce((acc, lane) => acc + lane.rows * OVERLAY_ROW_HEIGHT + 1, 0));
  const overlayLanesHeight = overlayLanes.reduce((acc, lane) => acc + lane.rows * OVERLAY_ROW_HEIGHT + 1, 0);
  // T57: the blocks lane goes last
  const blockLaneTop = clipLanesHeight + overlayLanesHeight;
  const blockLaneHeight = blockLane.rows > 0 ? blockLane.rows * OVERLAY_ROW_HEIGHT + 1 : 0;

  if (plan == null || tl == null) {
    return (
      <div className="no-user-select" style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: timelineBackground, transition: darkModeTransition, color: 'var(--gray-11)', fontSize: '.85em', padding: '0 1em', textAlign: 'center' }}>
        {t('Add clips to see the mix plan here.')}
      </div>
    );
  }

  return (
    // `isolation`: the z-indexes inside (the sticky time axis, a dragged clip) stay in the view's own stacking context, so
    // dialogs and menus (fixed, later in the document) always paint above it (T57)
    <div data-testid="mix-plan-view" style={{ flexGrow: 1, display: 'flex', overflow: 'hidden', background: controlsBackground, transition: darkModeTransition, padding: '.3em .5em', gap: '.5em', boxSizing: 'border-box', isolation: 'isolate' }}>
      <div style={{ width: Math.min(FRAME_MAX_WIDTH, FRAME_MAX_HEIGHT * (plan.width / plan.height)), flexShrink: 0 }}>
        <div ref={frameRef}>
          <FramePreview plan={plan} tl={tl} time={frameTime} clipsById={clipsById} getColor={getColor}>
            {frameBoxes.map((frameBox) => (
              <div
                key={frameBox.overlay.id}
                role="button"
                tabIndex={-1}
                title={frameBox.overlay.name}
                onPointerDown={(e) => handleBoxPointerDown(e, frameBox.overlay.id, 'move')}
                onPointerMove={handleBoxPointerMove}
                onPointerUp={handleBoxPointerUp}
                onPointerCancel={handleBoxPointerCancel}
                style={{ ...boxPercentStyle(frameBox.overlay.box), opacity: frameBox.visible ? 1 : 0.4, cursor: 'move', touchAction: 'none', outline: frameBox.visible ? (isBoxInSelection(frameBox.overlay.id) ? '1px dashed var(--cyan-9)' : undefined) : '1px dashed var(--gray-12)' }}
              >
                <OverlayBoxContent frameBox={frameBox} fps={settings.fps} />
              </div>
            ))}
            {selectedFrameBox != null && (
              // On top of every box, so the selected one can always be resized
              <div style={{ ...boxPercentStyle(selectedFrameBox.overlay.box), outline: '1px solid var(--cyan-9)', pointerEvents: 'none' }}>
                {resizeHandles.map((handle) => (
                  <div
                    key={handle}
                    onPointerDown={(e) => handleBoxPointerDown(e, selectedFrameBox.overlay.id, handle)}
                    onPointerMove={handleBoxPointerMove}
                    onPointerUp={handleBoxPointerUp}
                    onPointerCancel={handleBoxPointerCancel}
                    style={{ ...handlePosition(handle), pointerEvents: 'auto' }}
                  />
                ))}
              </div>
            )}
          </FramePreview>
        </div>
        <div className="no-user-select" style={{ textAlign: 'center', fontSize: '.7em', opacity: 0.7, marginTop: 2 }}>
          {formatDuration({ seconds: frameTime, shorten: true })}
        </div>
      </div>

      <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '.2em' }}>
        <div className="no-user-select" style={{ display: 'flex', alignItems: 'center', gap: '.3em', flexWrap: 'wrap' }}>
          <FaPlus style={{ fontSize: '.7em', opacity: 0.7 }} />
          <button type="button" style={toolbarButtonStyle} onClick={userAddImage} title={t('Adds a PNG image at the cursor')}><FaImage />{t('Add image…')}</button>
          <button type="button" style={toolbarButtonStyle} onClick={userAddText}><FaFont />{t('Add text')}</button>
          <button type="button" style={toolbarButtonStyle} onClick={userAddCountdown}><FaStopwatch />{t('Add countdown')}</button>
          <button type="button" style={toolbarButtonStyle} onClick={userAddProgressBar}><MdLinearScale />{t('Add progress bar')}</button>
          <button type="button" style={toolbarButtonStyle} onClick={userAddSound}><FaVolumeUp />{t('Add sound…')}</button>
          {blockTemplates != null && <BlockTemplateButtons blockTemplates={blockTemplates} buttonStyle={toolbarButtonStyle} />}
          {truncated != null && (
            <span data-testid="mix-truncated" style={{ fontSize: '.7em', marginLeft: 'auto', color: warningColor, display: 'inline-flex', alignItems: 'center', gap: '.3em' }} title={t('The mix is longer than its maximum duration: it is cut at {{time}} with the fade-out, {{seconds}} s are left out', { time: formatDuration({ seconds: truncated.time, shorten: true }), seconds: Math.round(truncated.seconds) })}>
              <FaCut />
              {t('Cut at {{time}} (−{{seconds}} s)', { time: formatDuration({ seconds: truncated.time, shorten: true }), seconds: Math.round(truncated.seconds) })}
            </span>
          )}
          <span style={{ fontSize: '.7em', opacity: 0.7, marginLeft: truncated != null ? undefined : 'auto' }} title={t('New overlays are added at the cursor. Click on the lanes to move it.')}>
            {t('Cursor: {{time}}', { time: formatDuration({ seconds: cursorTime, shorten: true }) })}
          </span>
          {/* A3 (T53) */}
          <span style={{ display: 'inline-flex', gap: '.2em' }}>
            <button type="button" data-testid="mix-zoom-out" style={{ ...toolbarButtonStyle, ...(zoom <= 1 && disabledButtonStyle) }} disabled={zoom <= 1} onClick={handleZoomOut} title={t('Zoom out (Ctrl + mouse wheel)')}><FaSearchMinus /></button>
            <button type="button" data-testid="mix-zoom-in" style={{ ...toolbarButtonStyle, ...(zoom >= maxZoom && disabledButtonStyle) }} disabled={zoom >= maxZoom} onClick={handleZoomIn} title={t('Zoom in (Ctrl + mouse wheel)')}><FaSearchPlus /></button>
            <button type="button" data-testid="mix-zoom-fit" style={{ ...toolbarButtonStyle, ...(zoom <= 1 && disabledButtonStyle) }} disabled={zoom <= 1} onClick={handleZoomFit} title={t('Fit the whole mix in the view')}>{t('Fit')}</button>
          </span>
        </div>

        <div ref={scrollerRef} data-testid="mix-lanes-scroller" data-zoom={zoom} style={{ overflow: 'auto', maxHeight: MAX_LANES_HEIGHT + TIME_AXIS_HEIGHT }} className="consistent-scrollbar">
          <div style={{ width: `${zoom * 100}%` }}>
            <TimeAxis scrollerRef={scrollerRef} duration={plan.duration} zoom={zoom} cursorTime={cursorTime} onPointerDown={handleLanesPointerDown} />
            <div
              ref={lanesRef}
              data-testid="mix-lanes"
              role="presentation"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onPointerDown={handleLanesPointerDown}
              // blocks past the end (an overlay outside the video, a dragged clip) don't widen the scrolled area
              style={{ position: 'relative', height: clipLanesHeight + overlayLanesHeight + blockLaneHeight, background: timelineBackground, overflow: 'hidden' }}
            >
              {relayouts.map((layout) => (
                <div
                  key={layout.time}
                  style={{ ...relayoutBandStyle, height: clipLanesHeight, left: `${timeToPercent(layout.time, plan.duration)}%`, width: `${timeToPercent(layout.time + layout.transitionDuration, plan.duration) - timeToPercent(layout.time, plan.duration)}%` }}
                />
              ))}

              {lanes.map((columns, laneIndex) => (
                <div
                  key={columns[0]}
                  role="button"
                  tabIndex={-1}
                  data-testid="mix-lane"
                  data-columns={columns.join(',')}
                  onClick={handleLaneClick(laneIndex)}
                  style={{ position: 'absolute', top: laneIndex * LANE_HEIGHT, left: 0, right: 0, height: LANE_HEIGHT, borderBottom: '1px solid var(--gray-6)', cursor: 'pointer' }}
                >
                  {columns.flatMap((column) => getColumnFillSpans(plan, column)).map((span) => (
                    <div
                      key={`${span.from}-${span.to}`}
                      style={{ ...fillStyle, left: `${timeToPercent(span.from, plan.duration)}%`, width: `${timeToPercent(span.to, plan.duration) - timeToPercent(span.from, plan.duration)}%` }}
                    />
                  ))}

                  {plan.placements.filter((p) => columns.includes(p.column)).map((placement) => {
                    const clip = clipsById.get(placement.clipId);
                    const dragging = clipDrag?.clipId === placement.clipId;
                    // a dragged block follows the pointer (it may go past the end of the video)
                    const start = dragging ? clipDrag.time : placement.startTime;
                    const left = timeToPercent(start, plan.duration);
                    const width = (Math.max(0, placement.endTime - placement.startTime) / Math.max(plan.duration, 1e-9)) * 100;
                    return (
                      <Block
                        key={placement.clipId}
                        placement={placement}
                        clip={clip}
                        laneWidthPercent={{ left, width }}
                        color={clip != null ? getColor(clip) : 'var(--gray-8)'}
                        name={clip?.name ?? placement.clipId}
                        thumbnailUrl={thumbnailUrls.get(placement.clipId)}
                        warnings={getPlacementWarnings(plan, placement)}
                        isSelected={clipPins.selectedClipIds.has(placement.clipId)}
                        rows={getPlanAxis(plan) === 'rows'}
                        pinned={clipPins.pinTimes.has(placement.clipId)}
                        groupColor={clip?.groupId != null ? clipPins.groupColors.get(clip.groupId) : undefined}
                        linked={clipPins.linkInfos.get(placement.clipId)?.linked === true}
                        sequenceIndex={clipPins.sequenceIndexes.get(placement.clipId)}
                        dragging={dragging}
                        openClipMenu={clipPins.openClipMenu}
                        onPointerDown={handleClipPointerDown}
                        onPointerMove={handleClipPointerMove}
                        onPointerUp={handleClipPointerUp}
                        onPointerCancel={handleClipPointerCancel}
                      />
                    );
                  })}
                </div>
              ))}

              {overlayLanes.map((lane, laneIndex) => {
                const top = overlayLaneTops[laneIndex] ?? 0;
                const height = lane.rows * OVERLAY_ROW_HEIGHT;
                return (
                  <div
                    key={lane.lane}
                    role="button"
                    tabIndex={-1}
                    onClick={handleOverlayLaneClick}
                    style={{ position: 'absolute', top, left: 0, right: 0, height, borderBottom: '1px solid var(--gray-6)', background: 'var(--gray-a2)' }}
                  >
                    <div className="no-user-select" style={{ position: 'absolute', left: '.3em', top: 0, height: OVERLAY_ROW_HEIGHT, display: 'flex', alignItems: 'center', fontSize: '.65em', color: 'var(--gray-11)', pointerEvents: 'none', opacity: 0.8 }}>
                      {getOverlayLaneLabel(lane.lane)}
                    </div>
                    {lane.items.map((item) => {
                      const overlay = overlaysById.get(item.overlayId);
                      if (overlay == null) return null;
                      const warnings = resolved.get(overlay.id)?.warnings ?? [];
                      const missing = missingOverlayIds.has(overlay.id);
                      const tooltipLines = [overlay.name, ...(missing ? [t('File not found')] : []), ...warnings.map((w) => getOverlayTimeWarningText(w))];
                      // a bar linked to a countdown takes its times from it
                      const linked = getLinkedCountdown(overlay, overlaysById) != null;
                      return (
                        <OverlayBlock
                          key={overlay.id}
                          overlay={overlay}
                          item={item}
                          duration={plan.duration}
                          isSelected={selectedIdSet.has(overlay.id)}
                          canMove={!linked}
                          canResize={!linked && overlay.type !== 'sound'}
                          tooltip={tooltipLines.join('\n')}
                          hasWarning={missing || warnings.length > 0}
                          onPointerDown={handleBlockPointerDown}
                          onPointerMove={handleBlockPointerMove}
                          onPointerUp={handleBlockPointerUp}
                          onPointerCancel={handleBlockPointerCancel}
                        />
                      );
                    })}
                  </div>
                );
              })}

              {blockLane.rows > 0 && (
                <div
                  role="button"
                  tabIndex={-1}
                  data-testid="block-lane"
                  onClick={handleOverlayLaneClick}
                  style={{ position: 'absolute', top: blockLaneTop, left: 0, right: 0, height: blockLane.rows * OVERLAY_ROW_HEIGHT, borderBottom: '1px solid var(--gray-6)', background: 'var(--gray-a2)' }}
                >
                  <div className="no-user-select" style={{ position: 'absolute', left: '.3em', top: 0, height: OVERLAY_ROW_HEIGHT, display: 'flex', alignItems: 'center', fontSize: '.65em', color: 'var(--gray-11)', pointerEvents: 'none', opacity: 0.8 }}>
                    {t('Blocks')}
                  </div>
                  {blockLane.items.map((item) => {
                    const block = blocksById.get(item.blockId);
                    const def = block != null ? blockDefsById.get(block.defId) : undefined;
                    if (block == null || def == null) return null;
                    const warnings = blockTimes.get(block.id)?.warnings ?? [];
                    const missing = def.members.some((m) => missingMemberKeys.has(`${def.id}/${m.id}`));
                    const memberWarning = def.members.some((m) => (resolved.get(`${block.id}/${m.id}`)?.warnings.length ?? 0) > 0);
                    const linkedCount = blocks.filter((b) => b.defId === def.id).length;
                    const tooltip = [
                      def.name,
                      ...(block.hidden ? [t('Hidden')] : []),
                      ...(block.locked ? [t('Locked')] : []),
                      ...(linkedCount > 1 ? [t('Linked: {{count}} copies share its content', { count: linkedCount })] : []),
                      ...(missing ? [t('File not found')] : []),
                      ...warnings.map((w) => getOverlayTimeWarningText(w)),
                      ...(block.locked ? [] : [t('Drag to move the whole block')]),
                    ].join('\n');
                    return (
                      <div key={block.id} style={{ display: 'contents' }}>
                        <BlockPiece
                          block={block}
                          def={def}
                          item={item}
                          duration={plan.duration}
                          color={getBlockColor(def.color)}
                          isSelected={selectedIdSet.has(block.id)}
                          linkedCount={linkedCount}
                          tooltip={tooltip}
                          hasWarning={missing || memberWarning || warnings.length > 0}
                          onPointerDown={handlePiecePointerDown}
                          onPointerMove={handlePiecePointerMove}
                          onPointerUp={handlePiecePointerUp}
                          onPointerCancel={handlePiecePointerCancel}
                          onToggleCollapsed={handleToggleCollapsed}
                        />
                        {item.members.map((memberItem) => {
                          const overlay = expandedById.get(memberItem.overlayId);
                          if (overlay == null) return null;
                          const memberWarnings = resolved.get(overlay.id)?.warnings ?? [];
                          const memberMissing = missingMemberKeys.has(`${def.id}/${memberItem.memberId}`);
                          const contentLocked = isBlockDefLocked(project, def.id);
                          const linked = getLinkedCountdown(overlay, expandedById) != null;
                          return (
                            <OverlayBlock
                              key={overlay.id}
                              overlay={overlay}
                              item={memberItem}
                              duration={plan.duration}
                              isSelected={selectedMember?.overlayId === overlay.id}
                              canMove={!linked && !contentLocked}
                              canResize={!linked && !contentLocked && overlay.type !== 'sound'}
                              tooltip={[overlay.name, ...(memberMissing ? [t('File not found')] : []), ...memberWarnings.map((w) => getOverlayTimeWarningText(w))].join('\n')}
                              hasWarning={memberMissing || memberWarnings.length > 0}
                              onPointerDown={handleBlockPointerDown}
                              onPointerMove={handleBlockPointerMove}
                              onPointerUp={handleBlockPointerUp}
                              onPointerCancel={handleBlockPointerCancel}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}

              <div data-testid="mix-cursor" style={{ position: 'absolute', top: 0, bottom: 0, left: `${timeToPercent(cursorTime, plan.duration)}%`, width: 1, background: 'var(--red-9)', pointerEvents: 'none' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(MixPlanView);
