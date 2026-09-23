// T12 dev demo: loudness balancing of the VideoMix audio pass with the T02 test media.
//
// 1. Builds a project with clips of the test media (sines and pink noise at very different levels, a clip without an
//    audio stream and a silent one), plans it with the real planner and measures each clip's loudness with the same
//    loudnorm first pass as src/main/videomix/loudness.ts (through the renderer's ensureLoudness and its cache key).
// 2. Renders the audio pass (buildAudioGraph) twice: balanced, and without normalization for comparison.
// 3. Measures the integrated loudness of every section of the result where the set of sounding clips is constant
//    (fades excluded) and compares it with the target (LOUDNESS_TARGET, ±2 LU).
//
// Usage (from the repo root): node script/videomix/audioDemo.ts [--music] [--columns <n>]  (default 2 columns)
// Needs the test media (node script/videomix/generateTestMedia.ts) and ffmpeg in ffmpeg/<platform>-<arch>/lib (or
// FFMPEG_PATH / FFPROBE_PATH). Outputs go to test-media/audio-demo/ (git-ignored).
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import os from 'node:os';
import { execa } from 'execa';

import { parseFfprobeAudioStream, parseLoudnormOutput, toLoudnessAnalysis } from '../../src/main/videomix/loudnessParse.ts';
import type { LoudnessAnalysis } from '../../src/main/videomix/loudnessParse.ts';
import registerRendererImports from './rendererImports.ts';

// Local copies of the few renderer types used here (see rendererImports.ts)
interface Placement { clipId: string, column: number, startTime: number, endTime: number, transitionIn: number, transitionOut?: number | undefined }
interface Plan { duration: number, placements: Placement[], layouts: unknown[] }
interface Clip { id: string, sourceId: string, name: string, start: number, end: number, muted: boolean, gainDb: number }
interface Project { sources: { id: string, absolutePath: string }[], clips: Clip[], settings: { transition: { duration: number } } }
interface AudioPass { inputs: string[][], filterComplex: string, outLabel: string }

registerRendererImports();
const rendererDir = '../../src/renderer/src/videomix';
const { createEmptyMixProject } = await import(`${rendererDir}/types.ts`) as { createEmptyMixProject: () => Project & Record<string, unknown> };
const { planMix } = await import(`${rendererDir}/planner/planMix.ts`) as { planMix: (input: unknown) => Plan };
const { getPlannerInput } = await import(`${rendererDir}/planner/plannerInput.ts`) as { getPlannerInput: (project: unknown) => unknown };
const { ensureLoudness } = await import(`${rendererDir}/loudness.ts`) as {
  ensureLoudness: (params: {
    project: unknown,
    music?: { absolutePath: string } | undefined,
    deps: { stat: (path: string) => Promise<{ mtimeMs: number, size: number }>, measureLoudness: (range: { filePath: string, start?: number | undefined, end?: number | undefined }) => Promise<LoudnessAnalysis> },
    onCacheEntries: (entries: Record<string, LoudnessAnalysis>) => void,
  }) => Promise<Record<string, LoudnessAnalysis>>,
};
const audioGraph = await import(`${rendererDir}/render/buildAudioGraph.ts`) as {
  LOUDNESS_TARGET: number,
  MUSIC_LOUDNESS_KEY: string,
  buildAudioGraph: (params: { plan: Plan, clips: Clip[], sourcePaths: Record<string, string>, settings: unknown, loudness: Record<string, LoudnessAnalysis> }) => AudioPass,
  getPlacementFades: (plan: Plan, placement: Placement) => { fadeIn: number, fadeOut: number },
  getNormalizationGain: (measurement: LoudnessAnalysis) => number,
};

const ffDir = join('ffmpeg', `${os.platform()}-${os.arch()}`, ...(os.platform() === 'darwin' ? [] : ['lib']));
const ffmpegPath = process.env['FFMPEG_PATH'] ?? join(ffDir, 'ffmpeg');
const ffprobePath = process.env['FFPROBE_PATH'] ?? join(ffDir, 'ffprobe');
const ffEnv = { LD_LIBRARY_PATH: ffDir };
const mediaDir = resolve('test-media');
const outDir = join(mediaDir, 'audio-demo');
const withMusic = process.argv.includes('--music');
const columnsArg = process.argv.indexOf('--columns');
const maxColumns = columnsArg !== -1 ? Number(process.argv[columnsArg + 1]) : 2;

const runFfmpeg = async (args: string[]) => execa(ffmpegPath, args, { env: ffEnv });

