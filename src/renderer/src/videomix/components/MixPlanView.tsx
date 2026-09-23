import type { CSSProperties, MouseEventHandler, PointerEvent as ReactPointerEvent, PointerEventHandler, ReactNode } from 'react';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FaExclamationTriangle, FaImage, FaPlus, FaStopwatch, FaVolumeUp } from 'react-icons/fa';
import { MdLinearScale } from 'react-icons/md';

import { useSegColors } from '../../contexts';
import useUserSettings from '../../hooks/useUserSettings';
import { controlsBackground, darkModeTransition, timelineBackground, warningColor } from '../../colors';
import { formatDuration } from '../../util/duration';
import type { MixClip, MixOverlay, MixSettings } from '../types';
import type { ColumnPlacement, MixPlan, PlanWarning } from '../planner/types';
import { getColumnsAtFrame, getFillSpansAtFrame, getRenderTimeline } from '../render/renderTimeline';
import { getColumnFillSpans, getLaneColumns, getPlacementAt, getPlacementWarnings, timeToPercent } from '../mixPlanLayout';
import type { UseMixOverlays } from '../hooks/useMixOverlays';
import type { MissingOverlayFile } from '../projectFile';
import type { DragHandle } from '../overlayMath';
import { resizeHandles } from '../overlayMath';
import { applyOverlayBoxDrag, getOverlayFrameBoxes, getOverlayMovePatch, getOverlayResizePatch, layoutOverlayLanes, pixelsToSeconds } from '../overlayTimeline';
import type { OverlayFrameBox, OverlayLaneItem } from '../overlayTimeline';
import { getOverlayLaneLabel, getOverlayTimeWarningText } from '../overlayTexts';
import { getLinkedCountdown } from '../overlays/anchors';
import { getCountdownTextAt, getOverlayFrames } from '../overlays/overlayFrames';

const { pathToFileURL } = window.require('@electron/remote').require('./index.js');

// Timeline of the mix plan (T15, 04-diseno §6.6): an alternative to the source Timeline that shows the MixPlan
// instead of the active source. A lane per column, the mini frame view and the fill/warning markers reuse the exact
// geometry the render uses (render/renderTimeline.ts), so what's shown here matches T13's render.
// T22 adds the overlay lanes (images, countdowns/bars, sounds) with draggable blocks, the Mix view cursor where new
// overlays are added, and the overlay boxes on the mini frame, which can be moved/resized there.

const LANE_HEIGHT = 22;
const OVERLAY_ROW_HEIGHT = 16;
const MAX_LANES_HEIGHT = 170;
const FRAME_HEIGHT = 108;
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
};

