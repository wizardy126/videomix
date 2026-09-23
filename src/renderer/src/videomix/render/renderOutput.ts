import { getPlannerInput } from '../planner/plannerInput';
import { planMix } from '../planner/planMix';
import type { MixPlan } from '../planner/types';
import { getOutputSize } from '../types';
import type { MixClip, MixProject, MixSettings } from '../types';
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

/** Low-resolution preview (04-diseno §6.6): fast to encode, only for checking the layout, transitions and audio. */
export const PREVIEW_SIZE = { width: 640, height: 360 } as const;
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

/** A gap scaled to another output height, kept even (yuv420p) like the planner's widths. */
export const scaleGap = (gap: number, fromHeight: number, toHeight: number) => 2 * Math.round((gap * toHeight) / fromHeight / 2);

/** Preview fps: 50/60 fps projects preview at half the rate (twice as fast to encode); the others as they are. */
export const getPreviewFps = (fps: MixSettings['fps']): MixSettings['fps'] => (fps === 60 ? 30 : (fps === 50 ? 25 : fps));

export interface RenderPlan {
  plan: MixPlan,
  /** The project settings adapted to the plan (preview: scaled gap and fps); pass these to `buildRenderJob`. */
  settings: MixSettings,
  /** Overrides the project's CRF/preset (preview). */
  encoding?: EncodingOptions | undefined,
}

/**
 * The plan to render. The final render plans at the output resolution. The preview plans at 640×360 (ADR-001: the plan
 * is always computed for the size it's rendered at) with the gap scaled from the output resolution, so the layout
 * matches the final one as closely as the rounding allows.
 */
export function planRender({ clips, settings }: Pick<MixProject, 'clips' | 'settings'>, { preview = false }: { preview?: boolean } = {}): RenderPlan {
  const input = getPlannerInput({ clips, settings });
  if (!preview) return { plan: planMix(input), settings };

  const { width, height } = PREVIEW_SIZE;
  const gap = scaleGap(settings.gap.width, getOutputSize(settings.output).height, height);
  const plan = planMix({ ...input, settings: { ...input.settings, width, height, gap } });
  return {
    plan,
    settings: { ...settings, fps: getPreviewFps(settings.fps), gap: { ...settings.gap, width: gap } },
    encoding: PREVIEW_ENCODING,
  };
}

export type RenderWarning =
  | { type: 'upscale', clipName: string, factor: number }
  | { type: 'pillarbox' | 'letterbox', clipName: string, time: number }
  | { type: 'fill', time: number, width: number };

/**
 * Plan warnings worth confirming before a render (01-requisitos §4.6): clips upscaled more than ×2, clips shown with
 * fill around them (pillarbox/letterbox) and rows that can't be filled with clips. Shortened transitions are left out:
 * validateMixProject already warns about short clips. One `fill` warning per keyframe would be noise, so only the first.
 */
export function getRenderWarnings(plan: Pick<MixPlan, 'warnings'>, clips: Pick<MixClip, 'id' | 'name'>[]): RenderWarning[] {
  const nameById = new Map(clips.map((clip) => [clip.id, clip.name]));
  const getName = (clipId: string) => nameById.get(clipId) ?? clipId;
  const ret: RenderWarning[] = [];
  let hasFill = false;
  plan.warnings.forEach((warning) => {
    if (warning.type === 'upscale') ret.push({ type: 'upscale', clipName: getName(warning.clipId), factor: warning.factor });
    else if (warning.type === 'pillarbox' || warning.type === 'letterbox') ret.push({ type: warning.type, clipName: getName(warning.clipId), time: warning.time });
    else if (warning.type === 'fill' && !hasFill) {
      hasFill = true;
      ret.push({ type: 'fill', time: warning.time, width: warning.width });
    }
  });
  return ret;
}
