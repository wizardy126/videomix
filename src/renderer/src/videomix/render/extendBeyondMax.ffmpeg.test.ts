// E7 (T38b): clips extended beyond their max rect, rendered with the real ffmpeg. Plans from the planner that leave fill
// without the extension (checked) and none with it, in 16:9 (columns) and 9:16 (rows), with a max near the source edge
// (asymmetric extension). Each column/row of a rendered frame is compared with the expected crop of the source (the
// planner's extended crop, cut and scaled by ffmpeg directly), so the extension shows real material, where it should.
// Skipped without the dev ffmpeg or the T02 media. With VIDEOMIX_EXTEND_FRAMES_DIR set, the frames (with and without
// the extension) are written there as PNG to review them by hand.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, test, expect, afterAll } from 'vitest';

import { getAspectRange, getCellRect, getExtendedCropForAspect } from '../geometry';
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
const framesDir = process.env['VIDEOMIX_EXTEND_FRAMES_DIR'];

const run = async (args: string[]) => (await execFileAsync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...args], { env, maxBuffer: 1e9, encoding: 'buffer' })).stdout;

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })));
});

// a plain colour that none of the test media has, so fill is easy to tell from material
const settings = testSettings({ fps: 30, gap: { width: 0, color: '#000000' }, fill: { mode: 'color', color: '#ff8000' }, fadeInOut: false, transition: { type: 'fade', duration: 0.5 } });
const DURATION = 3;
const SAMPLE_TIME = 1.5;

interface Case {
  name: string,
  width: number,
  height: number,
  clips: { id: string, sourceId: TestSourceId, maxRect: Rect }[],
  /** The clip whose max is near its source's edge: its extension starts at that edge. */
  asymmetric: string,
}

const cases: Case[] = [
  {
    // two 9:16 max rects of horizontal sources side by side: 202 + 202 of 640 px. The left one is 100 px from its
    // source's left edge, so its extension takes those 100 px and the rest on the right.
    name: '16:9 columns',
    width: 640,
    height: 360,
    clips: [
      { id: 'l', sourceId: 'h1080', maxRect: { x: 100, y: 0, width: 608, height: 1080 } },
      { id: 'r', sourceId: 'h720', maxRect: { x: 438, y: 0, width: 404, height: 720 } },
    ],
    asymmetric: 'l',
  },
  {
    // two horizontal bands (1.8:1) of a vertical source stacked: rows of 200 + 200 of 640 px. The bottom one is 100 px
    // from its source's top edge.
    name: '9:16 rows',
    width: 360,
    height: 640,
    clips: [
      { id: 't', sourceId: 'v1080', maxRect: { x: 0, y: 660, width: 1080, height: 600 } },
      { id: 'b', sourceId: 'v1080', maxRect: { x: 0, y: 100, width: 1080, height: 600 } },
    ],
    asymmetric: 'b',
  },
];

function plan(c: Case, extend: boolean) {
  const plannerClips = c.clips.map(({ id, sourceId, maxRect }): PlannerClip => ({
    id,
    duration: DURATION,
    aspectRange: getAspectRange(maxRect),
    rects: { maxRect },
    ...(extend && { extendBeyondMax: { frame: { width: testSources[sourceId].width, height: testSources[sourceId].height } } }),
  }));
  return planMix({ clips: plannerClips, settings: { width: c.width, height: c.height, maxColumns: 3, gap: 0, reorderWindow: 0, order: { mode: 'list', seed: 0 }, transitionDuration: 0.5 } });
}

const renderClips = (c: Case): RenderClip[] => c.clips.map(({ id, sourceId, maxRect }) => ({ id, sourceId, start: 0, maxRect }));

