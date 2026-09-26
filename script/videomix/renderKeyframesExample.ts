// Dev tool (T50): renders a fixed 16:9 example project that exercises several v4 features together over
// test-media/, with the production render code (planRender/buildRenderJob) and the same pure logic the UI uses, so
// the result can be reviewed by hand:
// - an animated clip (A9, T44/T48/T49): pan and zoom keyframes with the three interpolations (smooth, linear, hold);
// - a clip fitted to 1/3 of the output with `fitMaxRectToFraction` (F2, T45), whose exact size isn't a whole number
//   of output px, so the plan only avoids fill thanks to the 1 % tolerance (T44b) — checked with `getClipFractionFits`
//   (F1, T44/T45): it reads "fits" although the fraction isn't exact;
// - a clip with its black bars detected (`cropdetect`, real ffmpeg) and removed (A7, T44/T47), the same way the
//   "Remove black bars" button does.
//
// The animated and the black-bars clips get a min rect narrower than their (16:9) max, so the planner has room to fit
// them into a column next to the fitted one (a rigid 16:9 clip could otherwise only ever fill the whole row); the
// planner still picks the layout itself (here, 2 columns most of the time, the third clip replacing the animated one
// once it ends), which is enough to check there's no fill and to look at the animated pan/zoom next to the others.
//
//   node script/videomix/renderKeyframesExample.ts [outDir]
//
// Without an outDir it writes to test-media/render-keyframes-example/. Needs `yarn generate-test-media` to have made
// the test videos.
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import registerRendererImports from './rendererImports.ts';
import { parseCropDetectOutput } from '../../src/common/videomix/cropDetect.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rendererDir = path.join(repoRoot, 'src/renderer/src');

registerRendererImports();

// --- minimal local types of the renderer modules we use (see rendererImports.ts) ---
interface Rect { x: number, y: number, width: number, height: number }
interface Size { width: number, height: number }
type KeyframeInterpolation = 'smooth' | 'linear' | 'hold';
interface MixClipKeyframe { time: number, centerX: number, centerY: number, scale: number, interpolation?: KeyframeInterpolation }
interface MixClip {
  id: string, sourceId: string, name: string, color: number, start: number, end: number, maxRect: Rect, minRect?: Rect,
  muted: boolean, gainDb: number, keyframes?: MixClipKeyframe[],
}
interface MixSettings {
  output: { aspect: string, resolution: string }, fps: number, crf: number, preset: string, maxColumns: number, gap: { width: number, color: string },
  reorderWindow: number, order: { mode: string, seed: number }, transition: { type: string, duration: number }, fadeInOut: boolean,
  fill: { mode: string, color: string },
  encoder: { codec: string, hardware: string },
  musicPlaylist: { tracks: unknown[], crossfade: number, loop: boolean, ducking: { enabled: boolean, amountDb: number } },
  links: { maxGap: number, transition: 'cut' | 'global' },
  alwaysVisible: { clipIds: string[] },
}
interface MixSource { id: string, width: number, height: number }
interface MixPlan {
  duration: number,
  placements: { clipId: string, column: number, startTime: number, endTime: number }[],
  layouts: { time: number, columns: { column: number, x: number, width: number }[] }[],
  warnings: { type: string, clipId?: string }[],
  [key: string]: unknown,
}
interface RenderClip { id: string, sourceId: string, start: number, maxRect: Rect, minRect?: Rect, keyframes?: MixClipKeyframe[] }
interface AudioClip { id: string, sourceId: string, start: number, muted: boolean, gainDb: number }
interface RenderStep { args: string[], outPath: string, duration: number }
interface RenderJob {
  duration: number,
  files: { path: string, content: string }[],
  chunks: (RenderStep & { chunk: { f0: number, f1: number } })[],
  audio: RenderStep,
  concat: RenderStep,
}

const importRenderer = async <T>(file: string) => await import(pathToFileURL(path.join(rendererDir, file)).href) as T;

