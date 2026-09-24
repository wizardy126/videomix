import { getPlannerInput } from '../planner/plannerInput';
import { planMix } from '../planner/planMix';
import { truncatePlan } from '../planner/truncatePlan';
import { getDefaultAxis } from '../planner/types';
import type { MixPlan } from '../planner/types';
import { getOutputSize } from '../types';
import type { MixClip, MixOutput, MixProject, MixSettings, MixSource } from '../types';
import type { EncodingOptions } from './buildRenderJob';

// Pure helpers of the render/preview orchestration (T13, hooks/useMixRender.ts): output and temp paths, what to plan
// for the final render and for the low-resolution preview. Paths go through an injected `path` (node:path in the app).

export interface PathLike {
  join: (...parts: string[]) => string,
  dirname: (p: string) => string,
  basename: (p: string, ext?: string) => string,
  extname: (p: string) => string,
}

export const OUTPUT_EXTENSION = 'mp4';

/** Short side of the low-resolution preview (04-diseno §6.6): fast to encode, only for checking the layout, transitions and audio. */
export const PREVIEW_SHORT_SIDE = 360;

/** Preview size: {@link PREVIEW_SHORT_SIDE} with the output's aspect (T29): 640×360, 360×640 or 360×360. */
export function getPreviewSize(output: MixOutput) {
  const { width, height } = getOutputSize(output);
  const scale = PREVIEW_SHORT_SIDE / Math.min(width, height);
  return { width: 2 * Math.round((width * scale) / 2), height: 2 * Math.round((height * scale) / 2) };
}
export const PREVIEW_ENCODING: EncodingOptions = { preset: 'ultrafast', crf: 30 };

/**
 * Suggested output file of a render: `<project name>.mp4` next to the project, or next to the first source while the
 * project is unsaved. `lastOutputPath` (the previous render of this session) wins, so repeated renders go where the
 * user chose before.
 */
export function getDefaultOutputPath({ path, projectPath, firstSourcePath, lastOutputPath, fallbackDir, untitledName }: {
  path: PathLike,
  projectPath?: string | undefined,
  firstSourcePath?: string | undefined,
  lastOutputPath?: string | undefined,
  fallbackDir: string,
  untitledName: string,
}) {
  if (lastOutputPath != null) return lastOutputPath;
  const name = projectPath != null ? path.basename(projectPath, path.extname(projectPath)) : untitledName;
  const dir = projectPath != null ? path.dirname(projectPath) : (firstSourcePath != null ? path.dirname(firstSourcePath) : fallbackDir);
  return path.join(dir, `${name}.${OUTPUT_EXTENSION}`);
}

/** The save dialog on Linux doesn't add the extension of the filter: without it ffmpeg can't pick the muxer. */
export function withOutputExtension(filePath: string) {
  return /\.mp4$/i.test(filePath) ? filePath : `${filePath}.${OUTPUT_EXTENSION}`;
}

/**
 * The render writes here and renames to `outPath` only when it succeeds, so a cancelled or failed render never leaves
 * a truncated file with the final name (nor replaces an existing one). Same directory, so the rename is atomic.
 * Keeps the `.mp4` extension: ffmpeg picks the muxer from it.
 */
export function getPartialOutputPath(path: PathLike, outPath: string, id: string) {
  const ext = path.extname(outPath);
  return path.join(path.dirname(outPath), `${path.basename(outPath, ext)}.${id}.part${ext || `.${OUTPUT_EXTENSION}`}`);
}

/** Temp dir for the chunks, graphs and audio pass of one render (removed afterwards, also when cancelled or failed). */
export const getRenderWorkDir = (path: PathLike, tmpDir: string, kind: 'render' | 'preview', id: string) => path.join(tmpDir, `videomix-${kind}-${id}`);

/** Preview output, outside the work dir: it lives until the preview dialog is closed. */
export const getPreviewOutputPath = (path: PathLike, tmpDir: string, id: string) => path.join(tmpDir, `videomix-preview-${id}.${OUTPUT_EXTENSION}`);

