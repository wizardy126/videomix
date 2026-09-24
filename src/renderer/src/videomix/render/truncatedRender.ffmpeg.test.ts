// Render cut at the maximum duration (E4, T39) with the real ffmpeg at 320x180: the output lasts exactly the limit
// (video frames and audio), with the global fade to black and to silence at the cut; the music and the sound overlays
// are cut there too, and overlays are resolved on the placements of the whole plan. The render cache still reuses the
// chunks before the cut after rendering the whole mix. Skipped when the dev ffmpeg (ffmpeg/<platform>-<arch>) or the T02
// media (`yarn generate-test-media`) are missing.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, test, expect, afterAll } from 'vitest';

import { truncatePlan } from '../planner/truncatePlan';
import type { MixPlan } from '../planner/types';
import { resolveOverlayTimes } from '../overlays/resolveOverlayTimes';
import { createImageOverlay, createSoundOverlay } from '../overlays/factories';
import type { LoudnessMeasurement, MixClip, MixOverlay, MixSettings } from '../types';
import { defaultMusicPlaylist } from '../types';
import { buildAudioGraph } from './buildAudioGraph';
import { buildRenderJob } from './buildRenderJob';
import { applyRenderCache, getFileIdentity, getRenderCacheKeys } from './renderCache';
import { getOverlayTimesPlan } from './renderOutput';
import { runRenderJob } from './runRenderJob';
import type { RenderRunnerDeps } from './runRenderJob';
import { scalePlan, testClips, testPlans, testSettings, testSourcePaths, testSources } from './renderTestFixtures';

const execFileAsync = promisify(execFile);

const ffDir = path.resolve('ffmpeg', `${os.platform()}-${os.arch()}`, ...(os.platform() === 'darwin' ? [] : ['lib']));
const exe = os.platform() === 'win32' ? '.exe' : '';
const ffmpegPath = path.join(ffDir, `ffmpeg${exe}`);
const ffprobePath = path.join(ffDir, `ffprobe${exe}`);
const mediaDir = path.resolve('test-media');
const musicPath = path.join(mediaDir, 'music-20s.m4a');
const beepPath = path.join(mediaDir, 'overlay-beep.wav');
const logoPath = path.join(mediaDir, 'overlay-logo.png');
const available = existsSync(ffmpegPath) && existsSync(ffprobePath) && [musicPath, beepPath, logoPath, ...Object.values(testSources).map((s) => path.join(mediaDir, s.file))].every((p) => existsSync(p));
const env = { ...process.env, LD_LIBRARY_PATH: ffDir };
const run = async (bin: string, args: string[]) => (await execFileAsync(bin, args, { env, maxBuffer: 1e8, encoding: 'buffer' })).stdout;

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })));
});

const deps: RenderRunnerDeps = {
  mkdir: async (dir) => { await mkdir(dir, { recursive: true }); },
  writeFile: async (filePath, content) => writeFile(filePath, content),
  rm: async (filePath) => rm(filePath, { recursive: true, force: true }),
  rename: async (from, to) => rename(from, to),
  runFfmpeg: async ({ args }) => new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-loglevel', 'error', ...args], { env });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}\n${stderr}`))));
  }),
  abortAll: () => undefined,
  verifyCached: async (filePath, { duration, tolerance }) => {
    try {
      if ((await stat(filePath)).size === 0) return false;
      const probed = Number((await run(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath])).toString().trim());
      if (!(Math.abs(probed - duration) <= tolerance)) return false;
    } catch {
      return false;
    }
    const now = new Date();
    await utimes(filePath, now, now);
    return true;
  },
};

