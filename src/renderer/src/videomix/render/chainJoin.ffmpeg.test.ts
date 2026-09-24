// Audio of a direct cut between two clips of a column (a chain with `links.transition: 'cut'`, E2, T39) with the real
// ffmpeg: the join is a few-ms crossfade (CUT_CROSSFADE) instead of two separate de-click fades, so the level doesn't
// drop at the cut. Measured on white noise in 5 ms windows around the cut: consecutive clips of the same source
// (linear crossfade of the same audio) and clips of different moments (equal power). As a control, the same clips 1 ms
// apart (not a cut: two separate de-click fades) do dip. Skipped when the dev ffmpeg is missing.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';

import type { ColumnPlacement, MixPlan } from '../planner/types';
import type { LoudnessMeasurement, MixClip, MixSettings } from '../types';
import { createEmptyMixProject } from '../types';
import { AUDIO_SAMPLE_RATE, CUT_CROSSFADE, buildAudioGraph } from './buildAudioGraph';

const execFileAsync = promisify(execFile);

const ffDir = path.resolve('ffmpeg', `${os.platform()}-${os.arch()}`, ...(os.platform() === 'darwin' ? [] : ['lib']));
const ffmpegPath = path.join(ffDir, `ffmpeg${os.platform() === 'win32' ? '.exe' : ''}`);
const available = existsSync(ffmpegPath);
const env = { ...process.env, LD_LIBRARY_PATH: ffDir };

// Loudness "measured" at the target: no normalization gain, the noise plays as it is (well under the limiter)
const atTarget: LoudnessMeasurement = { hasAudio: true, inputI: -16, inputTp: -10, inputLra: 1, inputThresh: -26 };
const CUT = 3;
const WINDOW = 0.005;

const settings: MixSettings = { ...createEmptyMixProject().settings, fadeInOut: false, transition: { type: 'fade', duration: 0.5 } };
const clip = (id: string, start: number, end: number): MixClip => ({ id, sourceId: 's', name: id, color: 0, start, end, maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, muted: false, gainDb: 0 });
const place = (clipId: string, startTime: number, endTime: number): ColumnPlacement => ({ clipId, column: 0, startTime, endTime, transitionIn: 0 });
const planOf = (placements: ColumnPlacement[]): MixPlan => ({
  width: 1920,
  height: 1080,
  duration: Math.max(...placements.map((p) => p.endTime)),
  placements,
  layouts: [{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 1920 }], fills: [] }],
  warnings: [],
});

let workDir: string;
let sourcePaths: Record<string, string>;

/** Renders the audio pass and returns its samples (mono, f32). */
async function renderSamples(plan: MixPlan, clips: MixClip[], name: string) {
  const pass = buildAudioGraph({ plan, clips, sourcePaths, settings, loudness: Object.fromEntries(clips.map((c) => [c.id, atTarget])) });
  const graphPath = path.join(workDir, `${name}.txt`);
  const outPath = path.join(workDir, `${name}.f32`);
  await writeFile(graphPath, pass.filterComplex);
  await execFileAsync(ffmpegPath, ['-v', 'error', '-nostdin', '-y', ...pass.inputs.flat(), '-/filter_complex', graphPath, '-map', `[${pass.outLabel}]`, '-ac', '1', '-f', 'f32le', outPath], { env });
  const buffer = await readFile(outPath);
  return { pass, samples: new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4) };
}

/** RMS (dBFS) of every `WINDOW` s window starting in [from, to), every millisecond. */
function windowLevels(samples: Float32Array, from: number, to: number) {
  const size = Math.round(WINDOW * AUDIO_SAMPLE_RATE);
  const levels: number[] = [];
  for (let t = from; t < to; t += 0.001) {
    const start = Math.round(t * AUDIO_SAMPLE_RATE);
    let sum = 0;
    for (let i = start; i < start + size; i += 1) sum += (samples[i] ?? 0) ** 2;
    levels.push(10 * Math.log10(sum / size + 1e-20));
  }
  return levels;
}

