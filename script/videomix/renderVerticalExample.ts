// Dev tool (T34): renders a fixed 9:16 example project that uses several v2 features together over test-media/, with
// the production render code (planRender/buildRenderJob/buildAudioGraph), so the result can be reviewed by hand:
// - a text overlay with an entry animation (slide in from the bottom);
// - a music playlist of 2 tracks with crossfade and ducking (C2, T27);
// - a pinned clip and a group of 2 clips that play together, side by side in a row (A4, T30; 9:16 stacks in rows, T29).
//
// Unlike renderPlan.ts (silent audio) and renderOverlaysExample.ts (a single clip, no music), this measures loudness
// itself with ffmpeg's `loudnorm`/`ffprobe` directly (T21's algorithm, mirrored from src/main/videomix/loudness.ts) for
// every clip and music track, and plans the project with the real planner (planRender), so pin/group/rows are exactly
// what the app would produce.
//
//   node script/videomix/renderVerticalExample.ts [outDir]
//
// Without an outDir it writes to test-media/render-vertical-example/. Needs `yarn generate-test-media` to have made
// the test videos and test-media/music-20s.m4a / music-60s.mp3.
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
interface TextOverlay {
  id: string, name: string, type: 'text', anchor: OverlayAnchor, text: string, duration: number, box: OverlayBox,
  fontSize: number, align: string, color: string, border: { width: number, color: string }, lineSpacing: number,
  fadeIn: number, fadeOut: number, entry: { kind: string, from?: string, duration: number },
}
type MixOverlay = TextOverlay;
interface ResolvedOverlayTime { start: number, end: number, rawStart: number, rawEnd: number, warnings: { type: string }[] }
interface MixClip {
  id: string, sourceId: string, name: string, color: number, start: number, end: number, maxRect: Rect, muted: boolean,
  gainDb: number, pinTime?: number, groupId?: string,
}
interface MusicTrack { id: string, path: string, absolutePath: string, volumeDb: number }
interface MixSettings {
  output: { aspect: string, resolution: string }, fps: number, crf: number, preset: string, maxColumns: number, gap: { width: number, color: string },
  reorderWindow: number, order: { mode: string, seed: number }, transition: { type: string, duration: number }, fadeInOut: boolean,
  fill: { mode: string, color: string },
  encoder: { codec: string, hardware: string },
  musicPlaylist: { tracks: MusicTrack[], crossfade: number, loop: boolean, ducking: { enabled: boolean, amountDb: number } },
  // v3 (T36): chains, always visible sequence and maximum duration
  links: { maxGap: number, transition: 'cut' | 'global' },
  alwaysVisible: { clipIds: string[] },
  maxDuration?: number,
}
interface MixSource { id: string, width: number, height: number }
interface MixPlan { duration: number, placements: { clipId: string, startTime: number, endTime: number }[], [key: string]: unknown }
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
  createTextOverlay: (args: { id: string, name: string, start?: number, text: string }) => TextOverlay,
}
const { createTextOverlay } = await importRenderer<FactoriesModule>('videomix/overlays/factories.ts');

interface ResolveOverlayTimesModule {
  resolveOverlayTimes: (
    project: { overlays: MixOverlay[], clips: unknown[] },
    plan: { duration: number, placements: unknown[] },
    options?: { soundDurations?: Record<string, number> },
  ) => Map<string, ResolvedOverlayTime>,
}
const { resolveOverlayTimes } = await importRenderer<ResolveOverlayTimesModule>('videomix/overlays/resolveOverlayTimes.ts');

interface RenderOutputModule {
  planRender: (input: { clips: MixClip[], settings: MixSettings, sources: MixSource[] }) => { plan: MixPlan, fullPlan: MixPlan, settings: MixSettings },
  getOverlayTimesPlan: (renderPlan: { plan: MixPlan, fullPlan: MixPlan }) => { duration: number, placements: unknown[] },
}
const { planRender, getOverlayTimesPlan } = await importRenderer<RenderOutputModule>('videomix/render/renderOutput.ts');

