// Master clock of the live preview (A1, T32): the preview's time drives the media elements, never the other way round
// (04-diseno §9). Pure: `now` is a performance.now() value in ms, passed in by the caller.

export interface PreviewClock {
  playing: boolean,
  /** Preview time (s) at `anchor`. */
  time: number,
  /** performance.now() (ms) when `time` was set. */
  anchor: number,
  /** Video duration (s): playback stops there. */
  duration: number,
}

export const createPreviewClock = (duration: number): PreviewClock => ({ playing: false, time: 0, anchor: 0, duration });

const clampTime = (clock: Pick<PreviewClock, 'duration'>, time: number) => Math.min(Math.max(0, time), Math.max(0, clock.duration));

/** Preview time (s) at `now`: runs in real time while playing, clamped to the video. */
export function getClockTime(clock: PreviewClock, now: number) {
  if (!clock.playing) return clock.time;
  return clampTime(clock, clock.time + (now - clock.anchor) / 1000);
}

/** Whether a playing clock has reached the end of the video (the caller then pauses it). */
export const isClockAtEnd = (clock: PreviewClock, now: number) => clock.playing && getClockTime(clock, now) >= clock.duration;

/** Starts playing from the current time; from the start when at the end of the video (like a media player). */
export function playClock(clock: PreviewClock, now: number): PreviewClock {
  const time = getClockTime(clock, now);
  return { ...clock, playing: true, time: time >= clock.duration ? 0 : time, anchor: now };
}

export function pauseClock(clock: PreviewClock, now: number): PreviewClock {
  return { ...clock, playing: false, time: getClockTime(clock, now), anchor: now };
}

export function seekClock(clock: PreviewClock, time: number, now: number): PreviewClock {
  return { ...clock, time: clampTime(clock, time), anchor: now };
}

/** A new duration (the plan changed), keeping the current time when it still fits. */
export function setClockDuration(clock: PreviewClock, duration: number, now: number): PreviewClock {
  const time = getClockTime(clock, now);
  return { ...clock, duration, time: Math.min(time, Math.max(0, duration)), anchor: now };
}

/** Drift above which a media element is seeked (s): a rate nudge would take too long to catch up. */
export const DRIFT_SEEK_THRESHOLD = 0.15;
/** Drift below which nothing is done (s): about one frame at 30 fps is invisible and currentTime is coarse anyway. */
export const DRIFT_TOLERANCE = 0.03;
/** When paused, an element this far (s) from its position is seeked: well under a frame, above currentTime's noise. */
export const PAUSED_TOLERANCE = 0.005;
/** Largest playback rate change used to absorb a small drift (±5 %; Chromium keeps the pitch, `preservesPitch`). */
export const MAX_RATE_NUDGE = 0.05;
/**
 * While playing, a seek aims this far ahead (s): the element takes some time to seek (and decode from a keyframe),
 * during which the clock goes on, so aiming at the current time would leave it behind and seek again.
 */
export const SEEK_LEAD = 0.1;
/** Rate change per second of drift: a drift of 0.1 s is absorbed in about 2 s at the maximum nudge. */
const RATE_NUDGE_GAIN = 0.5;

export type DriftCorrection =
  | { kind: 'none', rate: 1 }
  | { kind: 'rate', rate: number }
  | { kind: 'seek', time: number, rate: 1 };

/**
 * What to do with a media element whose position is `actual` (s, its currentTime) when it should be at `expected`:
 * seek when the drift is above `DRIFT_SEEK_THRESHOLD` (`SEEK_LEAD` ahead), or exactly when paused (any visible
 * difference matters); nudge the playback rate for a smaller drift while playing (slower when ahead, faster when
 * behind); else play at normal speed.
 */
export function getDriftCorrection({ expected, actual, playing }: { expected: number, actual: number, playing: boolean }): DriftCorrection {
  const drift = actual - expected;
  const abs = Math.abs(drift);
  if (!playing) return abs > PAUSED_TOLERANCE ? { kind: 'seek', time: expected, rate: 1 } : { kind: 'none', rate: 1 };
  if (abs > DRIFT_SEEK_THRESHOLD) return { kind: 'seek', time: expected + SEEK_LEAD, rate: 1 };
  if (abs <= DRIFT_TOLERANCE) return { kind: 'none', rate: 1 };
  const nudge = Math.min(MAX_RATE_NUDGE, abs * RATE_NUDGE_GAIN);
  return { kind: 'rate', rate: drift > 0 ? 1 - nudge : 1 + nudge };
}
