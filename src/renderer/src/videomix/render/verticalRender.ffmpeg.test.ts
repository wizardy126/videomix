// Vertical (9:16) and square (1:1) output (T29) rendered with the real ffmpeg: plans from the planner with animated
// re-layouts and overlays, and the hand-written test plans as rows. Checks the output with ffprobe (size, exact frame
// count) and that the gap between two rows is a horizontal bar across the whole width. Skipped when the dev ffmpeg,
// the T02 media (`yarn generate-test-media`) or the bundled font are missing. With VIDEOMIX_VERTICAL_FRAMES_DIR set,
// the videos and a few PNG frames (re-layouts and overlays) are also written there, to review them by hand.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, test, expect, afterAll } from 'vitest';

import { getAspectRange } from '../geometry';
import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay, createTextOverlay } from '../overlays/factories';
import { resolveOverlayTimes } from '../overlays/resolveOverlayTimes';
import { formatPlan } from '../planner/formatPlan';
import { planMix } from '../planner/planMix';
import type { MixPlan, PlannerClip } from '../planner/types';
import type { MixOverlay } from '../types';
import { buildRenderJob } from './buildRenderJob';
import type { RenderClip } from './buildVideoGraph';
import { scalePlan, testClips, testPlans, testSettings, testSourcePaths, testSources, toRowsPlan } from './renderTestFixtures';

const execFileAsync = promisify(execFile);

const ffDir = path.resolve('ffmpeg', `${os.platform()}-${os.arch()}`, ...(os.platform() === 'darwin' ? [] : ['lib']));
const exe = os.platform() === 'win32' ? '.exe' : '';
const ffmpegPath = path.join(ffDir, `ffmpeg${exe}`);
const ffprobePath = path.join(ffDir, `ffprobe${exe}`);
const mediaDir = path.resolve('test-media');
const fontPath = path.resolve('resources', 'fonts', 'OpenSans-Bold.ttf');
const logoPath = path.join(mediaDir, 'overlay-logo.png');
const available = existsSync(ffmpegPath) && existsSync(ffprobePath) && existsSync(fontPath) && existsSync(logoPath)
  && Object.values(testSources).every((s) => existsSync(path.join(mediaDir, s.file)));
const env = { ...process.env, LD_LIBRARY_PATH: ffDir };
const framesDir = process.env['VIDEOMIX_VERTICAL_FRAMES_DIR'];

const run = async (bin: string, args: string[]) => (await execFileAsync(bin, args, { env, maxBuffer: 1e9, encoding: 'buffer' })).stdout;

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })));
});

const GAP_COLOR = [0xFF, 0x00, 0xFF] as const;
const settings = testSettings({ fps: 25, gap: { width: 4, color: '#ff00ff' }, transition: { type: 'fade', duration: 0.5 } });

// Test clips with durations: horizontals (w* can be cropped wider, down to ~2.4:1, so two of them stack in a square),
// verticals and a square, so the planner has to re-layout
const durations: Record<string, number> = { a: 4, b: 5, c: 3, d: 3, e: 4, w1: 4, w2: 3, w3: 3 };
const clips: RenderClip[] = [
  ...testClips,
  { ...testClips.find((c) => c.id === 'a')!, id: 'w1', minRect: { x: 0, y: 140, width: 1920, height: 800 } },
  { ...testClips.find((c) => c.id === 'c')!, id: 'w2', minRect: { x: 0, y: 100, width: 1280, height: 520 } },
  { ...testClips.find((c) => c.id === 'a')!, id: 'w3', start: 5, minRect: { x: 0, y: 140, width: 1920, height: 800 } },
];
const plannerClips: PlannerClip[] = ['w1', 'w2', 'a', 'w3', 'c', 'b', 'e', 'd'].map((id) => {
  const { maxRect, minRect } = clips.find((c) => c.id === id)!;
  return { id, duration: durations[id]!, aspectRange: getAspectRange(maxRect, minRect), rects: { maxRect, minRect } };
});

function planFor(width: number, height: number) {
  return planMix({ clips: plannerClips, settings: { width, height, maxColumns: 3, gap: settings.gap.width, reorderWindow: 3, order: { mode: 'list', seed: 0 }, transitionDuration: settings.transition.duration } });
}

function getOverlays(): MixOverlay[] {
  return [
    { ...createTextOverlay({ id: 'text', name: 'text', start: 0.3, text: 'VideoMix\nvertical' }), duration: 4, box: { x: 0.1, y: 0.05, width: 0.8, height: 0.12 }, align: 'center', fontSize: 0.05 },
    { ...createImageOverlay({ id: 'logo', name: 'logo', start: 0, filePath: logoPath }), duration: 6, box: { x: 0.7, y: 0.8, width: 0.2, height: 0.1125 } },
    { ...createCountdownOverlay({ id: 'cd', name: 'cd', start: 1 }), duration: 5, box: { x: 0.05, y: 0.85, width: 0.4, height: 0.06 } },
    { ...createProgressBarOverlay({ id: 'bar', name: 'bar', start: 1, linkedCountdownId: 'cd' }), duration: 5, box: { x: 0.05, y: 0.93, width: 0.9, height: 0.02 } },
  ];
}

