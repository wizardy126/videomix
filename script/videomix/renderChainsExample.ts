// Dev tool (T40): renders a fixed 16:9 example project that uses several v3 features together over test-media/, with
// the production render code (planRender/buildRenderJob), so the result can be reviewed by hand:
// - a chain of 2 linked clips of the same source (E2, T36/T39): they play one after the other in the same slot, with
//   a direct cut;
// - the always-visible sequence (E5, T36/T39): one clip in a slot of its own, on screen throughout its own run;
// - a clip cropped narrower than its column, extended beyond its max rect to avoid pillarbox (E7, T38b);
// - a clip turned 90° (E9, T38d);
// - a maximum duration (E4, T36/T38): the mix is cut at the limit, with the global fade-out.
//
// All clips are muted (no music, no loudness measurement needed): unlike renderVerticalExample.ts (T34) this is about
// the v3 layout/timing features, not audio.
//
//   node script/videomix/renderChainsExample.ts [outDir]
//
// Without an outDir it writes to test-media/render-chains-example/. Needs `yarn generate-test-media` to have made the
// test videos.
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import registerRendererImports from './rendererImports.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rendererDir = path.join(repoRoot, 'src/renderer/src');

registerRendererImports();

// --- minimal local types of the renderer modules we use (see rendererImports.ts) ---
interface Rect { x: number, y: number, width: number, height: number }
interface MixClip {
  id: string, sourceId: string, name: string, color: number, start: number, end: number, maxRect: Rect, muted: boolean,
  gainDb: number, extendBeyondMax?: boolean, rotation?: 90 | 180 | 270, link?: 'force' | 'break',
}
interface MixSettings {
  output: { aspect: string, resolution: string }, fps: number, crf: number, preset: string, maxColumns: number, gap: { width: number, color: string },
  reorderWindow: number, order: { mode: string, seed: number }, transition: { type: string, duration: number }, fadeInOut: boolean,
  fill: { mode: string, color: string },
  encoder: { codec: string, hardware: string },
  musicPlaylist: { tracks: unknown[], crossfade: number, loop: boolean, ducking: { enabled: boolean, amountDb: number } },
  // v3 (T36): chains, always visible sequence and maximum duration
  links: { maxGap: number, transition: 'cut' | 'global' },
  alwaysVisible: { clipIds: string[] },
  maxDuration?: number,
}
interface MixSource { id: string, width: number, height: number }
interface MixPlan {
  duration: number,
  placements: { clipId: string, column: number, startTime: number, endTime: number, extendedMaxRect?: Rect }[],
  warnings: { type: string, clipId?: string }[],
  [key: string]: unknown,
}
interface RenderClip { id: string, sourceId: string, start: number, maxRect: Rect, rotation?: number }
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
  s1: path.join(mediaDir, 'h-1080p-10s.mp4'), // 1920x1080, 10 s: the two clips of the chain (E2)
  s2: path.join(mediaDir, 'h-720p-25fps-8s.mp4'), // 1280x720, 8 s: cropped narrower than its column, extended (E7)
  s3: path.join(mediaDir, 'v-1080x1920-12s.mp4'), // 1080x1920, 12 s: turned 90° (E9), landscape once turned
  s4: path.join(mediaDir, 'v-720x1280-silent-7s.mp4'), // 720x1280, 7 s: the always-visible sequence (E5)
};
for (const p of Object.values(sourcePaths)) {
  if (!existsSync(p)) throw new Error(`Missing ${p}: run "yarn generate-test-media" first`);
}

const outDir = path.resolve(process.argv[2] ?? path.join(mediaDir, 'render-chains-example'));
await mkdir(outDir, { recursive: true });

const FPS = 30;

const clips: MixClip[] = [
  // E2: two clips of the same source (s1), 0.3 s apart (≤ the default 10 s link margin): linked automatically into a
  // chain of 2, playing one after the other in the same slot with a direct cut (settings.links.transition below).
  { id: 'chain1', sourceId: 's1', name: 'Chain 1/2', color: 0, start: 0, end: 3, maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, muted: true, gainDb: 0 },
  { id: 'chain2', sourceId: 's1', name: 'Chain 2/2', color: 0, start: 3.3, end: 6.3, maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, muted: true, gainDb: 0 },
  // E7: a narrow 608 px crop centered in the 1280 px wide source, extendable. Alone in its slot at the start of the
  // mix (before the chain/rotated clips get there), a plain layout would pillarbox it: extendBeyondMax widens the
  // crop (both sides, centered, bounded by the source) instead.
  { id: 'extended', sourceId: 's2', name: 'Extended', color: 1, start: 0, end: 4, maxRect: { x: 336, y: 0, width: 608, height: 720 }, muted: true, gainDb: 0, extendBeyondMax: true },
  // E9: the 1080x1920 source turned 90° clockwise becomes a 1920x1080 turned frame; the full turned frame as the max
  // rect (a portrait video turned on its side to fill a 16:9 slot).
  { id: 'rotated', sourceId: 's3', name: 'Rotated', color: 2, start: 0, end: 4, maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, muted: true, gainDb: 0, rotation: 90 },
  // E5: this clip is in settings.alwaysVisible.clipIds below, so it gets a slot of its own, always on screen during
  // its 5 s, alongside whatever else plays (the extended clip, at the start).
  { id: 'sequence', sourceId: 's4', name: 'Sequence', color: 3, start: 0, end: 5, maxRect: { x: 0, y: 0, width: 720, height: 1280 }, muted: true, gainDb: 0 },
];
const audioClips: AudioClip[] = clips.map((c) => ({ id: c.id, sourceId: c.sourceId, start: c.start, muted: c.muted, gainDb: c.gainDb }));

