// E9 (T38d): turned clips rendered with the real ffmpeg. A turned clip's rects are in the source's display frame
// turned clockwise by its rotation; the render crops the matching rect of the unturned frame (in coded pixels, B1) and
// turns only the crop. Each case is compared with a reference made the slow way: scale the whole frame to its display
// size, turn it, crop the rect. Covers the 4 turns on a square-pixel source, a source with rotation metadata and an
// anamorphic source with rotation metadata, plus a pillarboxed clip over its blurred cover and the thumbnails.
// Skipped when the dev ffmpeg or the test media (`yarn generate-test-media`) are missing.
// With VIDEOMIX_ROTATION_FRAMES_DIR set, the rendered frames and references are written there as PNG to look at.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, test, expect, afterAll } from 'vitest';

import { THUMBNAIL_HEIGHT, getThumbnailArgs } from '../../../../main/videomix/thumbnailArgs';
import type { FFprobeFormat, FFprobeStream } from '../../../../common/ffprobe';
import { addRotation, getRotationFilter, rotateSize } from '../clipRotation';
import { getCropForAspect } from '../geometry';
import type { MixPlan } from '../planner/types';
import { getThumbnailCrop } from '../thumbnails';
import { mixClipRotations } from '../types';
import type { MixClipRotation, MixSettings, MixSource, Rect } from '../types';
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
// square pixels; rotation metadata (display 1080x1920); anamorphic with rotation metadata (display 720x1358)
const files = { h: 'h-720p-25fps-8s.mp4', vrot: 'v-rotated-9s.mp4', anarot: 'ana-rotated-6s.mp4' } as const;
const available = existsSync(ffmpegPath) && existsSync(ffprobePath) && Object.values(files).every((f) => existsSync(path.join(mediaDir, f)));
const env = { ...process.env, LD_LIBRARY_PATH: ffDir };
const framesDir = process.env['VIDEOMIX_ROTATION_FRAMES_DIR'];

const run = async (bin: string, args: string[]) => (await execFileAsync(bin, args, { env, maxBuffer: 1e9, encoding: 'buffer' })).stdout;

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })));
});

type SourceId = keyof typeof files;
type Frame = { width: number, height: number } & Pick<MixSource, 'sar'>;

async function probeSource(id: SourceId): Promise<Frame> {
  const json = JSON.parse((await run(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path.join(mediaDir, files[id])])).toString()) as { streams: FFprobeStream[], format: FFprobeFormat };
  const { width, height, sar } = getSourceMeta(json);
  expect(width != null && height != null).toBe(true);
  return { width: width!, height: height!, sar };
}

function meanAbsDiff(a: Buffer, b: Buffer) {
  expect(a.length).toBe(b.length);
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
}

const rawArgs = ['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'];

/** The source frame at `t` scaled to its display size, turned by `rotation`, cropped to `rect` and scaled to w×h. */
const referenceFilter = (frame: Frame, rotation: MixClipRotation, rect: Rect, w: number, h: number) => [
  `scale=${frame.width}:${frame.height}:flags=bicubic,setsar=1`,
  ...(rotation !== 0 ? [getRotationFilter(rotation)] : []),
  `crop=${rect.width}:${rect.height}:${rect.x}:${rect.y},scale=${w}:${h}:flags=bicubic`,
].join(',');

const reference = async (id: SourceId, frame: Frame, rotation: MixClipRotation, t: number, rect: Rect, w: number, h: number) => run(ffmpegPath, [
  '-v', 'error', '-ss', t.toFixed(3), '-i', path.join(mediaDir, files[id]), '-frames:v', '1', '-vf', referenceFilter(frame, rotation, rect, w, h), ...rawArgs,
]);

async function savePng(name: string, raw: Buffer, w: number, h: number) {
  if (framesDir == null) return;
  await mkdir(framesDir, { recursive: true });
  const rawPath = path.join(framesDir, `${name}.rgb`);
  await writeFile(rawPath, raw);
  await run(ffmpegPath, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-i', rawPath, path.join(framesDir, `${name}.png`)]);
  await rm(rawPath);
}

const settings: MixSettings = testSettings({ fps: 30, fadeInOut: false, gap: { width: 0, color: '#000000' } });

/** One clip in one full-size cell, static, 1 s from `start`; returns its first frame as RGB24. */
async function renderFirstFrame(id: SourceId, frame: Frame, clip: Omit<RenderClip, 'id' | 'sourceId'>, width: number, height: number) {
  const plan: MixPlan = {
    width,
    height,
    duration: 1,
    placements: [{ clipId: 'c', column: 0, startTime: 0, endTime: 1, transitionIn: 0 }],
    layouts: [{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width }], fills: [] }],
    warnings: [],
  };
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'videomix-rot-'));
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
  return { graph: job.files.map((f) => f.content).join('\n'), out: await run(ffmpegPath, ['-v', 'error', '-i', outPath, '-frames:v', '1', ...rawArgs]) };
}

const even = (v: number) => 2 * Math.round(v / 2);