// b (0–4.5, fades into the fill), a (0–3) → c (2.5–6): 6 s. Cut at 4 s: b and c are cut, nothing is lost.
const fullPlan = scalePlan(testPlans.substitutions, 320, 180);
const LIMIT = 4;
const settings: MixSettings = testSettings({
  gap: { width: 4, color: '#303030' },
  fadeInOut: true,
  transition: { type: 'fade', duration: 0.5 },
  maxDuration: LIMIT,
  musicPlaylist: { ...defaultMusicPlaylist, tracks: [{ id: 'music', path: 'music-20s.m4a', absolutePath: musicPath, volumeDb: -6 }], loop: false },
});
const sourcePaths = testSourcePaths(mediaDir);
// the audio pass needs the clips' mute/gain (T12): the fixtures' clips, audible
const mixClips: MixClip[] = testClips.map((c) => ({ ...c, name: c.id, color: 0, end: c.start + 6, muted: false, gainDb: 0 }));
const atTarget = (duration?: number): LoudnessMeasurement => ({ hasAudio: true, inputI: -16, inputTp: -10, inputLra: 1, inputThresh: -26, ...(duration != null && { duration }) });
const loudness: Record<string, LoudnessMeasurement> = { ...Object.fromEntries(testClips.map((c) => [c.id, atTarget()])), music: atTarget(20), beep: atTarget(0.2), logo: atTarget() };

// A logo anchored 3 s after the start of c (5.5 s: after the cut) and a beep at 3.9 s (0.2 s long: cut at 4 s)
const overlays: MixOverlay[] = [
  { ...createImageOverlay({ id: 'logo', name: 'logo', filePath: logoPath }), anchor: { kind: 'clip', clipId: 'c', edge: 'start', offset: 3 } },
  createSoundOverlay({ id: 'beep', name: 'beep', start: 3.9, filePath: beepPath }),
];
const soundOverlays = overlays.filter((o) => o.type === 'sound');

async function render({ dir, plan, full, cacheRoot }: { dir: string, plan: MixPlan, full: MixPlan, cacheRoot?: string | undefined }) {
  const id = Math.random().toString(36).slice(2);
  const workDir = path.join(dir, `work-${id}`);
  const outPath = path.join(dir, `out-${id}.mp4`);
  const times = resolveOverlayTimes({ overlays, clips: mixClips }, getOverlayTimesPlan({ plan, fullPlan: full }), { soundDurations: { beep: 0.2 } });
  const uncached = buildRenderJob({
    plan,
    clips: testClips,
    sourcePaths,
    settings,
    encoding: { preset: 'ultrafast', crf: 30 },
    workDir,
    outPath,
    maxChunkSeconds: 1,
    join: path.join,
    buildAudioGraph: (input) => buildAudioGraph({ ...input, clips: mixClips, loudness, overlays: soundOverlays, overlayTimes: times }),
    overlays: { overlays, times, defaultFontPath: path.resolve('resources/fonts/OpenSans-Bold.ttf') },
  });
  let job = uncached;
  if (cacheRoot != null) {
    const files = [...Object.values(sourcePaths), musicPath, beepPath, logoPath];
    const fileIdentities = Object.fromEntries(await Promise.all(files.map(async (p) => [p, getFileIdentity(await stat(p))] as const)));
    job = applyRenderCache(uncached, { dir: path.join(cacheRoot, 'render'), keys: await getRenderCacheKeys(uncached, { fileIdentities }), runId: id, join: path.join, fps: settings.fps });
  }
  const result = await runRenderJob({ job, workDir, outPath, concurrency: 2, deps });
  return { job, result, outPath, times };
}

/** Mean luma (0–255) of every frame, from a 32×18 gray version. */
async function frameLumas(filePath: string) {
  const raw = await run(ffmpegPath, ['-v', 'error', '-i', filePath, '-map', '0:v', '-vf', 'scale=32:18,format=gray', '-f', 'rawvideo', '-']);
  const size = 32 * 18;
  return Array.from({ length: raw.length / size }, (_, i) => raw.subarray(i * size, (i + 1) * size).reduce((acc, v) => acc + v, 0) / size);
}

