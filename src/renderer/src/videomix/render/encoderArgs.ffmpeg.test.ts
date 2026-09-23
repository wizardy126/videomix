// Renders a small plan with libx265 through the real ffmpeg (T25 spec: hardware encoders can't be tested here for
// lack of a GPU, but the software H.265 path can). Skipped when the dev ffmpeg (ffmpeg/<platform>-<arch>,
// `yarn download-ffmpeg-…`) or the T02 media are missing, like buildRenderJob.ffmpeg.test.ts.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, test, expect, afterAll } from 'vitest';

import { buildRenderJob } from './buildRenderJob';
import { scalePlan, testClips, testPlans, testSettings, testSourcePaths, testSources } from './renderTestFixtures';

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

describe.skipIf(!available)('libx265 render (T25)', () => {
  test('renders h265 and the concat mux keeps the hvc1 tag', async () => {
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'videomix-render-h265-'));
    tempDirs.push(workDir);
    const outPath = path.join(workDir, 'out.mp4');

    const job = buildRenderJob({
      plan: scalePlan(testPlans.static, 320, 180),
      clips: testClips,
      sourcePaths: testSourcePaths(mediaDir),
      settings: testSettings({ gap: { width: 4, color: '#303030' }, encoder: { codec: 'h265', hardware: 'auto' } }),
      encoding: { preset: 'ultrafast', crf: 30 },
      resolvedEncoder: { codec: 'h265', hardware: 'none' },
      workDir,
      outPath,
      join: path.join,
    });

    await Promise.all(job.files.map(async (f) => writeFile(f.path, f.content)));
    await Promise.all(job.chunks.map(async (c) => run(ffmpegPath, ['-loglevel', 'error', ...c.args])));
    await run(ffmpegPath, ['-loglevel', 'error', ...job.audio.args]);
    await run(ffmpegPath, ['-loglevel', 'error', ...job.concat.args]);

    const probe = JSON.parse(await run(ffprobePath, [
      '-v', 'error', '-count_frames',
      '-show_entries', 'stream=codec_type,codec_name,codec_tag_string,width,height,nb_read_frames',
      '-of', 'json', outPath,
    ])) as { streams: { codec_type: string, codec_name?: string, codec_tag_string?: string, width?: number, height?: number, nb_read_frames?: string }[] };

    const video = probe.streams.find((s) => s.codec_type === 'video');
    expect(video?.codec_name).toBe('hevc');
    expect(video?.codec_tag_string).toBe('hvc1');
    expect(video?.width).toBe(320);
    expect(video?.height).toBe(180);
    expect(Number(video?.nb_read_frames)).toBe(job.totalFrames);
    expect(probe.streams.some((s) => s.codec_type === 'audio')).toBe(true);
  }, 30000);
});
