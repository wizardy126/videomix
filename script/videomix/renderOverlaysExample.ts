// Dev tool (T23): renders a fixed example project that uses the four overlay types (T19-T22) over test-media/, with
// the production render code (buildRenderJob/buildVideoGraph/buildAudioGraph), so the frames and audio can be
// reviewed by hand. Unlike renderPlan.ts (which renders silent audio: loudness lives in main, T12), this script
// measures loudness itself with ffmpeg's `loudnorm`/`ffprobe` directly (T21's algorithm, mirrored from
// src/main/videomix/loudness.ts), so the sound effect is normalized and actually audible in the output.
//
//   node script/videomix/renderOverlaysExample.ts [outDir]
//
// Without an outDir it writes to test-media/render-overlays-example/. Needs `yarn generate-test-media` to have made
// test-media/v-1080x1920-12s.mp4, test-media/overlay-logo.png and test-media/overlay-beep.wav.
//
// The project (a single 11 s clip, portrait, so the countdown/bar/logo have somewhere to sit):
// - a 10 s countdown, top-right (the built-in preset box), with a progress bar linked to it at the bottom;
// - a PNG logo (transparent circle) with fade in/out, anchored to the clip's start;
// - a beep, anchored to the countdown's *end* (T19 §9.2 example): the video is 1 s longer than the countdown so the
//   beep, which starts exactly when the countdown reaches 0, is fully inside the video and can be heard.
//
// The renderer modules are loaded through rendererImports.ts (extensionless imports, import.meta.env); their types
// are declared locally because the node tsconfig can't type-check renderer files. src/main and src/common files have
// no such imports, so they're imported directly (typed normally).
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import registerRendererImports from './rendererImports.ts';
import { LOOP_MEASURE_DURATION, parseFfprobeAudioStream, parseFfprobeDuration as parseProbedDuration, parseLoudnormOutput, shouldLoopForMeasurement, toLoudnessAnalysis } from '../../src/main/videomix/loudnessParse.ts';
import type { LoudnessAnalysis } from '../../src/main/videomix/loudnessParse.ts';
import { getFixChannelLayoutFilter } from '../../src/common/util.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rendererDir = path.join(repoRoot, 'src/renderer/src');

registerRendererImports();

// --- minimal local types of the renderer modules we use (see rendererImports.ts) ---
interface Rect { x: number, y: number, width: number, height: number }
type OverlayAnchor =
  | { kind: 'absolute', time: number }
  | { kind: 'clip', clipId: string, edge: 'start' | 'end', offset: number }
  | { kind: 'element', elementId: string, edge: 'start' | 'end', offset: number };
