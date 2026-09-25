// A9 (T48): animated framing (keyframes: pan and zoom) rendered with the real ffmpeg, checked by pixels. The source is a
// synthetic grid of small white dots on black, made by the test (lossless), so the exact position of every dot in every
// output frame follows from the keyframes: P → (P − crop.xy) · cell / crop.size, with the crop computed independently
// here from the keyframe model (getKeyframeTransformAt + clampTransform), not with the render's own function. The
// centroid of each visible dot is measured in every frame and compared with it.
// - a static column (perspective, ADR-003): sub-pixel position, smooth frame to frame (no judder), linear/smooth/hold
//   curves, chunks cut in the middle of the animation; also with an anamorphic source (B1) and a turned clip (E9);
// - a re-layout at the same time (column layer): the animated crops on a column whose width changes, within its
//   documented 2 px quantization.
// Skipped without the dev ffmpeg. With VIDEOMIX_KEYFRAMES_FRAMES_DIR set, a few frames are written there as PNG.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';

import { getAnimatedCellCrop } from '../animatedCrop';
import { clampTransform, getKeyframeTransformAt } from '../clipKeyframes';
import { rotateSize } from '../clipRotation';
import type { MixPlan } from '../planner/types';
import type { MixClipKeyframe, MixClipRotation, MixSource, Rect } from '../types';
import { buildRenderJob } from './buildRenderJob';
import type { RenderClip } from './buildVideoGraph';
import { testSettings } from './renderTestFixtures';
import { getColumnsAtFrame, getRenderTimeline } from './renderTimeline';

const execFileAsync = promisify(execFile);

const ffDir = path.resolve('ffmpeg', `${os.platform()}-${os.arch()}`, ...(os.platform() === 'darwin' ? [] : ['lib']));
const exe = os.platform() === 'win32' ? '.exe' : '';
const ffmpegPath = path.join(ffDir, `ffmpeg${exe}`);
const available = existsSync(ffmpegPath);
const env = { ...process.env, LD_LIBRARY_PATH: ffDir };
const framesDir = process.env['VIDEOMIX_KEYFRAMES_FRAMES_DIR'];

const run = async (args: string[]) => (await execFileAsync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...args], { env, maxBuffer: 1e9, encoding: 'buffer' })).stdout;

const FPS = 30;
const SOURCE = { width: 1920, height: 1080 };
// dots every 240 px (12 px squares), centres at 120 + 240·i, 120 + 240·j of the display frame
const DOTS = Array.from({ length: 8 }, (_v, i) => Array.from({ length: 5 }, (_w, j) => ({ x: 120 + 240 * i, y: 60 + 240 * j }))).flat();

let workDir = '';
const sources = { dots: '', ana: '' };
beforeAll(async () => {
  if (!available) return;
  workDir = await mkdtemp(path.join(os.tmpdir(), 'videomix-keyframes-'));
  const boxes = (sx: number) => DOTS.map(({ x, y }) => `drawbox=x=${(x - 6) / sx}:y=${y - 6}:w=${12 / sx}:h=12:c=white:t=fill`).join(',');
  sources.dots = path.join(workDir, 'dots.mp4');
  sources.ana = path.join(workDir, 'dots-ana.mp4');
  // lossless, 4 s; the anamorphic one is coded 960x1080 at 2:1 (displayed 1920x1080, the same picture)
  await run(['-f', 'lavfi', '-i', `color=c=black:s=1920x1080:r=${FPS}:d=4,${boxes(1)}`, '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', sources.dots]);
  await run(['-f', 'lavfi', '-i', `color=c=black:s=960x1080:r=${FPS}:d=4,${boxes(2)},setsar=2/1`, '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', sources.ana]);
}, 60_000);
afterAll(async () => {
  if (workDir !== '') await rm(workDir, { recursive: true, force: true });
});

const settings = testSettings({ fps: FPS, gap: { width: 0, color: '#000000' }, fill: { mode: 'color', color: '#000000' }, fadeInOut: false, transition: { type: 'fade', duration: 0.5 } });

