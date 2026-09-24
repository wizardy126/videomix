// B1 (T35): sources with non-square pixels rendered with the real ffmpeg. The clip rects are in display pixels (what
// the editor shows, Chromium's videoWidth/videoHeight); the render and the thumbnails must show the same part of the
// picture as a reference made the slow way: scale the frame to its display size first, then crop the rect. Also runs
// the probe → getSourceMeta path on the real files. Skipped when the dev ffmpeg or the T35 media
// (`yarn generate-test-media`) are missing.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, test, expect, afterAll } from 'vitest';

import { THUMBNAIL_HEIGHT, getThumbnailArgs } from '../../../../main/videomix/thumbnailArgs';
import type { FFprobeFormat, FFprobeStream } from '../../../../common/ffprobe';
import { extendMaxRect, getCropForAspect, getExtendedCropForAspect } from '../geometry';
import type { MixPlan } from '../planner/types';
import { getThumbnailCrop } from '../thumbnails';
import type { MixSettings, MixSource, Rect } from '../types';
import { getSourceMeta } from '../workspace';
import { buildRenderJob } from './buildRenderJob';
import type { RenderClip } from './buildVideoGraph';
import { testSettings } from './renderTestFixtures';

const execFileAsync = promisify(execFile);

const ffDir = path.resolve('ffmpeg', `${os.platform()}-${os.arch()}`, ...(os.platform() === 'darwin' ? [] : ['lib']));
const exe = os.platform() === 'win32' ? '.exe' : '';
const ffmpegPath = path.join(ffDir, `ffmpeg${exe}`);
const ffprobePath = path.join(ffDir, `ffprobe${exe}`);
const mediaDir = path.resolve('test-media');
const files = { ana: 'ana-1280x720-sar-6s.mp4', rot: 'ana-rotated-6s.mp4' } as const;
const available = existsSync(ffmpegPath) && existsSync(ffprobePath) && Object.values(files).every((f) => existsSync(path.join(mediaDir, f)));
const env = { ...process.env, LD_LIBRARY_PATH: ffDir };

const run = async (bin: string, args: string[]) => (await execFileAsync(bin, args, { env, maxBuffer: 1e9, encoding: 'buffer' })).stdout;

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })));
});

type SourceId = keyof typeof files;
type Frame = Pick<MixSource, 'width' | 'height' | 'sar'>;

async function probeSource(id: SourceId): Promise<Frame> {
  const json = JSON.parse((await run(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path.join(mediaDir, files[id])])).toString()) as { streams: FFprobeStream[], format: FFprobeFormat };
  return getSourceMeta(json);
}

/** Mean absolute difference (0–255) of two RGB24 buffers, over the rows [y0, y1) of a `width` px wide image. */
function meanAbsDiff(a: Buffer, b: Buffer, width: number, y0: number, y1: number) {
  expect(a.length).toBe(b.length);
  let sum = 0;
  for (let i = y0 * width * 3; i < y1 * width * 3; i += 1) sum += Math.abs(a[i]! - b[i]!);
  return sum / ((y1 - y0) * width * 3);
}

/** RGB24 of the source frame at `t`, scaled to its display size first (square pixels), cropped to `rect`, scaled to w×h. */
const reference = async (id: SourceId, frame: Frame, t: number, rect: Rect, w: number, h: number) => run(ffmpegPath, [
  '-v', 'error', '-ss', t.toFixed(3), '-i', path.join(mediaDir, files[id]), '-frames:v', '1',
  '-vf', `scale=${frame.width}:${frame.height}:flags=bicubic,setsar=1,crop=${rect.width}:${rect.height}:${rect.x}:${rect.y},scale=${w}:${h}:flags=bicubic`,
  '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
]);

const settings: MixSettings = testSettings({ fps: 30, fadeInOut: false, gap: { width: 0, color: '#000000' } });