interface RenderOutputModule {
  planRender: (input: { clips: MixClip[], settings: MixSettings, sources: MixSource[] }) => { plan: MixPlan, fullPlan: MixPlan, settings: MixSettings },
}
const { planRender } = await importRenderer<RenderOutputModule>('videomix/render/renderOutput.ts');
const { buildRenderJob } = await importRenderer<{ buildRenderJob: (options: Record<string, unknown>) => RenderJob }>('videomix/render/buildRenderJob.ts');
const { buildAudioGraph } = await importRenderer<{ buildAudioGraph: (input: Record<string, unknown>) => unknown }>('videomix/render/buildAudioGraph.ts');

// F2 (T45): "Fit to a fraction" and the F1 indicator, the same pure logic the clip editor uses.
interface FitFractionsModule {
  getFitLayout: (settings: MixSettings, axis?: 'columns' | 'rows') => { width: number, height: number, gap: number, axis: 'columns' | 'rows' },
  fitMaxRectToFraction: (input: { maxRect: Rect, minRect?: Rect | undefined, frame: Size, fraction: '1/3' | '1/2' | '2/3', layout: { width: number, height: number, gap: number, axis: 'columns' | 'rows' } }) =>
    { ok: true, maxRect: Rect } | { ok: false, reason: string },
  getClipFractionFits: (input: { clip: Pick<MixClip, 'maxRect' | 'minRect'>, source: MixSource, settings: MixSettings }) =>
    { fraction: string, status: 'fits' | 'extends' | 'no' }[],
}
const { getFitLayout, fitMaxRectToFraction, getClipFractionFits } = await importRenderer<FitFractionsModule>('videomix/fitFractions.ts');

// A9 (T44/T48/T49): reading an animated clip's framing at a given source time, for the sanity checks below.
interface ClipKeyframesModule {
  getClipRectsAt: (clip: Pick<MixClip, 'maxRect' | 'minRect' | 'keyframes'>, sourceTime: number, frame?: Size) => { maxRect: Rect, minRect?: Rect },
}
const { getClipRectsAt } = await importRenderer<ClipKeyframesModule>('videomix/clipKeyframes.ts');

// A7 (T44/T47): the pure geometry behind "Remove black bars" (main runs `cropdetect`, done below with our own ffmpeg
// call, and the renderer converts the result to display pixels and cuts the max/min to what has picture).
interface BlackBarsModule {
  cropDetectToDisplayRect: (input: { rect: { x: number, y: number, width: number, height: number }, sar: undefined, displayFrame: Size }) => Rect,
  getPictureRect: (rect: Rect, frame: Size) => Rect | undefined,
  removeBlackBarsFromRects: (rects: { maxRect: Rect, minRect?: Rect }, picture: Rect) => { maxRect: Rect, minRect?: Rect } | undefined,
}
const { cropDetectToDisplayRect, getPictureRect, removeBlackBarsFromRects } = await importRenderer<BlackBarsModule>('videomix/blackBars.ts');
const { getFrameRect } = await importRenderer<{ getFrameRect: (size: Size) => Rect }>('videomix/overlayMath.ts');

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

// --- the example project: 16:9, 1280x720 ---
const mediaDir = path.join(repoRoot, 'test-media');
const sourcePaths = {
  s1: path.join(mediaDir, 'h-1080p-10s.mp4'), // 1920x1080, 10 s: the animated (keyframed) clip
  s2: path.join(mediaDir, 'v-1080x1920-12s.mp4'), // 1080x1920, 12 s, real 9:16: fitted to 1/3 with the tolerance
  s3: path.join(mediaDir, 'h-bars-1280x960-6s.mp4'), // 1280x960 with 120 px top/bottom bars, content 1280x720
};
for (const p of Object.values(sourcePaths)) {
  if (!existsSync(p)) throw new Error(`Missing ${p}: run "yarn generate-test-media" first`);
}

const outDir = path.resolve(process.argv[2] ?? path.join(mediaDir, 'render-keyframes-example'));
await mkdir(outDir, { recursive: true });