const { buildRenderJob } = await importRenderer<{ buildRenderJob: (options: Record<string, unknown>) => RenderJob }>('videomix/render/buildRenderJob.ts');
const { buildAudioGraph } = await importRenderer<{ buildAudioGraph: (input: Record<string, unknown>) => AudioGraph }>('videomix/render/buildAudioGraph.ts');

// --- ffmpeg/ffprobe (dev layout, see script/videomix/generateTestMedia.ts) ---
const ffDir = path.join(repoRoot, 'ffmpeg', `${os.platform()}-${os.arch()}`, 'lib');
const ffmpegPath = process.env['FFMPEG_PATH'] ?? path.join(ffDir, 'ffmpeg');
const ffprobePath = process.env['FFPROBE_PATH'] ?? path.join(ffDir, 'ffprobe');
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

/** Loudness measurement (T21/T21b, mirrored from src/main/videomix/loudness.ts#measureLoudness); see renderOverlaysExample.ts. */
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

// --- the example project: 9:16, 720x1280 ---
const mediaDir = path.join(repoRoot, 'test-media');
const sourcePaths = {
  src1: path.join(mediaDir, 'h-1080p-10s.mp4'), // 1920x1080, plays alone first
  src2: path.join(mediaDir, 'v-1080x1920-12s.mp4'), // 1080x1920, grouped with src3
  src3: path.join(mediaDir, 'v-720x1280-silent-7s.mp4'), // 720x1280, grouped with src2
  src4: path.join(mediaDir, 'h-720p-25fps-8s.mp4'), // 1280x720, pinned
};
const musicPaths = {
  music1: path.join(mediaDir, 'music-20s.m4a'),
  music2: path.join(mediaDir, 'music-60s.mp3'),
};
for (const p of [...Object.values(sourcePaths), ...Object.values(musicPaths)]) {
  if (!existsSync(p)) throw new Error(`Missing ${p}: run "yarn generate-test-media" first`);
}

const outDir = path.resolve(process.argv[2] ?? path.join(mediaDir, 'render-vertical-example'));
await mkdir(outDir, { recursive: true });

const FPS = 30;
const PIN_TIME = 3; // clip1 (A4/T30) must start at 3 s of the final video: nothing comes before it, so the planner
// fills [0, PIN_TIME) with the blank/color fill (D of 04-diseno) — no clip audio there, handy to check ducking's release below.

const clips: MixClip[] = [
  { id: 'clip1', sourceId: 'src1', name: 'Pinned', color: 0, start: 0, end: 3, maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, muted: false, gainDb: 0, pinTime: PIN_TIME },
  { id: 'clip2', sourceId: 'src2', name: 'Group A', color: 1, start: 0, end: 3, maxRect: { x: 0, y: 0, width: 1080, height: 1920 }, muted: false, gainDb: 0, groupId: 'g1' },
  { id: 'clip3', sourceId: 'src3', name: 'Group B', color: 2, start: 0, end: 3, maxRect: { x: 0, y: 0, width: 720, height: 1280 }, muted: false, gainDb: 0, groupId: 'g1' },
  { id: 'clip4', sourceId: 'src4', name: 'Solo', color: 3, start: 0, end: 3, maxRect: { x: 0, y: 0, width: 1280, height: 720 }, muted: false, gainDb: 0 },
];
const audioClips: AudioClip[] = clips.map((c) => ({ id: c.id, sourceId: c.sourceId, start: c.start, muted: c.muted, gainDb: c.gainDb }));