interface OverlayBox { x: number, y: number, width: number, height: number }
interface ImageOverlay { id: string, name: string, type: 'image', anchor: OverlayAnchor, path: string, absolutePath: string, duration: number, box: OverlayBox, fadeIn: number, fadeOut: number }
interface CountdownOverlay {
  id: string, name: string, type: 'countdown', anchor: OverlayAnchor, duration: number, box: OverlayBox,
  align: 'left' | 'center' | 'right', decimals: 0 | 1 | 2 | 3, leadingZeros: boolean, color: string,
  border: { width: number, color: string }, fadeOut: number,
}
interface ProgressBarOverlay {
  id: string, name: string, type: 'progressBar', anchor: OverlayAnchor, duration: number, linkedCountdownId?: string | undefined,
  box: OverlayBox, fillColor: string, backgroundColor: string, border: { width: number, color: string }, direction: string, mode: string,
}
interface SoundOverlay { id: string, name: string, type: 'sound', anchor: OverlayAnchor, path: string, absolutePath: string, gainDb: number }
type MixOverlay = ImageOverlay | CountdownOverlay | ProgressBarOverlay | SoundOverlay;
interface ResolvedOverlayTime { start: number, end: number, rawStart: number, rawEnd: number, warnings: { type: string }[] }
interface ColumnPlacement { clipId: string, column: number, startTime: number, endTime: number, transitionIn: number }
interface LayoutKeyframe { time: number, transitionDuration: number, columns: { column: number, x: number, width: number }[], fills: { x: number, width: number }[] }
interface MixPlan { width: number, height: number, duration: number, placements: ColumnPlacement[], layouts: LayoutKeyframe[], warnings: unknown[] }
interface MixSettings {
  resolution: string, fps: number, crf: number, preset: string, maxColumns: number, gap: { width: number, color: string },
  reorderWindow: number, order: { mode: string, seed: number }, transition: { type: string, duration: number }, fadeInOut: boolean,
  fill: { mode: string, color: string },
}
interface RenderClip { id: string, sourceId: string, start: number, maxRect: Rect }
interface AudioClip { id: string, sourceId: string, start: number, muted: boolean, gainDb: number }
interface RenderStep { args: string[], outPath: string, duration: number }
interface RenderJob {
  totalFrames: number,
  duration: number,
  files: { path: string, content: string }[],
  chunks: (RenderStep & { frames: number, chunk: { f0: number, f1: number, animated: boolean } })[],
  audio: RenderStep,
  concat: RenderStep,
}
interface AudioGraph { inputs: string[][], filterComplex: string, outLabel: string }

const importRenderer = async <T>(file: string) => await import(pathToFileURL(path.join(rendererDir, file)).href) as T;

interface FactoriesModule {
  createImageOverlay: (args: { id: string, name: string, start?: number, filePath: string }) => ImageOverlay,
  createCountdownOverlay: (args: { id: string, name: string, start?: number }) => CountdownOverlay,
  createProgressBarOverlay: (args: { id: string, name: string, start?: number, linkedCountdownId?: string }) => ProgressBarOverlay,
  createSoundOverlay: (args: { id: string, name: string, start?: number, filePath: string }) => SoundOverlay,
}
const { createImageOverlay, createCountdownOverlay, createProgressBarOverlay, createSoundOverlay } = await importRenderer<FactoriesModule>('videomix/overlays/factories.ts');

interface ResolveOverlayTimesModule {
  resolveOverlayTimes: (
    project: { overlays: MixOverlay[], clips: unknown[] },
    plan: { duration: number, placements: unknown[] },
    options?: { soundDurations?: Record<string, number> },
  ) => Map<string, ResolvedOverlayTime>,
}
const { resolveOverlayTimes } = await importRenderer<ResolveOverlayTimesModule>('videomix/overlays/resolveOverlayTimes.ts');

const { buildRenderJob } = await importRenderer<{ buildRenderJob: (options: Record<string, unknown>) => RenderJob }>('videomix/render/buildRenderJob.ts');
const { buildAudioGraph } = await importRenderer<{ buildAudioGraph: (input: Record<string, unknown>) => AudioGraph }>('videomix/render/buildAudioGraph.ts');