/** One clip in one full-size column, static. */
async function renderSingle(id: SourceId, frame: Frame, clip: Omit<RenderClip, 'id' | 'sourceId'>, width: number, height: number, extendedMaxRect?: Rect) {
  const plan: MixPlan = {
    width,
    height,
    duration: 2,
    placements: [{ clipId: 'c', column: 0, startTime: 0, endTime: 2, transitionIn: 0, ...(extendedMaxRect != null && { extendedMaxRect }) }],
    layouts: [{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width }], fills: [] }],
    warnings: [],
  };
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'videomix-sar-'));
  tempDirs.push(workDir);
  const outPath = path.join(workDir, 'out.mp4');
  const job = buildRenderJob({
    plan,
    clips: [{ id: 'c', sourceId: id, ...clip }],
    sourcePaths: { [id]: path.join(mediaDir, files[id]) },
    sourceFrames: { [id]: frame },
    settings,
    encoding: { preset: 'ultrafast', crf: 12 },
    workDir,
    outPath,
    join: path.join,
  });
  await Promise.all(job.files.map(async (f) => writeFile(f.path, f.content)));
  await Promise.all(job.chunks.map(async (c) => run(ffmpegPath, ['-loglevel', 'error', ...c.args])));
  await run(ffmpegPath, ['-loglevel', 'error', ...job.audio.args]);
  await run(ffmpegPath, ['-loglevel', 'error', ...job.concat.args]);
  const frameAt = async (t: number) => run(ffmpegPath, ['-v', 'error', '-ss', t.toFixed(3), '-i', outPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return { job, frameAt };
}

/** A rect moved by (dx, dy) px: shows that the comparison notices a wrong crop. */
const shifted = (r: Rect, dx: number, dy: number) => ({ ...r, x: r.x + dx, y: r.y + dy });

describe.skipIf(!available)('anamorphic sources with ffmpeg (B1)', () => {
  test('probe → display size and oriented SAR, like Chromium (1358x720, rotated 720x1358)', async () => {
    // x264 signals 679:640 as 87:82 (see generateTestMedia.ts); the display size is the same
    expect(await probeSource('ana')).toMatchObject({ width: 1358, height: 720, sar: { num: 87, den: 82 } });
    // autorotate inverts the SAR of a quarter turn
    expect(await probeSource('rot')).toMatchObject({ width: 720, height: 1358, sar: { num: 82, den: 87 } });
  });

  test('the user case (78,14 1232x694 on 1280x720 at 679:640) renders the editor framing', async () => {
    const frame = await probeSource('ana');
    const maxRect = { x: 78, y: 14, width: 1232, height: 694 };
    const minRect = { x: 478, y: 160, width: 400, height: 400 };
    const [W, H] = [640, 360];
    const { frameAt } = await renderSingle('ana', frame, { start: 1, maxRect, minRect }, W, H);
    const { crop, fit } = getCropForAspect(maxRect, minRect, W / H);
    expect(fit).toBe('fill');
    const out = await frameAt(1);
    const diff = meanAbsDiff(out, await reference('ana', frame, 2, crop, W, H), W, 0, H);
    // a crop off by 1/20 of its width (what the SAR changes over 1232 px) is clearly worse
    const off = meanAbsDiff(out, await reference('ana', frame, 2, shifted(crop, -60, 0), W, H), W, 0, H);
    expect(diff).toBeLessThan(8);
    expect(off).toBeGreaterThan(4 * diff);
  }, 60_000);

  test('rotated anamorphic source: the SAR applies to the vertical axis of the rotated frame', async () => {
    const frame = await probeSource('rot');
    const maxRect = { x: 14, y: 78, width: 694, height: 1232 };
    const minRect = { x: 160, y: 478, width: 400, height: 400 };
    const [W, H] = [360, 640];
    const { frameAt } = await renderSingle('rot', frame, { start: 1, maxRect, minRect }, W, H);
    const { crop, fit } = getCropForAspect(maxRect, minRect, W / H);
    expect(fit).toBe('fill');
    const out = await frameAt(1);
    const diff = meanAbsDiff(out, await reference('rot', frame, 2, crop, W, H), W, 0, H);
    const off = meanAbsDiff(out, await reference('rot', frame, 2, shifted(crop, 0, -60), W, H), W, 0, H);
    expect(diff).toBeLessThan(8);
    expect(off).toBeGreaterThan(4 * diff);
  }, 60_000);

  test('E7 (T38b): a clip extended beyond its max crops the extended rect in display pixels', async () => {
    const frame = await probeSource('ana');
    // a 1:1 max near the right edge of the 1358x720 display frame, shown at 16:9: 1280 px of the display width
    const maxRect = { x: 1000, y: 0, width: 358, height: 720 };
    const [W, H] = [640, 360];
    const extended = extendMaxRect(maxRect, frame as { width: number, height: number }, 'horizontal', 1280 - 358);
    expect(extended).toEqual({ x: 78, y: 0, width: 1280, height: 720 });
    const { crop, fit } = getExtendedCropForAspect(maxRect, undefined, extended, W / H);
    expect({ crop, fit }).toEqual({ crop: extended, fit: 'fill' });
    const { frameAt } = await renderSingle('ana', frame, { start: 1, maxRect }, W, H, extended);
    const out = await frameAt(1);
    const diff = meanAbsDiff(out, await reference('ana', frame, 2, crop, W, H), W, 0, H);
    const off = meanAbsDiff(out, await reference('ana', frame, 2, shifted(crop, -60, 0), W, H), W, 0, H);
    expect(diff).toBeLessThan(8);
    expect(off).toBeGreaterThan(4 * diff);
  }, 60_000);

  test('letterboxed rigid clip over its blurred cover: the foreground keeps the display proportion', async () => {
    const frame = await probeSource('ana');
    const maxRect = { x: 78, y: 14, width: 1232, height: 694 };
    const [W, H] = [360, 360];
    const { frameAt } = await renderSingle('ana', frame, { start: 1, maxRect }, W, H);
    const fh = 2 * Math.round((maxRect.height * W) / maxRect.width / 2);
    const y0 = (H - fh) / 2;
    const out = await frameAt(1);
    const ref = await reference('ana', frame, 2, maxRect, W, fh);
    const fg = out.subarray(y0 * W * 3, (y0 + fh) * W * 3);
    // small and detailed: a larger error from resampling, but still far from a wrong crop
    const diff = meanAbsDiff(fg, ref, W, 0, fh);
    const off = meanAbsDiff(fg, await reference('ana', frame, 2, shifted(maxRect, -60, 0), W, fh), W, 0, fh);
    expect(diff).toBeLessThan(12);
    expect(off).toBeGreaterThan(3 * diff);
  }, 60_000);

  test('thumbnails show the same framing as the editor', async () => {
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'videomix-sar-thumb-'));
    tempDirs.push(workDir);
    for (const [id, maxRect] of [['ana', { x: 78, y: 14, width: 1232, height: 694 }], ['rot', { x: 14, y: 78, width: 694, height: 1232 }]] as const) {
      const frame = await probeSource(id);
      const outPath = path.join(workDir, `${id}.png`);
      await run(ffmpegPath, ['-v', 'error', ...getThumbnailArgs({ filePath: path.join(mediaDir, files[id]), timestamp: 2, ...getThumbnailCrop(maxRect, frame), outPath, qscale: 2 })]);
      const probe = JSON.parse((await run(ffprobePath, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', outPath])).toString()) as { streams: { width: number, height: number }[] };
      const w = 2 * Math.round((THUMBNAIL_HEIGHT * maxRect.width) / maxRect.height / 2);
      expect(probe.streams[0]).toMatchObject({ width: w, height: THUMBNAIL_HEIGHT });
      const thumb = await run(ffmpegPath, ['-v', 'error', '-i', outPath, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      expect(meanAbsDiff(thumb, await reference(id, frame, 2, maxRect, w, THUMBNAIL_HEIGHT), w, 0, THUMBNAIL_HEIGHT)).toBeLessThan(10);
    }
  }, 60_000);
});
