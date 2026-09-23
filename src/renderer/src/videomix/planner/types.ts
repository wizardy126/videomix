import { getAxisLengths } from '../geometry';
import type { AspectRange, LayoutAxis } from '../geometry';
import type { Rect } from '../types';

/** A clip as the planner sees it. Built from `MixClip` by `getPlannerInput`. */
export interface PlannerClip {
  id: string,
  /** Seconds, > 0. */
  duration: number,
  aspectRange: AspectRange,
  /** Source rects, only needed for upscale warnings/scoring. Without them upscaling is ignored. */
  rects?: { maxRect: Rect, minRect?: Rect | undefined } | undefined,
  /**
   * A4 (T30): the clip starts at this time of the final video (s). Pinned clips are outside the reorder window. When
   * the row has no room then, it starts as soon as it can and the plan warns (`pin-shifted`).
   */
  pinTime?: number | undefined,
  /**
   * A4 (T30): the clips of a group (≥ 2 of them) start together and take the list position of their first clip. A group
   * with a pinned clip is pinned as a whole, at the earliest pin of its clips.
   */
  groupId?: string | undefined,
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
  /**
   * Force the main axis (tests). By default it follows the output shape (01-requisitos §10 B5, {@link getDefaultAxis}):
   * columns for landscape, rows for portrait, and for a square output the better of both plans.
   */
  axis?: LayoutAxis | undefined,
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
 * Layout of the row of columns (or, with `axis: 'rows'`, the column of rows) from `time` on. `x` and `width` are the
 * offset and length along the main axis: output x/width for columns, output y/height for rows (a row spans the whole
 * width, as a column spans the whole height). "Left"/"right" below read "top"/"bottom" for rows.
 * When `transitionDuration > 0`, widths/positions animate linearly from the previous
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
  /** Output px along the main axis, left to right (top to bottom). Adjacent columns are separated by exactly `gap`. */
  columns: { column: number, x: number, width: number }[],
  /** Areas no column covers (when the clips can't fill the row). They touch their neighbours, without gap. */
  fills: { x: number, width: number }[],
}

export type PlanWarning =
  /** The clip is upscaled more than x2 (factor is the maximum over its layouts). */
  | { type: 'upscale', clipId: string, factor: number }
  /**
   * The column (or row) is wider/narrower than the clip allows, so the clip gets side (pillarbox) or top/bottom
   * (letterbox) fill from `time` on. Always in output terms, whatever the axis.
   */
  | { type: 'pillarbox' | 'letterbox', clipId: string, time: number }
  /** The crossfade into this clip is shorter than the global transition (short clips). */
  | { type: 'transition-shortened', clipId: string, duration: number }
  /**
   * The row has fill from `time` on while clips are still pending, because none fitted better. `width` is along the
   * main axis (a height for rows).
   */
  | { type: 'fill', time: number, width: number }
  /**
   * A4 (T30): a pinned clip doesn't start at its pin time but at `time`: later when the row had no room (more pinned
   * clips than columns at once, or no column could be freed without cutting a clip), earlier when the other clips run
   * out before it (it can't leave a hole in the video).
   */
  | { type: 'pin-shifted', clipId: string, pinTime: number, time: number }
  /** A4 (T30): the clips of a group don't all start together (more clips than columns, or no room for all of them). */
  | { type: 'group-split', groupId: string, clipIds: string[] };

export interface MixPlan {
  /** Output size (px), whatever the axis. */
  width: number,
  height: number,
  /**
   * Main axis of the layouts (T29): `columns` side by side or `rows` stacked. The planner always sets it; a missing
   * value (hand-written plans in tests and scripts) means `columns`. Read it with {@link getPlanAxis}.
   */
  axis?: LayoutAxis | undefined,
  /** Seconds (end of the last clip). */
  duration: number,
  /** In start-time order (without pinned clips it is also the order the planner picked them). */
  placements: ColumnPlacement[],
  /** Sorted by time; the first one at t = 0. */
  layouts: LayoutKeyframe[],
  warnings: PlanWarning[],
}

/** Main axis of a plan (missing = columns). */
export const getPlanAxis = (plan: Pick<MixPlan, 'axis'>): LayoutAxis => plan.axis ?? 'columns';

/** Length of the plan's frame along its main axis (what the layouts span) and across it. */
export const getPlanAxisLengths = (plan: Pick<MixPlan, 'axis' | 'width' | 'height'>) => getAxisLengths(getPlanAxis(plan), plan);

/**
 * Main axis for an output (01-requisitos §10 B5): columns side by side in landscape, a single column of full-width rows
 * in portrait (never side by side), and `undefined` for a square frame, where the planner tries both.
 */
export function getDefaultAxis({ width, height }: { width: number, height: number }): LayoutAxis | undefined {
  if (width > height) return 'columns';
  if (width < height) return 'rows';
  return undefined;
}