const FPS = 30;
const sources: MixSource[] = [
  { id: 's1', width: 1920, height: 1080 },
  { id: 's2', width: 1080, height: 1920 },
  { id: 's3', width: 1280, height: 960 },
];

const settings: MixSettings = {
  output: { aspect: '16:9', resolution: '720' },
  encoder: { codec: 'h264', hardware: 'none' },
  fps: FPS,
  crf: 23,
  preset: 'veryfast',
  maxColumns: 3, // exactly 3 slots: the three clips share the row for their whole duration
  gap: { width: 6, color: '#000000' },
  reorderWindow: 3,
  order: { mode: 'list', seed: 0 },
  transition: { type: 'fade', duration: 0.5 },
  fadeInOut: true,
  fill: { mode: 'color', color: '#101020' },
  musicPlaylist: { tracks: [], crossfade: 0, loop: false, ducking: { enabled: false, amountDb: -10 } },
  links: { maxGap: 10, transition: 'cut' },
  alwaysVisible: { clipIds: [] },
};

// --- A7 (T44/T47): detect and remove the black bars of s3, with a real cropdetect run (like main's detectBlackBars) ---
const s3Frame: Size = { width: 1280, height: 960 };
const sampleTimes = [1, 3, 5];
const cropdetectOutputs = await Promise.all(sampleTimes.map(async (t) => {
  const { stderr } = await run(ffmpegPath, [
    '-hide_banner', '-nostats',
    '-ss', String(t), '-i', sourcePaths['s3'],
    '-map', '0:v:0', '-frames:v', '30',
    '-vf', 'cropdetect',
    '-f', 'null', '-',
  ]);
  return stderr;
}));
const detectedCodedRect = parseCropDetectOutput(cropdetectOutputs.join('\n'));
if (detectedCodedRect == null) throw new Error('A7: cropdetect found no picture in h-bars-1280x960-6s.mp4');
const detectedDisplayRect = cropDetectToDisplayRect({ rect: detectedCodedRect, sar: undefined, displayFrame: s3Frame });
const picture = getPictureRect(detectedDisplayRect, s3Frame);
if (picture == null) throw new Error('A7: no black bars detected (getPictureRect found none)');
console.log(`A7: detected picture rect ${JSON.stringify(picture)} in a ${s3Frame.width}x${s3Frame.height} frame (bars removed)`);
if (Math.abs(picture.y - 120) > 8 || Math.abs(picture.height - 720) > 8) {
  throw new Error(`A7: expected the picture rect close to y=120, height=720, got ${JSON.stringify(picture)}`);
}
const s3FullFrameRect = getFrameRect(s3Frame);
const s3Rects = removeBlackBarsFromRects({ maxRect: s3FullFrameRect }, picture);
if (s3Rects == null) throw new Error('A7: removeBlackBarsFromRects found nothing to remove');
// The picture is 1280x720 (16:9, rigid): a narrower min, same flexibility reason as s1 above.
const s3MinRect: Rect = { x: s3Rects.maxRect.x + 340, y: s3Rects.maxRect.y, width: 600, height: s3Rects.maxRect.height };

// --- F1/F2 (T44/T44b/T45): fit s2 (a real 9:16 source) to 1/3 of the 1280 px wide output; 1280/3 = 426.67 px isn't a
// whole number, so the exact division never fits: only the 1 % tolerance (T44b) lets the planner lay it out flush,
// without fill, which getClipFractionFits (the F1 indicator) reports as "fits" (not "no", the exact result). ---
const s2Frame: Size = { width: 1080, height: 1920 };
const s2FullFrameRect = getFrameRect(s2Frame);
const fitLayout = getFitLayout(settings);
const s2Fit = fitMaxRectToFraction({ maxRect: s2FullFrameRect, frame: s2Frame, fraction: '1/3', layout: fitLayout });
if (!s2Fit.ok) throw new Error(`F2: fitMaxRectToFraction failed: ${s2Fit.reason}`);
console.log(`F2: s2's max rect fitted to 1/3 → ${JSON.stringify(s2Fit.maxRect)}`);
const s2Fits = getClipFractionFits({ clip: { maxRect: s2Fit.maxRect }, source: sources[1]!, settings });
const s2ThirdFit = s2Fits.find((f) => f.fraction === '1/3');
if (s2ThirdFit?.status !== 'fits') throw new Error(`F1: expected the 1/3 fraction to read "fits" (with the tolerance), got ${JSON.stringify(s2ThirdFit)}`);
console.log('OK: F1 reports "1/3: fits" for the fitted clip, thanks to the 1 % tolerance (T44b).');

