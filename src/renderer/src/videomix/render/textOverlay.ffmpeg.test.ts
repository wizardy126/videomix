// Renders text overlays (T26) with the real ffmpeg at 640x360 and measures them on the frames: the text is found by
// diffing against the same render without overlays. Raw RGB output (no encoding), so the pixels are exact. Skipped when
// the dev ffmpeg, the T02 media (`yarn generate-test-media`) or the bundled font are missing. With
// VIDEOMIX_OVERLAY_FRAMES_DIR set, the checked frames are also written there as PNG.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';

import { createTextOverlay } from '../overlays/factories';
import { resolveOverlayTimes } from '../overlays/resolveOverlayTimes';
import type { MixPlan } from '../planner/types';
import type { TextOverlay } from '../types';
import { buildVideoGraph } from './buildVideoGraph';
import { getRenderChunks } from './renderChunks';
import { testClips, testSettings, testSourcePaths, testSources } from './renderTestFixtures';
import { getRenderTimeline } from './renderTimeline';

const execFileAsync = promisify(execFile);

const ffDir = path.resolve('ffmpeg', `${os.platform()}-${os.arch()}`, ...(os.platform() === 'darwin' ? [] : ['lib']));
const ffmpegPath = path.join(ffDir, `ffmpeg${os.platform() === 'win32' ? '.exe' : ''}`);
const mediaDir = path.resolve('test-media');
const fontPath = path.resolve('resources', 'fonts', 'OpenSans-Bold.ttf');
const available = existsSync(ffmpegPath) && existsSync(path.join(mediaDir, testSources.sq.file)) && existsSync(fontPath);
const env = { ...process.env, LD_LIBRARY_PATH: ffDir };
const framesDir = process.env['VIDEOMIX_OVERLAY_FRAMES_DIR'];

const W = 640;
const H = 360;
const fps = 30;

const plan: MixPlan = {
  width: W,
  height: H,
  duration: 3,
  placements: [{ clipId: 'd', column: 0, startTime: 0, endTime: 3, transitionIn: 0 }],
  layouts: [{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 220, width: 200 }], fills: [{ x: 0, width: 220 }, { x: 420, width: 220 }] }],
  warnings: [],
};
const settings = testSettings({ fps, gap: { width: 0, color: '#000000' }, fadeInOut: false, fill: { mode: 'color', color: '#202020' } });

const text = (id: string, props: Partial<TextOverlay>): TextOverlay => ({
  ...createTextOverlay({ id, name: id, start: 0, text: '' }),
  duration: 3,
  fadeIn: 0,
  fadeOut: 0,
  ...props,
});

// px boxes: multi = 32..288 × 18..~110, typewriter = 352..608 × 198.., slide = 32..288 × 216..
const multi = text('multi', { text: 'Line one\nA longer second line\nthird', align: 'right', fontSize: 0.06, lineSpacing: 0.3, box: { x: 0.05, y: 0.05, width: 0.4, height: 0.06 * 3.6 } });
const typewriter = text('tw', { text: 'Hello\nworld', align: 'center', fontSize: 0.08, box: { x: 0.55, y: 0.55, width: 0.4, height: 0.08 * 2.2 }, entry: { kind: 'typewriter', duration: 2 } });
const slide = text('slide', { text: 'Slide', align: 'left', fontSize: 0.08, box: { x: 0.05, y: 0.6, width: 0.4, height: 0.08 }, entry: { kind: 'slide', from: 'left', duration: 1 } });
const overlays = [multi, typewriter, slide];

let workDir: string;

beforeAll(async () => {
  if (!available) return;
  workDir = await mkdtemp(path.join(os.tmpdir(), 'videomix-texts-'));
});

afterAll(async () => {
  if (workDir != null) await rm(workDir, { recursive: true, force: true });
});