// Only what getRenderWorkDir and getPreviewOutputPath create (the ids are nanoid(8)), nothing else in the temp dir
const tempEntryPattern = /^videomix-(?:render|preview)-[\w-]{8}(?:\.mp4)?$/;

/** Old enough to be sure no render or preview (of this or another instance) is still using it. */
export const ORPHAN_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Temp dir entries left by a render or preview that never cleaned up (the app was closed or crashed meanwhile): ours
 * by name, and not modified for `maxAgeMs`. Returns their names.
 */
export function getOrphanTempEntries(entries: { name: string, mtimeMs: number }[], now: number, maxAgeMs = ORPHAN_TEMP_MAX_AGE_MS) {
  return entries.filter(({ name, mtimeMs }) => tempEntryPattern.test(name) && now - mtimeMs > maxAgeMs).map(({ name }) => name);
}

/** A gap scaled to another output size (by a side, e.g. the height or the short side), kept even (yuv420p) like the planner's widths. */
export const scaleGap = (gap: number, fromHeight: number, toHeight: number) => 2 * Math.round((gap * toHeight) / fromHeight / 2);

/** Preview fps: 50/60 fps projects preview at half the rate (twice as fast to encode); the others as they are. */
export const getPreviewFps = (fps: MixSettings['fps']): MixSettings['fps'] => (fps === 60 ? 30 : (fps === 50 ? 25 : fps));

export interface RenderPlan {
  /** What is rendered: cut at `settings.maxDuration` (E4, `truncatePlan`) when the mix is longer. */
  plan: MixPlan,
  /**
   * The plan before the cut (the same object as `plan` when nothing is cut): its duration is the "≈ m:ss" estimate
   * (E3), and its placements anchor the overlays (see {@link getOverlayTimesPlan}).
   */
  fullPlan: MixPlan,
  /** The project settings adapted to the plan (preview: scaled gap and fps); pass these to `buildRenderJob`. */
  settings: MixSettings,
  /** Overrides the project's CRF/preset (preview). */
  encoding?: EncodingOptions | undefined,
}

/**
 * The plan to render. The final render plans at the output resolution. The preview plans at a 360 px short side with
 * the output's aspect ({@link getPreviewSize}; ADR-001: the plan is always computed for the size it's rendered at)
 * with the gap scaled from the output resolution, so the layout matches the final one as closely as the rounding
 * allows. In 1:1 the axis (rows or columns) is the one the final render picks at the output resolution, so the preview
 * never shows the other one on a near-tie (T29).
 */
export function planRender({ clips, settings, sources }: Pick<MixProject, 'clips' | 'settings'> & { sources: Pick<MixSource, 'id' | 'width' | 'height'>[] }, { preview = false }: { preview?: boolean } = {}): RenderPlan {
  // E7 (T38b): the source sizes bound the extension beyond the max; the preview extends by the same source pixels
  const input = getPlannerInput({ clips, settings, sources });
  // E4 (T39): the render, the preview and the live preview all show the mix cut at the maximum duration
  const cut = (fullPlan: MixPlan) => ({ plan: settings.maxDuration != null ? truncatePlan(fullPlan, settings.maxDuration) : fullPlan, fullPlan });
  if (!preview) return { ...cut(planMix(input)), settings };

  const { width, height } = getPreviewSize(settings.output);
  const output = getOutputSize(settings.output);
  const gap = scaleGap(settings.gap.width, Math.min(output.width, output.height), Math.min(width, height));
  const axis = getDefaultAxis(output) ?? planMix(input).axis;
  return {
    ...cut(planMix({ ...input, settings: { ...input.settings, width, height, gap, axis } })),
    settings: { ...settings, fps: getPreviewFps(settings.fps), gap: { ...settings.gap, width: gap } },
    encoding: PREVIEW_ENCODING,
  };
}

