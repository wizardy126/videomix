import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Rect } from '../types';
import { getOrientation } from '../geometry';
import type { Box, ClipRects, DragHandle, RectTarget, Size } from '../overlayMath';
import { applyRectDrag, formatAspect, getVideoContentBox, resizeHandles, toScreenCoords } from '../overlayMath';
import { snapRectDrag } from '../fitFractions';
import type { FitFraction, FitLayout, FractionFit } from '../fitFractions';
import FitChips from './FitChips';

const HANDLE_SIZE = 10;
// F2 (T45): how close (screen px) a dragged edge must get to a fraction's size to snap to it
const SNAP_THRESHOLD = 8;
// room (screen px) the fit chips take below the max rect: one row of chips, plus a margin
const CHIPS_HEIGHT = 22;
const ARROW_STEP = 2;
const ARROW_STEP_SHIFT = 10;

const handleCursors: Record<DragHandle, CSSProperties['cursor']> = {
  move: 'move', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
};

const arrowDeltas: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

function getHandleCenter(box: Box, handle: DragHandle) {
  let x = box.x + box.width / 2;
  let y = box.y + box.height / 2;
  if (handle.includes('w')) x = box.x;
  if (handle.includes('e')) x = box.x + box.width;
  if (handle.includes('n')) y = box.y;
  if (handle.includes('s')) y = box.y + box.height;
  return { x, y };
}

const sameRect = (a: Rect | undefined, b: Rect | undefined) => (
  a === b || (a != null && b != null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height)
);
const sameRects = (a: ClipRects, b: ClipRects) => sameRect(a.maxRect, b.maxRect) && sameRect(a.minRect, b.minRect);

interface DragState {
  pointerId: number,
  target: RectTarget,
  handle: DragHandle,
  startClient: { x: number, y: number },
  start: ClipRects,
  last: ClipRects,
  /** The pointer's last position, to redo the step when Alt (the magnet's inverter) is pressed or released. */
  lastClient: { x: number, y: number },
}

/**
 * Editable max/min rects of a clip, drawn over the <video> (same container, absolutely positioned on top).
 * Rects are in oriented source pixels; `videoSize` is the oriented size of the source (turned by `clipRotation`, E9).
 *
 * Controlled: `onChange` is called on every step of a drag (transient, don't record history), `onCommit` once at the
 * end of a drag or on each keyboard nudge (record it). The parent must apply both.
 *
 * Only the rects and handles take pointer events, so clicks elsewhere reach the video and the wheel bubbles to the
 * container (seek/zoom).
 */