async function renderRaw({ maxChunkSeconds, withOverlays = true }: { maxChunkSeconds: number, withOverlays?: boolean }) {
  const tl = getRenderTimeline(plan, { fps, gap: 0, transitionDuration: settings.transition.duration });
  const times = resolveOverlayTimes({ overlays, clips: [] }, plan);
  const chunks = getRenderChunks(tl, { maxChunkSeconds });
  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    const graph = buildVideoGraph({ timeline: tl, clips: testClips, sourcePaths: testSourcePaths(mediaDir), settings, chunk, ...(withOverlays && { overlays: { overlays, times, defaultFontPath: fontPath } }) });
    const graphPath = path.join(workDir, `graph-${chunk.index}.txt`);
    // eslint-disable-next-line no-await-in-loop
    await writeFile(graphPath, graph.filterComplex);
    // eslint-disable-next-line no-await-in-loop
    const { stdout } = await execFileAsync(ffmpegPath, ['-v', 'error', '-nostdin', ...graph.inputs.flat(), '-/filter_complex', graphPath, '-map', `[${graph.outLabel}]`, '-frames:v', String(graph.frames), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { env, encoding: 'buffer', maxBuffer: 1e9 });
    expect(stdout.length).toBe(graph.frames * W * H * 3);
    buffers.push(stdout);
  }
  const all = Buffer.concat(buffers);
  return { chunks, frame: (f: number) => all.subarray(f * W * H * 3, (f + 1) * W * H * 3) };
}

interface Region { x0: number, y0: number, x1: number, y1: number }

/** Pixels of `region` changed by the overlays (the text, its border and its antialiasing). */
function textMask(withText: Buffer, plain: Buffer, { x0, y0, x1, y1 }: Region) {
  const points: { x: number, y: number }[] = [];
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * W + x) * 3;
      if (Math.max(Math.abs(withText[i]! - plain[i]!), Math.abs(withText[i + 1]! - plain[i + 1]!), Math.abs(withText[i + 2]! - plain[i + 2]!)) > 40) points.push({ x, y });
    }
  }
  return points;
}

const bounds = (points: { x: number, y: number }[]) => ({
  minX: Math.min(...points.map((p) => p.x)),
  maxX: Math.max(...points.map((p) => p.x)),
  minY: Math.min(...points.map((p) => p.y)),
  maxY: Math.max(...points.map((p) => p.y)),
});

async function savePng(name: string, frame: Buffer) {
  if (framesDir == null) return;
  await mkdir(framesDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', '-', '-frames:v', '1', path.join(framesDir, `${name}.png`)], { env });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
    p.stdin.end(frame);
  });
}

