// Renders overlays with the real ffmpeg at 320x180 and measures the frames (T20). The chunk graphs are run to raw RGB
// (no encoding), so the pixels are exact. Skipped when the dev ffmpeg, the T02 media (`yarn generate-test-media`) or the
// bundled font are missing. With VIDEOMIX_OVERLAY_FRAMES_DIR set, the checked frames are also written there as PNG.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';

import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay } from '../overlays/factories';
import { resolveOverlayTimes } from '../overlays/resolveOverlayTimes';
import type { MixPlan } from '../planner/types';
import type { MixOverlay } from '../types';
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

const W = 320;
const H = 180;
const fps = 30;

/** Stable 3 s plan: a rigid square in a column [100, 220) between colour fills, so the overlays lie on plain colour. */
const plan: MixPlan = {
  width: W,
  height: H,
  duration: 3,
  placements: [{ clipId: 'd', column: 0, startTime: 0, endTime: 3, transitionIn: 0 }],
  layouts: [{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 100, width: 120 }], fills: [{ x: 0, width: 100 }, { x: 220, width: 100 }] }],
  warnings: [],
};
const FILL = [0x20, 0x20, 0x20] as const;
const settings = testSettings({ fps, gap: { width: 0, color: '#000000' }, fadeInOut: false, fill: { mode: 'color', color: '#202020' } });

let workDir: string;
let pngPath: string;

beforeAll(async () => {
  if (!available) return;
  workDir = await mkdtemp(path.join(os.tmpdir(), 'videomix-overlays-'));
  // 64x64 PNG: left half opaque green, right half fully transparent
  pngPath = path.join(workDir, 'half.png');
  await execFileAsync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xff000000:s=64x64,format=rgba,drawbox=x=0:y=0:w=32:h=64:color=0x00ff00ff:t=fill:replace=1', '-frames:v', '1', pngPath], { env });
});

afterAll(async () => {
  if (workDir != null) await rm(workDir, { recursive: true, force: true });
});

function getOverlays(): MixOverlay[] {
  // left fill: image (px 10,20 80x40) and a bar (px 10,140 80x16); right fill: a countdown and a vertical bar
  const image = { ...createImageOverlay({ id: 'img', name: 'img', start: 0.5, filePath: pngPath }), duration: 2, fadeIn: 0.4, fadeOut: 0.5, box: { x: 10 / W, y: 20 / H, width: 80 / W, height: 40 / H } };
  const countdown = {
    ...createCountdownOverlay({ id: 'cd', name: 'cd', start: 0 }),
    duration: 2.5,
    decimals: 1 as const,
    box: { x: 230 / W, y: 20 / H, width: 80 / W, height: 24 / H },
  };
  const bar = {
    ...createProgressBarOverlay({ id: 'bar', name: 'bar', start: 0.5 }),
    duration: 2,
    fillColor: '#ff0000',
    backgroundColor: '#0000ff',
    border: { width: 0, color: '#000000' },
    box: { x: 10 / W, y: 140 / H, width: 80 / W, height: 16 / H },
  };
  // 20x80 px, emptying downwards, 1 px white border (6 reference px at 180 px)
  const vbar = {
    ...createProgressBarOverlay({ id: 'vbar', name: 'vbar', start: 0.5 }),
    duration: 2,
    fillColor: '#00ff00',
    backgroundColor: '#0000ff',
    border: { width: 6, color: '#ffffff' },
    direction: 'btt' as const,
    mode: 'empty' as const,
    box: { x: 250 / W, y: 90 / H, width: 20 / W, height: 80 / H },
  };
  return [image, countdown, bar, vbar];
}

/** Renders the plan (all chunks, `maxChunkSeconds`) to raw RGB24 frames, with or without the overlays. */
async function renderRaw({ maxChunkSeconds, withOverlays = true }: { maxChunkSeconds: number, withOverlays?: boolean }) {
  const tl = getRenderTimeline(plan, { fps, gap: 0, transitionDuration: settings.transition.duration });
  const overlays = getOverlays();
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

const pixel = (frame: Buffer, x: number, y: number) => {
  const i = (y * W + x) * 3;
  return [frame[i]!, frame[i + 1]!, frame[i + 2]!] as const;
};

const near = (a: readonly number[], b: readonly number[], tolerance: number) => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);

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

