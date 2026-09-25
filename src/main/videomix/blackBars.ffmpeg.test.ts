// Empirical check of detectBlackBars's sampling with the real ffmpeg: skipped when the dev ffmpeg
// (ffmpeg/<platform>-<arch>, `yarn download-ffmpeg-…`) or the T47 test media (`yarn generate-test-media`) is missing.
// Can't import detectBlackBars (src/main/videomix/blackBars.ts) directly: it pulls in src/main/ffmpeg.ts, which
// imports Electron's `app` and crashes outside a real Electron process. So this mirrors its algorithm (same sample
// spread, same ffmpeg args) with plain child_process calls, like loudness.ffmpeg.test.ts does for the same reason.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
// eslint-disable-next-line import/no-extraneous-dependencies
import { describe, test, expect } from 'vitest';

import { parseCropDetectOutput } from '../../common/videomix/cropDetect';

const execFileAsync = promisify(execFile);

const ffDir = path.resolve('ffmpeg', `${os.platform()}-${os.arch()}`, ...(os.platform() === 'darwin' ? [] : ['lib']));
const exe = os.platform() === 'win32' ? '.exe' : '';
const ffmpegPath = path.join(ffDir, `ffmpeg${exe}`);
const env = { ...process.env, LD_LIBRARY_PATH: ffDir };

const testMediaDir = path.resolve('test-media');
const horizontalBarsPath = path.join(testMediaDir, 'h-bars-1280x960-6s.mp4');
const verticalBarsPath = path.join(testMediaDir, 'v-bars-960x1280-6s.mp4');
const plainPath = path.join(testMediaDir, 'h-1080p-10s.mp4');

const available = existsSync(ffmpegPath) && existsSync(horizontalBarsPath) && existsSync(verticalBarsPath) && existsSync(plainPath);

/** Mirrors detectBlackBars: a `cropdetect` pass on a few samples spread across the range, unioned. */
async function detect(filePath: string, start: number, end: number) {
  const span = end - start;
  const count = Math.max(1, Math.min(5, Math.floor(span / 1) + 1));
  const times = Array.from({ length: count }, (_, i) => start + ((i + 0.5) * span) / count);
  const outputs = await Promise.all(times.map(async (time) => {
    const { stderr } = await execFileAsync(ffmpegPath, [
      '-hide_banner', '-nostats',
      '-ss', time.toFixed(6),
      '-i', filePath,
      '-map', '0:v:0',
      '-frames:v', '30',
      '-vf', 'cropdetect',
      '-f', 'null', '-',
    ], { env, maxBuffer: 1e8 });
    return stderr;
  }));
  return parseCropDetectOutput(outputs.join('\n'));
}

describe.skipIf(!available)('detectBlackBars\'s sampling, with ffmpeg (A7, T47)', () => {
  test('top/bottom bars: the picture rect excludes them', async () => {
    expect(await detect(horizontalBarsPath, 0, 6)).toEqual({ x: 0, y: 120, width: 1280, height: 720 });
  }, 30000);

  test('left/right bars: the picture rect excludes them', async () => {
    expect(await detect(verticalBarsPath, 0, 6)).toEqual({ x: 120, y: 0, width: 720, height: 1280 });
  }, 30000);

  test('a clip\'s own range (not the whole file) is what gets analyzed', async () => {
    expect(await detect(horizontalBarsPath, 1, 3)).toEqual({ x: 0, y: 120, width: 1280, height: 720 });
  }, 30000);

  test('no bars: the whole frame', async () => {
    expect(await detect(plainPath, 0, 10)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  }, 30000);
});