/** The frame at `time` of the rendered plan, as raw RGB. */
async function renderFrame(c: Case, p: MixPlan, time: number) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'videomix-extend-'));
  tempDirs.push(workDir);
  const outPath = path.join(workDir, 'out.mp4');
  const job = buildRenderJob({ plan: p, clips: renderClips(c), sourcePaths: testSourcePaths(mediaDir), settings, encoding: { preset: 'ultrafast', crf: 12 }, workDir, outPath, join: path.join });
  await Promise.all(job.files.map(async (f) => writeFile(f.path, f.content)));
  for (const chunk of job.chunks) await run(chunk.args);
  await run(job.audio.args);
  await run(job.concat.args);
  const raw = await run(['-i', outPath, '-vf', `select=eq(n\\,${Math.round(time * settings.fps)})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  if (framesDir != null) {
    await mkdir(framesDir, { recursive: true });
    await run(['-y', '-i', outPath, '-vf', `select=eq(n\\,${Math.round(time * settings.fps)})`, '-frames:v', '1', path.join(framesDir, `${c.name.replaceAll(/\W+/g, '-')}-${p.placements.some((pl) => pl.extendedMaxRect != null) ? 'extended' : 'before'}.png`)]);
  }
  return raw;
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

/** Share of the pixels of the fill colour (#ff8000). */
const fillShare = (raw: Buffer) => {
  let n = 0;
  for (let i = 0; i < raw.length; i += 3) if (raw[i]! > 220 && Math.abs(raw[i + 1]! - 128) < 30 && raw[i + 2]! < 40) n += 1;
  return n / (raw.length / 3);
};

describe.skipIf(!available)('extension beyond the max, rendered (E7)', () => {
  test.each(cases)('$name: the fill is real material of the source', async (c) => {
    const before = plan(c, false);
    const p = plan(c, true);
    const rows = getPlanAxis(p) === 'rows';
    expect(rows).toBe(c.height > c.width);
    // without the extension the layout leaves fill; with it, none, and some clip extends asymmetrically
    expect(before.layouts[0]!.fills.reduce((acc, f) => acc + f.width, 0), formatPlan(before)).toBeGreaterThan(100);
    expect(p.layouts[0]!.fills, formatPlan(p)).toEqual([]);
    const asymmetric = p.placements.find((pl) => pl.clipId === c.asymmetric)!.extendedMaxRect!;
    const max = c.clips.find((x) => x.id === c.asymmetric)!.maxRect;
    // 100 px on the near side, the rest on the other one
    expect(rows ? asymmetric.y : asymmetric.x).toBe(0);
    expect(rows ? asymmetric.y + asymmetric.height - max.y - max.height : asymmetric.x + asymmetric.width - max.x - max.width).toBeGreaterThan(100);

    const [frameBefore, frame] = await Promise.all([renderFrame(c, before, SAMPLE_TIME), renderFrame(c, p, SAMPLE_TIME)]);
    expect(fillShare(frameBefore)).toBeGreaterThan(0.1);
    expect(fillShare(frame)).toBeLessThan(0.001);

    // every cell shows exactly the extended crop of its source
    for (const col of p.layouts[0]!.columns) {
      const placement = p.placements.find((pl) => pl.column === col.column)!;
      const clip = c.clips.find((x) => x.id === placement.clipId)!;
      const cell = getCellRect(getPlanAxis(p), { offset: col.x, length: col.width }, p);
      const { crop, fit } = getExtendedCropForAspect(clip.maxRect, undefined, placement.extendedMaxRect, cell.width / cell.height);
      expect(fit).toBe('fill');
      const expected = await run([
        '-ss', String(SAMPLE_TIME), '-i', path.join(mediaDir, testSources[clip.sourceId].file), '-frames:v', '1',
        '-vf', `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${cell.width}:${cell.height}:flags=bicubic`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
      ]);
      const diff = meanAbsDiff(region(frame, c.width, cell), expected);
      expect(diff, `${clip.id} ${JSON.stringify(crop)}`).toBeLessThan(4);
      // and not the unextended crop stretched to the cell: the check tells them apart (the bars of the test media are
      // vertical, so a stretched row differs only in the moving line, the checkerboard and the timecode)
      const normal = getExtendedCropForAspect(clip.maxRect, undefined, undefined, cell.width / cell.height).crop;
      const unextended = await run([
        '-ss', String(SAMPLE_TIME), '-i', path.join(mediaDir, testSources[clip.sourceId].file), '-frames:v', '1',
        '-vf', `crop=${normal.width}:${normal.height}:${normal.x}:${normal.y},scale=${cell.width}:${cell.height}:flags=bicubic`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
      ]);
      const other = meanAbsDiff(region(frame, c.width, cell), unextended);
      expect(other).toBeGreaterThan(2.5 * diff);
    }
  }, 120_000);
});