/**
 * What overlays and sounds are resolved on (`resolveOverlayTimes`, T38): the placements of the whole plan with the
 * duration of the cut one. So an overlay anchored to a clip lost at the cut falls after the end of the video (and is
 * left out) instead of losing its anchor, and one anchored to the end of a clip that is cut keeps its real time.
 */
export const getOverlayTimesPlan = ({ plan, fullPlan }: Pick<RenderPlan, 'plan' | 'fullPlan'>): Pick<MixPlan, 'duration' | 'placements'> => (
  plan === fullPlan ? plan : { duration: plan.duration, placements: fullPlan.placements }
);

export type RenderWarning =
  | { type: 'upscale', clipName: string, factor: number }
  | { type: 'pillarbox' | 'letterbox', clipName: string, time: number }
  /** `width` is along the main axis: a height when `rows`. */
  | { type: 'fill', time: number, width: number, rows: boolean }
  /** A4 (T30): a pinned clip that can't start at its pin time. */
  | { type: 'pin-shifted', clipName: string, pinTime: number, time: number }
  /** A4 (T30): a group whose clips don't all start together. */
  | { type: 'group-split', clipNames: string[] }
  /** E7 (T38b): a clip shown beyond its max rect (`pixels` along the main axis: a height when `rows`). */
  | { type: 'extended', clipName: string, pixels: number, time: number, endTime: number, rows: boolean }
  /** E4 (T39): the mix is cut at the maximum duration `time`: `seconds` lost, clips left out and clips cut. */
  | { type: 'truncated', time: number, seconds: number, lostClipNames: string[], cutClipNames: string[] };

/**
 * Plan warnings worth confirming before a render (01-requisitos §4.6): clips upscaled more than ×2, clips shown with
 * fill around them (pillarbox/letterbox), rows that can't be filled with clips, pins or groups the planner couldn't
 * honour (A4), clips shown beyond their max rect to avoid fill (E7) and the cut at the maximum duration (E4, first).
 * Shortened transitions are left out:
 * validateMixProject already warns about short clips. One `fill` warning per keyframe would be noise, so only the first.
 */
export function getRenderWarnings(plan: Pick<MixPlan, 'warnings' | 'axis'>, clips: Pick<MixClip, 'id' | 'name'>[]): RenderWarning[] {
  const nameById = new Map(clips.map((clip) => [clip.id, clip.name]));
  const getName = (clipId: string) => nameById.get(clipId) ?? clipId;
  const ret: RenderWarning[] = [];
  let hasFill = false;
  plan.warnings.forEach((warning) => {
    switch (warning.type) {
      case 'upscale': {
        ret.push({ type: 'upscale', clipName: getName(warning.clipId), factor: warning.factor });
        break;
      }
      case 'pillarbox':
      case 'letterbox': {
        ret.push({ type: warning.type, clipName: getName(warning.clipId), time: warning.time });
        break;
      }
      case 'fill': {
        if (!hasFill) ret.push({ type: 'fill', time: warning.time, width: warning.width, rows: plan.axis === 'rows' });
        hasFill = true;
        break;
      }
      case 'pin-shifted': {
        ret.push({ type: 'pin-shifted', clipName: getName(warning.clipId), pinTime: warning.pinTime, time: warning.time });
        break;
      }
      case 'group-split': {
        ret.push({ type: 'group-split', clipNames: warning.clipIds.map((id) => getName(id)) });
        break;
      }
      case 'extended': {
        ret.push({ type: 'extended', clipName: getName(warning.clipId), pixels: warning.pixels, time: warning.time, endTime: warning.endTime, rows: plan.axis === 'rows' });
        break;
      }
      case 'truncated': {
        // first: it's the one that changes the video most
        ret.unshift({ type: 'truncated', time: warning.time, seconds: warning.seconds, lostClipNames: warning.clipIds.map((id) => getName(id)), cutClipNames: warning.cutClipIds.map((id) => getName(id)) });
        break;
      }
      default: { break; }
    }
  });
  return ret;
}
