import type { MixPlan } from '../planner/types';
import type { MixSettings, mixPresets } from '../types';
import { buildVideoGraph, formatNumber } from './buildVideoGraph';
import type { RenderClip, RenderSourceFrames, VideoGraphSettings } from './buildVideoGraph';
import { getVideoEncodeArgs } from './encoderArgs';
import type { ResolvedEncoder } from './encoderArgs';
import type { VideoGraphOverlays } from './overlayFilters';
import { MAX_CHUNK_SECONDS, getRenderChunks } from './renderChunks';
import type { RenderChunk } from './renderChunks';
import { getRenderTimeline } from './renderTimeline';
import type { RenderTimeline } from './renderTimeline';

export type { ResolvedEncoder } from './encoderArgs';

// Whole render as independent ffmpeg invocations (ADR-001 "Arquitectura de render"): video chunks (run 2 at a time),
// one audio pass over the whole duration, then concat demuxer (-c copy) + audio mux. Pure: it only returns args and
// the text files that must be written before running them.

/** What the audio pass hook receives. T12's graph also needs the loudness cache and the full clips: the caller closes over them. */
export interface AudioGraphInput {
  plan: MixPlan,
  clips: RenderClip[],
  sourcePaths: Record<string, string>,
  settings: MixSettings,
  /** Exact duration of the video (totalFrames / fps): the audio must be cut to it. */
  duration: number,
}

/** Audio pass graph (T12's `AudioPass` has this shape). Same shape as the video graph: inputs, graph text, output pad. */
export interface AudioGraph {
  /** Input options per input, each ending in `-i <path>`. */
  inputs: string[][],
  /** Written by the job to a file and passed with `-/filter_complex <file>`. */
  filterComplex: string,
  outLabel: string,
}

/**
 * Hook for the audio pass, rendered once for the whole duration apart from the video chunks (ADR-001). T13 passes
 * `(input) => buildAudioGraph({ ...input, clips: project.clips, loudness })` (T12, `render/buildAudioGraph.ts`).
 * The job encodes it as AAC 192 kbps 48 kHz stereo (.m4a), which the final mux copies.
 * The default, {@link buildSilentAudioGraph}, produces stereo silence.
 */
export type BuildAudioGraph = (input: AudioGraphInput) => AudioGraph;

/** Stereo silence of the exact duration: keeps the output shape (MP4 with an AAC track) without T12's graph. */
export const buildSilentAudioGraph: BuildAudioGraph = ({ duration }) => ({
  inputs: [['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']],
  filterComplex: `[0:a]atrim=duration=${formatNumber(duration)}[aout]`,
  outLabel: 'aout',
});

export interface RenderStepCache {
  path: string,
  /** How far (s) the probed duration of a cached file can be from `duration` for it to be reused. */
  tolerance: number,
}

/** One ffmpeg invocation. `args` exclude the ffmpeg binary. */
export interface RenderStep {
  args: string[],
  outPath: string,
  /** Seconds of media the step produces (for progress). */
  duration: number,
  /**
   * Render cache (T28, set by `applyRenderCache`): the step's output is reused from `path` when it's there and valid;
   * otherwise ffmpeg writes to `outPath` (a partial name next to it) and the runner renames it to `path`.
   */
  cache?: RenderStepCache | undefined,
}

export interface RenderChunkStep extends RenderStep {
  chunk: RenderChunk,
  /** File name of `outPath` inside the work dir. */
  fileName: string,
  /** Frames the chunk produces: progress = Σ frames done / `RenderJob.totalFrames` (ADR-001). */
  frames: number,
  graphPath: string,
}

export interface RenderJob {
  totalFrames: number,
  /** Exact output duration (s): totalFrames / fps. */
  duration: number,
  /** Text files (graphs, concat list) to write before running any step. */
  files: { path: string, content: string }[],
  /** Independent of each other: run with {@link getChunkConcurrency}. */
  chunks: RenderChunkStep[],
  /** Independent of the chunks (can run before or alongside them). */
  audio: RenderStep,
  /** Last step: concat the chunks and mux the audio into `outPath`. */
  concat: RenderStep,
  /** Every temporary file (written files and step outputs except the final one), to delete when done or cancelled. */
  tempPaths: string[],
  /** Render cache dir of the cached steps (T28, `applyRenderCache`), created by the runner. */
  cacheDir?: string | undefined,
}

export interface EncodingOptions {
  crf: number,
  preset: typeof mixPresets[number],
}

const defaultJoin = (dir: string, name: string) => (dir.endsWith('/') || dir.endsWith('\\') ? `${dir}${name}` : `${dir}/${name}`);

/** ADR-001: 2 chunks in parallel; 1 at 2160p (memory) or with fewer than 4 cores (no gain). */
export function getChunkConcurrency({ height, cpuCount }: { height: number, cpuCount: number }) {
  return height > 1080 || cpuCount < 4 ? 1 : 2;
}

