/* eslint-disable no-console, no-continue, no-mixed-operators, unicorn/no-process-exit */
// T48 mini-spike (ADR-003): technique for an animated crop (pan + zoom with a fixed proportion, A9) in the render.
// ffmpeg's `crop` can't change its output size per frame, so the candidates are:
// - "layer": the column layer of ADR-001 (fixed crop of the union U → scale eval=frame → overlay on a fixed base), with
//   the per-frame crops rounded to even source px like the pipeline's rects (`layer-even`) or real-valued (`layer`);
// - "perspective": fixed crop U → perspective (sense=source, eval=frame: the four corners of C(t) inside U, sub-pixel)
//   → fixed scale to the cell (`persp-linear`, `persp-cubic`), optionally pre-scaled so that U is never larger than the
//   cell needs at the most zoomed frame (`persp-pre`);
// - "crop-after-scale": fixed crop U → scale eval=frame → crop w×h at per-frame x/y (checks whether crop takes the
//   variable-size frames).
// zoompan is ruled out without measuring: its crop always has the input's proportion (iw/zoom × ih/zoom), not the cell's.
//
// Accuracy: a static synthetic source with four white dots; per output frame the centroid of each dot is compared with
// its exact position (P − C.xy)·cell.w/C.w. Speed: decode + filters only (-f null), 1080p testsrc2 source (T02 media).
//
// Usage (repo root): node script/videomix/spike/keyframeSpike.ts [cellW cellH]   (default 1280 720)
// Outputs in test-media/spike-out/keyframes/ (git-ignored).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const ffDir = join('ffmpeg', `${os.platform()}-${os.arch()}`, 'lib');
const ffmpegPath = process.env['FFMPEG_PATH'] ?? join(ffDir, 'ffmpeg');
const ffEnv = { ...process.env, LD_LIBRARY_PATH: ffDir };
const outDir = join('test-media', 'spike-out', 'keyframes');
mkdirSync(outDir, { recursive: true });

interface Rect { x: number, y: number, width: number, height: number }

const FPS = 30;
const FRAMES = 90;
const SRC_W = 1920;
const SRC_H = 1080;
const cellW = Number(process.argv[2] ?? 1280);
const cellH = Number(process.argv[3] ?? 720);
const aspect = cellW / cellH;

const roundEven = (v: number) => 2 * Math.round(v / 2) + 0;
const ceilEven = (v: number) => 2 * Math.ceil(v / 2 - 1e-6) + 0;
const floorEven = (v: number) => 2 * Math.floor(v / 2 + 1e-6) + 0;
const smooth = (u: number) => u * u * (3 - 2 * u);

// Animation: 1.5 s of a slow linear pan (30 source px), then 1.5 s of a smooth zoom-in to half the size.
function cropAt(m: number): Rect {
  const t = m / FPS;
  const w0 = 1600;
  if (t <= 1.5) {
    const x = 100 + 30 * (t / 1.5);
    return { x, y: 90 + (w0 / aspect - 900) * 0, width: w0, height: w0 / aspect };
  }
  const u = smooth((t - 1.5) / 1.5);
  const cx = 130 + w0 / 2 + u * (960 - (130 + w0 / 2));
  const cy = 90 + w0 / aspect / 2 + u * (540 - (90 + w0 / aspect / 2));
  const w = w0 + u * (800 - w0);
  return { x: cx - w / 2, y: cy - w / aspect / 2, width: w, height: w / aspect };
}

/** Even rect like getRectsForTransform: even size and even origin around the same centre. */
function evenRect(r: Rect): Rect {
  const width = roundEven(r.width);
  const height = roundEven(r.height);
  return { x: roundEven(r.x + r.width / 2 - width / 2), y: roundEven(r.y + r.height / 2 - height / 2), width, height };
}

const crops = Array.from({ length: FRAMES }, (_v, m) => cropAt(m));

let bounds = { width: SRC_W, height: SRC_H };