describe.skipIf(!available)('text overlays with ffmpeg', () => {
  test('multi-line alignment, typewriter and slide, exact across chunk cuts', async () => {
    const single = await renderRaw({ maxChunkSeconds: 60 });
    const chunked = await renderRaw({ maxChunkSeconds: 1 });
    const plain = await renderRaw({ maxChunkSeconds: 60, withOverlays: false });

    // Multi-line, right-aligned: three bands of lines (22 px letters, 6.6 px apart), each ending at the box's right
    // edge (288 px, +1 px border), and nothing outside the box
    const multiRegion = { x0: 0, y0: 0, x1: 330, y1: 150 };
    const multiMask = textMask(single.frame(45), plain.frame(45), multiRegion);
    const multiBounds = bounds(multiMask);
    expect(multiBounds.maxX).toBeGreaterThanOrEqual(284);
    expect(multiBounds.maxX).toBeLessThanOrEqual(291);
    expect(multiBounds.minY).toBeGreaterThanOrEqual(14);
    expect(multiBounds.maxY).toBeLessThanOrEqual(18 + 78 + 6);
    const lineCenters = [18 + 11, 18 + 11 + 28.6, 18 + 11 + 57.2];
    lineCenters.forEach((center, i) => {
      const line = multiMask.filter((p) => Math.abs(p.y - center) < 8);
      expect(line.length, `line ${i}`).toBeGreaterThan(20);
      expect(bounds(line).maxX, `line ${i}`).toBeGreaterThanOrEqual(284);
    });
    // the second line is the longest: it starts further left than the others
    const lineMinX = lineCenters.map((center) => bounds(multiMask.filter((p) => Math.abs(p.y - center) < 8)).minX);
    expect(lineMinX[1]).toBeLessThan(lineMinX[0]!);
    expect(lineMinX[1]).toBeLessThan(lineMinX[2]!);

    // Typewriter (10 characters in 60 frames, centered): frame 41 shows 7 ("Hello" + "wo"), in their final place
    const twRegion = { x0: 330, y0: 170, x1: 640, y1: 300 };
    const twFull = textMask(single.frame(75), plain.frame(75), twRegion);
    const twMid = textMask(single.frame(41), plain.frame(41), twRegion);
    const twFirst = textMask(single.frame(0), plain.frame(0), twRegion);
    expect(twFirst.length).toBe(0); // nothing on its first frame (floor(1·10/60) = 0)
    expect(twMid.length).toBeGreaterThan(50);
    expect(twMid.length).toBeLessThan(twFull.length * 0.85);
    const fullSet = new Set(twFull.map((p) => p.y * W + p.x));
    // revealed in place: (nearly) every pixel of the partial text is a pixel of the whole text
    expect(twMid.filter((p) => !fullSet.has(p.y * W + p.x)).length).toBeLessThan(twMid.length * 0.02);
    // second line: only its left part
    const secondLineY = (y: number) => y > 198 + 29 + 3;
    const midSecond = bounds(twMid.filter((p) => secondLineY(p.y)));
    const fullSecond = bounds(twFull.filter((p) => secondLineY(p.y)));
    expect(Math.abs(midSecond.minX - fullSecond.minX)).toBeLessThanOrEqual(1);
    expect(midSecond.maxX).toBeLessThan(fullSecond.maxX - 20);

    // Slide from the left (1 s, ease-out cubic): at frame 15 it is 1/8 of the way out,
    // (box right 288 + margin 29 + 1 + 0) / 8 ≈ 39.75 px to the left of its final place
    const slideRegion = { x0: 0, y0: 200, x1: 330, y1: 300 };
    const slideEnd = bounds(textMask(single.frame(45), plain.frame(45), slideRegion));
    const slideMid = bounds(textMask(single.frame(15), plain.frame(15), slideRegion));
    expect(slideEnd.minX).toBeGreaterThanOrEqual(29);
    expect(slideEnd.minX).toBeLessThanOrEqual(34);
    // (its left edge is already cut by the frame: measured on the right edge)
    expect(slideEnd.maxX - slideMid.maxX).toBeGreaterThanOrEqual(38);
    expect(slideEnd.maxX - slideMid.maxX).toBeLessThanOrEqual(42);
    expect(slideMid.minY).toBe(slideEnd.minY);
    // fully outside the frame on its first frame
    expect(textMask(single.frame(0), plain.frame(0), slideRegion).length).toBe(0);

    // the chunked render draws the same texts at every frame (outside the video column)
    for (let f = 0; f < 90; f += 1) {
      const a = single.frame(f);
      const b = chunked.frame(f);
      let maxDiff = 0;
      for (let y = 0; y < H; y += 1) {
        for (const [x0, x1] of [[0, 220], [420, 640]] as const) {
          for (let x = x0; x < x1; x += 1) {
            const i = (y * W + x) * 3;
            for (let c = 0; c < 3; c += 1) maxDiff = Math.max(maxDiff, Math.abs(a[i + c]! - b[i + c]!));
          }
        }
      }
      expect(maxDiff, `frame ${f}`).toBe(0);
    }

    await savePng('text-multiline', single.frame(45));
    await savePng('text-typewriter-mid', single.frame(41));
    await savePng('text-slide-mid', single.frame(15));
    await savePng('text-slide-early', single.frame(5));
  }, 120_000);
});
