import type { MixOverlay, OverlayBox, ProgressBarOverlay, Rect } from '../types';
import type { ResolvedOverlayTime, ResolvedOverlayTimes } from './resolveOverlayTimes';

// Per-frame values of the visual overlays (T20), shared by the render graph (render/overlayFilters.ts) and the UI (mini
// frame view, countdown text preview), so both show the same thing. Everything is in output frames, f = round(t·fps),
// like the rest of the render (ADR-001): frame f is shown at t = f / fps.

const roundEven = (v: number) => 2 * Math.round(v / 2) + 0;

export interface OverlayFrames {
  /** Visible frames [start, end) in the final video (cut to it). Drawn only if end > start. */
  start: number,
  end: number,
  /** Uncut frames: the countdown value and the bar progress use these (a countdown cut by the end of the video doesn't reach 0). */
  rawStart: number,
  rawEnd: number,
}

export function getOverlayFrames(time: Pick<ResolvedOverlayTime, 'start' | 'end' | 'rawStart' | 'rawEnd'>, fps: number): OverlayFrames {
  return {
    start: Math.round(time.start * fps),
    end: Math.round(time.end * fps),
    rawStart: Math.round(time.rawStart * fps),
    rawEnd: Math.round(time.rawEnd * fps),
  };
}

/** Box of an overlay in output px: even values (yuv420p), at least 2×2. */
export function getOverlayPixelBox(box: OverlayBox, width: number, height: number): Rect {
  return {
    x: roundEven(box.x * width),
    y: roundEven(box.y * height),
    width: Math.max(2, roundEven(box.width * width)),
    height: Math.max(2, roundEven(box.height * height)),
  };
}

/**
 * Value shown by a countdown `remainingFrames` before its (raw) end, in units of 10^-decimals s, rounded up: it shows
 * `ceil(duration)` on its first frame and never 0 (it disappears then). Integer maths: exact at every frame.
 */
export const getCountdownUnits = (remainingFrames: number, fps: number, decimals: number) => Math.ceil((remainingFrames * 10 ** decimals) / fps);

/**
 * Whether a countdown shows `M:SS` for its whole run (decided once, by its total duration, not by the shown value):
 * ≥ 60 s of (uncut) duration keeps `M:SS` throughout (`1:00` → `0:59` → … → `0:01`); below that it's always `SS`
 * (01-requisitos §9.1).
 */
export function getCountdownMinutesFormat(frames: Pick<OverlayFrames, 'rawStart' | 'rawEnd'>, fps: number) {
  return frames.rawEnd - frames.rawStart >= 60 * fps;
}

/** Text of a countdown value (from {@link getCountdownUnits}): `S[.ddd]` or `M:SS[.ddd]` per {@link getCountdownMinutesFormat}. */
export function formatCountdown(units: number, decimals: number, leadingZeros: boolean, minutesFormat: boolean) {
  const p = 10 ** decimals;
  const seconds = Math.floor(units / p);
  const pad = (v: number, n: number) => String(v).padStart(n, '0');
  const fraction = decimals > 0 ? `.${pad(units % p, decimals)}` : '';
  if (!minutesFormat) return `${leadingZeros ? pad(seconds, 2) : seconds}${fraction}`;
  const minutes = Math.floor(seconds / 60);
  return `${leadingZeros ? pad(minutes, 2) : minutes}:${pad(seconds % 60, 2)}${fraction}`;
}

/** Countdown text at output frame `frame` (undefined if not visible), as the render draws it. */
export function getCountdownTextAt(overlay: { decimals: number, leadingZeros: boolean }, frames: OverlayFrames, frame: number, fps: number) {
  if (frame < frames.start || frame >= frames.end) return undefined;
  return formatCountdown(getCountdownUnits(frames.rawEnd - frame, fps, overlay.decimals), overlay.decimals, overlay.leadingZeros, getCountdownMinutesFormat(frames, fps));
}

/**
 * Filled fraction of a progress bar at output frame `frame`: `(frame − rawStart) / (rawEnd − rawStart)` in `fill` mode
 * (0 on its first frame; it disappears when full), the complement in `empty` mode.
 */
export function getProgressBarFraction(mode: ProgressBarOverlay['mode'], frames: Pick<OverlayFrames, 'rawStart' | 'rawEnd'>, frame: number) {
  const total = frames.rawEnd - frames.rawStart;
  if (total <= 0) return mode === 'fill' ? 1 : 0;
  const p = Math.min(1, Math.max(0, (frame - frames.rawStart) / total));
  return mode === 'fill' ? p : 1 - p;
}

export interface VisibleOverlayBox {
  id: string,
  type: Exclude<MixOverlay['type'], 'sound'>,
  name: string,
  /** Fractions of the frame, as stored. */
  box: OverlayBox,
  /** Output px as rendered (only with `width`/`height`). */
  pixelBox?: Rect | undefined,
  /** Index in `project.overlays`: the array is already in layer order (last = on top). */
  layer: number,
}

/**
 * Visual overlays shown at `time` (s) of the final video, bottom to top: for the mini frame view (T15/T22), which draws
 * their outlines and types. Uses the render's frame rounding, so it agrees with the render at every frame.
 */
export function getVisibleOverlayBoxes({ overlays, resolved, time, fps, width, height }: {
  overlays: readonly MixOverlay[],
  resolved: ResolvedOverlayTimes,
  time: number,
  fps: number,
  /** Output size, to also get the rendered px boxes. */
  width?: number | undefined,
  height?: number | undefined,
}): VisibleOverlayBox[] {
  const frame = Math.round(time * fps);
  const ret: VisibleOverlayBox[] = [];
  overlays.forEach((overlay, layer) => {
    if (overlay.type === 'sound') return;
    const times = resolved.get(overlay.id);
    if (times == null) return;
    const { start, end } = getOverlayFrames(times, fps);
    if (frame < start || frame >= end) return;
    ret.push({
      id: overlay.id,
      type: overlay.type,
      name: overlay.name,
      box: overlay.box,
      ...(width != null && height != null && { pixelBox: getOverlayPixelBox(overlay.box, width, height) }),
      layer,
    });
  });
  return ret;
}