// --- ffmpeg/ffprobe (dev layout, see script/videomix/generateTestMedia.ts) ---
const ffDir = path.join(repoRoot, 'ffmpeg', `${os.platform()}-${os.arch()}`, ...(os.platform() === 'darwin' ? [] : ['lib']));
const ffmpegPath = process.env['FFMPEG_PATH'] ?? path.join(ffDir, os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ffprobePath = process.env['FFPROBE_PATH'] ?? path.join(ffDir, os.platform() === 'win32' ? 'ffprobe.exe' : 'ffprobe');
const ffEnv = { ...process.env, LD_LIBRARY_PATH: ffDir };

function run(bin: string, args: string[]) {
  return new Promise<{ stdout: string, stderr: string }>((resolve, reject) => {
    const child = spawn(bin, args, { env: ffEnv });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(bin)} exited with ${code}\n${stderr.slice(-4000)}`));
    });
  });
}
const ffmpeg = async (args: string[]) => (await run(ffmpegPath, ['-loglevel', 'error', ...args])).stdout;
const ffprobe = async (args: string[]) => (await run(ffprobePath, ['-v', 'error', ...args])).stdout;

/**
 * Loudness measurement (T21/T21b's algorithm, src/main/videomix/loudness.ts#measureLoudness) run directly with the
 * dev ffmpeg, so this script doesn't need Electron/main to normalize the clip and the sound effect. A whole-file
 * measurement (range omitted) shorter than LOOP_MEASURE_DURATION loops the input first (T21b), so the countdown
 * beep (0.2 s, generateTestMedia.ts) measures a finite value instead of loudnorm's -inf for very short inputs.
 */
async function measureLoudnessCli(filePath: string, range?: { start: number, end: number }): Promise<LoudnessAnalysis> {
  const probeOut = await ffprobe(['-select_streams', 'a:0', '-show_entries', 'format=duration:stream=index,channels,channel_layout', '-of', 'json', '-i', filePath]);
  const stream = parseFfprobeAudioStream(probeOut);
  const duration = parseProbedDuration(probeOut);
  const isWholeFile = range == null;
  const wholeFileDuration = isWholeFile ? duration : undefined;
  if (stream == null) return { hasAudio: false, ...(wholeFileDuration != null && { duration: wholeFileDuration }) };
  const loop = shouldLoopForMeasurement({ isWholeFile, duration });
  const filters = [getFixChannelLayoutFilter(stream), 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json'].filter((f): f is string => f != null);
  const { stderr } = await run(ffmpegPath, [
    '-hide_banner', '-nostats',
    ...(loop ? ['-stream_loop', '-1'] : []),
    ...(range != null ? ['-ss', String(range.start), '-t', String(range.end - range.start)] : []),
    '-i', filePath,
    '-map', '0:a:0',
    ...(loop ? ['-t', String(LOOP_MEASURE_DURATION)] : []),
    '-af', filters.join(','),
    '-f', 'null', '-',
  ]);
  const values = parseLoudnormOutput(stderr);
  if (values == null) throw new Error(`Failed to parse loudnorm output for ${filePath}`);
  const analysis = toLoudnessAnalysis(values, stream);
  return wholeFileDuration != null ? { ...analysis, duration: wholeFileDuration } : analysis;
}

/** Mean/peak level (dBFS) of an audio slice, via ffmpeg's `astats` (its "Overall" summary at the end of stderr). */
async function measureSlice(filePath: string, start: number, duration: number) {
  const { stderr } = await run(ffmpegPath, ['-hide_banner', '-nostats', '-ss', String(start), '-t', String(duration), '-i', filePath, '-af', 'astats=metadata=0', '-f', 'null', '-']);
  const overall = stderr.slice(stderr.lastIndexOf('Overall'));
  const pick = (label: string) => {
    const m = new RegExp(`${label}:\\s*(-?[\\d.]+)`).exec(overall);
    if (m?.[1] == null) throw new Error(`astats: couldn't read "${label}" for ${filePath} @${start}s`);
    return Number(m[1]);
  };
  return { rmsDb: pick('RMS level dB'), peakDb: pick('Peak level dB') };
}

// --- the example project ---
const mediaDir = path.join(repoRoot, 'test-media');
const clipSourcePath = path.join(mediaDir, 'v-1080x1920-12s.mp4');
const logoPath = path.join(mediaDir, 'overlay-logo.png');
const beepPath = path.join(mediaDir, 'overlay-beep.wav');
for (const p of [clipSourcePath, logoPath, beepPath]) {
  if (!existsSync(p)) throw new Error(`Missing ${p}: run "yarn generate-test-media" first`);
}

const outDir = path.resolve(process.argv[2] ?? path.join(mediaDir, 'render-overlays-example'));
await mkdir(outDir, { recursive: true });

const WIDTH = 480;
const HEIGHT = 854; // ≈ 1080×1920, portrait, even
const FPS = 30;
const COUNTDOWN_DURATION = 10; // 01-requisitos §9.1 example: a 10 s countdown with a linked bar and a beep at 0
const VIDEO_DURATION = COUNTDOWN_DURATION + 1; // 1 s longer than the countdown, so the beep (anchored to its end) fits

const clips: RenderClip[] = [{ id: 'clip1', sourceId: 'src1', start: 0, maxRect: { x: 0, y: 0, width: 1080, height: 1920 } }];
const audioClips: AudioClip[] = [{ id: 'clip1', sourceId: 'src1', start: 0, muted: false, gainDb: 0 }];
const sourcePaths = { src1: clipSourcePath };

const plan: MixPlan = {
  width: WIDTH,
  height: HEIGHT,
  duration: VIDEO_DURATION,
  placements: [{ clipId: 'clip1', column: 0, startTime: 0, endTime: VIDEO_DURATION, transitionIn: 0 }],
  layouts: [{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: WIDTH }], fills: [] }],
  warnings: [],
};