/** Steady level (well away from the cut) and the lowest/highest window around it. */
function measureJoin(samples: Float32Array) {
  const steady = [...windowLevels(samples, 1, 2.5), ...windowLevels(samples, 3.5, 5)];
  const mean = steady.reduce((acc, l) => acc + l, 0) / steady.length;
  const around = windowLevels(samples, CUT - 0.05, CUT + 0.05);
  return { steadyMin: Math.min(...steady) - mean, steadyMax: Math.max(...steady) - mean, min: Math.min(...around) - mean, max: Math.max(...around) - mean };
}

beforeAll(async () => {
  if (!available) return;
  workDir = await mkdtemp(path.join(os.tmpdir(), 'videomix-join-'));
  const noisePath = path.join(workDir, 'noise.wav');
  await execFileAsync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `anoisesrc=d=12:c=white:a=0.1:r=${AUDIO_SAMPLE_RATE}:seed=7`, noisePath], { env });
  sourcePaths = { s: noisePath };
});

afterAll(async () => {
  if (workDir != null) await rm(workDir, { recursive: true, force: true });
});

describe.skipIf(!available)('audio of a direct cut with ffmpeg (T39)', () => {
  test('consecutive clips of a source: the join is seamless (linear crossfade of the same audio)', async () => {
    const clips = [clip('a', 1, 4), clip('b', 4, 7)];
    const { pass, samples } = await renderSamples(planOf([place('a', 0, CUT), place('b', CUT, 6)]), clips, 'continuous');
    expect(pass.filterComplex).toContain(`atrim=duration=${CUT + CUT_CROSSFADE}`);
    expect(pass.filterComplex).toContain('curve=tri');
    const join = measureJoin(samples);
    console.log('continuous join (dB from the steady level)', join);
    // within the noise of the 5 ms windows themselves
    expect(join.min).toBeGreaterThan(join.steadyMin - 0.5);
    expect(join.max).toBeLessThan(join.steadyMax + 0.5);

    // and the samples around the cut are the source's own (the noise is at ±0.1)
    const sourcePath = path.join(workDir, 'noise.f32');
    await execFileAsync(ffmpegPath, ['-v', 'error', '-y', '-i', sourcePaths['s']!, '-ac', '1', '-f', 'f32le', sourcePath], { env });
    const sourceBuffer = await readFile(sourcePath);
    const source = new Float32Array(sourceBuffer.buffer, sourceBuffer.byteOffset, sourceBuffer.byteLength / 4);
    let maxDiff = 0;
    for (let i = Math.round((CUT - 0.05) * AUDIO_SAMPLE_RATE); i < Math.round((CUT + 0.05) * AUDIO_SAMPLE_RATE); i += 1) {
      maxDiff = Math.max(maxDiff, Math.abs(samples[i]! - source[i + AUDIO_SAMPLE_RATE]!));
    }
    console.log('continuous join: max difference with the source', maxDiff);
    expect(maxDiff).toBeLessThan(0.005);
  });

  test('clips of different moments: equal-power crossfade, no dip', async () => {
    const clips = [clip('a', 1, 4), clip('b', 8, 11)];
    const { pass, samples } = await renderSamples(planOf([place('a', 0, CUT), place('b', CUT, 6)]), clips, 'uncorrelated');
    expect(pass.filterComplex).not.toContain('curve=tri');
    const join = measureJoin(samples);
    console.log('uncorrelated join (dB from the steady level)', join);
    expect(join.min).toBeGreaterThan(join.steadyMin - 1);
    expect(join.max).toBeLessThan(join.steadyMax + 1);
  });

  test('control: without the join (1 ms apart, two de-click fades) the level dips at the cut', async () => {
    const clips = [clip('a', 1, 4), clip('b', 4.001, 7.001)];
    const { samples } = await renderSamples(planOf([place('a', 0, CUT), place('b', CUT + 0.001, 6.001)]), clips, 'separate');
    const join = measureJoin(samples);
    console.log('separate fades (dB from the steady level)', join);
    expect(join.min).toBeLessThan(-6);
  });
});