function unionOf(rects: Rect[]): Rect {
  const x = floorEven(Math.min(...rects.map((r) => r.x)));
  const y = floorEven(Math.min(...rects.map((r) => r.y)));
  const x1 = Math.min(bounds.width, ceilEven(Math.max(...rects.map((r) => r.x + r.width))));
  const y1 = Math.min(bounds.height, ceilEven(Math.max(...rects.map((r) => r.y + r.height))));
  return { x, y, width: x1 - x, height: y1 - y };
}

/** Flat sum of steps over `variable` (t: time, in: frame index), ADR-001. */
function steps(values: number[], variable: 't' | 'in') {
  const terms = [String(values[0]!)];
  for (let m = 1; m < values.length; m += 1) {
    const d = values[m]! - values[m - 1]!;
    const at = variable === 't' ? ((m - 0.5) / FPS).toFixed(6) : String(m + 1); // perspective's `in` counts from 1
    if (Math.abs(d) > 1e-9) terms.push(`${d > 0 ? '+' : ''}${Number(d.toFixed(4))}*gte(${variable},${at})`);
  }
  return terms.length > 1 ? `'${terms.join('')}'` : terms[0]!;
}

const head = `fps=${FPS}:start_time=0,trim=end_frame=${FRAMES},setpts=PTS-STARTPTS`;

function layerGraph(rects: Rect[]) {
  const U = unionOf(rects);
  const sw: number[] = [];
  const sh: number[] = [];
  const ox: number[] = [];
  const oy: number[] = [];
  for (const c of rects) {
    const sx = cellW / c.width;
    const sy = cellH / c.height;
    sw.push(Math.max(2, ceilEven(U.width * sx)));
    sh.push(Math.max(2, ceilEven(U.height * sy)));
    ox.push(roundEven(-(c.x - U.x) * sx));
    oy.push(roundEven(-(c.y - U.y) * sy));
  }
  return `[0:v]${head},crop=${U.width}:${U.height}:${U.x}:${U.y},scale=w=${steps(sw, 't')}:h=${steps(sh, 't')}:eval=frame:flags=bicubic,setsar=1[sc];`
    + `color=c=black:s=${cellW}x${cellH}:r=${FPS}:d=${FRAMES / FPS + 1}[base];`
    + `[base][sc]overlay=x=${steps(ox, 't')}:y=${steps(oy, 't')}:eval=frame:shortest=1[out]`;
}

function perspectiveGraph(rects: Rect[], interpolation: 'linear' | 'cubic', prescale: boolean) {
  const U = unionOf(rects);
  // never larger than the most zoomed frame needs (never upscaled here: the final scale does it)
  const k = prescale ? Math.min(1, Math.max(...rects.map((c) => cellW / c.width))) : 1;
  const pw = k < 1 ? ceilEven(U.width * k) : U.width;
  const ph = k < 1 ? ceilEven(U.height * k) : U.height;
  const kx = pw / U.width;
  const ky = ph / U.height;
  const corner = (fn: (c: Rect) => number) => steps(rects.map((c) => Number(fn(c).toFixed(3))), 'in');
  const x0 = corner((c) => (c.x - U.x) * kx);
  const y0 = corner((c) => (c.y - U.y) * ky);
  const x1 = corner((c) => (c.x + c.width - U.x) * kx);
  const y2 = corner((c) => (c.y + c.height - U.y) * ky);
  const pre = k < 1 ? `,scale=${pw}:${ph}:flags=bicubic` : '';
  return `[0:v]${head},crop=${U.width}:${U.height}:${U.x}:${U.y}${pre},`
    + `perspective=x0=${x0}:y0=${y0}:x1=${x1}:y1=${y0}:x2=${x0}:y2=${y2}:x3=${x1}:y3=${y2}:interpolation=${interpolation}:sense=source:eval=frame,`
    + `scale=${cellW}:${cellH}:flags=bicubic,setsar=1[out]`;
}

function cropAfterScaleGraph(rects: Rect[]) {
  const U = unionOf(rects);
  const s = rects.map((c) => cellW / c.width);
  const sw = s.map((v) => ceilEven(U.width * v));
  const sh = s.map((v) => ceilEven(U.height * v));
  const x = rects.map((c, m) => Math.round((c.x - U.x) * s[m]!));
  const y = rects.map((c, m) => Math.round((c.y - U.y) * s[m]!));
  return `[0:v]${head},crop=${U.width}:${U.height}:${U.x}:${U.y},scale=w=${steps(sw, 't')}:h=${steps(sh, 't')}:eval=frame:flags=bicubic,`
    + `crop=w=${cellW}:h=${cellH}:x=${steps(x, 't')}:y=${steps(y, 't')}:exact=1,setsar=1[out]`;
}

