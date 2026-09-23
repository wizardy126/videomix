// T12 dev demo: loudness balancing of the VideoMix audio pass with the T02 test media (music playlist and ducking: T27).
//
// 1. Builds a project with clips of the test media (sines and pink noise at very different levels, a clip without an
//    audio stream and a silent one), plans it with the real planner and measures each clip's loudness with the same
//    loudnorm first pass as src/main/videomix/loudness.ts (through the renderer's ensureLoudness and its cache key).
// 2. Renders the audio pass (buildAudioGraph) twice: balanced, and without normalization for comparison.
// 3. Measures the integrated loudness of every section of the result where the set of sounding clips is constant
//    (fades excluded) and compares it with the target (LOUDNESS_TARGET, ±2 LU).
//
// 4. With --playlist (T27): the music is a looped playlist of two generated tones (330 Hz, 12 s; 990 Hz, 9 s) with a
//    2 s crossfade. Checks, on the music rendered alone, that each tone sounds where getMusicSchedule puts it (the
//    crossfades at the right time and the list repeated), and that both are balanced in the middle of each crossfade.
// 5. With --ducking [amountDb] (T27, default -10): enables the ducking and mutes c3 (so 8–14 s has no audible clip).
//    Renders the ducked music alone (the same graph, the clips only driving the compressor) and compares it with the
//    music without ducking, section by section: the level must drop by ≈ amountDb (±1.5 dB) where clips sound and stay
//    (±1 dB) where none does.
//
// Usage (from the repo root): node script/videomix/audioDemo.ts [--music] [--playlist] [--ducking [amountDb]] [--columns <n>]
// (default 2 columns; --playlist and --ducking imply music)
// Needs the test media (node script/videomix/generateTestMedia.ts) and ffmpeg in ffmpeg/<platform>-<arch>/lib (or
// FFMPEG_PATH / FFPROBE_PATH). Outputs go to test-media/audio-demo/ (git-ignored).
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import os from 'node:os';
import { execa } from 'execa';

import { LOOP_MEASURE_DURATION, parseFfprobeAudioStream, parseFfprobeDuration, parseLoudnormOutput, shouldLoopForMeasurement, toLoudnessAnalysis } from '../../src/main/videomix/loudnessParse.ts';
import type { LoudnessAnalysis } from '../../src/main/videomix/loudnessParse.ts';
import registerRendererImports from './rendererImports.ts';

// Local copies of the few renderer types used here (see rendererImports.ts)
interface Placement { clipId: string, column: number, startTime: number, endTime: number, transitionIn: number, transitionOut?: number | undefined }
interface Plan { duration: number, placements: Placement[], layouts: unknown[] }
interface Clip { id: string, sourceId: string, name: string, start: number, end: number, muted: boolean, gainDb: number }
interface Project { sources: { id: string, absolutePath: string }[], clips: Clip[], settings: { transition: { duration: number } } }
interface AudioPass { inputs: string[][], filterComplex: string, outLabel: string }
interface MusicTrack { id: string, path: string, absolutePath: string, volumeDb: number }
interface MusicPlaylist { tracks: MusicTrack[], crossfade: number, loop: boolean, ducking: { enabled: boolean, amountDb: number } }

registerRendererImports();
const rendererDir = '../../src/renderer/src/videomix';
const { createEmptyMixProject } = await import(`${rendererDir}/types.ts`) as { createEmptyMixProject: () => Project & Record<string, unknown> };
const { planMix } = await import(`${rendererDir}/planner/planMix.ts`) as { planMix: (input: unknown) => Plan };
const { getPlannerInput } = await import(`${rendererDir}/planner/plannerInput.ts`) as { getPlannerInput: (project: unknown) => unknown };
const { ensureLoudness } = await import(`${rendererDir}/loudness.ts`) as {
  ensureLoudness: (params: {
    project: unknown,
    musicTracks?: { id: string, absolutePath: string }[] | undefined,
    deps: { stat: (path: string) => Promise<{ mtimeMs: number, size: number }>, measureLoudness: (range: { filePath: string, start?: number | undefined, end?: number | undefined }) => Promise<LoudnessAnalysis> },
    onCacheEntries: (entries: Record<string, LoudnessAnalysis>) => void,
  }) => Promise<Record<string, LoudnessAnalysis>>,
};
const audioGraph = await import(`${rendererDir}/render/buildAudioGraph.ts`) as {
  LOUDNESS_TARGET: number,
  buildAudioGraph: (params: { plan: Plan, clips: Clip[], sourcePaths: Record<string, string>, settings: unknown, loudness: Record<string, LoudnessAnalysis> }) => AudioPass,
  getPlacementFades: (plan: Plan, placement: Placement) => { fadeIn: number, fadeOut: number },
  getNormalizationGain: (measurement: LoudnessAnalysis) => number,
  DUCKING_ATTACK: number,
  DUCKING_RELEASE: number,
  getMusicSchedule: (params: { playlist: MusicPlaylist, durations: Record<string, number | undefined>, totalDuration: number }) => { track: MusicTrack, start: number, duration: number, crossfade: number }[],
};