/** Mono f32 samples at 48 kHz. */
async function audioSamples(filePath: string) {
  const raw = await run(ffmpegPath, ['-v', 'error', '-i', filePath, '-map', '0:a', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

const rmsDb = (samples: Float32Array, from: number, to: number) => {
  const a = Math.round(from * 48000);
  const b = Math.min(samples.length, Math.round(to * 48000));
  let sum = 0;
  for (let i = a; i < b; i += 1) sum += samples[i]! ** 2;
  return 10 * Math.log10(sum / Math.max(1, b - a) + 1e-20);
};

async function probeDurations(filePath: string) {
  const out = (await run(ffprobePath, ['-v', 'error', '-show_entries', 'stream=codec_type,duration,nb_frames', '-of', 'json', filePath])).toString();
  const { streams } = JSON.parse(out) as { streams: { codec_type: string, duration: string, nb_frames: string }[] };
  const video = streams.find((s) => s.codec_type === 'video')!;
  const audio = streams.find((s) => s.codec_type === 'audio')!;
  return { videoFrames: Number(video.nb_frames), videoDuration: Number(video.duration), audioDuration: Number(audio.duration) };
}

describe.skipIf(!available)('render cut at the maximum duration with ffmpeg (T39)', () => {
  const plan = truncatePlan(fullPlan, LIMIT);

  test('the plan and the overlays', () => {
    expect(plan.duration).toBe(LIMIT);
    expect(plan.warnings.find((w) => w.type === 'truncated')).toMatchObject({ clipIds: [], cutClipIds: ['b', 'c'] });
    const times = resolveOverlayTimes({ overlays, clips: mixClips }, getOverlayTimesPlan({ plan, fullPlan }), { soundDurations: { beep: 0.2 } });
    // anchored to the real start of c: after the cut, left out (not an overlay whose anchor is lost)
    expect(times.get('logo')).toMatchObject({ rawStart: 5.5, start: LIMIT, end: LIMIT, warnings: [{ type: 'outside-video' }] });
    expect(times.get('beep')).toMatchObject({ start: 3.9, end: LIMIT, warnings: [{ type: 'clipped' }] });
  });

  test('exactly the limit long, faded out at the cut; the cache reuses the chunks before it', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'videomix-truncated-test-'));
    tempDirs.push(dir);
    const cacheRoot = path.join(dir, '.project.vmx.cache');

    // the whole mix first (as before turning the limit on), then cut
    const whole = await render({ dir, plan: fullPlan, full: fullPlan, cacheRoot });
    expect(whole.job.totalFrames).toBe(6 * settings.fps);
    const cut = await render({ dir, plan, full: fullPlan, cacheRoot });
    expect(cut.job.totalFrames).toBe(LIMIT * settings.fps);
    // the chunks that end before the cut's fade (and the changes it brings to b's fade into fill) are the same
    expect(cut.result.reusedChunks).toBeGreaterThanOrEqual(2);
    expect(cut.result.renderedChunks).toBeGreaterThan(0);
    expect(cut.result.audioReused).toBe(false);

    const durations = await probeDurations(cut.outPath);
    expect(durations.videoFrames).toBe(LIMIT * settings.fps);
    expect(durations.videoDuration).toBeCloseTo(LIMIT, 3);
    // AAC works in 1024-sample frames
    expect(Math.abs(durations.audioDuration - LIMIT)).toBeLessThan(1024 / 48000 + 1e-3);

    // fade to black: the last frame is black, the ones before the fade aren't
    const lumas = await frameLumas(cut.outPath);
    expect(lumas).toHaveLength(LIMIT * settings.fps);
    expect(Math.max(...lumas.slice(60, 100))).toBeGreaterThan(40);
    expect(lumas.at(-1)!).toBeLessThan(20);
    // the same picture as without the cache
    const uncached = await render({ dir, plan, full: fullPlan });
    expect(await frameLumas(uncached.outPath)).toEqual(lumas);

    // fade to silence: clips, music and the beep all go down at the cut
    const samples = await audioSamples(cut.outPath);
    const before = rmsDb(samples, 3, 3.4);
    const end = rmsDb(samples, LIMIT - 0.02, LIMIT);
    expect(before).toBeGreaterThan(-40);
    expect(end).toBeLessThan(before - 20);
    // the whole mix goes on after 4 s (no fade there)
    const wholeSamples = await audioSamples(whole.outPath);
    const wholeEnd = rmsDb(wholeSamples, LIMIT - 0.02, LIMIT);
    console.log('cut render', { ...cut.result, chunks: cut.job.chunks.length, ...durations, lumaBefore: Math.max(...lumas.slice(60, 100)), lumaLast: lumas.at(-1), before, end, wholeEnd });
    expect(wholeEnd).toBeGreaterThan(end + 15);
  }, 180_000);
});
