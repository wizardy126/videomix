// Music playlist and ducking with the real ffmpeg (T27): a looped playlist of two generated tones crossfades at the
// times getMusicSchedule gives, and with ducking the music goes down by amountDb while a clip sounds. Rendered to PCM
// and measured with band-pass filters and astats. Skipped when the dev ffmpeg is missing (see script/videomix for
// the longer demo with the T02 media, audioDemo.ts --playlist --ducking).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';

import type { MixPlan } from '../planner/types';
import type { LoudnessMeasurement, MixClip, MixMusicPlaylist, MixSettings } from '../types';
import { createEmptyMixProject } from '../types';
import type { AudioPass } from './buildAudioGraph';
import { buildAudioGraph, getMusicSchedule } from './buildAudioGraph';

const execFileAsync = promisify(execFile);

const ffDir = path.resolve('ffmpeg', `${os.platform()}-${os.arch()}`, ...(os.platform() === 'darwin' ? [] : ['lib']));
const ffmpegPath = path.join(ffDir, `ffmpeg${os.platform() === 'win32' ? '.exe' : ''}`);
const available = existsSync(ffmpegPath);
const env = { ...process.env, LD_LIBRARY_PATH: ffDir };

const DURATION = 12;
const tones = { a: { frequency: 250, duration: 6 }, b: { frequency: 2000, duration: 6 } };
const band = (frequency: number) => `bandpass=f=${frequency}:t=q:w=4`;

// Loudness "measured" at the target, so the normalization gain is 0 and only volumeDb applies
const atTarget = (duration?: number): LoudnessMeasurement => ({ hasAudio: true, inputI: -16, inputTp: -10, inputLra: 1, inputThresh: -26, ...(duration != null && { duration }) });

const clip: MixClip = { id: 'c', sourceId: 's', name: 'c', color: 0, start: 0, end: 4, maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, muted: false, gainDb: 0 };
// The clip (a 1 kHz tone) sounds from 3 s to 7 s
const plan: MixPlan = {
  width: 1920,
  height: 1080,
  duration: DURATION,
  placements: [{ clipId: 'c', column: 0, startTime: 3, endTime: 7, transitionIn: 0 }],
  layouts: [{ time: 0, transitionDuration: 0, columns: [{ column: 0, x: 0, width: 1920 }], fills: [] }],
  warnings: [],
};
const noClipsPlan: MixPlan = { ...plan, placements: [] };

let workDir: string;
let sourcePaths: Record<string, string>;
let playlist: MixMusicPlaylist;

const settingsWith = (ducking: MixMusicPlaylist['ducking']): MixSettings => ({
  ...createEmptyMixProject().settings,
  fadeInOut: false,
  transition: { type: 'fade', duration: 0.5 },
  musicPlaylist: { ...playlist, ducking },
});
const loudness = { c: atTarget(), a: atTarget(tones.a.duration), b: atTarget(tones.b.duration) };

async function render(audioPass: AudioPass, name: string) {
  const graphPath = path.join(workDir, `${name}.txt`);
  const outPath = path.join(workDir, `${name}.wav`);
  await writeFile(graphPath, audioPass.filterComplex);
  await execFileAsync(ffmpegPath, ['-v', 'error', '-nostdin', '-y', ...audioPass.inputs.flat(), '-/filter_complex', graphPath, '-map', `[${audioPass.outLabel}]`, '-c:a', 'pcm_f32le', outPath], { env });
  return outPath;
}

/** RMS level (dBFS) of `[start, end)`, after an optional filter (trimmed after it, so a band-pass has settled). */
async function rms(filePath: string, start: number, end: number, filter?: string) {
  const { stderr } = await execFileAsync(ffmpegPath, [
    '-hide_banner', '-nostats', '-i', filePath, '-af', [filter, `atrim=${start}:${end}`, 'astats=metadata=0:measure_perchannel=none'].filter((f) => f != null).join(','), '-f', 'null', '-',
  ], { env });
  const match = /RMS level dB:\s*(-?[\d.]+|-inf)/.exec(stderr.slice(stderr.lastIndexOf('Overall')));
  if (match?.[1] == null) throw new Error(`No RMS level for ${filePath}`);
  return match[1] === '-inf' ? -Infinity : Number(match[1]);
}