const techniques: Record<string, () => string> = {
  'layer-even': () => layerGraph(crops.map((c) => evenRect(c))),
  layer: () => layerGraph(crops),
  'persp-linear': () => perspectiveGraph(crops, 'linear', false),
  'persp-cubic': () => perspectiveGraph(crops, 'cubic', false),
  'persp-pre': () => perspectiveGraph(crops, 'linear', true),
  'crop-after-scale': () => cropAfterScaleGraph(crops),
};

function ff(args: string[]) {
  const start = process.hrtime.bigint();
  const res = spawnSync(ffmpegPath, ['-hide_banner', '-nostdin', '-y', ...args], { env: ffEnv, maxBuffer: 2e9 });
  const sec = Number(process.hrtime.bigint() - start) / 1e9;
  if (res.status !== 0) throw new Error(`ffmpeg failed: ${res.stderr.toString().slice(-2000)}`);
  return { stdout: res.stdout, stderr: res.stderr.toString(), sec };
}

// four 12x12 white dots on black, static, lossless
const DOTS = [[500, 300], [1400, 300], [500, 800], [1400, 800]] as const;
const dotsPath = join(outDir, 'dots.mp4');
if (!existsSync(dotsPath)) {
  const boxes = DOTS.map(([x, y]) => `drawbox=x=${x - 6}:y=${y - 6}:w=12:h=12:c=white:t=fill`).join(',');
  ff(['-f', 'lavfi', '-i', `color=c=black:s=${SRC_W}x${SRC_H}:r=${FPS}:d=4,${boxes}`, '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', dotsPath]);
}
const benchSource = join('test-media', 'h-1080p-10s.mp4');