const settings: MixSettings = {
  output: { aspect: '9:16', resolution: '720' },
  encoder: { codec: 'h264', hardware: 'none' },
  fps: FPS,
  crf: 23,
  preset: 'veryfast',
  maxColumns: 2, // up to 2 rows visible at once, so the group (clip2 + clip3) can show together
  gap: { width: 8, color: '#000000' },
  reorderWindow: 2,
  order: { mode: 'list', seed: 0 },
  transition: { type: 'fade', duration: 0.5 },
  fadeInOut: true,
  fill: { mode: 'color', color: '#101020' },
  musicPlaylist: {
    tracks: [
      { id: 'music1', path: 'music-20s.m4a', absolutePath: musicPaths.music1, volumeDb: 0 },
      { id: 'music2', path: 'music-60s.mp3', absolutePath: musicPaths.music2, volumeDb: -3 },
    ],
    crossfade: 2,
    loop: true,
    ducking: { enabled: true, amountDb: -10 },
  },
  links: { maxGap: 10, transition: 'cut' },
  alwaysVisible: { clipIds: [] },
};

// Display sizes of the sources (E7, T38b: they bound the extension beyond the max, as in the app)
const sources: MixSource[] = [
  { id: 'src1', width: 1920, height: 1080 },
  { id: 'src2', width: 1080, height: 1920 },
  { id: 'src3', width: 720, height: 1280 },
  { id: 'src4', width: 1280, height: 720 },
];
const renderPlan = planRender({ clips, settings, sources });
const { plan } = renderPlan;
console.log(`Planned ${plan.placements.length} placement(s), duration ${plan.duration.toFixed(2)} s`);
for (const p of plan.placements as { clipId: string, startTime: number, endTime: number }[]) {
  console.log(`  ${p.clipId}: [${p.startTime.toFixed(2)}, ${p.endTime.toFixed(2)})`);
}
const clip1Placement = (plan.placements as { clipId: string, startTime: number }[]).find((p) => p.clipId === 'clip1');
if (clip1Placement == null) throw new Error('clip1 (pinned) is missing from the plan');
console.log(`Pinned clip (clip1) requested at ${PIN_TIME} s, planner placed it at ${clip1Placement.startTime.toFixed(2)} s.`);
if (Math.abs(clip1Placement.startTime - PIN_TIME) > 0.05) {
  // Not enough remaining content to wait until PIN_TIME with no gap: the planner pulls it earlier instead of leaving
  // a gap (04-diseno §3.6), and reports it with a `pin-shifted` warning (T30) — check it's there.
  const shifted = (plan['warnings'] as { type: string, clipId?: string }[]).some((w) => w.type === 'pin-shifted' && w.clipId === 'clip1');
  if (!shifted) throw new Error(`clip1 moved from its pin (${PIN_TIME} s) to ${clip1Placement.startTime} s without a pin-shifted warning`);
  console.log('OK: shifted, with the expected pin-shifted warning.');
} else {
  console.log('OK: the pinned clip (clip1) starts exactly where pinned; [0, PIN_TIME) is filled (no clip, no audio).');
}

// Text overlay with an entry animation (B1, T26): slides in from the bottom, shown for most of the video.
const text: TextOverlay = {
  ...createTextOverlay({ id: 'text1', name: 'Title', start: PIN_TIME + 0.2, text: '¡Bienvenidos!\nMontaje de ejemplo' }),
  entry: { kind: 'slide', from: 'bottom', duration: 0.8 },
  duration: Math.max(1, plan.duration - 2),
};
const overlays: MixOverlay[] = [text];

console.log('Measuring loudness with ffmpeg (loudnorm)…');
const loudnessEntries = await Promise.all([
  ...clips.map(async (c) => [c.id, await measureLoudnessCli(sourcePaths[c.sourceId as keyof typeof sourcePaths], { start: c.start, end: c.end })] as const),
  ...settings.musicPlaylist.tracks.map(async (t) => [t.id, await measureLoudnessCli(t.absolutePath)] as const),
]);
const loudness: Record<string, LoudnessAnalysis> = Object.fromEntries(loudnessEntries);
for (const [id, l] of loudnessEntries) console.log(`${id}:`, l);

// on the placements of the whole plan, cut to the maximum duration (T39), like the app
const overlayTimes = resolveOverlayTimes({ overlays, clips }, getOverlayTimesPlan(renderPlan), {});
for (const overlay of overlays) {
  const times = overlayTimes.get(overlay.id);
  console.log(`overlay ${overlay.id} (${overlay.type}): [${times?.start}, ${times?.end}) s, warnings=${JSON.stringify(times?.warnings)}`);
}

