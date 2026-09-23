// Empirical check of T21b's loop fix with the real ffmpeg: skipped when the dev ffmpeg (ffmpeg/<platform>-<arch>,
// `yarn download-ffmpeg-…`) is missing. Can't import measureLoudness (src/main/videomix/loudness.ts) directly: it
// pulls in src/main/ffmpeg.ts, which imports Electron's `app` and crashes outside a real Electron process. So this
// mirrors its algorithm with the same pure helpers (loudnessParse.ts) and plain child_process calls, like
// script/videomix/renderOverlaysExample.ts's measureLoudnessCli does for the same reason.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
// eslint-disable-next-line import/no-extraneous-dependencies
import { describe, test, expect, beforeAll, afterAll } from 'vitest';

import { LOOP_MEASURE_DURATION, parseFfprobeAudioStream, parseFfprobeDuration, parseLoudnormOutput, shouldLoopForMeasurement, toLoudnessAnalysis } from './loudnessParse';

const execFileAsync = promisify(execFile);

const ffDir = path.resolve('ffmpeg', `${os.platform()}-${os.arch()}`, ...(os.platform() === 'darwin' ? [] : ['lib']));
const exe = os.platform() === 'win32' ? '.exe' : '';
const ffmpegPath = path.join(ffDir, `ffmpeg${exe}`);
const ffprobePath = path.join(ffDir, `ffprobe${exe}`);
const available = existsSync(ffmpegPath) && existsSync(ffprobePath);
const env = { ...process.env, LD_LIBRARY_PATH: ffDir };

const run = async (bin: string, args: string[]) => (await execFileAsync(bin, args, { env, maxBuffer: 1e8 })).stdout;

/** Whole-file measurement, mirroring src/main/videomix/loudness.ts#measureLoudness (T21b's loop fix included). */
async function measureWholeFile(filePath: string) {
  const probeOut = await run(ffprobePath, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'format=duration:stream=index,channels,channel_layout', '-of', 'json', '-i', filePath]);
  const stream = parseFfprobeAudioStream(probeOut);
  const duration = parseFfprobeDuration(probeOut);
  if (stream == null) return { hasAudio: false as const, duration, loop: false };

  const loop = shouldLoopForMeasurement({ isWholeFile: true, duration });
  const { stderr } = await execFileAsync(ffmpegPath, [
    '-hide_banner', '-nostats',
    ...(loop ? ['-stream_loop', '-1'] : []),
    '-i', filePath,
    '-map', '0:a:0',
    ...(loop ? ['-t', String(LOOP_MEASURE_DURATION)] : []),
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
    '-f', 'null', '-',
  ], { env });
  const values = parseLoudnormOutput(stderr);
  if (values == null) throw new Error(`Failed to parse loudnorm output for ${filePath}`);
  return { ...toLoudnessAnalysis(values, stream), duration, loop };
}

let workDir: string;
beforeAll(async () => {
  if (!available) return;
  workDir = await mkdtemp(path.join(os.tmpdir(), 'videomix-loudness-'));
});
afterAll(async () => {
  if (workDir != null) await rm(workDir, { recursive: true, force: true });
});

async function makeTone(name: string, duration: number) {
  const filePath = path.join(workDir, name);
  await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=880:duration=${duration}`, '-c:a', 'pcm_s16le', filePath]);
  return filePath;
}

describe.skipIf(!available)('measureLoudness\'s loop fix, with ffmpeg (T21b)', () => {
  test('a 0.15 s and a 0.3 s beep measure within 1.5 LU of the same tone at 2 s (task acceptance criterion)', async () => {
    const [short, medium, reference] = await Promise.all([makeTone('beep-0.15.wav', 0.15), makeTone('beep-0.3.wav', 0.3), makeTone('beep-2.wav', 2)]);
    const [shortAnalysis, mediumAnalysis, referenceAnalysis] = await Promise.all([measureWholeFile(short!), measureWholeFile(medium!), measureWholeFile(reference!)]);

    // Without the loop fix, the two short ones would measure as -inf (silence): this is exactly what T21b fixes.
    expect(shortAnalysis.hasAudio).toBe(true);
    expect(mediumAnalysis.hasAudio).toBe(true);
    expect(referenceAnalysis.hasAudio).toBe(true);
    expect(shortAnalysis.loop).toBe(true);
    expect(mediumAnalysis.loop).toBe(true);
    expect(referenceAnalysis.loop).toBe(true); // 2 s is also < LOOP_MEASURE_DURATION, so it's looped too

    if (!shortAnalysis.hasAudio || !mediumAnalysis.hasAudio || !referenceAnalysis.hasAudio) throw new Error('unreachable');
    expect(Math.abs(shortAnalysis.inputI - referenceAnalysis.inputI)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(mediumAnalysis.inputI - referenceAnalysis.inputI)).toBeLessThanOrEqual(1.5);
  }, 20000);

  test('a beep already at or above LOOP_MEASURE_DURATION isn\'t looped, and still agrees with the short ones', async () => {
    const [short, long] = await Promise.all([makeTone('beep-0.15b.wav', 0.15), makeTone('beep-3.5.wav', 3.5)]);
    const [shortAnalysis, longAnalysis] = await Promise.all([measureWholeFile(short!), measureWholeFile(long!)]);
    expect(shortAnalysis.loop).toBe(true);
    expect(longAnalysis.loop).toBe(false);
    if (!shortAnalysis.hasAudio || !longAnalysis.hasAudio) throw new Error('unreachable');
    expect(Math.abs(shortAnalysis.inputI - longAnalysis.inputI)).toBeLessThanOrEqual(1.5);
  }, 20000);

  test('a genuinely silent file still measures as silent once looped (no false positive)', async () => {
    const filePath = path.join(workDir, 'silence-0.2.wav');
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=duration=0.2', '-c:a', 'pcm_s16le', filePath]);
    const analysis = await measureWholeFile(filePath);
    expect(analysis.loop).toBe(true);
    expect(analysis.hasAudio).toBe(false);
    // unmeasured (T21b) is for a measurement that fails outright, not for confirmed silence
    expect((analysis as { unmeasured?: true }).unmeasured).toBeUndefined();
  }, 20000);
});