describe.skipIf(!available)('overlays with ffmpeg', () => {
  test('PNG, countdown and bars, exact across chunk cuts', async () => {
    const single = await renderRaw({ maxChunkSeconds: 60 });
    const chunked = await renderRaw({ maxChunkSeconds: 1 });
    expect(single.chunks).toHaveLength(1);
    const cuts = chunked.chunks.slice(1).map((c) => c.f0);
    // cuts inside the overlays' time
    expect(cuts.some((f) => f > 15 && f < 75)).toBe(true);

    // PNG at mid fade-in (frame 21 = 0.2 s of a 0.4 s fade): left half ≈ ½ green + ½ fill, right half transparent
    const midFade = single.frame(21);
    const half = FILL.map((v, i) => (v + [0, 255, 0][i]!) / 2);
    expect(near(pixel(midFade, 30, 40), half, 10), `mid fade ${pixel(midFade, 30, 40).join(',')}`).toBe(true);
    expect(near(pixel(midFade, 70, 40), FILL, 3)).toBe(true);
    expect(near(pixel(single.frame(45), 30, 40), [0, 255, 0], 12)).toBe(true);
    expect(near(pixel(single.frame(14), 30, 40), FILL, 3)).toBe(true); // before it starts
    expect(near(pixel(single.frame(75), 30, 40), FILL, 3)).toBe(true); // after it ends

    // countdown (frames [0, 75)): white text inside its box, nothing outside it
    const brightIn = (frame: Buffer, x0: number, y0: number, x1: number, y1: number) => {
      let n = 0;
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) if (Math.min(...pixel(frame, x, y)) > 200) n += 1;
      return n;
    };
    const nearZero = single.frame(72); // 3 frames left: "0.1"
    expect(brightIn(nearZero, 230, 20, 310, 44)).toBeGreaterThan(20);
    expect(brightIn(nearZero, 220, 0, 320, 18) + brightIn(nearZero, 220, 46, 250, 90)).toBe(0);
    expect(brightIn(single.frame(75), 230, 20, 310, 44)).toBe(0); // gone at 0

    // bar at 50 % (frame 45 = 30 of its 60 frames): 40 of 80 px red, the rest blue background
    const barMid = single.frame(45);
    const red = Array.from({ length: 80 }, (_v, i) => pixel(barMid, 10 + i, 148)).filter((p) => p[0] > 180 && p[2] < 80).length;
    expect(red).toBeGreaterThanOrEqual(39);
    expect(red).toBeLessThanOrEqual(41);
    expect(near(pixel(barMid, 80, 148), [0, 0, 255], 40)).toBe(true);
    // vertical bar, emptying downwards: 39 of its 78 inner px green, at the bottom
    const green = Array.from({ length: 78 }, (_v, i) => pixel(barMid, 260, 91 + i)).filter((p) => p[1] > 180 && p[0] < 80).length;
    expect(green).toBeGreaterThanOrEqual(38);
    expect(green).toBeLessThanOrEqual(40);
    expect(pixel(barMid, 260, 165)[1]).toBeGreaterThan(180);
    expect(Math.min(...pixel(barMid, 250, 130))).toBeGreaterThan(180); // white border

    // the chunked render draws the same overlays at every frame (the fills under them are plain colour)
    for (let f = 0; f < 90; f += 1) {
      const a = single.frame(f);
      const b = chunked.frame(f);
      let maxDiff = 0;
      for (let y = 0; y < H; y += 1) {
        for (const [x0, x1] of [[0, 100], [220, 320]] as const) {
          for (let x = x0; x < x1; x += 1) {
            const i = (y * W + x) * 3;
            for (let c = 0; c < 3; c += 1) maxDiff = Math.max(maxDiff, Math.abs(a[i + c]! - b[i + c]!));
          }
        }
      }
      expect(maxDiff, `frame ${f}`).toBe(0);
    }

    // and without overlays the same areas are plain fill
    const plain = await renderRaw({ maxChunkSeconds: 60, withOverlays: false });
    expect(near(pixel(plain.frame(45), 30, 40), FILL, 3)).toBe(true);

    await savePng('png-mid-fade', midFade);
    await savePng('countdown-near-zero', nearZero);
    await savePng('bar-half', barMid);
    for (const cut of cuts) {
      // eslint-disable-next-line no-await-in-loop
      await savePng(`chunk-cut-${cut - 1}`, chunked.frame(cut - 1));
      // eslint-disable-next-line no-await-in-loop
      await savePng(`chunk-cut-${cut}`, chunked.frame(cut));
    }
  }, 120_000);
});