/** Renders `plan` (chunks of at most `maxChunkSeconds`) and returns all its frames as gray bytes. */
async function renderFrames(name: string, plan: MixPlan, clips: RenderClip[], sourceFrames: Record<string, Pick<MixSource, 'width' | 'height' | 'sar'>>, maxChunkSeconds: number) {
  const dir = await mkdtemp(path.join(workDir, `${name}-`));
  const outPath = path.join(dir, 'out.mp4');
  const job = buildRenderJob({ plan, clips, sourcePaths: { dots: sources.dots, ana: sources.ana }, sourceFrames, settings, encoding: { preset: 'ultrafast', crf: 8 }, workDir: dir, outPath, join: path.join, maxChunkSeconds });
  await Promise.all(job.files.map(async (f) => writeFile(f.path, f.content)));
  await Promise.all(job.chunks.map(async (chunk) => run(chunk.args)));
  await run(job.audio.args);
  await run(job.concat.args);
  if (framesDir != null) {
    await mkdir(framesDir, { recursive: true });
    await run(['-y', '-i', outPath, '-vf', String.raw`select=not(mod(n\,15))`, '-fps_mode', 'passthrough', path.join(framesDir, `${name}-%02d.png`)]);
  }
  const raw = await run(['-i', outPath, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  return { raw, chunks: job.chunks.length, frames: job.totalFrames };
}

/** Intensity-weighted centroid of the dot expected at (x, y) in a gray frame, within ±r px. */
function centroid(frame: Buffer, width: number, height: number, x: number, y: number, r: number) {
  let sum = 0;
  let cx = 0;
  let cy = 0;
  for (let py = Math.max(0, Math.floor(y - r)); py < Math.min(height, Math.ceil(y + r)); py += 1) {
    for (let px = Math.max(0, Math.floor(x - r)); px < Math.min(width, Math.ceil(x + r)); px += 1) {
      const v = frame[py * width + px]! - 60;
      if (v > 0) {
        sum += v;
        cx += v * (px + 0.5);
        cy += v * (py + 0.5);
      }
    }
  }
  return sum > 0 ? { x: cx / sum, y: cy / sum } : undefined;
}

interface Expected {
  /** Output px of the cell (its window) at this frame. */
  cell: Rect,
  /** Source rect (clip frame px) shown in the cell. */
  crop: Rect,
}

/**
 * Measures every dot fully inside its cell (with a margin) in every frame: error (px) of its centroid against the
 * expected position, and the frame-to-frame change of the mean error (judder).
 */
function measure(raw: Buffer, outWidth: number, outHeight: number, frames: number, expectedAt: (n: number) => Expected, dots: { x: number, y: number }[]) {
  const size = outWidth * outHeight;
  const errors: number[] = [];
  const perFrame: ({ x: number, y: number } | undefined)[] = [];
  for (let n = 0; n < frames; n += 1) {
    const frame = raw.subarray(n * size, (n + 1) * size);
    const { cell, crop } = expectedAt(n);
    const s = cell.width / crop.width;
    let ex = 0;
    let ey = 0;
    let count = 0;
    for (const dot of dots) {
      const x = cell.x + (dot.x - crop.x) * s;
      const y = cell.y + (dot.y - crop.y) * (cell.height / crop.height);
      const margin = 12 * s + 4;
      if (x >= cell.x + margin && x <= cell.x + cell.width - margin && y >= cell.y + margin && y <= cell.y + cell.height - margin) {
        const c = centroid(frame, outWidth, outHeight, x, y, 6 * s + 4);
        expect(c, `frame ${n}: dot ${dot.x},${dot.y} not found at ${x},${y}`).toBeDefined();
        errors.push(Math.hypot(c!.x - x, c!.y - y));
        ex += c!.x - x;
        ey += c!.y - y;
        count += 1;
      }
    }
    perFrame.push(count > 0 ? { x: ex / count, y: ey / count } : undefined);
  }
  const steps: number[] = [];
  for (let n = 1; n < perFrame.length; n += 1) {
    const a = perFrame[n - 1];
    const b = perFrame[n];
    if (a != null && b != null) steps.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  return {
    count: errors.length,
    mean: errors.reduce((acc, e) => acc + e, 0) / errors.length,
    max: Math.max(...errors),
    judder: Math.sqrt(steps.reduce((acc, d) => acc + d * d, 0) / steps.length),
  };
}

const kf = (time: number, centerX: number, centerY: number, scale: number, interpolation?: MixClipKeyframe['interpolation']): MixClipKeyframe => (
  { time, centerX, centerY, scale, ...(interpolation != null && { interpolation }) }
);

/** The max rect moved and scaled by the keyframes at `time`, inside the frame: computed from the model only. */
function animatedMax(maxRect: Rect, keyframes: MixClipKeyframe[], time: number, frame: { width: number, height: number }): Rect {
  const { centerX, centerY, scale } = clampTransform(maxRect, getKeyframeTransformAt(keyframes, time)!, frame);
  return { x: centerX - (maxRect.width * scale) / 2, y: centerY - (maxRect.height * scale) / 2, width: maxRect.width * scale, height: maxRect.height * scale };
}

const singleColumn = (width: number, height: number, duration: number): MixPlan => ({
  width,
  height,
  duration,
  placements: [{ clipId: 'k', column: 0, startTime: 0, endTime: duration, transitionIn: 0 }],
  layouts: [{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width }], fills: [] }],
  warnings: [],
});

describe.skipIf(!available)('animated framing, rendered (A9)', () => {
  // clip from source 0.5 s, 3 s long: holds, slow linear pan (40 px in 1 s: ~0.5 output px per frame), smooth zoom-in
  // to half the size, then a hold that jumps at 3.3 s
  const START = 0.5;
  const DURATION = 3;
  const maxRect = { x: 160, y: 90, width: 1600, height: 900 };
  const keyframes = [kf(1, 960, 540, 1, 'linear'), kf(2, 1000, 560, 1), kf(3, 900, 500, 0.5, 'hold'), kf(3.3, 1150, 600, 0.5)];

  const cases: { name: string, sourceId: 'dots' | 'ana', rotation: MixClipRotation, out: { width: number, height: number } }[] = [
    { name: 'square pixels', sourceId: 'dots', rotation: 0, out: { width: 640, height: 360 } },
    { name: 'anamorphic source (B1)', sourceId: 'ana', rotation: 0, out: { width: 640, height: 360 } },
    { name: 'turned clip (E9)', sourceId: 'dots', rotation: 90, out: { width: 360, height: 640 } },
  ];

  test.each(cases)('static column, $name: every dot where the keyframes put it, sub-pixel and smooth', async ({ name, sourceId, rotation, out }) => {
    const frame = rotateSize(SOURCE, rotation);
    // in the turned frame (90° clockwise): (x, y) → (1080 − y, x)
    const turn = (p: { x: number, y: number }) => (rotation === 90 ? { x: SOURCE.height - p.y, y: p.x } : p);
    const turnRect = (r: Rect) => (rotation === 90 ? { x: SOURCE.height - r.y - r.height, y: r.x, width: r.height, height: r.width } : r);
    const clipMax = turnRect(maxRect);
    const clipKeyframes = keyframes.map((k) => {
      const c = turn({ x: k.centerX, y: k.centerY });
      return { ...k, centerX: c.x, centerY: c.y };
    });
    const clip: RenderClip = { id: 'k', sourceId, start: START, maxRect: clipMax, keyframes: clipKeyframes, ...(rotation !== 0 && { rotation }) };
    const sourceFrames = { [sourceId]: { ...SOURCE, ...(sourceId === 'ana' && { sar: { num: 2, den: 1 } }) } };
    // 1 s chunks: cuts in the middle of the pan and of the zoom
    const { raw, chunks, frames } = await renderFrames(name.replaceAll(/\W+/g, '-'), singleColumn(out.width, out.height, DURATION), [clip], sourceFrames, 1);
    expect(chunks).toBe(3);
    expect(frames).toBe(DURATION * FPS);
    const cell = { x: 0, y: 0, ...out };
    const expectedAt = (n: number) => ({ cell, crop: animatedMax(clipMax, clipKeyframes, START + n / FPS, frame) });
    const res = measure(raw, out.width, out.height, frames, expectedAt, DOTS.map((d) => turn(d)));
    expect(res.count).toBeGreaterThan(frames * 10);
    // sub-pixel: a rounding to even source px would be off by up to 0.4–0.8 output px, the column layer by 2 px
    expect(res.mean, JSON.stringify(res)).toBeLessThan(0.3);
    expect(res.max, JSON.stringify(res)).toBeLessThan(1);
    // the hold jump at 3.3 s (frame 84) lands on its frame, and the error doesn't jump from frame to frame
    expect(res.judder, JSON.stringify(res)).toBeLessThan(0.25);
    const at = (n: number) => measure(raw.subarray(n * out.width * out.height), out.width, out.height, 1, () => expectedAt(n), DOTS.map((d) => turn(d))).mean;
    expect(at(83)).toBeLessThan(0.5);
    expect(at(84)).toBeLessThan(0.5);
  }, 120_000);

  test('re-layout at the same time: the column layer shows the animated crop (2 px quantization)', async () => {
    // column 0 (static dots clip) | column 1 (the animated clip, croppable to 4:3) re-laid out 318|318 → 200|436 at 1 s
    const plan: MixPlan = {
      width: 640,
      height: 360,
      duration: DURATION,
      placements: [
        { clipId: 's', column: 0, startTime: 0, endTime: DURATION, transitionIn: 0 },
        { clipId: 'k', column: 1, startTime: 0, endTime: DURATION, transitionIn: 0 },
      ],
      layouts: [
        { time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 318 }, { column: 1, x: 322, width: 318 }], fills: [] },
        { time: 1, transitionDuration: 1, columns: [{ column: 0, x: 0, width: 200 }, { column: 1, x: 204, width: 436 }], fills: [] },
      ],
      warnings: [],
    };
    const k: RenderClip = { id: 'k', sourceId: 'dots', start: START, maxRect, minRect: { x: 560, y: 90, width: 800, height: 900 }, keyframes: [kf(1, 960, 540, 1, 'linear'), kf(2.5, 1000, 520, 0.6)] };
    const s: RenderClip = { id: 's', sourceId: 'dots', start: 0, maxRect: { x: 0, y: 0, width: 1080, height: 1080 } };
    const gapSettings = { ...settings, gap: { width: 4, color: '#000000' } };
    const dir = await mkdtemp(path.join(workDir, 'relayout-'));
    const outPath = path.join(dir, 'out.mp4');
    const job = buildRenderJob({ plan, clips: [s, k], sourcePaths: { dots: sources.dots }, sourceFrames: { dots: SOURCE }, settings: gapSettings, encoding: { preset: 'ultrafast', crf: 8 }, workDir: dir, outPath, join: path.join });
    await Promise.all(job.files.map(async (f) => writeFile(f.path, f.content)));
    const graphs = job.files.filter((f) => f.path.endsWith('.txt') && f.content.includes('[vout]')).map((f) => f.content);
    // the re-layout chunk uses the column layer, the static ones the perspective
    expect(graphs.some((g) => g.includes('eval=frame:flags=bicubic') && !g.includes('perspective'))).toBe(true);
    expect(graphs.some((g) => g.includes('perspective'))).toBe(true);
    await Promise.all(job.chunks.map(async (chunk) => run(chunk.args)));
    await run(job.audio.args);
    await run(job.concat.args);
    const raw = await run(['-i', outPath, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
    const tl = getRenderTimeline(plan, { fps: FPS, gap: 4, transitionDuration: 0.5 });
    const expectedAt = (n: number): Expected => {
      const geom = getColumnsAtFrame(tl, n).get(1)!;
      // the render's layer is anchored at the column's even x
      const cell = { x: 2 * Math.round(geom.x / 2), y: 0, width: geom.width, height: 360 };
      return { cell, crop: getAnimatedCellCrop({ clip: k, aspect: geom.width / 360, time: START + n / FPS, frame: SOURCE }).crop };
    };
    const res = measure(raw, 640, 360, job.totalFrames, expectedAt, DOTS);
    expect(res.count).toBeGreaterThan(job.totalFrames * 5);
    expect(res.mean, JSON.stringify(res)).toBeLessThan(1.2);
    expect(res.max, JSON.stringify(res)).toBeLessThan(3.5);
  }, 120_000);
});