async function render(name: string, plan: MixPlan, { overlays = false }: { overlays?: boolean } = {}) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'videomix-vertical-'));
  tempDirs.push(workDir);
  const outPath = path.join(workDir, 'out.mp4');
  const mixOverlays = overlays ? getOverlays() : [];
  const job = buildRenderJob({
    plan,
    clips,
    sourcePaths: testSourcePaths(mediaDir),
    settings,
    encoding: { preset: 'ultrafast', crf: 18 },
    workDir,
    outPath,
    join: path.join,
    maxChunkSeconds: 3,
    ...(overlays && { overlays: { overlays: mixOverlays, times: resolveOverlayTimes({ overlays: mixOverlays, clips: [] }, plan), defaultFontPath: fontPath } }),
  });
  await Promise.all(job.files.map(async (f) => writeFile(f.path, f.content)));
  await Promise.all(job.chunks.map(async (c) => run(ffmpegPath, ['-loglevel', 'error', ...c.args])));
  await run(ffmpegPath, ['-loglevel', 'error', ...job.audio.args]);
  await run(ffmpegPath, ['-loglevel', 'error', ...job.concat.args]);
  const probe = JSON.parse((await run(ffprobePath, ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=width,height,nb_read_frames', '-of', 'json', outPath])).toString()) as {
    streams: { width: number, height: number, nb_read_frames: string }[],
  };
  expect(probe.streams[0]).toMatchObject({ width: plan.width, height: plan.height });
  expect(Number(probe.streams[0]!.nb_read_frames)).toBe(job.totalFrames);

  if (framesDir != null) {
    const dir = path.join(framesDir, name);
    await mkdir(dir, { recursive: true });
    await copyFile(outPath, path.join(dir, 'out.mp4'));
    await writeFile(path.join(dir, 'plan.txt'), formatPlan(plan));
    // the middle of every re-layout, plus a couple of stable frames
    const times = [0.2, ...plan.layouts.filter((l) => l.transitionDuration > 0).map((l) => l.time + l.transitionDuration / 2), plan.duration - 0.8];
    await Promise.all(times.map(async (t) => run(ffmpegPath, ['-v', 'error', '-y', '-ss', t.toFixed(3), '-i', outPath, '-frames:v', '1', path.join(dir, `frame-${t.toFixed(2)}.png`)])));
  }

  /** RGB24 pixels of the frame at `t`. */
  const frameAt = async (t: number) => run(ffmpegPath, ['-v', 'error', '-ss', t.toFixed(3), '-i', outPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return { job, frameAt };
}

/** The gap between the first two rows of the first layout is a magenta bar across the whole width. */
async function expectHorizontalGap(plan: MixPlan, frameAt: (t: number) => Promise<Buffer>) {
  const [first, second] = plan.layouts[0]!.columns;
  expect(first != null && second != null).toBe(true);
  const y = first!.x + first!.width + 1;
  const frame = await frameAt(0.6); // after the global fade in, before the first event
  const W = plan.width;
  for (let x = 4; x < W - 4; x += 8) {
    const i = (y * W + x) * 3;
    const px = [frame[i]!, frame[i + 1]!, frame[i + 2]!];
    expect(px.every((v, k) => Math.abs(v - GAP_COLOR[k]!) <= 60), `pixel ${x},${y}: ${px.join(',')}`).toBe(true);
  }
}

describe.skipIf(!available)('vertical and square render with ffmpeg (T29)', () => {
  test('9:16 plan with re-layouts and overlays: stacked rows, exact frames', async () => {
    const plan = planFor(180, 320);
    expect(plan.axis).toBe('rows');
    expect(plan.layouts.some((l) => l.transitionDuration > 0)).toBe(true);
    const { frameAt } = await render('9x16', plan, { overlays: true });
    await expectHorizontalGap(plan, frameAt);
  }, 120_000);

  test('1:1 plan with re-layouts and overlays: the wide clips stack, exact frames', async () => {
    const plan = planFor(240, 240);
    expect(plan.axis).toBe('rows');
    expect(plan.layouts.some((l) => l.transitionDuration > 0)).toBe(true);
    const { frameAt } = await render('1x1', plan, { overlays: true });
    await expectHorizontalGap(plan, frameAt);
  }, 120_000);

  test.each(['relayout', 'fills', 'removal'] as const)('test plan "%s" as rows', async (name) => {
    const plan = toRowsPlan(scalePlan(testPlans[name], 320, 180));
    expect(plan).toMatchObject({ width: 180, height: 320 });
    const { frameAt } = await render(`rows-${name}`, plan);
    // the scaled ADR example has no gap left, and the fills plan starts with a single row
    if (name === 'removal') await expectHorizontalGap(plan, frameAt);
  }, 120_000);
});
