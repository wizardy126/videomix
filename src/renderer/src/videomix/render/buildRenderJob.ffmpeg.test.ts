// Renders the test plans with the real ffmpeg at 320x180 and checks the output with ffprobe. Skipped when the dev
// ffmpeg (ffmpeg/<platform>-<arch>, `yarn download-ffmpeg-…`) or the T02 media (`yarn generate-test-media`) are missing.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, test, expect, afterAll } from 'vitest';

import { buildRenderJob } from './buildRenderJob';
import { scalePlan, testClips, testPlans, testSettings, testSourcePaths, testSources } from './renderTestFixtures';
import type { MixPlan } from '../planner/types';
import type { MixSettings } from '../types';

const execFileAsync = promisify(execFile);

const ffDir = path.resolve('ffmpeg', `${os.platform()}-${os.arch()}`, ...(os.platform() === 'darwin' ? [] : ['lib']));
const exe = os.platform() === 'win32' ? '.exe' : '';
const ffmpegPath = path.join(ffDir, `ffmpeg${exe}`);
const ffprobePath = path.join(ffDir, `ffprobe${exe}`);
const mediaDir = path.resolve('test-media');
const available = existsSync(ffmpegPath) && existsSync(ffprobePath) && Object.values(testSources).every((s) => existsSync(path.join(mediaDir, s.file)));
const env = { ...process.env, LD_LIBRARY_PATH: ffDir };

const run = async (bin: string, args: string[]) => (await execFileAsync(bin, args, { env, maxBuffer: 1e8 })).stdout;

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })));
});

async function render(plan: MixPlan, settings: MixSettings) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'videomix-render-'));
  tempDirs.push(workDir);
  const outPath = path.join(workDir, 'out.mp4');
  const job = buildRenderJob({
    plan,
    clips: testClips,
    sourcePaths: testSourcePaths(mediaDir),
    settings,
    encoding: { preset: 'ultrafast', crf: 30 },
    workDir,
    outPath,
    join: path.join,
  });
  await Promise.all(job.files.map(async (f) => writeFile(f.path, f.content)));
  await Promise.all(job.chunks.map(async (c) => run(ffmpegPath, ['-loglevel', 'error', ...c.args])));
  await run(ffmpegPath, ['-loglevel', 'error', ...job.audio.args]);
  await run(ffmpegPath, ['-loglevel', 'error', ...job.concat.args]);
  const probe = JSON.parse(await run(ffprobePath, ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,width,height,nb_read_frames,pix_fmt,r_frame_rate:format=duration', '-of', 'json', outPath])) as {
    streams: { codec_type: string, width?: number, height?: number, nb_read_frames: string, pix_fmt?: string, r_frame_rate: string }[],
    format: { duration: string },
  };
  return { job, probe };
}

const half = (p: MixPlan) => scalePlan(p, 320, 180);

describe.skipIf(!available)('render with ffmpeg', () => {
  test.each([
    ['static', half(testPlans.static), testSettings({ gap: { width: 4, color: '#303030' } })],
    ['substitutions', half(testPlans.substitutions), testSettings({ gap: { width: 4, color: '#303030' }, transition: { type: 'wipeleft', duration: 0.5 } })],
    ['relayout', scalePlan(testPlans.relayout, 320, 180), testSettings({ gap: { width: 0, color: '#000000' }, fps: 25 })],
    ['fills', half(testPlans.fills), testSettings({ gap: { width: 4, color: '#303030' } })],
    ['fills (colour)', half(testPlans.fills), testSettings({ gap: { width: 4, color: '#303030' }, fill: { mode: 'color', color: '#224466' } })],
    ['removal', half(testPlans.removal), testSettings({ gap: { width: 4, color: '#303030' } })],
    // T40: a chain (E2) handing off to a plain crossfade used to fail here with an ffmpeg "xfade timebase" error
    // (`concat`'s output wasn't normalized to 1/fps, see buildVideoGraph.ts's chainSegments).
    ['chainThenSwitch', half(testPlans.chainThenSwitch), testSettings({ gap: { width: 4, color: '#303030' } })],
  ] as const)('%s', async (_name, plan, settings) => {
    const { job, probe } = await render(plan, settings);
    const video = probe.streams.find((s) => s.codec_type === 'video')!;
    expect(video).toMatchObject({ width: 320, height: 180, pix_fmt: 'yuv420p', r_frame_rate: `${settings.fps}/1` });
    expect(Number(video.nb_read_frames)).toBe(job.totalFrames);
    expect(probe.streams.some((s) => s.codec_type === 'audio')).toBe(true);
    expect(Number(probe.format.duration)).toBeCloseTo(job.duration, 1);
  }, 60_000);
});
