import type { AspectRange } from '../geometry';
import type { Rect } from '../types';

/** A clip as the planner sees it. Built from `MixClip` by `getPlannerInput`. */
export interface PlannerClip {
  id: string,
  /** Seconds, > 0. */
  duration: number,
  aspectRange: AspectRange,
  /** Source rects, only needed for upscale warnings/scoring. Without them upscaling is ignored. */
  rects?: { maxRect: Rect, minRect?: Rect | undefined } | undefined,
}

export interface PlannerSettings {
  /** Output size in px. */
  width: number,
  height: number,
  maxColumns: number,
  /** Separation between adjacent columns, px. */
  gap: number,
  /** A clip may start at most this many positions before/after its index in the base list. */
  reorderWindow: number,
  order: { mode: 'list' | 'random', seed: number },
  /** Global transition duration (s). Shortened per clip when clips are short. */
  transitionDuration: number,
}

export interface PlanMixInput {
  /** In list order. */
  clips: PlannerClip[],
  settings: PlannerSettings,
}

/** A clip playing in a column. */
export interface ColumnPlacement {
  clipId: string,
  /** Stable column id (not its visual index). */
  column: number,
  /** In the final video (s). */
  startTime: number,
  /** `startTime` + clip duration. */
  endTime: number,
  /**
   * Crossfade with the previous clip of the column (s): this clip starts `transitionIn` before the previous one ends.
   * 0 for the first clip of a column. Below the global duration when a clip is short (see `transition-shortened`).
   */
  transitionIn: number,
  /**
   * End of the video (01-requisitos §4.3): the clip has no successor, its column stays in the layout and becomes fill,
   * so the clip fades out to the fill with the global transition during [endTime - transitionOut, endTime].
   * Missing (or 0) when the clip is followed in its column (the successor's `transitionIn` is the crossfade), when its
   * column is removed by a re-layout (it shrinks to 0), or when it ends with the video (the global fade handles it).
   * ≤ min(D, clip duration / 2), and no layout animation starts inside the fade.
   */
  transitionOut?: number | undefined,
}

/**
 * Row layout from `time` on. When `transitionDuration > 0`, widths/positions animate linearly from the previous
 * keyframe to this one during [time, time + transitionDuration]. Keyframes never overlap.
 *
 * - A column missing from the previous keyframe is new: it grows from width 0 and its first clip starts at `time`.
 * - A column missing from this keyframe is removed: it shrinks to 0 and its last clip ends exactly when the
 *   animation ends.
 * - A column stays in the layout after its last clip ends only at the end of the video (no clips left): its area then
 *   shows fill, without re-expanding the others (01-requisitos §4.3).
 */
export interface LayoutKeyframe {
  time: number,
  /** 0 = instant change (only the initial layout, or when the global transition is 0). */
  transitionDuration: number,
  /** Output px, left to right. Adjacent columns are separated by exactly `gap`. */
  columns: { column: number, x: number, width: number }[],
  /** Areas no column covers (when the clips can't fill the row). They touch their neighbours, without gap. */
  fills: { x: number, width: number }[],
}

export type PlanWarning =
  /** The clip is upscaled more than x2 (factor is the maximum over its layouts). */
  | { type: 'upscale', clipId: string, factor: number }
  /** The column is wider/narrower than the clip allows, so the clip gets side/top-bottom fill from `time` on. */
  | { type: 'pillarbox' | 'letterbox', clipId: string, time: number }
  /** The crossfade into this clip is shorter than the global transition (short clips). */
  | { type: 'transition-shortened', clipId: string, duration: number }
  /** The row has fill from `time` on while clips are still pending, because none fitted better. */
  | { type: 'fill', time: number, width: number };

export interface MixPlan {
  width: number,
  height: number,
  /** Seconds (end of the last clip). */
  duration: number,
  /** In the order the planner picked the clips, which is also start-time order. */
  placements: ColumnPlacement[],
  /** Sorted by time; the first one at t = 0. */
  layouts: LayoutKeyframe[],
  warnings: PlanWarning[],
}
