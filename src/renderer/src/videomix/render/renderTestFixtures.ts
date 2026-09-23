// Hand-written plans for the render tests (unit snapshots and the optional real-ffmpeg test). Written by hand, not with
// planMix, so the snapshots don't move when the planner's scoring is tuned.
import type { ColumnPlacement, LayoutKeyframe, MixPlan } from '../planner/types';
import { defaultMixSettings } from '../types';
import type { MixSettings, Rect } from '../types';
import type { RenderClip } from './buildVideoGraph';

/** Oriented sizes of the T02 media (test-media/), by source id. */
export const testSources = {
  h1080: { file: 'h-1080p-10s.mp4', width: 1920, height: 1080 },
  h720: { file: 'h-720p-25fps-8s.mp4', width: 1280, height: 720 },
  v1080: { file: 'v-1080x1920-12s.mp4', width: 1080, height: 1920 },
  sq: { file: 'sq-1080-6s.mp4', width: 1080, height: 1080 },
  rot: { file: 'v-rotated-9s.mp4', width: 1080, height: 1920 },
} as const;

export type TestSourceId = keyof typeof testSources;

const full = (id: TestSourceId): Rect => ({ x: 0, y: 0, width: testSources[id].width, height: testSources[id].height });
const centered = (id: TestSourceId, width: number, height: number): Rect => {
  const s = testSources[id];
  return { x: 2 * Math.round((s.width - width) / 4), y: 2 * Math.round((s.height - height) / 4), width, height };
};

export const testClips: RenderClip[] = [
  // horizontal, croppable down to 800 px wide
  { id: 'a', sourceId: 'h1080', start: 1, maxRect: full('h1080'), minRect: centered('h1080', 800, 1080) },
  // vertical that can widen to 1080x1400 (zoom when its column gets wider than 9:16)
  { id: 'b', sourceId: 'v1080', start: 0, maxRect: full('v1080'), minRect: centered('v1080', 1080, 1400) },
  // 25 fps horizontal, croppable down to 560 px wide
  { id: 'c', sourceId: 'h720', start: 0, maxRect: full('h720'), minRect: centered('h720', 560, 720) },
  // rigid square
  { id: 'd', sourceId: 'sq', start: 0.5, maxRect: full('sq') },
  // rigid vertical (display-matrix rotated source)
  { id: 'e', sourceId: 'rot', start: 2, maxRect: full('rot') },
];

export const testSourcePaths = (dir: string) => Object.fromEntries(Object.entries(testSources).map(([id, s]) => [id, `${dir}/${s.file}`]));

export const testSettings = (overrides: Partial<MixSettings> = {}): MixSettings => ({
  ...defaultMixSettings,
  gap: { width: 8, color: '#303030' },
  ...overrides,
});

const col = (column: number, x: number, width: number) => ({ column, x, width });
const kf = (time: number, transitionDuration: number, columns: LayoutKeyframe['columns'], fills: LayoutKeyframe['fills'] = []): LayoutKeyframe => ({ time, transitionDuration, columns, fills });
const place = (clipId: string, column: number, startTime: number, endTime: number, transitionIn?: number, transitionOut?: number): ColumnPlacement => ({
  clipId, column, startTime, endTime, transitionIn: transitionIn ?? 0, ...(transitionOut != null && { transitionOut }),
});
const plan = (width: number, height: number, placements: ColumnPlacement[], layouts: LayoutKeyframe[]): MixPlan => ({
  width, height, duration: Math.max(...placements.map((p) => p.endTime)), placements, layouts, warnings: [],
});

/** Scale a plan's geometry (x/width) to another output size, keeping even values. */
export function scalePlan(p: MixPlan, width: number, height: number): MixPlan {
  const s = width / p.width;
  const even = (v: number) => 2 * Math.round((v * s) / 2);
  return {
    ...p,
    width,
    height,
    layouts: p.layouts.map((l) => ({
      ...l,
      columns: l.columns.map((c) => ({ ...c, x: even(c.x), width: even(c.x + c.width) - even(c.x) })),
      fills: l.fills.map((f) => ({ x: even(f.x), width: even(f.x + f.width) - even(f.x) })),
    })),
  };
}

/** The test plans, at 640x360 (gap 8) unless noted. */
export const testPlans = {
  /** Two columns, nothing changes. */
  static: plan(640, 360, [place('b', 0, 0, 3), place('a', 1, 0, 3)], [kf(0, 0, [col(0, 0, 202), col(1, 210, 430)])]),

  /** Clip replaced by a 25 fps clip (xfade), and a column whose clip ends before the video: it fades into fill. */
  substitutions: plan(640, 360, [
    place('b', 0, 0, 4.5, 0, 0.5),
    place('a', 1, 0, 3),
    place('c', 1, 2.5, 6, 0.5),
  ], [kf(0, 0, [col(0, 0, 202), col(1, 210, 430)])]),

  /** ADR-001 example at 1920x1080: re-layout 632|1280 → 776|1136 with an xfade at the same time, the vertical zooms. */
  relayout: plan(1920, 1080, [
    place('b', 0, 0, 4),
    place('a', 1, 0, 2.5),
    place('c', 1, 2, 4, 0.5),
  ], [
    kf(0, 0, [col(0, 0, 632), col(1, 640, 1280)]),
    kf(2, 0.5, [col(0, 0, 776), col(1, 784, 1136)]),
  ]),

  /** Pillarboxed rigid square between edge fills; a new column grows from width 0 and the fills close. */
  fills: plan(640, 360, [
    place('d', 0, 0, 4),
    place('a', 1, 2, 4),
  ], [
    kf(0, 0, [col(0, 100, 440)], [{ x: 0, width: 100 }, { x: 540, width: 100 }]),
    kf(2, 0.5, [col(0, 0, 360), col(1, 368, 272)]),
  ]),

  /** Three columns, the middle one is removed (shrinks to 0 next to its right neighbour) and ends with the animation. */
  removal: plan(640, 360, [
    place('b', 0, 0, 4),
    place('e', 1, 0, 2.5),
    place('c', 2, 0, 4),
  ], [
    kf(0, 0, [col(0, 0, 202), col(1, 210, 202), col(2, 420, 220)]),
    kf(2, 0.5, [col(0, 0, 276), col(2, 284, 356)]),
  ]),
} satisfies Record<string, MixPlan>;

/**
 * The same plan as rows (T29): the output size is transposed (640x360 → 360x640) and every column becomes a full-width
 * row with the same offsets and lengths along the vertical axis. The clips keep their rects, so their crops change.
 */
export const toRowsPlan = (p: MixPlan): MixPlan => ({ ...p, axis: 'rows', width: p.height, height: p.width });