const ffDir = join('ffmpeg', `${os.platform()}-${os.arch()}`, ...(os.platform() === 'darwin' ? [] : ['lib']));
const ffmpegPath = process.env['FFMPEG_PATH'] ?? join(ffDir, 'ffmpeg');
const ffprobePath = process.env['FFPROBE_PATH'] ?? join(ffDir, 'ffprobe');
const ffEnv = { LD_LIBRARY_PATH: ffDir };
const mediaDir = resolve('test-media');
const outDir = join(mediaDir, 'audio-demo');
const withPlaylist = process.argv.includes('--playlist');
const duckingArg = process.argv.indexOf('--ducking');
const withDucking = duckingArg !== -1;
const duckingAmountDb = withDucking && process.argv[duckingArg + 1] != null && !process.argv[duckingArg + 1]!.startsWith('--') ? Number(process.argv[duckingArg + 1]) : -10;
const withMusic = process.argv.includes('--music') || withPlaylist || withDucking;
const columnsArg = process.argv.indexOf('--columns');
const maxColumns = columnsArg !== -1 ? Number(process.argv[columnsArg + 1]) : 2;

const runFfmpeg = async (args: string[]) => execa(ffmpegPath, args, { env: ffEnv });

// Same commands as src/main/videomix/loudness.ts (which can't run outside Electron). start/end omitted: whole file
// (music, T12b), with its duration (T21) and looped if very short (T21b).
async function measureLoudness({ filePath, start, end }: { filePath: string, start?: number | undefined, end?: number | undefined }): Promise<LoudnessAnalysis> {
  const probe = await execa(ffprobePath, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'format=duration:stream=index,channels,channel_layout', '-of', 'json', '-i', filePath], { env: ffEnv });
  const stream = parseFfprobeAudioStream(probe.stdout);
  const isWholeFile = start == null && end == null;
  const duration = isWholeFile ? parseFfprobeDuration(probe.stdout) : undefined;
  if (stream == null) return { hasAudio: false, ...(duration != null && { duration }) };
  const loop = shouldLoopForMeasurement({ isWholeFile, duration });
  const { stderr } = await runFfmpeg([
    '-hide_banner', '-nostats', ...(loop ? ['-stream_loop', '-1'] : []), '-i', filePath,
    '-map', '0:a:0', ...(loop ? ['-t', String(LOOP_MEASURE_DURATION)] : []),
    // A section is cut with atrim, exact (decodes from the start). Not with input seeking, which occasionally misjudges
    // the frame boundary on these freshly-encoded, very short sections and reads back silence (T12b), nor with -ss/-t
    // as output options: with -af, those trim the filter's output, so loudnorm would still measure from 0 (T27).
    '-af', [...(start != null && end != null ? [`atrim=${start.toFixed(6)}:${end.toFixed(6)}`] : []), 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json'].join(','), '-f', 'null', '-',
  ]);
  const values = parseLoudnormOutput(stderr);
  if (values == null) throw new Error(`No loudnorm output for ${filePath}`);
  const analysis = toLoudnessAnalysis(values, stream);
  return duration != null ? { ...analysis, duration } : analysis;
}