/**
 * Build the whole render job for a plan. `plan.width/height` is the output size (the plan is computed for it, also
 * for the low-resolution preview). `encoding` overrides the project's CRF/preset (preview).
 * `join` builds paths inside `workDir` (pass `path.join`; the default joins with `/`, which ffmpeg accepts everywhere).
 */
export function buildRenderJob({
  plan,
  clips,
  sourcePaths,
  sourceFrames,
  settings,
  encoding,
  // Software by default (as before T25): callers that don't resolve hardware availability themselves (dev
  // scripts, tests, previews before T25) always get libx264/libx265 for `settings.encoder.codec`.
  resolvedEncoder,
  workDir,
  outPath,
  maxChunkSeconds = MAX_CHUNK_SECONDS,
  buildAudioGraph = buildSilentAudioGraph,
  join = defaultJoin,
  overlays,
}: {
  plan: MixPlan,
  clips: RenderClip[],
  sourcePaths: Record<string, string>,
  /** Size and SAR of each source (B1): the crops of anamorphic sources are converted to coded pixels. */
  sourceFrames?: RenderSourceFrames | undefined,
  settings: MixSettings,
  encoding?: Partial<EncodingOptions> | undefined,
  /** Which encoder to actually use (T25): resolved from `settings.encoder` against `detectEncoders` (useMixRender). */
  resolvedEncoder?: ResolvedEncoder | undefined,
  workDir: string,
  outPath: string,
  maxChunkSeconds?: number | undefined,
  buildAudioGraph?: BuildAudioGraph | undefined,
  join?: ((dir: string, name: string) => string) | undefined,
  /** Visual overlays with their times resolved for `plan` (T20). */
  overlays?: VideoGraphOverlays | undefined,
}): RenderJob {
  const { fps } = settings;
  const timeline: RenderTimeline = getRenderTimeline(plan, { fps, gap: settings.gap.width, transitionDuration: settings.transition.duration });
  const { totalFrames } = timeline;
  const duration = totalFrames / fps;
  const { codec, hardware } = resolvedEncoder ?? { codec: settings.encoder.codec, hardware: 'none' };
  const { globalArgs: encoderGlobalArgs, outputArgs: encodeArgs } = getVideoEncodeArgs({
    codec, hardware, fps, crf: encoding?.crf ?? settings.crf, preset: encoding?.preset ?? settings.preset,
  });
  const graphSettings: VideoGraphSettings = settings;
  const common = ['-hide_banner', '-nostdin', '-y'];

  const files: RenderJob['files'] = [];
  const chunks = getRenderChunks(timeline, { maxChunkSeconds }).map((chunk): RenderChunkStep => {
    const graph = buildVideoGraph({ timeline, clips, sourcePaths, sourceFrames, settings: graphSettings, chunk, overlays });
    const name = `chunk-${String(chunk.index).padStart(4, '0')}`;
    const graphPath = join(workDir, `${name}.graph.txt`);
    const fileName = `${name}.mp4`;
    const chunkOutPath = join(workDir, fileName);
    files.push({ path: graphPath, content: graph.filterComplex });
    return {
      chunk,
      fileName,
      frames: graph.frames,
      graphPath,
      outPath: chunkOutPath,
      duration: graph.frames / fps,
      args: [
        ...common,
        ...encoderGlobalArgs,
        ...graph.inputs.flat(),
        '-/filter_complex', graphPath,
        '-map', `[${graph.outLabel}]`,
        '-frames:v', String(graph.frames),
        ...encodeArgs,
        '-an',
        chunkOutPath,
      ],
    };
  });

  const audioGraph = buildAudioGraph({ plan, clips, sourcePaths, settings, duration });
  const audioGraphPath = join(workDir, 'audio.graph.txt');
  const audioPath = join(workDir, 'audio.m4a');
  files.push({ path: audioGraphPath, content: audioGraph.filterComplex });
  const audio: RenderStep = {
    outPath: audioPath,
    duration,
    args: [
      ...common,
      ...audioGraph.inputs.flat(),
      '-/filter_complex', audioGraphPath,
      '-map', `[${audioGraph.outLabel}]`,
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
      audioPath,
    ],
  };

  // Paths in the list are relative to the list file (all in workDir): no quoting issues with odd directory names.
  const listPath = join(workDir, 'chunks.txt');
  files.push({ path: listPath, content: chunks.map((c) => `file '${c.fileName}'\n`).join('') });
  const concat: RenderStep = {
    outPath,
    duration,
    args: [
      ...common,
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-i', audioPath,
      '-map', '0:v', '-map', '1:a',
      '-c', 'copy',
      '-t', formatNumber(duration),
      '-movflags', '+faststart',
      outPath,
    ],
  };

  return {
    totalFrames,
    duration,
    files,
    chunks,
    audio,
    concat,
    tempPaths: [...files.map((f) => f.path), ...chunks.map((c) => c.outPath), audioPath],
  };
}