// --- A9 (T44/T48/T49): pan and zoom keyframes over s1's full frame, with the three interpolations. A min rect
// narrower than the (16:9) max gives the planner room to fit it into a column alongside the other two clips (a rigid
// 16:9 clip could otherwise only ever fill the whole row): the keyframes animate the *picture* inside whatever crop
// the planner and the render pick for the base max/min, exactly as documented (F1/the planner don't change). ---
const s1MaxRect: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
const s1MinRect: Rect = { x: 660, y: 0, width: 600, height: 1080 };
const keyframes: MixClipKeyframe[] = [
  // 0-2 s: smooth zoom in, centred
  { time: 0, centerX: 960, centerY: 540, scale: 1, interpolation: 'smooth' },
  // 2-4 s: linear pan to the left, at the zoomed-in scale
  { time: 2, centerX: 960, centerY: 540, scale: 0.6, interpolation: 'linear' },
  // 4-6 s: hold (stays at the t=2 framing, jumps to the next one exactly at t=6)
  { time: 4, centerX: 700, centerY: 540, scale: 0.6, interpolation: 'hold' },
  { time: 6, centerX: 1200, centerY: 540, scale: 0.6 },
];

const clips: MixClip[] = [
  { id: 'animated', sourceId: 's1', name: 'Animated', color: 0, start: 0, end: 6, maxRect: s1MaxRect, minRect: s1MinRect, muted: true, gainDb: 0, keyframes },
  { id: 'fit-third', sourceId: 's2', name: 'Fit to 1/3', color: 1, start: 0, end: 6, maxRect: s2Fit.maxRect, muted: true, gainDb: 0 },
  { id: 'no-bars', sourceId: 's3', name: 'No black bars', color: 2, start: 0, end: 5.5, maxRect: s3Rects.maxRect, minRect: s3MinRect, muted: true, gainDb: 0 },
];
const audioClips: AudioClip[] = clips.map((c) => ({ id: c.id, sourceId: c.sourceId, start: c.start, muted: c.muted, gainDb: c.gainDb }));

// --- sanity checks on the animated clip's framing, independent of the render ---
const atStart = getClipRectsAt(clips[0]!, 0, { width: 1920, height: 1080 });
if (Math.abs(atStart.maxRect.width - 1920) > 2) throw new Error(`A9: expected the framing at t=0 close to the full frame, got ${JSON.stringify(atStart.maxRect)}`);
const atHold = getClipRectsAt(clips[0]!, 4.9, { width: 1920, height: 1080 });
const kf2 = getClipRectsAt(clips[0]!, 4, { width: 1920, height: 1080 });
if (Math.abs(atHold.maxRect.x - kf2.maxRect.x) > 2 || Math.abs(atHold.maxRect.y - kf2.maxRect.y) > 2) {
  throw new Error(`A9: expected "hold" to keep the t=4 framing at t=4.9, got ${JSON.stringify(atHold.maxRect)} vs ${JSON.stringify(kf2.maxRect)}`);
}
console.log('OK: the animated clip\'s framing at t=0 is close to the full frame, and "hold" keeps it steady from t=4 to t=6.');