/** An off-centre rect of the turned frame (so that a wrong turn or a mirrored crop shows). */
const testRect = (frame: { width: number, height: number }): Rect => ({
  x: even(frame.width * 0.12), y: even(frame.height * 0.2), width: even(frame.width * 0.5), height: even(frame.height * 0.6),
});

describe.skipIf(!available)('turned clips with ffmpeg (E9)', () => {
  const start = 1;

  for (const id of Object.keys(files) as SourceId[]) {
    test(`${id}: the render shows the editor's framing in the 4 turns`, async () => {
      const frame = await probeSource(id);
      for (const rotation of mixClipRotations) {
        const turned = rotateSize(frame, rotation);
        const maxRect = testRect(turned);
        const H = 360;
        const W = even((H * maxRect.width) / maxRect.height);
        const { crop, fit } = getCropForAspect(maxRect, undefined, W / H);
        expect(fit).toBe('fill');
        // eslint-disable-next-line no-await-in-loop
        const { graph, out } = await renderFirstFrame(id, frame, { start, maxRect, ...(rotation !== 0 && { rotation }) }, W, H);
        if (rotation === 0) expect(graph).not.toMatch(/transpose|hflip/);
        else expect(graph).toContain(getRotationFilter(rotation));
        // eslint-disable-next-line no-await-in-loop
        const ref = await reference(id, frame, rotation, start, crop, W, H);
        // the opposite turn (same frame size, same rect) shows other content: the comparison notices a wrong turn
        // eslint-disable-next-line no-await-in-loop
        const wrong = await reference(id, frame, addRotation(rotation, 180), start, crop, W, H);
        const diff = meanAbsDiff(out, ref);
        const off = meanAbsDiff(out, wrong);
        // eslint-disable-next-line no-await-in-loop
        await savePng(`${id}-${rotation}-render`, out, W, H);
        // eslint-disable-next-line no-await-in-loop
        await savePng(`${id}-${rotation}-reference`, ref, W, H);
        expect(diff, `${id} ${rotation}°`).toBeLessThan(8);
        expect(off, `${id} ${rotation}°`).toBeGreaterThan(4 * diff);
      }
    }, 120_000);
  }

  test('a pillarboxed turned clip over its blurred cover keeps the foreground framing', async () => {
    const frame = await probeSource('anarot');
    const rotation = 90;
    // a rigid 1:1 max of the turned 1358x720 frame, in a 16:9 cell: pillarbox
    const maxRect = { x: 600, y: 100, width: 520, height: 520 };
    const [W, H] = [640, 360];
    const { fit } = getCropForAspect(maxRect, undefined, W / H);
    expect(fit).toBe('pillarbox');
    const { out } = await renderFirstFrame('anarot', frame, { start, maxRect, rotation }, W, H);
    await savePng('anarot-90-pillarbox', out, W, H);
    const x0 = (W - H) / 2;
    const fg = Buffer.concat(Array.from({ length: H }, (_v, y) => out.subarray((y * W + x0) * 3, (y * W + x0 + H) * 3)));
    const diff = meanAbsDiff(fg, await reference('anarot', frame, rotation, start, maxRect, H, H));
    const off = meanAbsDiff(fg, await reference('anarot', frame, 270, start, maxRect, H, H));
    expect(diff).toBeLessThan(10);
    expect(off).toBeGreaterThan(3 * diff);
  }, 60_000);

  test('thumbnails of turned clips show the same framing', async () => {
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'videomix-rot-thumb-'));
    tempDirs.push(workDir);
    for (const id of ['h', 'anarot'] as const) {
      // eslint-disable-next-line no-await-in-loop
      const frame = await probeSource(id);
      for (const rotation of mixClipRotations) {
        const maxRect = testRect(rotateSize(frame, rotation));
        const outPath = path.join(workDir, `${id}-${rotation}.png`);
        // eslint-disable-next-line no-await-in-loop
        await run(ffmpegPath, ['-v', 'error', ...getThumbnailArgs({ filePath: path.join(mediaDir, files[id]), timestamp: start, ...getThumbnailCrop(maxRect, frame, rotation), outPath, qscale: 2 })]);
        const w = even((THUMBNAIL_HEIGHT * maxRect.width) / maxRect.height);
        // eslint-disable-next-line no-await-in-loop
        const thumb = await run(ffmpegPath, ['-v', 'error', '-i', outPath, ...rawArgs]);
        expect(thumb.length, `${id} ${rotation}°`).toBe(w * THUMBNAIL_HEIGHT * 3);
        // eslint-disable-next-line no-await-in-loop
        const diff = meanAbsDiff(thumb, await reference(id, frame, rotation, start, maxRect, w, THUMBNAIL_HEIGHT));
        // eslint-disable-next-line no-await-in-loop
        const off = meanAbsDiff(thumb, await reference(id, frame, addRotation(rotation, 180), start, maxRect, w, THUMBNAIL_HEIGHT));
        // eslint-disable-next-line no-await-in-loop
        await savePng(`${id}-${rotation}-thumb`, thumb, w, THUMBNAIL_HEIGHT);
        expect(diff, `${id} ${rotation}°`).toBeLessThan(10);
        expect(off, `${id} ${rotation}°`).toBeGreaterThan(3 * diff);
      }
    }
  }, 120_000);
});
