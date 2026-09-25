// T44b: the 1 % aspect tolerance, rendered with the real ffmpeg. Three clips without min fitted to 1/3 (F2 "Fit to")
// of a 1280x720 output, whose third (426.67 px) isn't a whole even number of px: before T44b the row was 2 px short
// (fill) or didn't fit. The planner's row has no fill, no column of the rendered frame is fill, and every cell shows
// its clip scaled uniformly: the crop has the cell's proportion, the cell matches that crop cut and scaled by ffmpeg
// directly, and an independent reference (the max scaled to cover the cell keeping its proportion, centred, cut). (The difference with a ≤ 1 % stretch is below
// what the vertical bars of the test media can show, so it isn't asserted.)
// Skipped without the dev ffmpeg or the T02 media. With VIDEOMIX_TOLERANCE_FRAMES_DIR set, the frames are written
// there as PNG to review them by hand.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, test, expect, afterAll } from 'vitest';

import { fitMaxRectToFraction } from '../fitFractions';
import { getAspectRange, getCellRect, getExtendedCropForAspect, getWidthRange, rectAspect } from '../geometry';
import { formatPlan } from '../planner/formatPlan';
import { planMix } from '../planner/planMix';
import { getPlanAxis } from '../planner/types';
import type { MixPlan, PlannerClip } from '../planner/types';
import type { Rect } from '../types';
import { buildRenderJob } from './buildRenderJob';
import type { RenderClip } from './buildVideoGraph';
import { testSettings, testSourcePaths, testSources } from './renderTestFixtures';
import type { TestSourceId } from './renderTestFixtures';

const execFileAsync = promisify(execFile);

const ffDir = path.resolve('ffmpeg', `${os.platform()}-${os.arch()}`, ...(os.platform() === 'darwin' ? [] : ['lib']));
const exe = os.platform() === 'win32' ? '.exe' : '';
const ffmpegPath = path.join(ffDir, `ffmpeg${exe}`);
const mediaDir = path.resolve('test-media');
const available = existsSync(ffmpegPath) && Object.values(testSources).every((s) => existsSync(path.join(mediaDir, s.file)));
const env = { ...process.env, LD_LIBRARY_PATH: ffDir };
const framesDir = process.env['VIDEOMIX_TOLERANCE_FRAMES_DIR'];

const run = async (args: string[]) => (await execFileAsync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...args], { env, maxBuffer: 1e9, encoding: 'buffer' })).stdout;

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })));
});

const WIDTH = 1280;
const HEIGHT = 720;
// a plain colour that none of the test media has, so fill is easy to tell from material
const settings = testSettings({ fps: 30, gap: { width: 0, color: '#000000' }, fill: { mode: 'color', color: '#ff8000' }, fadeInOut: false, transition: { type: 'fade', duration: 0.5 } });
const DURATION = 3;
const SAMPLE_TIME = 1.5;

interface Case {
  name: string,
  sources: TestSourceId[],
}

const cases: Case[] = [
  // a 9:16 video (1080x1920): the whole width, 1822 px tall (426.79 px at 720)
  { name: '9:16 source', sources: ['v1080', 'v1080', 'v1080'] },
  // 16:9 videos: 640x1080 (exactly 426.67 px) and 426x720 (426 px)
  { name: '16:9 sources', sources: ['h1080', 'h720', 'h1080'] },
];

const layout = { width: WIDTH, height: HEIGHT, gap: 0, axis: 'columns' as const };

function clipsOf(c: Case) {
  return c.sources.map((sourceId, i) => {
    const s = testSources[sourceId];
    const frame = { width: s.width, height: s.height };
    const res = fitMaxRectToFraction({ maxRect: { x: 0, y: 0, ...frame }, frame, fraction: '1/3', layout });
    if (!res.ok) throw new Error('fit');
    // E7 off: the tolerance alone must cover the mismatch
    return { id: `c${i}`, sourceId, start: i * 2, maxRect: res.maxRect };
  });
}

function plan(clips: RenderClip[]) {
  const plannerClips = clips.map(({ id, maxRect }): PlannerClip => ({ id, duration: DURATION, aspectRange: getAspectRange(maxRect), rects: { maxRect } }));
  return planMix({ clips: plannerClips, settings: { width: WIDTH, height: HEIGHT, maxColumns: 3, gap: 0, reorderWindow: 0, order: { mode: 'list', seed: 0 }, transitionDuration: 0.5 } });
}