const settings: MixSettings = {
  output: { aspect: '16:9', resolution: '720' },
  encoder: { codec: 'h264', hardware: 'none' },
  fps: FPS,
  crf: 23,
  preset: 'veryfast',
  maxColumns: 2, // up to 2 slots visible at once: the always-visible sequence, plus the rest
  gap: { width: 8, color: '#000000' },
  reorderWindow: 3,
  order: { mode: 'list', seed: 0 },
  transition: { type: 'fade', duration: 0.5 },
  fadeInOut: true,
  fill: { mode: 'color', color: '#101020' },
  musicPlaylist: { tracks: [], crossfade: 0, loop: false, ducking: { enabled: false, amountDb: -10 } },
  links: { maxGap: 10, transition: 'cut' }, // E2: direct cut between chained clips
  alwaysVisible: { clipIds: ['sequence'] }, // E5
  // maxDuration is set below, once the full (untruncated) duration is known
};

// Display sizes of the sources (E7 bounds the extension; E9's rotation is applied on top, unrotated here)
const sources: MixSource[] = [
  { id: 's1', width: 1920, height: 1080 },
  { id: 's2', width: 1280, height: 720 },
  { id: 's3', width: 1080, height: 1920 },
  { id: 's4', width: 720, height: 1280 },
];

// --- plan once without a maximum duration, to see how long the mix would otherwise be ---
const { fullPlan: unboundedPlan } = planRender({ clips, settings, sources });
console.log(`Unbounded duration: ${unboundedPlan.duration.toFixed(2)} s`);
for (const p of unboundedPlan.placements) console.log(`  ${p.clipId}: column ${p.column}, [${p.startTime.toFixed(2)}, ${p.endTime.toFixed(2)})`);

// E4: cut it 3 s before the end, into the rotated clip's slot: settings.maxDuration is the project's ("desactivado
// por defecto") maximum duration, respected by planRender (renderOutput.ts's `cut`/truncatePlan) and by the render.
settings.maxDuration = Math.max(1, unboundedPlan.duration - 3);
console.log(`Maximum duration: ${settings.maxDuration.toFixed(2)} s`);

const renderPlan = planRender({ clips, settings, sources });
const { plan } = renderPlan;
console.log(`Planned (cut) duration: ${plan.duration.toFixed(2)} s`);
for (const p of plan.placements) console.log(`  ${p.clipId}: column ${p.column}, [${p.startTime.toFixed(2)}, ${p.endTime.toFixed(2)})${p.extendedMaxRect != null ? ` extended to ${JSON.stringify(p.extendedMaxRect)}` : ''}`);
console.log('warnings:', JSON.stringify(plan.warnings));

// --- checks: the features we set out to exercise really show up in the plan ---
const byId = (id: string) => plan.placements.find((p) => p.clipId === id);
const chain1 = byId('chain1')!;
const chain2 = byId('chain2')!;
if (chain1.column !== chain2.column) throw new Error('E2: the chained clips are not in the same slot');
if (Math.abs(chain2.startTime - chain1.endTime) > 0.01) throw new Error(`E2: no direct cut between chained clips (gap ${chain2.startTime - chain1.endTime})`);
console.log('OK: chain1 → chain2 share a slot with a direct cut.');

const sequencePlacement = byId('sequence')!;
const extendedPlacement = byId('extended')!;
if (sequencePlacement.column === extendedPlacement.column) throw new Error('E5: the sequence clip should have a slot of its own, distinct from the extended clip playing at the same time');
console.log('OK: the always-visible sequence clip has its own slot, alongside another clip.');

if (extendedPlacement.extendedMaxRect == null) throw new Error('E7: the narrow clip was not extended');
if (!plan.warnings.some((w) => w.type === 'extended' && w.clipId === 'extended')) throw new Error('E7: missing the "extended" warning');
console.log(`OK: the narrow clip was extended to ${JSON.stringify(extendedPlacement.extendedMaxRect)}.`);

if (!plan.warnings.some((w) => w.type === 'truncated')) throw new Error('E4: missing the "truncated" warning at the maximum duration');
console.log(`OK: the mix is cut at its maximum duration (${plan.duration.toFixed(2)} s), with a "truncated" warning.`);

// --- render it ---
const defaultFontPath = path.join(repoRoot, 'resources/fonts/OpenSans-Bold.ttf');
const workDir = path.join(outDir, 'work');
await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });
const outPath = path.join(outDir, 'out.mp4');

const renderClips: RenderClip[] = clips.map((c) => ({ id: c.id, sourceId: c.sourceId, start: c.start, maxRect: c.maxRect, ...(c.rotation != null && { rotation: c.rotation }) }));

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
console.log('OK: 1280x720, expected (cut) duration.');

// --- frames to review by hand (Read tool) ---
const frameTimes: Record<string, number> = {
  'extended-and-sequence': Math.min(job.duration - 0.1, 2), // extended clip + sequence, side by side
  'chain-first-half': Math.min(job.duration - 0.1, chain1.startTime + 1),
  'chain-cut': Math.min(job.duration - 0.1, chain1.endTime + 0.05), // just after the direct cut, mid-chain
  rotated: Math.min(job.duration - 0.1, byId('rotated')!.startTime + 0.5),
  'near-end-fade': Math.max(0, job.duration - 0.3), // the maximum-duration cut's fade-out
};
for (const [name, t] of Object.entries(frameTimes)) {
  const png = path.join(outDir, `frame-${name}.png`);
  // eslint-disable-next-line no-await-in-loop
  await ffmpeg(['-y', '-ss', String(t), '-i', outPath, '-frames:v', '1', png]);
  console.log(`wrote ${png} (t=${t.toFixed(2)} s)`);
}