const defaultFontPath = path.join(repoRoot, 'resources/fonts/OpenSans-Bold.ttf');
if (!existsSync(defaultFontPath)) throw new Error(`Missing bundled font: ${defaultFontPath}`);

const workDir = path.join(outDir, 'work');
await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });
const outPath = path.join(outDir, 'out.mp4');

const renderClips: RenderClip[] = clips.map((c) => ({ id: c.id, sourceId: c.sourceId, start: c.start, maxRect: c.maxRect }));

const job = buildRenderJob({
  plan,
  clips: renderClips,
  sourcePaths,
  settings,
  encoding: { crf: settings.crf, preset: settings.preset },
  workDir,
  outPath,
  buildAudioGraph: (input: Record<string, unknown>) => buildAudioGraph({ ...input, clips: audioClips, loudness, overlays: [], overlayTimes: new Map() }),
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

// --- verify the output size and duration with ffprobe ---
const probeOut = await ffprobe(['-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-show_entries', 'format=duration', '-of', 'json', '-i', outPath]);
const probe = JSON.parse(probeOut) as { streams: { width: number, height: number }[], format: { duration: string } };
console.log('ffprobe:', probe.streams[0], 'duration', probe.format.duration);
if (probe.streams[0]?.width !== 720 || probe.streams[0]?.height !== 1280) throw new Error(`Expected 720x1280, got ${JSON.stringify(probe.streams[0])}`);
if (Math.abs(Number(probe.format.duration) - job.duration) > 0.5) throw new Error(`Expected duration ~${job.duration.toFixed(2)}s, got ${probe.format.duration}`);
console.log('OK: 720x1280, expected duration.');

// --- ducking (C2, T27) is enabled in settings.musicPlaylist.ducking; buildAudioGraph.ffmpeg.test.ts already checks its
// exact level with generated tones. Here, with these very quiet test clips (all well under -20 LUFS, see above), just
// log the music level at a moment with a clip playing vs. without one, informationally (not a hard check: at these
// levels the difference can be smaller than the astats measurement noise). ---
const clip4Placement = (plan.placements as { clipId: string, startTime: number, endTime: number }[]).find((p) => p.clipId === 'clip4')!;
const withoutClips = await measureSlice(outPath, Math.max(0, clip4Placement.endTime + 0.1), 0.3);
const duringClip1 = await measureSlice(outPath, clip1Placement.startTime + 0.8, 1);
console.log(`music level with (probably) no clip playing: RMS ${withoutClips.rmsDb.toFixed(1)} dB`);
console.log(`music level while clip1 plays (ducked): RMS ${duringClip1.rmsDb.toFixed(1)} dB`);

// --- frames to review by hand (Read tool) ---
const textTimes = overlayTimes.get('text1');
const clip2Placement = (plan.placements as { clipId: string, startTime: number }[]).find((p) => p.clipId === 'clip2')!;
const frameTimes: Record<string, number> = {
  'first-clip': 0.5, // clip4, played first by the planner to fill ahead of clip1's pin
  'group-rows': Math.min(job.duration - 0.1, clip2Placement.startTime + 1), // group A + B, both rows visible
  'text-slide-mid': (textTimes?.rawStart ?? PIN_TIME) + text.entry.duration / 2, // text sliding in
  'pinned-clip1': Math.min(job.duration - 0.1, clip1Placement.startTime + 0.5), // the pinned clip on screen
  'near-end': Math.max(0, job.duration - 0.3),
};
for (const [name, t] of Object.entries(frameTimes)) {
  const png = path.join(outDir, `frame-${name}.png`);
  // eslint-disable-next-line no-await-in-loop
  await ffmpeg(['-y', '-ss', String(t), '-i', outPath, '-frames:v', '1', png]);
  console.log(`wrote ${png} (t=${t.toFixed(2)} s)`);
}

await rm(workDir, { recursive: true, force: true });