/** RMS level (dBFS) of `[start, end)` of a file, after an optional filter (e.g. a band-pass), via astats. */
async function measureRms(filePath: string, start: number, end: number, filter?: string) {
  const { stderr } = await runFfmpeg([
    '-hide_banner', '-nostats', '-i', filePath,
    // trimmed after the filter, so a band-pass has settled (see measureLoudness)
    '-af', [filter, `atrim=${start.toFixed(6)}:${end.toFixed(6)}`, 'astats=metadata=0:measure_perchannel=none'].filter((f) => f != null).join(','), '-f', 'null', '-',
  ]);
  const match = /RMS level dB:\s*(-?[\d.]+|-inf)/.exec(stderr.slice(stderr.lastIndexOf('Overall')));
  if (match?.[1] == null) throw new Error(`astats: no RMS level for ${filePath} @${start}s`);
  return match[1] === '-inf' ? -Infinity : Number(match[1]);
}

async function renderAudioPass(audioPass: AudioPass, name: string) {
  const filterComplexPath = join(outDir, `${name}.graph.txt`);
  const outPath = join(outDir, `${name}.m4a`);
  await writeFile(filterComplexPath, audioPass.filterComplex);
  await writeFile(join(outDir, `${name}.inputs.json`), JSON.stringify(audioPass.inputs));
  const startedAt = Date.now();
  // same encoding as buildRenderJob's audio step
  await runFfmpeg([
    '-hide_banner', '-nostdin', '-y', ...audioPass.inputs.flat(), '-/filter_complex', filterComplexPath,
    '-map', `[${audioPass.outLabel}]`, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', outPath,
  ]);
  console.log(`Rendered ${outPath} in ${((Date.now() - startedAt) / 1000).toFixed(1)} s (graph: ${filterComplexPath})`);
  return outPath;
}

// Two tones for the playlist check (T27): easy to tell apart with a band-pass
const toneTracks = [{ id: 'toneA', frequency: 330, duration: 12 }, { id: 'toneB', frequency: 990, duration: 9 }];

const media = (name: string) => join(mediaDir, name);
const sourceFiles = {
  h1080: 'h-1080p-10s.mp4', // sine 440 Hz
  h720: 'h-720p-25fps-8s.mp4', // sine 660 Hz, -12 dB
  vPink: 'v-1080x1920-12s.mp4', // pink noise, -24 dB
  rotated: 'v-rotated-9s.mp4', // sine 550 Hz
  square: 'sq-1080-6s.mp4', // no audio stream
  silent: 'v-720x1280-silent-7s.mp4', // silent audio stream
};