// --- plan the mix and check it lays the three clips out without fill (F1/F2/T44b) ---
const { plan } = planRender({ clips, settings, sources });
console.log(`Planned duration: ${plan.duration.toFixed(2)} s`);
for (const p of plan.placements) console.log(`  ${p.clipId}: column ${p.column}, [${p.startTime.toFixed(2)}, ${p.endTime.toFixed(2)})`);
console.log('warnings:', JSON.stringify(plan.warnings));

if (plan.placements.length !== 3) throw new Error(`Expected the three clips in the plan, got ${plan.placements.length}`);
if (plan.warnings.some((w) => w.type === 'fill')) throw new Error('F2/T44b: expected no fill in the row (the tolerance should have avoided it)');
console.log('OK: no fill in the row (the 1 % tolerance avoided it for the 1/3-fitted clip).');

const firstLayout = plan.layouts[0]!;
const fitPlacement = plan.placements.find((p) => p.clipId === 'fit-third')!;
const fitColumnWidth = firstLayout.columns.find((c) => c.column === fitPlacement.column)!.width;
const expectedThird = 1280 / 3;
if (Math.abs(fitColumnWidth - expectedThird) > 8) throw new Error(`F2: expected the fitted clip's column close to 1/3 of 1280 (${expectedThird.toFixed(2)}), got ${fitColumnWidth}`);
console.log(`OK: the fitted clip's column is ${fitColumnWidth.toFixed(2)} px, close to 1/3 of the output (${expectedThird.toFixed(2)} px).`);

// --- render it ---
const defaultFontPath = path.join(repoRoot, 'resources/fonts/OpenSans-Bold.ttf');
const workDir = path.join(outDir, 'work');
await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });
const outPath = path.join(outDir, 'out.mp4');

const renderClips: RenderClip[] = clips.map((c) => ({
  id: c.id,
  sourceId: c.sourceId,
  start: c.start,
  maxRect: c.maxRect,
  ...(c.minRect != null && { minRect: c.minRect }),
  ...(c.keyframes != null && { keyframes: c.keyframes }),
}));

const job = buildRenderJob({
  plan,
  clips: renderClips,
  sourcePaths,
  sourceFrames: Object.fromEntries(sources.map((s) => [s.id, s])),
  settings,
  encoding: { crf: settings.crf, preset: settings.preset },
  workDir,
  outPath,
  buildAudioGraph: (input: Record<string, unknown>) => buildAudioGraph({ ...input, clips: audioClips, loudness: {}, overlays: [], overlayTimes: new Map() }),
  join: path.join,
  overlays: { overlays: [], times: new Map(), defaultFontPath },
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
if (probe.streams[0]?.width !== 1280 || probe.streams[0]?.height !== 720) throw new Error(`Expected 1280x720, got ${JSON.stringify(probe.streams[0])}`);
if (Math.abs(Number(probe.format.duration) - job.duration) > 0.5) throw new Error(`Expected duration ~${job.duration.toFixed(2)}s, got ${probe.format.duration}`);
console.log('OK: 1280x720, expected duration.');

// --- frames to review by hand (Read tool): the animated clip's zoom, pan and hold, next to the other two clips ---
const animatedPlacement = plan.placements.find((p) => p.clipId === 'animated')!;
const frameTimes: Record<string, number> = {
  'zoomed-in': Math.min(job.duration - 0.1, animatedPlacement.startTime + 1.9), // end of the smooth zoom
  'panned-left': Math.min(job.duration - 0.1, animatedPlacement.startTime + 3.9), // end of the linear pan
  held: Math.min(job.duration - 0.1, animatedPlacement.startTime + 4.9), // mid-hold, same framing as panned-left
  'no-bars-visible': Math.min(job.duration - 0.1, 8), // after the no-bars clip has taken over its column: no black bars
};
for (const [name, t] of Object.entries(frameTimes)) {
  const png = path.join(outDir, `frame-${name}.png`);
  // eslint-disable-next-line no-await-in-loop
  await ffmpeg(['-y', '-ss', String(t), '-i', outPath, '-frames:v', '1', png]);
  console.log(`wrote ${png} (t=${t.toFixed(2)} s)`);
}