beforeAll(async () => {
  if (!available) return;
  workDir = await mkdtemp(path.join(os.tmpdir(), 'videomix-music-'));
  const tonePath = (name: string) => path.join(workDir, `${name}.wav`);
  await Promise.all([
    ...Object.entries(tones).map(async ([name, { frequency, duration }]) => execFileAsync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${duration}:sample_rate=48000`, tonePath(name)], { env })),
    execFileAsync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=4:sample_rate=48000', tonePath('clip')], { env }),
  ]);
  sourcePaths = { s: tonePath('clip') };
  playlist = {
    tracks: [{ id: 'a', path: 'a.wav', absolutePath: tonePath('a'), volumeDb: -12 }, { id: 'b', path: 'b.wav', absolutePath: tonePath('b'), volumeDb: -12 }],
    crossfade: 1,
    loop: true,
    ducking: { enabled: false, amountDb: -10 },
  };
});

afterAll(async () => {
  if (workDir != null) await rm(workDir, { recursive: true, force: true });
});

describe.skipIf(!available)('music playlist and ducking with ffmpeg (T27)', () => {
  test('the tracks crossfade at the scheduled times and the list loops', async () => {
    const settings = settingsWith({ enabled: false, amountDb: -10 });
    expect(getMusicSchedule({ playlist, durations: { a: 6, b: 6 }, totalDuration: DURATION }).map(({ track, start }) => [track.id, start])).toEqual([['a', 0], ['b', 5], ['a', 10]]);
    const musicPath = await render(buildAudioGraph({ plan: noClipsPlan, clips: [], sourcePaths, settings, loudness }), 'music');

    const levels = async (start: number, end: number) => {
      const [a, b] = await Promise.all([rms(musicPath, start, end, band(tones.a.frequency)), rms(musicPath, start, end, band(tones.b.frequency))]);
      return { a, b };
    };
    const first = await levels(1, 4.5);
    const second = await levels(6.5, 9.5);
    const again = await levels(11.2, 11.8); // the list again (under the music's final fade-out)
    expect(first.a - first.b).toBeGreaterThan(20);
    expect(second.b - second.a).toBeGreaterThan(20);
    expect(again.a - again.b).toBeGreaterThan(20);
    // middle of the first crossfade (5–6 s): both tracks at -3 dB (equal power)
    const middle = await levels(5.4, 5.6);
    expect(middle.a - first.a).toBeCloseTo(-3, 0);
    expect(middle.b - second.b).toBeCloseTo(-3, 0);
  });

  test('with ducking, the music goes down by amountDb while the clip sounds', async () => {
    const settings = settingsWith({ enabled: true, amountDb: -10 });
    const audioPass = buildAudioGraph({ plan, clips: [clip], sourcePaths, settings, loudness });
    // The ducked music alone: the clips only drive the compressor, they're muted in the mix (with an anullsink
    // instead, ffmpeg ends the graph early)
    const clipsMix = '[clipsMix][duckedMusic]amix';
    expect(audioPass.filterComplex).toContain(clipsMix);
    const [duckedPath, musicPath] = await Promise.all([
      render({ ...audioPass, filterComplex: audioPass.filterComplex.replace(clipsMix, '[clipsMix]volume=0[mutedClips];\n[mutedClips][duckedMusic]amix') }, 'ducked'),
      render(buildAudioGraph({ plan: noClipsPlan, clips: [], sourcePaths, settings, loudness }), 'unducked'),
    ]);
    const delta = async (start: number, end: number) => (await rms(duckedPath, start, end)) - (await rms(musicPath, start, end));
    expect(await delta(1, 2.9)).toBeCloseTo(0, 0); // before the clip
    expect(Math.abs(await delta(3.5, 6.9) + 10)).toBeLessThan(1); // while it sounds (after the attack)
    expect(await delta(8, 9.5)).toBeCloseTo(0, 0); // after it (after the release)

    // and the whole graph renders (the clip + the ducked music)
    const mixPath = await render(audioPass, 'mix');
    expect(await rms(mixPath, 3.5, 6.9, band(1000))).toBeGreaterThan(-25);
  });

  test('with ducking, a music shorter than the video (no loop) ends without cutting the clips', async () => {
    const settings: MixSettings = { ...settingsWith({ enabled: true, amountDb: -10 }), musicPlaylist: { ...playlist, tracks: playlist.tracks.slice(0, 1), loop: false, ducking: { enabled: true, amountDb: -10 } } };
    const mixPath = await render(buildAudioGraph({ plan, clips: [clip], sourcePaths, settings, loudness }), 'short-music');
    const { stderr } = await execFileAsync(ffmpegPath, ['-hide_banner', '-i', mixPath], { env }).catch((err: { stderr: string }) => err);
    expect(stderr).toContain('Duration: 00:00:12.00');
    // the music (a, 0–6 s) has ended, the clip (3–7 s) still sounds as before
    expect(await rms(mixPath, 6.2, 6.9, band(1000)) - await rms(mixPath, 3.5, 5.5, band(1000))).toBeCloseTo(0, 0);
  });
});