async function main() {
  await Promise.all(Object.values(sourceFiles).map(async (name) => {
    try {
      await stat(media(name));
    } catch {
      throw new Error(`Missing ${media(name)}: run node script/videomix/generateTestMedia.ts first`);
    }
  }));
  await mkdir(outDir, { recursive: true });

  const empty = createEmptyMixProject();
  const rect = (width: number, height: number) => ({ x: 0, y: 0, width, height });
  const sizes: Record<keyof typeof sourceFiles, [number, number]> = {
    h1080: [1920, 1080], h720: [1280, 720], vPink: [1080, 1920], rotated: [1080, 1920], square: [1080, 1080], silent: [720, 1280],
  };
  const clipDefs: [keyof typeof sourceFiles, number, number][] = [
    ['h1080', 0, 8],
    ['vPink', 0, 10],
    ['h720', 0, 7],
    ['square', 0, 5],
    ['rotated', 0, 8],
    ['silent', 0, 6],
    ['vPink', 1, 7],
    ['h1080', 2, 9],
  ];
  const musicTracks: MusicTrack[] = [];
  if (withPlaylist) {
    await Promise.all(toneTracks.map(async ({ id, frequency, duration }) => {
      const path = join(outDir, `${id}.m4a`);
      await runFfmpeg(['-hide_banner', '-y', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${duration}:sample_rate=48000`, '-af', 'volume=-6dB', '-c:a', 'aac', '-b:a', '192k', path]);
      musicTracks.push({ id, path, absolutePath: path, volumeDb: -12 });
    }));
    musicTracks.sort((a, b) => a.id.localeCompare(b.id));
  } else if (withMusic) {
    musicTracks.push({ id: 'music', path: media('music-20s.m4a'), absolutePath: media('music-20s.m4a'), volumeDb: -12 });
  }
  const musicPlaylist: MusicPlaylist = { tracks: musicTracks, crossfade: 2, loop: true, ducking: { enabled: withDucking, amountDb: duckingAmountDb } };
  const project = {
    ...empty,
    sources: Object.entries(sourceFiles).map(([id, name]) => ({ id, path: media(name), absolutePath: media(name), name })),
    clips: clipDefs.map(([sourceId, start, end], i) => {
      const [width, height] = sizes[sourceId];
      // --ducking: c3 muted, so that its section has no audible clip and the music comes back up
      return { id: `c${i + 1}`, sourceId, name: `c${i + 1}-${sourceId}`, color: i, start, end, maxRect: rect(width, height), muted: withDucking && i === 2, gainDb: 0 };
    }),
    settings: {
      ...empty.settings,
      maxColumns,
      musicPlaylist,
    },
  };

  const plan = planMix(getPlannerInput(project));
  console.log(`Plan: ${plan.duration.toFixed(2)} s, ${plan.placements.length} placements`);

  let cache: Record<string, LoudnessAnalysis> = {};
  const loudness = await ensureLoudness({
    project,
    musicTracks,
    deps: { stat: async (path) => stat(path), measureLoudness },
    onCacheEntries: (entries) => { cache = { ...cache, ...entries }; },
  });
  console.log(`Measured ${Object.keys(cache).length} clip/music ranges (cache keys: ${Object.keys(cache).map((key) => key.slice(0, 8)).join(', ')})`);
  musicTracks.forEach((track) => {
    const m = loudness[track.id]!;
    console.log(`Music ${track.id} (whole file, ${m.duration?.toFixed(2)} s): ${m.hasAudio ? `${m.inputI.toFixed(1)} LUFS, gain ${audioGraph.getNormalizationGain(m).toFixed(1)} dB` : '(no audio)'}`);
  });

  const clipsById = new Map(project.clips.map((clip) => [clip.id, clip]));
  console.log('\nClip   Source          In→out (s)      Column  input_i   gain');
  plan.placements.forEach((p) => {
    const clip = clipsById.get(p.clipId)!;
    const m = loudness[p.clipId]; // none if muted
    console.log(`${clip.id.padEnd(6)} ${clip.sourceId.padEnd(15)} ${p.startTime.toFixed(2).padStart(6)}→${p.endTime.toFixed(2).padEnd(8)} ${String(p.column).padStart(6)}  ${m == null ? '(muted)' : (m.hasAudio ? m.inputI.toFixed(1).padStart(7) : ' (none)')}  ${m?.hasAudio === true ? `${audioGraph.getNormalizationGain(m).toFixed(1)} dB` : ''}`);
  });

  // unbalanced reference: every clip measured "at the target" → normalization gain 0
  const flatLoudness = Object.fromEntries(Object.entries(loudness).map(([id, m]) => [id, m.hasAudio
    ? { ...m, inputI: audioGraph.LOUDNESS_TARGET, inputTp: -100 }
    : m]));

  const sourcePaths = Object.fromEntries(project.sources.map((source) => [source.id, source.absolutePath]));
  const render = async (name: string, clipLoudness: Record<string, LoudnessAnalysis>) => renderAudioPass(audioGraph.buildAudioGraph({ plan, clips: project.clips, sourcePaths, settings: project.settings, loudness: clipLoudness }), name);

  const balancedPath = await render('balanced', loudness);
  const flatPath = await render('unbalanced', flatLoudness);

  // Isolates the music (T12b): same music settings, but an empty plan (no clips), so the result is just the
  // normalized music + its own fade-out/global fade. Measured away from both fades.
  let musicAlonePath: string | undefined;
  if (withMusic) {
    const isolatedPlan: Plan = { duration: plan.duration, placements: [], layouts: [] };
    musicAlonePath = await renderAudioPass(audioGraph.buildAudioGraph({ plan: isolatedPlan, clips: [], sourcePaths, settings: project.settings, loudness }), 'music-only');
  }

  // The ducked music alone (T27): the real graph, but the clips only drive the compressor (demo-only surgery of the
  // graph: the clips are muted in the mix; with an anullsink instead, ffmpeg ends the graph early)
  let duckedMusicPath: string | undefined;
  if (withDucking) {
    const audioPass = audioGraph.buildAudioGraph({ plan, clips: project.clips, sourcePaths, settings: project.settings, loudness });
    const clipsMix = '[clipsMix][duckedMusic]amix';
    if (!audioPass.filterComplex.includes(clipsMix)) throw new Error('No ducking in the graph');
    duckedMusicPath = await renderAudioPass({ ...audioPass, filterComplex: audioPass.filterComplex.replace(clipsMix, '[clipsMix]volume=0[mutedClips];\n[mutedClips][duckedMusic]amix') }, 'music-ducked-only');
  }

  // sections where the set of sounding clips is constant: cut at every clip start/end and fade boundary
  const audible = plan.placements.filter((p) => loudness[p.clipId]?.hasAudio === true).map((p) => ({ ...p, ...audioGraph.getPlacementFades(plan, p) }));
  const D = project.settings.transition.duration;
  const cuts = [...new Set([0, D, plan.duration - D, plan.duration, ...audible.flatMap((p) => [p.startTime, p.startTime + p.fadeIn, p.endTime - p.fadeOut, p.endTime])]
    .map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b);
  const sections = cuts.slice(0, -1).map((start, i) => ({ start, end: cuts[i + 1]! }))
    .filter(({ start, end }) => end - start >= 1)
    .map(({ start, end }) => ({ start, end, clips: audible.filter((p) => p.startTime + p.fadeIn <= start + 1e-3 && p.endTime - p.fadeOut >= end - 1e-3).map((p) => p.clipId) }));

  const measureSection = async (filePath: string, start: number, end: number) => {
    const m = await measureLoudness({ filePath, start, end });
    return m.hasAudio ? m.inputI : -Infinity;
  };

  console.log(`\nIntegrated loudness per section (target ${audioGraph.LOUDNESS_TARGET} LUFS${withMusic ? ', music normalized then volumeDb on top (T12b)' : ''}):`);
  console.log('Section (s)       Sounding clips        Unbalanced   Balanced   Δ target');
  let failures = 0;
  for (const { start, end, clips } of sections) {
    // eslint-disable-next-line no-await-in-loop
    const [flat, balanced] = await Promise.all([measureSection(flatPath, start, end), measureSection(balancedPath, start, end)]);
    const delta = balanced - audioGraph.LOUDNESS_TARGET;
    const ok = clips.length === 0 ? balanced === -Infinity || withMusic : Math.abs(delta) <= 2;
    if (!ok) failures += 1;
    const fmtLufs = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : 'silence').padStart(8);
    console.log(`${start.toFixed(2).padStart(6)}–${end.toFixed(2).padEnd(8)}  ${(clips.join('+') || '(none)').padEnd(20)} ${fmtLufs(flat)}   ${fmtLufs(balanced)}   ${clips.length > 0 ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}` : ''}${ok ? '' : '  ✗'}`);
  }

  const whole = await Promise.all([flatPath, balancedPath].map(async (filePath) => measureLoudness({ filePath, start: 0, end: plan.duration })));
  whole.forEach((m, i) => {
    if (m.hasAudio) console.log(`${i === 0 ? 'Unbalanced' : 'Balanced'} whole mix: ${m.inputI.toFixed(1)} LUFS, true peak ${m.inputTp.toFixed(1)} dBTP, LRA ${m.inputLra.toFixed(1)} LU`);
  });

  // away from the global fade-in and the music's own fade-out at the end
  const steadyStart = 1;
  const steadyEnd = plan.duration - 3;
  if (musicAlonePath != null && musicTracks[0] != null) {
    const m = await measureLoudness({ filePath: musicAlonePath, start: steadyStart, end: steadyEnd });
    const { volumeDb } = musicTracks[0];
    if (m.hasAudio) {
      console.log(`\nMusic alone (isolated render, ${steadyStart.toFixed(1)}–${steadyEnd.toFixed(1)} s, volumeDb ${volumeDb} dB): ${m.inputI.toFixed(1)} LUFS (target ${(audioGraph.LOUDNESS_TARGET + volumeDb).toFixed(1)} LUFS)`);
    }
  }

  // Playlist (T27): which tone sounds in the middle of each occurrence, and both at -3 dB in the middle of each crossfade
  if (withPlaylist && musicAlonePath != null) {
    const durations = Object.fromEntries(musicTracks.map((track) => [track.id, loudness[track.id]?.duration]));
    const schedule = audioGraph.getMusicSchedule({ playlist: musicPlaylist, durations, totalDuration: plan.duration });
    const band = (id: string) => `bandpass=f=${toneTracks.find((tone) => tone.id === id)!.frequency}:t=q:w=4`;
    console.log('\nPlaylist schedule (getMusicSchedule) and the tones measured in the music alone (band-pass RMS, dBFS):');
    console.log('Track   Start (s)  Crossfade   Steady window (s)   Own tone   Other tone   Crossfade midpoint: out / in (dB vs steady)');
    const steadyLevels: number[] = [];
    for (const [i, { track, start, duration, crossfade }] of schedule.entries()) {
      const next = schedule[i + 1];
      const windowStart = Math.max(start + crossfade + 0.3, steadyStart);
      const windowEnd = Math.min(start + duration - (next?.crossfade ?? 0) - 0.3, steadyEnd);
      const other = toneTracks.find((tone) => tone.id !== track.id)!.id;
      let line = `${track.id.padEnd(7)} ${start.toFixed(2).padStart(8)}  ${crossfade.toFixed(2).padStart(9)}   `;
      if (windowEnd - windowStart >= 0.5) {
        // eslint-disable-next-line no-await-in-loop
        const [own, otherLevel] = await Promise.all([measureRms(musicAlonePath, windowStart, windowEnd, band(track.id)), measureRms(musicAlonePath, windowStart, windowEnd, band(other))]);
        steadyLevels[i] = own;
        const ok = own - otherLevel >= 20;
        if (!ok) failures += 1;
        line += `${`${windowStart.toFixed(2)}–${windowEnd.toFixed(2)}`.padEnd(18)} ${own.toFixed(1).padStart(8)}   ${otherLevel.toFixed(1).padStart(10)}${ok ? '' : '  ✗'}`;
      } else {
        line += '(too short / in a fade)';
      }
      const previousLevel = steadyLevels[i - 1];
      const previous = schedule[i - 1];
      if (crossfade > 0 && previous != null && previousLevel != null && start + crossfade < steadyEnd) {
        // 0.2 s around the middle of the crossfade: qsin gives each track sin(π/4), -3 dB
        const middle = start + crossfade / 2;
        // eslint-disable-next-line no-await-in-loop
        const [out, into] = await Promise.all([measureRms(musicAlonePath, middle - 0.1, middle + 0.1, band(previous.track.id)), measureRms(musicAlonePath, middle - 0.1, middle + 0.1, band(track.id))]);
        const ownSteady = steadyLevels[i] ?? previousLevel;
        const ok = Math.abs(out - previousLevel + 3) <= 1 && Math.abs(into - ownSteady + 3) <= 1;
        if (!ok) failures += 1;
        line += `   ${(out - previousLevel).toFixed(1)} / ${(into - ownSteady).toFixed(1)}${ok ? '' : '  ✗'}`;
      }
      console.log(line);
    }
  }

  // Ducking (T27): the ducked music vs the music alone, per section
  if (duckedMusicPath != null && musicAlonePath != null) {
    console.log(`\nDucking (amountDb ${duckingAmountDb}, attack/release ${audioGraph.DUCKING_ATTACK}/${audioGraph.DUCKING_RELEASE} ms): music level (RMS, dBFS) per section, alone vs ducked by the clips`);
    console.log('Section (s)       Sounding clips        Music     Ducked      Δ (dB)   Expected');
    for (const { start, end, clips } of sections) {
      // after the attack/release has settled, and away from the global and music fades
      const windowStart = Math.max(start + Math.min(0.5, (end - start) / 3), steadyStart);
      const windowEnd = Math.min(end, steadyEnd);
      if (windowEnd - windowStart >= 0.5) {
        // eslint-disable-next-line no-await-in-loop
        const [alone, ducked] = await Promise.all([measureRms(musicAlonePath, windowStart, windowEnd), measureRms(duckedMusicPath, windowStart, windowEnd)]);
        const delta = ducked - alone;
        const expected = clips.length > 0 ? duckingAmountDb : 0;
        const ok = Math.abs(delta - expected) <= (clips.length > 0 ? 1.5 : 1);
        if (!ok) failures += 1;
        console.log(`${windowStart.toFixed(2).padStart(6)}–${windowEnd.toFixed(2).padEnd(8)}  ${(clips.join('+') || '(none)').padEnd(20)} ${alone.toFixed(1).padStart(6)}   ${ducked.toFixed(1).padStart(8)}   ${delta.toFixed(1).padStart(8)}   ${expected}${ok ? '' : '  ✗'}`);
      }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed (✗)`);
    process.exitCode = 1;
  } else {
    console.log('\nAll checks passed (sections within ±2 LU of the target, and the playlist/ducking checks if enabled)');
  }
}

await main();