const settings: MixSettings = {
  resolution: '1080p',
  fps: FPS,
  crf: 23,
  preset: 'veryfast',
  maxColumns: 3,
  gap: { width: 0, color: '#000000' },
  reorderWindow: 3,
  order: { mode: 'list', seed: 0 },
  transition: { type: 'fade', duration: 0.5 },
  fadeInOut: false,
  fill: { mode: 'color', color: '#000000' },
};

// Countdown: the factory's default box (top-right, 20%×10%). Progress bar: linked, so it takes the countdown's
// start/duration (its own anchor is at 0, unused). Logo: anchored to the clip's start, with the factory's default
// fade in/out (0.5 s). Beep: anchored to the countdown's *end* (T19 §9.2's own example of an element anchor).
const countdown = createCountdownOverlay({ id: 'countdown', name: 'Countdown', start: 0 });
const bar = createProgressBarOverlay({ id: 'bar', name: 'Progress bar', start: 0, linkedCountdownId: 'countdown' });
const image: ImageOverlay = { ...createImageOverlay({ id: 'logo', name: 'Logo', start: 0, filePath: logoPath }), anchor: { kind: 'clip', clipId: 'clip1', edge: 'start', offset: 0 } };
const sound: SoundOverlay = { ...createSoundOverlay({ id: 'beep', name: 'Beep', start: 0, filePath: beepPath }), anchor: { kind: 'element', elementId: 'countdown', edge: 'end', offset: 0 } };
const overlays: MixOverlay[] = [image, countdown, bar, sound];

console.log('Measuring loudness with ffmpeg (loudnorm)…');
const [clipLoudness, beepLoudness] = await Promise.all([
  measureLoudnessCli(clipSourcePath, { start: 0, end: VIDEO_DURATION }),
  measureLoudnessCli(beepPath),
]);
const loudness: Record<string, LoudnessAnalysis> = { clip1: clipLoudness, beep: beepLoudness };
console.log('clip1 (pink noise background):', clipLoudness);
console.log('beep (sound effect):', beepLoudness);
if (beepLoudness.duration == null) throw new Error('Could not read the beep\'s duration');

const overlayTimes = resolveOverlayTimes({ overlays, clips }, plan, { soundDurations: { beep: beepLoudness.duration } });
for (const overlay of overlays) {
  const times = overlayTimes.get(overlay.id);
  console.log(`overlay ${overlay.id} (${overlay.type}): [${times?.start}, ${times?.end}) s, raw [${times?.rawStart}, ${times?.rawEnd}), warnings=${JSON.stringify(times?.warnings)}`);
}

const defaultFontPath = path.join(repoRoot, 'resources/fonts/OpenSans-Bold.ttf');
if (!existsSync(defaultFontPath)) throw new Error(`Missing bundled font: ${defaultFontPath}`);

