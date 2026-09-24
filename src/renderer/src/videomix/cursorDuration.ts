import type { StateSegment } from '../types';
import { formatDuration } from '../util/duration';

// E1 (01-requisitos §11): the duration counter shown next to the playhead in the Timeline and as text in the
// BottomBar. Pure so it's testable without React; the components just format the result.

export type CursorDurationInfo =
  /** A marker (no end yet): elapsed time from its start to the cursor. */
  | { type: 'marker', duration: number }
  /** A clip (has an end): its actual duration, and what it would become if its end moved to the cursor. */
  | { type: 'clip', duration: number, cursorDuration: number };

/**
 * What to show for `segment` (the current timeline segment) with the cursor at `cursorTime`. `undefined` without a
 * current segment. Negative spans (cursor before the segment's start) are clamped to 0 so the label never goes
 * negative while scrubbing backwards.
 */
export function getCursorDurationInfo(segment: Pick<StateSegment, 'start' | 'end'> | undefined, cursorTime: number): CursorDurationInfo | undefined {
  if (segment == null) return undefined;
  if (segment.end == null) return { type: 'marker', duration: Math.max(0, cursorTime - segment.start) };
  return {
    type: 'clip',
    duration: segment.end - segment.start,
    cursorDuration: Math.max(0, cursorTime - segment.start),
  };
}

const formatShort = (seconds: number) => formatDuration({ seconds, shorten: true, showFraction: false });

/** The text for `info`: just the elapsed duration for a marker, or "duration → duration if end were here" for a clip. */
export function formatCursorDurationLabel(info: CursorDurationInfo | undefined): string | undefined {
  if (info == null) return undefined;
  if (info.type === 'marker') return formatShort(info.duration);
  return `${formatShort(info.duration)} → ${formatShort(info.cursorDuration)}`;
}