function measureAccuracy(name: string, graph: string) {
  const graphPath = join(outDir, `${name}-${cellW}x${cellH}.graph.txt`);
  writeFileSync(graphPath, graph);
  const { stdout } = ff(['-i', dotsPath, '-/filter_complex', graphPath, '-map', '[out]', '-frames:v', String(FRAMES), '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  const frameSize = cellW * cellH;
  const errs: number[][] = []; // per frame: mean error vector (x, y) over the dots, and the max distance
  let maxErr = 0;
  let sumErr = 0;
  let count = 0;
  for (let m = 0; m < FRAMES; m += 1) {
    const frame = stdout.subarray(m * frameSize, (m + 1) * frameSize);
    const c = crops[m]!;
    const s = cellW / c.width;
    let ex = 0;
    let ey = 0;
    let n = 0;
    for (const [px, py] of DOTS) {
      const exX = (px - c.x) * s;
      const exY = (py - c.y) * s;
      if (exX < 30 || exY < 30 || exX > cellW - 30 || exY > cellH - 30) continue;
      let wsum = 0;
      let cx = 0;
      let cy = 0;
      for (let y = Math.floor(exY - 25); y <= exY + 25; y += 1) {
        for (let x = Math.floor(exX - 25); x <= exX + 25; x += 1) {
          const v = frame[y * cellW + x]! - 40;
          if (v > 0) {
            wsum += v;
            cx += v * (x + 0.5);
            cy += v * (y + 0.5);
          }
        }
      }
      const dx = cx / wsum - exX;
      const dy = cy / wsum - exY;
      const d = Math.hypot(dx, dy);
      maxErr = Math.max(maxErr, d);
      sumErr += d;
      count += 1;
      ex += dx;
      ey += dy;
      n += 1;
    }
    if (n > 0) errs.push([ex / n, ey / n]);
  }
  // jitter: RMS of the frame-to-frame change of the error (what the eye sees as judder in a smooth move)
  let jitter = 0;
  for (let m = 1; m < errs.length; m += 1) jitter += (errs[m]![0]! - errs[m - 1]![0]!) ** 2 + (errs[m]![1]! - errs[m - 1]![1]!) ** 2;
  return { meanErr: sumErr / count, maxErr, jitter: Math.sqrt(jitter / (errs.length - 1)) };
}

function measureSpeed(name: string, graph: string) {
  const graphPath = join(outDir, `${name}-${cellW}x${cellH}.bench.graph.txt`);
  writeFileSync(graphPath, graph);
  // baseline cost of decoding: subtracted to get the filter cost
  const runs = [0, 1, 2].map(() => ff(['-i', benchSource, '-/filter_complex', graphPath, '-map', '[out]', '-frames:v', String(FRAMES), '-f', 'null', '-']).sec);
  return Math.min(...runs);
}

const baselineGraph = join(outDir, 'baseline.graph.txt');
writeFileSync(baselineGraph, `[0:v]${head},crop=1600:900:100:90,scale=${cellW}:${cellH}:flags=bicubic,setsar=1[out]`);
const baseline = Math.min(...[0, 1, 2].map(() => ff(['-i', benchSource, '-/filter_complex', baselineGraph, '-map', '[out]', '-frames:v', String(FRAMES), '-f', 'null', '-']).sec));
console.log(`cell ${cellW}x${cellH}, ${FRAMES} frames; static crop+scale (baseline): ${baseline.toFixed(2)} s`);

for (const [name, build] of Object.entries(techniques)) {
  const graph = build();
  try {
    const acc = measureAccuracy(name, graph);
    const sec = measureSpeed(name, graph);
    console.log(`${name.padEnd(17)} wall ${sec.toFixed(2)} s (+${((sec - baseline) * 1000 / FRAMES).toFixed(1)} ms/frame vs static)  `
      + `error mean ${acc.meanErr.toFixed(2)} px, max ${acc.maxErr.toFixed(2)} px, jitter ${acc.jitter.toFixed(2)} px  graph ${graph.length} chars`);
  } catch (err) {
    console.log(`${name.padEnd(17)} FAILED: ${(err as Error).message.split('\n').slice(-3).join(' | ')}`);
  }
}

// Encoding for scale: the same static baseline with x264 medium (what every render chunk pays anyway)
const enc = Math.min(...[0, 1].map(() => ff(['-i', benchSource, '-/filter_complex', baselineGraph, '-map', '[out]', '-frames:v', String(FRAMES), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-f', 'null', '-']).sec));
console.log(`static crop+scale + x264 medium: ${enc.toFixed(2)} s (${(enc * 1000 / FRAMES).toFixed(1)} ms/frame)`);

// 4K source (the same animation at twice the size): the perspective's cost follows the size of the union it works on
const src4k = join(outDir, 'src-2160p.mp4');
if (!existsSync(src4k)) ff(['-f', 'lavfi', '-i', `testsrc2=s=3840x2160:r=${FPS}:d=4`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', src4k]);
bounds = { width: 3840, height: 2160 };
const crops4k = crops.map((c) => ({ x: c.x * 2, y: c.y * 2, width: c.width * 2, height: c.height * 2 }));
const bench4k = (graph: string) => {
  const graphPath = join(outDir, `bench4k-${cellW}x${cellH}.graph.txt`);
  writeFileSync(graphPath, graph);
  return Math.min(...[0, 1].map(() => ff(['-i', src4k, '-/filter_complex', graphPath, '-map', '[out]', '-frames:v', String(FRAMES), '-f', 'null', '-']).sec));
};
const base4k = bench4k(`[0:v]${head},crop=3200:1800:200:180,scale=${cellW}:${cellH}:flags=bicubic,setsar=1[out]`);
console.log(`4K source: static ${base4k.toFixed(2)} s`);
for (const [name, graph] of [['layer', layerGraph(crops4k)], ['persp-linear', perspectiveGraph(crops4k, 'linear', false)], ['persp-pre', perspectiveGraph(crops4k, 'linear', true)]] as const) {
  const sec = bench4k(graph);
  console.log(`4K ${name.padEnd(14)} wall ${sec.toFixed(2)} s (+${((sec - base4k) * 1000 / FRAMES).toFixed(1)} ms/frame vs static)`);
}
process.exit(0);