const workDir = path.join(outDir, 'work');
await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });
const outPath = path.join(outDir, 'out.mp4');

const job = buildRenderJob({
  plan,
  clips,
  sourcePaths,
  settings,
  encoding: { crf: settings.crf, preset: settings.preset },
  workDir,
  outPath,
  // The sound overlay is mixed in like T21's useMixRender: after the simultaneity compensation, before the limiter,
  // unaffected by the (disabled here) global fade.
  buildAudioGraph: (input: Record<string, unknown>) => buildAudioGraph({ ...input, clips: audioClips, loudness, overlays: [sound], overlayTimes }),
  join: path.join,
  overlays: { overlays, times: overlayTimes, defaultFontPath },
});
for (const file of job.files) await writeFile(file.path, file.content);

console.log(`Rendering ${outPath} (${job.chunks.length} chunk(s), ${job.duration.toFixed(2)} s)…`);
const started = performance.now();
for (const step of job.chunks) {
  // eslint-disable-next-line no-await-in-loop
  await ffmpeg(step.args);
  console.log(`chunk [${step.chunk.f0}, ${step.chunk.f1})`);
}
await ffmpeg(job.audio.args);
await ffmpeg(job.concat.args);
console.log(`rendered ${outPath} in ${((performance.now() - started) / 1000).toFixed(1)} s`);
if (!existsSync(outPath)) throw new Error('no output');

// --- frames to review by hand (Read tool) ---
const countdownTimes = overlayTimes.get('countdown');
const imageTimes = overlayTimes.get('logo');
const frameTimes: Record<string, number> = {
  'logo-fade-mid': (imageTimes?.rawStart ?? 0) + (image.fadeIn / 2), // mid fade-in of the PNG
  'countdown-bar-mid': (countdownTimes?.rawStart ?? 0) + COUNTDOWN_DURATION / 2, // countdown ~"5", bar ~50 %
  'countdown-near-zero': (countdownTimes?.rawEnd ?? COUNTDOWN_DURATION) - 0.3, // countdown "1"/"0", bar near full
  'beep-start': (countdownTimes?.rawEnd ?? COUNTDOWN_DURATION) + 0.05, // just after the countdown/bar disappear
};
for (const [name, t] of Object.entries(frameTimes)) {
  const png = path.join(outDir, `frame-${name}.png`);
  // eslint-disable-next-line no-await-in-loop
  await ffmpeg(['-y', '-ss', String(t), '-i', outPath, '-frames:v', '1', png]);
  console.log(`wrote ${png} (t=${t.toFixed(2)} s)`);
}

// --- verify the beep's position with ffmpeg (astats levels, before vs. during) ---
const beepStart = countdownTimes?.rawEnd ?? COUNTDOWN_DURATION;
const before = await measureSlice(outPath, Math.max(0, beepStart - 0.4), 0.3);
// the first part of the tone, before its own fade-out tail (afade st=0.15 in generateTestMedia.ts, a 0.2 s beep)
const during = await measureSlice(outPath, beepStart + 0.02, 0.1);
console.log(`audio level before the beep (background only): RMS ${before.rmsDb.toFixed(1)} dB, peak ${before.peakDb.toFixed(1)} dB`);
console.log(`audio level during the beep: RMS ${during.rmsDb.toFixed(1)} dB, peak ${during.peakDb.toFixed(1)} dB`);
const RMS_MARGIN_DB = 2;
if (during.rmsDb < before.rmsDb + RMS_MARGIN_DB) {
  throw new Error(`The beep doesn't stand out at t=${beepStart.toFixed(2)} s (RMS ${during.rmsDb.toFixed(1)} dB vs. ${before.rmsDb.toFixed(1)} dB before it): check its anchor/gain.`);
}
console.log('OK: the beep is clearly louder than the background right after the countdown ends.');

await rm(workDir, { recursive: true, force: true });
