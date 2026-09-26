// A3 (T53): zoom and horizontal scroll of the Mix view (components/MixPlanView.tsx). Pure, so it can be unit tested.
// The zoom is the content width over the visible width: 1 = the whole mix fits (the default). It's per session, not
// stored in the project.

/** Factor of the + / − buttons. */
export const MIX_ZOOM_STEP = 1.5;

/** Seconds shown across the view at the maximum zoom. */
const MIN_VISIBLE_SECONDS = 2;

/** Tick steps of the time axis (s). */
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

export function getMaxMixZoom(duration: number) {
  return Math.max(1, duration / MIN_VISIBLE_SECONDS);
}

export function clampMixZoom(zoom: number, duration: number) {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(getMaxMixZoom(duration), Math.max(1, zoom));
}

/** Zoom factor for a Ctrl + wheel step of `pixelY` (normalized wheel px, positive = down = zoom out). */
export function getWheelZoomFactor(pixelY: number) {
  return Math.exp(-pixelY / 500);
}

/** A native wheel event's deltas in px (line and page modes as in hooks/normalizeWheel.ts). */
export function getWheelPixels({ deltaX, deltaY, deltaMode }: { deltaX: number, deltaY: number, deltaMode: number }) {
  const unit = deltaMode === 1 ? 40 : (deltaMode === 2 ? 800 : 1);
  return { x: deltaX * unit, y: deltaY * unit };
}

const clampScroll = (scrollLeft: number, contentWidth: number, viewportWidth: number) => Math.min(Math.max(0, contentWidth - viewportWidth), Math.max(0, scrollLeft));

/** `scrollLeft` that shows `time` at `anchorX` px from the left of the view (zoom centred on the mouse or the view). */
export function getAnchoredScrollLeft({ time, duration, contentWidth, viewportWidth, anchorX }: {
  time: number,
  duration: number,
  contentWidth: number,
  viewportWidth: number,
  anchorX: number,
}) {
  const x = duration > 0 ? (time / duration) * contentWidth : 0;
  return clampScroll(x - anchorX, contentWidth, viewportWidth);
}

/**
 * Follows the play cursor: the `scrollLeft` that brings `time` back into view, a page at a time (it lands a tenth of
 * the view from the left, like the source timeline), or `undefined` when it's already visible.
 */
export function getFollowScrollLeft({ time, duration, contentWidth, viewportWidth, scrollLeft }: {
  time: number,
  duration: number,
  contentWidth: number,
  viewportWidth: number,
  scrollLeft: number,
}) {
  if (duration <= 0 || contentWidth <= viewportWidth) return undefined;
  const x = (time / duration) * contentWidth;
  if (x >= scrollLeft && x <= scrollLeft + viewportWidth) return undefined;
  return clampScroll(x - viewportWidth * 0.1, contentWidth, viewportWidth);
}

/**
 * Ticks of the time axis within `[from, to]` (s): the smallest step that leaves at least `minSpacing` px between
 * labels at `pixelsPerSecond`.
 */
export function getTimeTicks({ duration, pixelsPerSecond, from, to, minSpacing = 60 }: {
  duration: number,
  pixelsPerSecond: number,
  from: number,
  to: number,
  minSpacing?: number,
}) {
  if (duration <= 0 || pixelsPerSecond <= 0) return { step: 0, ticks: [] };
  const step = TICK_STEPS.find((s) => s * pixelsPerSecond >= minSpacing) ?? TICK_STEPS.at(-1)!;
  const ticks: number[] = [];
  const first = Math.max(0, Math.ceil(from / step - 1e-9));
  for (let i = first; i * step <= Math.min(duration, to) + 1e-9; i += 1) ticks.push(Math.round(i * step * 1000) / 1000);
  return { step, ticks };
}