const toolbarButtonStyle: CSSProperties = { font: 'inherit', fontSize: '.75em', padding: '.1em .5em', border: '1px solid var(--gray-7)', borderRadius: '.3em', background: 'var(--gray-3)', color: 'var(--gray-12)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '.3em', whiteSpace: 'nowrap' };

function warningTooltip(t: (key: string) => string, warnings: PlanWarning[]) {
  return warnings.map((w) => {
    if (w.type === 'upscale') return t('Enlarged more than the recommended limit');
    if (w.type === 'pillarbox' || w.type === 'letterbox') return t('Gets fill around it in this column');
    return t('Its transition is shortened');
  }).join('; ');
}

// eslint-disable-next-line react/display-name
const Block = memo(({ placement, laneWidthPercent, color, name, warnings, isSelected }: {
  placement: ColumnPlacement,
  laneWidthPercent: { left: number, width: number },
  color: string,
  name: string,
  warnings: PlanWarning[],
  isSelected: boolean,
}) => {
  const { t } = useTranslation();
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
    borderRadius: 3,
    overflow: 'hidden',
    border: `1px solid ${isSelected ? 'var(--gray-12)' : 'transparent'}`,
    boxSizing: 'border-box',
    cursor: 'pointer',
  }), [color, isSelected, laneWidthPercent.left, laneWidthPercent.width]);

  return (
    <div style={style} title={`${name}${warnings.length > 0 ? ` — ${warningTooltip(t, warnings)}` : ''}`}>
      {inFrac > 0 && <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${inFrac * 100}%`, background: 'linear-gradient(90deg, rgba(255,255,255,.4), transparent)', pointerEvents: 'none' }} />}
      {outFrac > 0 && <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: `${outFrac * 100}%`, background: 'linear-gradient(90deg, transparent, rgba(0,0,0,.4))', pointerEvents: 'none' }} />}
      <div className="no-user-select" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: '.2em', padding: '0 .3em', fontSize: '.75em', color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', pointerEvents: 'none' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
        {warnings.length > 0 && <FaExclamationTriangle style={{ flexShrink: 0, color: warningColor }} />}
      </div>
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

/** Mini view of the output frame at `time` (real column widths, no video): matches the render's per-frame geometry. */
// eslint-disable-next-line react/display-name
const FramePreview = memo(({ plan, tl, time, clipsById, getColor, children }: {
  plan: Pick<MixPlan, 'width' | 'height' | 'placements'>,
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

  return (
    // container-type: the countdown text is sized in `cqh` (a fraction of the frame height, like the render)
    <div style={{ position: 'relative', width: '100%', aspectRatio: `${plan.width} / ${plan.height}`, background: 'var(--gray-3)', overflow: 'hidden', borderRadius: 3, containerType: 'size' }}>
      {[...fills.values()].map((f) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={`${f.x}-${f.width}`} style={{ ...fillStyle, left: `${(f.x / plan.width) * 100}%`, width: `${(f.width / plan.width) * 100}%` }} />
      ))}
      {[...columns.entries()].map(([column, geom]) => {
        const placement = placementAt(column);
        const clip = placement != null ? clipsById.get(placement.clipId) : undefined;
        return (
          <div
            key={column}
            style={{ position: 'absolute', top: 0, bottom: 0, left: `${(geom.x / plan.width) * 100}%`, width: `${(geom.width / plan.width) * 100}%`, background: clip != null ? getColor(clip) : 'var(--gray-6)' }}
          />
        );
      })}
      {children}
    </div>
  );
});

interface BlockDrag { pointerId: number, mode: BlockDragMode, startX: number, axisWidth: number, start: MixOverlay, rawStart: number, moved: boolean }
interface BoxDrag { pointerId: number, handle: DragHandle, startX: number, startY: number, scale: number, start: Exclude<MixOverlay, { type: 'sound' }>, moved: boolean }

function MixPlanView({ clips, settings, selectedClipId, onSelect, mixOverlays, overlays, missingOverlayFiles }: {
  clips: MixClip[],
  settings: MixSettings,
  selectedClipId: string | undefined,
  onSelect: (clipId: string) => void,
  mixOverlays: UseMixOverlays,
  overlays: MixOverlay[],
  missingOverlayFiles: readonly MissingOverlayFile[],
}) {
  const { t } = useTranslation();
  const { darkMode } = useUserSettings();
  const { getSegColor } = useSegColors();
  const [hoverTime, setHoverTime] = useState<number>();

  const { plan, resolved, selectedOverlayId, setSelectedOverlayId, cursorTime, setCursorTime, update, commitTransient, cancelTransient, userAddImage, userAddCountdown, userAddProgressBar, userAddSound } = mixOverlays;

  const clipsById = useMemo(() => new Map(clips.map((clip) => [clip.id, clip])), [clips]);
  const getColor = useCallback((clip: MixClip) => getSegColor({ segColorIndex: clip.color }).desaturate(0.1).lightness(darkMode ? 40 : 55).string(), [darkMode, getSegColor]);

  const laneColumns = useMemo(() => (plan != null ? getLaneColumns(plan) : []), [plan]);
  const relayouts = useMemo(() => (plan != null ? plan.layouts.filter((l) => l.transitionDuration > 0) : []), [plan]);

  const tl = useMemo(() => (plan != null ? getRenderTimeline(plan, { fps: settings.fps, gap: settings.gap.width, transitionDuration: settings.transition.duration }) : undefined), [plan, settings.fps, settings.gap.width, settings.transition.duration]);

  const overlayLanes = useMemo(() => (plan != null ? layoutOverlayLanes(overlays, resolved, { minDuration: plan.duration * MIN_BLOCK_FRACTION }) : []), [overlays, plan, resolved]);
  const overlaysById = useMemo(() => new Map(overlays.map((o) => [o.id, o])), [overlays]);
  const missingOverlayIds = useMemo(() => new Set(missingOverlayFiles.map((m) => m.overlayId)), [missingOverlayFiles]);

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

  const handleLaneClick = useCallback((laneIndex: number): MouseEventHandler<HTMLDivElement> => (e) => {
    if (plan == null) return;
    const placement = getPlacementAt(plan, laneColumns, laneIndex, timeAtClientX(e.clientX));
    if (placement != null) onSelect(placement.clipId);
  }, [laneColumns, onSelect, plan, timeAtClientX]);

  const handleOverlayLaneClick = useCallback(() => setSelectedOverlayId(undefined), [setSelectedOverlayId]);

  // Block drags: transient edits while moving, one undo step on release (T04), computed from the state at pointer down
  const blockDragRef = useRef<BlockDrag>(undefined);

  const handleBlockPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>, overlayId: string, mode: BlockDragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelectedOverlayId(overlayId);
    const overlay = overlaysById.get(overlayId);
    const times = resolved.get(overlayId);
    const axisWidth = lanesRef.current?.getBoundingClientRect().width ?? 0;
    if (overlay == null || times == null) return;
    // don't merge the drag with a pending transient edit (e.g. arrow key nudges of a clip rect)
    commitTransient();
    e.currentTarget.setPointerCapture(e.pointerId);
    blockDragRef.current = { pointerId: e.pointerId, mode, startX: e.clientX, axisWidth, start: overlay, rawStart: times.rawStart, moved: false };
  }, [commitTransient, overlaysById, resolved, setSelectedOverlayId]);

  const handleBlockPointerMove = useCallback<PointerEventHandler<HTMLDivElement>>((e) => {
    const drag = blockDragRef.current;
    if (drag == null || drag.pointerId !== e.pointerId || plan == null) return;
    e.stopPropagation();
    const dt = pixelsToSeconds(e.clientX - drag.startX, drag.axisWidth, plan.duration);
    const patch = drag.mode === 'move'
      ? getOverlayMovePatch({ start: drag.start, rawStart: drag.rawStart, dt, overlays })
      : getOverlayResizePatch({ start: drag.start, dt, overlays });
    if (patch == null || (!drag.moved && Math.abs(e.clientX - drag.startX) < 2)) return;
    drag.moved = true;
    update(drag.start.id, patch, { transient: true });
  }, [overlays, plan, update]);

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

  // Box drags on the mini frame, in output px (overlayMath), same transient/commit pattern
  const boxDragRef = useRef<BoxDrag>(undefined);
  const frameRef = useRef<HTMLDivElement>(null);

  const handleBoxPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>, overlayId: string, handle: DragHandle) => {
    if (e.button !== 0 || plan == null) return;
    e.stopPropagation();
    setSelectedOverlayId(overlayId);
    const overlay = overlaysById.get(overlayId);
    const frameWidth = frameRef.current?.getBoundingClientRect().width ?? 0;
    if (overlay == null || overlay.type === 'sound' || frameWidth <= 0) return;
    commitTransient();
    e.currentTarget.setPointerCapture(e.pointerId);
    boxDragRef.current = { pointerId: e.pointerId, handle, startX: e.clientX, startY: e.clientY, scale: plan.width / frameWidth, start: overlay, moved: false };
  }, [commitTransient, overlaysById, plan, setSelectedOverlayId]);

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
    update(start.id, { box }, { transient: true });
  }, [plan, update]);

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

  const frameTime = hoverTime ?? cursorTime;
  const frameBoxes = useMemo(() => getOverlayFrameBoxes(overlays, resolved, frameTime, selectedOverlayId), [frameTime, overlays, resolved, selectedOverlayId]);
  const selectedFrameBox = frameBoxes.find((b) => b.overlay.id === selectedOverlayId);

  const clipLanesHeight = Math.max(LANE_HEIGHT, laneColumns.length * LANE_HEIGHT);
  // Overlay lanes go below the clip lanes, each as tall as its rows (+1 px border)
  const overlayLaneTops = overlayLanes.map((_, i) => clipLanesHeight + overlayLanes.slice(0, i).reduce((acc, lane) => acc + lane.rows * OVERLAY_ROW_HEIGHT + 1, 0));
  const overlayLanesHeight = overlayLanes.reduce((acc, lane) => acc + lane.rows * OVERLAY_ROW_HEIGHT + 1, 0);

  if (plan == null || tl == null) {
    return (
      <div className="no-user-select" style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: timelineBackground, transition: darkModeTransition, color: 'var(--gray-11)', fontSize: '.85em', padding: '0 1em', textAlign: 'center' }}>
        {t('Add clips to see the mix plan here.')}
      </div>
    );
  }

  return (
    <div style={{ flexGrow: 1, display: 'flex', overflow: 'hidden', background: controlsBackground, transition: darkModeTransition, padding: '.3em .5em', gap: '.5em', boxSizing: 'border-box' }}>
      <div style={{ width: FRAME_HEIGHT * (plan.width / plan.height), flexShrink: 0 }}>
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
                style={{ ...boxPercentStyle(frameBox.overlay.box), opacity: frameBox.visible ? 1 : 0.4, cursor: 'move', touchAction: 'none', outline: frameBox.visible ? undefined : '1px dashed var(--gray-12)' }}
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
          <button type="button" style={toolbarButtonStyle} onClick={userAddCountdown}><FaStopwatch />{t('Add countdown')}</button>
          <button type="button" style={toolbarButtonStyle} onClick={userAddProgressBar}><MdLinearScale />{t('Add progress bar')}</button>
          <button type="button" style={toolbarButtonStyle} onClick={userAddSound}><FaVolumeUp />{t('Add sound…')}</button>
          <span style={{ fontSize: '.7em', opacity: 0.7, marginLeft: 'auto' }} title={t('New overlays are added at the cursor. Click on the lanes to move it.')}>
            {t('Cursor: {{time}}', { time: formatDuration({ seconds: cursorTime, shorten: true }) })}
          </span>
        </div>

        <div style={{ overflowY: 'auto', maxHeight: MAX_LANES_HEIGHT }} className="consistent-scrollbar">
          <div
            ref={lanesRef}
            role="presentation"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onPointerDown={handleLanesPointerDown}
            style={{ position: 'relative', height: clipLanesHeight + overlayLanesHeight, background: timelineBackground }}
          >
            {relayouts.map((layout) => (
              <div
                key={layout.time}
                style={{ ...relayoutBandStyle, height: clipLanesHeight, left: `${timeToPercent(layout.time, plan.duration)}%`, width: `${timeToPercent(layout.time + layout.transitionDuration, plan.duration) - timeToPercent(layout.time, plan.duration)}%` }}
              />
            ))}

            {laneColumns.map((column, laneIndex) => (
              <div
                key={column}
                role="button"
                tabIndex={-1}
                onClick={handleLaneClick(laneIndex)}
                style={{ position: 'absolute', top: laneIndex * LANE_HEIGHT, left: 0, right: 0, height: LANE_HEIGHT, borderBottom: '1px solid var(--gray-6)', cursor: 'pointer' }}
              >
                {getColumnFillSpans(plan, column).map((span) => (
                  <div
                    key={`${span.from}-${span.to}`}
                    style={{ ...fillStyle, left: `${timeToPercent(span.from, plan.duration)}%`, width: `${timeToPercent(span.to, plan.duration) - timeToPercent(span.from, plan.duration)}%` }}
                  />
                ))}

                {plan.placements.filter((p) => p.column === column).map((placement) => {
                  const clip = clipsById.get(placement.clipId);
                  const left = timeToPercent(placement.startTime, plan.duration);
                  const width = timeToPercent(placement.endTime, plan.duration) - left;
                  return (
                    <Block
                      key={placement.clipId}
                      placement={placement}
                      laneWidthPercent={{ left, width }}
                      color={clip != null ? getColor(clip) : 'var(--gray-8)'}
                      name={clip?.name ?? placement.clipId}
                      warnings={getPlacementWarnings(plan, placement)}
                      isSelected={placement.clipId === selectedClipId}
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
                        isSelected={overlay.id === selectedOverlayId}
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

            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${timeToPercent(cursorTime, plan.duration)}%`, width: 1, background: 'var(--red-9)', pointerEvents: 'none' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(MixPlanView);