/** The frame at `time` of the rendered plan, as raw RGB. */
async function renderFrame(c: Case, clips: RenderClip[], p: MixPlan, time: number) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'videomix-tolerance-'));
  tempDirs.push(workDir);
  const outPath = path.join(workDir, 'out.mp4');
  const job = buildRenderJob({ plan: p, clips, sourcePaths: testSourcePaths(mediaDir), settings, encoding: { preset: 'ultrafast', crf: 12 }, workDir, outPath, join: path.join });
  await Promise.all(job.files.map(async (f) => writeFile(f.path, f.content)));
  for (const chunk of job.chunks) await run(chunk.args);
  await run(job.audio.args);
  await run(job.concat.args);
  const select = `select=eq(n\\,${Math.round(time * settings.fps)})`;
  if (framesDir != null) {
    await mkdir(framesDir, { recursive: true });
    await run(['-y', '-i', outPath, '-vf', select, '-frames:v', '1', path.join(framesDir, `${c.name.replaceAll(/\W+/g, '-')}.png`)]);
  }
  return run(['-i', outPath, '-vf', select, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
}

/** `rect` (output px) of a raw RGB frame `width` px wide. */
function region(raw: Buffer, width: number, rect: Rect) {
  const out = Buffer.alloc(rect.width * rect.height * 3);
  for (let y = 0; y < rect.height; y += 1) raw.copy(out, y * rect.width * 3, ((rect.y + y) * width + rect.x) * 3, ((rect.y + y) * width + rect.x + rect.width) * 3);
  return out;
}

const meanAbsDiff = (a: Buffer, b: Buffer) => {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
};

const isFill = (raw: Buffer, i: number) => raw[i]! > 220 && Math.abs(raw[i + 1]! - 128) < 30 && raw[i + 2]! < 40;

/** Columns of the frame (x) where most pixels are the fill colour (#ff8000). */
function fillColumns(raw: Buffer, width: number, height: number) {
  const columns: number[] = [];
  for (let x = 0; x < width; x += 1) {
    let n = 0;
    for (let y = 0; y < height; y += 1) if (isFill(raw, (y * width + x) * 3)) n += 1;
    if (n > height / 2) columns.push(x);
  }
  return columns;
}

/** A frame of the source at SAMPLE_TIME + start through `filters`, as raw RGB. */
const sourceFrame = async (clip: RenderClip, filters: string) => run([
  '-ss', String(clip.start + SAMPLE_TIME), '-i', path.join(mediaDir, testSources[clip.sourceId as TestSourceId].file), '-frames:v', '1',
  '-vf', filters, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
]);

describe.skipIf(!available)('aspect tolerance, rendered (T44b)', () => {
  test.each(cases)('$name: three clips without min fitted to 1/3 of 1280x720 leave no fill and are not deformed', async (c) => {
    const clips = clipsOf(c);
    // without the tolerance the row was short or too long: the exact widths don't add up to 1280
    const exact = clips.map(({ maxRect }) => getWidthRange(getAspectRange(maxRect), HEIGHT));
    expect(exact.some((w) => w.min === w.max)).toBe(true);
    expect(exact.reduce((acc, w) => acc + w.max, 0) !== WIDTH || exact.reduce((acc, w) => acc + w.min, 0) !== WIDTH).toBe(true);

    const p = plan(clips);
    expect(p.layouts[0]!.columns, formatPlan(p)).toHaveLength(3);
    expect(p.layouts[0]!.fills, formatPlan(p)).toEqual([]);
    expect(p.warnings.filter((w) => w.type !== 'upscale'), formatPlan(p)).toEqual([]);

    const frame = await renderFrame(c, clips, p, SAMPLE_TIME);
    // no column of the frame is fill
    expect(fillColumns(frame, WIDTH, HEIGHT)).toEqual([]);

    for (const col of p.layouts[0]!.columns) {
      const placement = p.placements.find((pl) => pl.column === col.column)!;
      const clip = clips.find((x) => x.id === placement.clipId)!;
      const cell = getCellRect(getPlanAxis(p), { offset: col.x, length: col.width }, p);
      const { crop, fit, strategy } = getExtendedCropForAspect(clip.maxRect, undefined, placement.extendedMaxRect, cell.width / cell.height);
      expect(fit).toBe('fill');
      expect(['none', 'crop']).toContain(strategy);
      // the crop has the cell's proportion: the scale is uniform (≤ 0.2 % apart, the even rounding)
      expect(Math.abs(rectAspect(crop) / (cell.width / cell.height) - 1)).toBeLessThan(0.002);

      const m = clip.maxRect;
      // independent reference: the max scaled uniformly to cover the cell, centred, cut to the cell
      const coverHeight = Math.round((m.height * cell.width) / m.width);
      const coverWidth = Math.round((m.width * cell.height) / m.height);
      const uniform = coverHeight >= cell.height
        ? `crop=${m.width}:${m.height}:${m.x}:${m.y},scale=${cell.width}:${coverHeight}:flags=bicubic,crop=${cell.width}:${cell.height}:0:${Math.floor((coverHeight - cell.height) / 2)}`
        : `crop=${m.width}:${m.height}:${m.x}:${m.y},scale=${coverWidth}:${cell.height}:flags=bicubic,crop=${cell.width}:${cell.height}:${Math.floor((coverWidth - cell.width) / 2)}:0`;
      const cellPixels = region(frame, WIDTH, cell);
      // the render shows the planned crop (cut by ffmpeg directly and scaled to the cell)…
      const planned = meanAbsDiff(cellPixels, await sourceFrame(clip, `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${cell.width}:${cell.height}:flags=bicubic`));
      // …which is the max scaled uniformly (up to the 1 source px that the even crop may cut on one side only)
      const independent = meanAbsDiff(cellPixels, await sourceFrame(clip, uniform));
      const ctx = JSON.stringify({ clip: clip.id, cell, crop, strategy, planned, independent });
      expect(planned, ctx).toBeLessThan(2);
      expect(independent, ctx).toBeLessThan(6);
    }
  }, 120_000);
});