function RectOverlay({ maxRect, minRect, videoSize, color = 'var(--cyan-9)', aspectLock, cssRotation, clipRotation, fits, fitLayout, magnet = false, onChange, onCommit }: {
  maxRect: Rect,
  minRect?: Rect | undefined,
  videoSize: Size,
  /** CSS color of the clip. */
  color?: string | undefined,
  /** width / height of the max rect while resizing it, or undefined for free. */
  aspectLock?: number | undefined,
  /** CSS rotation applied to the video by the compat player, see getVideoContentBox. */
  cssRotation?: number | undefined,
  /**
   * E9 (T38d): the clip's turn. The player is turned by it (useMixPlayerTurn) and `videoSize` is the turned frame;
   * the overlay itself isn't turned, it draws on the turned picture.
   */
  clipRotation?: number | undefined,
  /** F1 (T45): the fit of the current rects in the fractions, shown as chips next to the max rect. */
  fits?: FractionFit[] | undefined,
  /** F2 (T45): the output layout the magnet snaps to; `magnet` is its toggle (Alt while dragging inverts it). */
  fitLayout?: FitLayout | undefined,
  magnet?: boolean | undefined,
  onChange: (rects: ClipRects) => void,
  /** `keyboard`: an arrow key nudge, the parent may merge repeated nudges into one undo step. */
  onCommit: (rects: ClipRects, info?: { keyboard: boolean }) => void,
}) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState>(undefined);
  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 });
  const [active, setActive] = useState<RectTarget>('max');
  const [focused, setFocused] = useState(false);
  const [snapped, setSnapped] = useState<FitFraction>();

  useEffect(() => {
    const svg = svgRef.current;
    if (svg == null) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry == null) return;
      setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const rects = useMemo<ClipRects>(() => ({ maxRect, minRect }), [maxRect, minRect]);
  const activeTarget: RectTarget = active === 'min' && minRect != null ? 'min' : 'max';

  const box = useMemo(() => getVideoContentBox(containerSize, videoSize, cssRotation, clipRotation), [clipRotation, containerSize, cssRotation, videoSize]);
  const maxBox = useMemo(() => (box != null ? toScreenCoords(maxRect, box, videoSize) : undefined), [box, maxRect, videoSize]);
  const minBox = useMemo(() => (box != null && minRect != null ? toScreenCoords(minRect, box, videoSize) : undefined), [box, minRect, videoSize]);

  const handlePointerDown = useCallback((e: PointerEvent<SVGElement>, target: RectTarget, handle: DragHandle) => {
    if (e.button !== 0) return;
    // don't let the video toggle playback or the container start anything else
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    svgRef.current?.focus();
    setActive(target);
    dragRef.current = { pointerId: e.pointerId, target, handle, startClient: { x: e.clientX, y: e.clientY }, start: rects, last: rects, lastClient: { x: e.clientX, y: e.clientY } };
  }, [rects]);

  /** One step of the drag, to the pointer at `client`; `altKey` inverts the magnet (F2). */
  const dragTo = useCallback((drag: DragState, client: { x: number, y: number }, altKey: boolean) => {
    if (box == null) return;
    // eslint-disable-next-line no-param-reassign
    drag.lastClient = client;
    let next = applyRectDrag({
      start: drag.start,
      target: drag.target,
      handle: drag.handle,
      dx: ((client.x - drag.startClient.x) * videoSize.width) / box.width,
      dy: ((client.y - drag.startClient.y) * videoSize.height) / box.height,
      videoSize,
      aspect: drag.target === 'max' ? aspectLock : undefined,
    });
    // a locked aspect ratio wins over the magnet (snapping one edge would break it)
    const snap = magnet !== altKey && fitLayout != null && !(drag.target === 'max' && aspectLock != null)
      ? snapRectDrag({
        rects: next,
        target: drag.target,
        handle: drag.handle,
        threshold: { x: (SNAP_THRESHOLD * videoSize.width) / box.width, y: (SNAP_THRESHOLD * videoSize.height) / box.height },
        layout: fitLayout,
        videoSize,
      })
      : undefined;
    if (snap != null) next = snap.rects;
    setSnapped(snap?.fraction);
    if (sameRects(next, drag.last)) return;
    // eslint-disable-next-line no-param-reassign
    drag.last = next;
    onChange(next);
  }, [aspectLock, box, fitLayout, magnet, onChange, videoSize]);

  // Events of the captured handle bubble up to the svg, even though the svg itself has pointer-events: none.
  const handlePointerMove = useCallback((e: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag == null || drag.pointerId !== e.pointerId) return;
    dragTo(drag, { x: e.clientX, y: e.clientY }, e.altKey);
  }, [dragTo]);

  const handlePointerUp = useCallback((e: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag == null || drag.pointerId !== e.pointerId) return;
    dragRef.current = undefined;
    setSnapped(undefined);
    if (!sameRects(drag.last, drag.start)) onCommit(drag.last);
  }, [onCommit]);

  const handlePointerCancel = useCallback((e: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag == null || drag.pointerId !== e.pointerId) return;
    dragRef.current = undefined;
    setSnapped(undefined);
    onChange(drag.start);
  }, [onChange]);

  // F2: pressing or releasing Alt during a drag inverts the magnet at once, without waiting for the pointer to move.
  // Keeping the default also keeps Alt from focusing the window menu.
  const handleAltKey = useCallback((e: KeyboardEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (e.key !== 'Alt' || drag == null) return false;
    e.preventDefault();
    e.stopPropagation();
    dragTo(drag, drag.lastClient, e.type === 'keydown');
    return true;
  }, [dragTo]);

  const handleKeyUp = useCallback((e: KeyboardEvent<SVGSVGElement>) => { handleAltKey(e); }, [handleAltKey]);

  const handleKeyDown = useCallback((e: KeyboardEvent<SVGSVGElement>) => {
    if (handleAltKey(e)) return;
    if (e.key === 'Escape') {
      svgRef.current?.blur();
      return;
    }
    const delta = arrowDeltas[e.key];
    if (delta == null || e.ctrlKey || e.metaKey || e.altKey) return;
    // keep the global shortcuts (seek on arrows) from also firing
    e.stopPropagation();
    e.preventDefault();
    if (dragRef.current != null) return;
    const step = e.shiftKey ? ARROW_STEP_SHIFT : ARROW_STEP;
    const next = applyRectDrag({ start: rects, target: activeTarget, handle: 'move', dx: delta[0] * step, dy: delta[1] * step, videoSize });
    if (!sameRects(next, rects)) onCommit(next, { keyboard: true });
  }, [activeTarget, handleAltKey, onCommit, rects, videoSize]);

  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);

  const svgStyle = useMemo<CSSProperties>(() => ({
    position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'hidden', pointerEvents: 'none', outline: 'none',
  }), []);

  const renderHandles = (target: RectTarget, targetBox: Box | undefined) => targetBox != null && resizeHandles.map((handle) => {
    const { x, y } = getHandleCenter(targetBox, handle);
    return (
      <rect
        // Keyed by position only: when the active rect changes, React reuses the nodes instead of moving them,
        // which would drop the pointer capture of the drag that just started.
        key={handle}
        x={x - HANDLE_SIZE / 2}
        y={y - HANDLE_SIZE / 2}
        width={HANDLE_SIZE}
        height={HANDLE_SIZE}
        data-testid={`rect-handle-${target}-${handle}`}
        style={{ fill: target === 'max' ? color : 'white', stroke: 'black', strokeWidth: 1, cursor: handleCursors[handle], pointerEvents: 'all' }}
        onPointerDown={(e) => handlePointerDown(e, target, handle)}
      />
    );
  });

  if (box == null || maxBox == null) {
    return <svg ref={svgRef} style={svgStyle} />;
  }

  const inactiveTarget: RectTarget = activeTarget === 'max' ? 'min' : 'max';
  const boxOf = (target: RectTarget) => (target === 'max' ? maxBox : minBox);
  const labelFontSize = 12;
  const labelAbove = maxBox.y - box.y > 2 * labelFontSize + 8;
  const labelY = labelAbove ? maxBox.y - labelFontSize - 10 : maxBox.y + labelFontSize + 6;

  // F1 (T45): the chips go below the max rect, clear of its handles (or, without room there, inside it just above its
  // bottom handles), on the side of the frame the max is on, so they don't run out of the player
  const maxBottom = maxBox.y + maxBox.height;
  const chipsGap = HANDLE_SIZE / 2 + 4;
  const chipsBelow = maxBottom + chipsGap + CHIPS_HEIGHT <= containerSize.height;
  const chipsOnLeft = maxBox.x + maxBox.width / 2 <= containerSize.width / 2;
  const chipsLeft = Math.max(0, maxBox.x + HANDLE_SIZE);
  const chipsRight = Math.max(0, containerSize.width - (maxBox.x + maxBox.width) + HANDLE_SIZE);
  const chipsStyle: CSSProperties = {
    position: 'absolute',
    ...(chipsBelow ? { top: maxBottom + chipsGap } : { bottom: containerSize.height - (maxBottom - chipsGap) }),
    ...(chipsOnLeft ? { left: chipsLeft } : { right: chipsRight, justifyContent: 'flex-end' }),
    maxWidth: Math.max(0, containerSize.width - (chipsOnLeft ? chipsLeft : chipsRight) - 4),
  };

  return (
    <>
      <svg
        ref={svgRef}
        data-testid="rect-overlay"
        style={svgStyle}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        {/* darken the frame outside max */}
        <path
          d={`M${box.x},${box.y}h${box.width}v${box.height}h${-box.width}Z M${maxBox.x},${maxBox.y}h${maxBox.width}v${maxBox.height}h${-maxBox.width}Z`}
          style={{ fill: 'rgba(0,0,0,0.5)', fillRule: 'evenodd', pointerEvents: 'none' }}
        />

        <rect
          x={maxBox.x}
          y={maxBox.y}
          width={maxBox.width}
          height={maxBox.height}
          style={{ fill: 'transparent', stroke: color, strokeWidth: activeTarget === 'max' && focused ? 3 : 2, cursor: 'move', pointerEvents: 'all' }}
          onPointerDown={(e) => handlePointerDown(e, 'max', 'move')}
        />

        {minBox != null && (
        <rect
          x={minBox.x}
          y={minBox.y}
          width={minBox.width}
          height={minBox.height}
          style={{ fill: 'transparent', stroke: color, strokeWidth: activeTarget === 'min' && focused ? 3 : 2, strokeDasharray: '6 4', cursor: 'move', pointerEvents: 'all' }}
          onPointerDown={(e) => handlePointerDown(e, 'min', 'move')}
        />
        )}

        {/* the active rect's handles go last, so they win where they overlap */}
        <g>{renderHandles(inactiveTarget, boxOf(inactiveTarget))}</g>
        <g>{renderHandles(activeTarget, boxOf(activeTarget))}</g>

        <text
          data-testid="rect-label"
          x={maxBox.x}
          y={labelY}
          style={{ fill: 'white', stroke: 'black', strokeWidth: 3, paintOrder: 'stroke', fontSize: labelFontSize, pointerEvents: 'none', userSelect: 'none' }}
        >
          <tspan x={maxBox.x + (labelAbove ? 0 : 6)}>
            {`${t('Max')} ${maxRect.width}×${maxRect.height} · ${formatAspect(maxRect.width, maxRect.height)} · ${getOrientation(maxRect) === 'horizontal' ? t('Horizontal') : t('Vertical')}`}
          </tspan>
          {minRect != null && (
          <tspan x={maxBox.x + (labelAbove ? 0 : 6)} dy={labelFontSize + 3}>
            {`${t('Min')} ${minRect.width}×${minRect.height} · ${formatAspect(minRect.width, minRect.height)}`}
          </tspan>
          )}
        </text>
      </svg>

      {fits != null && <FitChips fits={fits} snapped={snapped} style={chipsStyle} />}
    </>
  );
}

export default memo(RectOverlay);