// Same commands as src/main/videomix/loudness.ts (which can't run outside Electron). start/end omitted: whole file (music, T12b).
async function measureLoudness({ filePath, start, end }: { filePath: string, start?: number | undefined, end?: number | undefined }) {
  const probe = await execa(ffprobePath, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index,channels,channel_layout', '-of', 'json', '-i', filePath], { env: ffEnv });
  const stream = parseFfprobeAudioStream(probe.stdout);
  if (stream == null) return { hasAudio: false } as const;
  const { stderr } = await runFfmpeg([
    '-hide_banner', '-nostats', '-i', filePath,
    // -ss/-t as output options (after -i): exact (decodes from the start), unlike input seeking, which occasionally
    // misjudges the frame boundary on these freshly-encoded, very short sections and reads back silence.
    ...(start != null && end != null ? ['-ss', start.toFixed(6), '-t', (end - start).toFixed(6)] : []),
    '-map', '0:a:0', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-',
  ]);
  const values = parseLoudnormOutput(stderr);
  if (values == null) throw new Error(`No loudnorm output for ${filePath}`);
  return toLoudnessAnalysis(values, stream);
}

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
  const project = {
    ...empty,
    sources: Object.entries(sourceFiles).map(([id, name]) => ({ id, path: media(name), absolutePath: media(name), name })),
    clips: clipDefs.map(([sourceId, start, end], i) => {
      const [width, height] = sizes[sourceId];
      return { id: `c${i + 1}`, sourceId, name: `c${i + 1}-${sourceId}`, color: i, start, end, maxRect: rect(width, height), muted: false, gainDb: 0 };
    }),
    settings: {
      ...empty.settings,
      maxColumns,
      ...(withMusic && { music: { path: media('music-20s.m4a'), absolutePath: media('music-20s.m4a'), volumeDb: -12, loop: true } }),
    },
  };

  const plan = planMix(getPlannerInput(project));
  console.log(`Plan: ${plan.duration.toFixed(2)} s, ${plan.placements.length} placements`);

  let cache: Record<string, LoudnessAnalysis> = {};
  const loudness = await ensureLoudness({
    project,
    music: withMusic ? { absolutePath: media('music-20s.m4a') } : undefined,
    deps: { stat: async (path) => stat(path), measureLoudness },
    onCacheEntries: (entries) => { cache = { ...cache, ...entries }; },
  });
  console.log(`Measured ${Object.keys(cache).length} clip/music ranges (cache keys: ${Object.keys(cache).map((key) => key.slice(0, 8)).join(', ')})`);
  if (withMusic) {
    const m = loudness[audioGraph.MUSIC_LOUDNESS_KEY]!;
    console.log(`Music (whole file): ${m.hasAudio ? `${m.inputI.toFixed(1)} LUFS, gain ${audioGraph.getNormalizationGain(m).toFixed(1)} dB` : '(no audio)'}`);
  }

  const clipsById = new Map(project.clips.map((clip) => [clip.id, clip]));
  console.log('\nClip   Source          In→out (s)      Column  input_i   gain');
  plan.placements.forEach((p) => {
    const clip = clipsById.get(p.clipId)!;
    const m = loudness[p.clipId]!;
    console.log(`${clip.id.padEnd(6)} ${clip.sourceId.padEnd(15)} ${p.startTime.toFixed(2).padStart(6)}→${p.endTime.toFixed(2).padEnd(8)} ${String(p.column).padStart(6)}  ${m.hasAudio ? m.inputI.toFixed(1).padStart(7) : ' (none)'}  ${m.hasAudio ? `${audioGraph.getNormalizationGain(m).toFixed(1)} dB` : ''}`);
  });

  // unbalanced reference: every clip measured "at the target" → normalization gain 0
  const flatLoudness = Object.fromEntries(Object.entries(loudness).map(([id, m]) => [id, m.hasAudio
    ? { ...m, inputI: audioGraph.LOUDNESS_TARGET, inputTp: -100 }
    : m]));

  async function render(name: string, clipLoudness: Record<string, LoudnessAnalysis>) {
    const sourcePaths = Object.fromEntries(project.sources.map((source) => [source.id, source.absolutePath]));
    const audioPass = audioGraph.buildAudioGraph({ plan, clips: project.clips, sourcePaths, settings: project.settings, loudness: clipLoudness });
    const filterComplexPath = join(outDir, `${name}.graph.txt`);
    const outPath = join(outDir, `${name}.m4a`);
    await writeFile(filterComplexPath, audioPass.filterComplex);
    const startedAt = Date.now();
    // same encoding as buildRenderJob's audio step
    await runFfmpeg([
      '-hide_banner', '-nostdin', '-y', ...audioPass.inputs.flat(), '-/filter_complex', filterComplexPath,
      '-map', `[${audioPass.outLabel}]`, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', outPath,
    ]);
    console.log(`\nRendered ${outPath} in ${((Date.now() - startedAt) / 1000).toFixed(1)} s (graph: ${filterComplexPath})`);
    return outPath;
  }

  const balancedPath = await render('balanced', loudness);
  const flatPath = await render('unbalanced', flatLoudness);

  // Isolates the music (T12b): same music settings, but an empty plan (no clips), so the result is just the
  // normalized music + its own fade-out/global fade. Measured away from both fades.
  let musicAlonePath: string | undefined;
  if (withMusic) {
    const sourcePaths = Object.fromEntries(project.sources.map((source) => [source.id, source.absolutePath]));
    const isolatedPlan: Plan = { duration: plan.duration, placements: [], layouts: [] };
    const audioPass = audioGraph.buildAudioGraph({ plan: isolatedPlan, clips: [], sourcePaths, settings: project.settings, loudness });
    const filterComplexPath = join(outDir, 'music-only.graph.txt');
    musicAlonePath = join(outDir, 'music-only.m4a');
    await writeFile(filterComplexPath, audioPass.filterComplex);
    await runFfmpeg([
      '-hide_banner', '-nostdin', '-y', ...audioPass.inputs.flat(), '-/filter_complex', filterComplexPath,
      '-map', `[${audioPass.outLabel}]`, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', musicAlonePath,
    ]);
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

  if (musicAlonePath != null) {
    // away from the global fade-in and the music's own fade-out at the end
    const start = 1;
    const end = plan.duration - 3;
    const m = await measureLoudness({ filePath: musicAlonePath, start, end });
    const volumeDb = project.settings.music?.volumeDb ?? 0;
    if (m.hasAudio) {
      console.log(`\nMusic alone (isolated render, ${start.toFixed(1)}–${end.toFixed(1)} s, volumeDb ${volumeDb} dB): ${m.inputI.toFixed(1)} LUFS (target ${(audioGraph.LOUDNESS_TARGET + volumeDb).toFixed(1)} LUFS)`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} section(s) outside ±2 LU of the target`);
    process.exitCode = 1;
  } else {
    console.log('\nAll sections within ±2 LU of the target');
  }
}

await main();
