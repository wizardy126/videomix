// Dev tool (T11): plan and render a VideoMix project with the production render code, outside the app.
//
//   node script/videomix/renderPlan.ts [project.vmx] [options]
//
// Without a project it writes and renders a built-in example over the T02 media (test-media/, see
// `yarn generate-test-media`): test-media/render-example/example.vmx.
// Options:
//   --size WxH          output size; the plan is computed for it, like the app's preview (default 640x360)
//   --preset P --crf N  encoding (default ultrafast / 28)
//   --out DIR           work/output dir (default test-media/render-<name>/)
//   --frames t1,t2,…    also extract PNG frames at those output times
//   --concurrency N     chunks in parallel (default 2)
//   --max-chunk S       longest stable chunk in seconds (default 15)
//   --keep              keep the chunks, graphs and audio pass
//   --cache DIR         incremental render (T28): reuse/store the chunks and the audio pass in DIR (like the app's
//                       .<project>.vmx.cache/render) and print how many chunks were encoded and reused
//   --fixture NAME      render a hand-written plan of render/renderTestFixtures.ts instead (static, substitutions,
//                       relayout = the ADR-001 example, fills, removal), scaled to --size
//
// The renderer modules are loaded through rendererImports.ts (extensionless imports, import.meta.env); their types are
// declared locally because the node tsconfig can't type-check renderer files.
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import registerRendererImports from './rendererImports.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rendererDir = path.join(repoRoot, 'src/renderer/src');

registerRendererImports();

// --- minimal local types of the renderer modules we use ---
interface Rect { x: number, y: number, width: number, height: number }
interface MixSource { id: string, path: string, absolutePath: string, name: string, width?: number, height?: number, duration?: number, sar?: { num: number, den: number } }
interface MixClip { id: string, sourceId: string, name: string, color: number, start: number, end: number, maxRect: Rect, minRect?: Rect, muted: boolean, gainDb: number }
interface MixSettings { fps: number, gap: { width: number, color: string }, transition: { type: string, duration: number }, [key: string]: unknown }
interface MixProject { version: 1, sources: MixSource[], clips: MixClip[], settings: MixSettings }
interface MixPlan { width: number, height: number, duration: number, warnings: unknown[] }
interface PlanMixInput { clips: unknown[], settings: { width: number, height: number, gap: number } & Record<string, unknown> }
interface RenderStep { args: string[], outPath: string, duration: number, cache?: { path: string, tolerance: number } }
interface RenderJob {
  totalFrames: number,
  duration: number,
  files: { path: string, content: string }[],
  chunks: (RenderStep & { frames: number, chunk: { f0: number, f1: number, animated: boolean } })[],
  audio: RenderStep,
  concat: RenderStep,
  tempPaths: string[],
  cacheDir?: string,
}

const importRenderer = async <T>(file: string) => await import(pathToFileURL(path.join(rendererDir, file)).href) as T;
const { createEmptyMixProject } = await importRenderer<{ createEmptyMixProject: () => MixProject }>('videomix/types.ts');
interface ProjectFileModule {
  loadMixProject: (deps: unknown, file: string) => Promise<{ project: MixProject, missingSourceIds: string[] }>,
  saveMixProject: (deps: unknown, file: string, project: MixProject) => Promise<void>,
}
interface FixturesModule {
  testPlans: Record<string, MixPlan>,
  testClips: unknown[],
  testSourcePaths: (dir: string) => Record<string, string>,
  testSettings: (overrides?: Record<string, unknown>) => MixSettings,
  scalePlan: (plan: MixPlan, w: number, h: number) => MixPlan,
}
const { loadMixProject, saveMixProject } = await importRenderer<ProjectFileModule>('videomix/projectFile.ts');
const { getPlannerInput } = await importRenderer<{ getPlannerInput: (p: MixProject) => PlanMixInput }>('videomix/planner/plannerInput.ts');
const { planMix } = await importRenderer<{ planMix: (input: PlanMixInput) => MixPlan }>('videomix/planner/planMix.ts');
const { formatPlan } = await importRenderer<{ formatPlan: (plan: MixPlan) => string }>('videomix/planner/formatPlan.ts');
const { buildRenderJob } = await importRenderer<{ buildRenderJob: (options: Record<string, unknown>) => RenderJob }>('videomix/render/buildRenderJob.ts');
interface RenderCacheModule {
  getFileIdentity: (s: { size: number, mtimeMs: number }) => string,
  getRenderCacheKeys: (job: RenderJob, o: { fileIdentities: Record<string, string> }) => Promise<unknown>,
  applyRenderCache: (job: RenderJob, o: { dir: string, keys: unknown, runId: string, join: (a: string, b: string) => string, fps: number }) => RenderJob,
  getRenderCacheFileNames: (job: RenderJob, basename: (p: string) => string) => string[],
  pruneRenderCache: (o: Record<string, unknown>) => Promise<{ removedFiles: number, removedBytes: number, totalBytes: number }>,
}
const renderCache = await importRenderer<RenderCacheModule>('videomix/render/renderCache.ts');
const { runRenderJob } = await importRenderer<{ runRenderJob: (o: Record<string, unknown>) => Promise<{ renderedChunks: number, reusedChunks: number, audioReused: boolean }> }>('videomix/render/runRenderJob.ts');

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    size: { type: 'string', default: '640x360' },
    preset: { type: 'string', default: 'ultrafast' },
    crf: { type: 'string', default: '28' },
    out: { type: 'string' },
    frames: { type: 'string' },
    concurrency: { type: 'string', default: '2' },
    'max-chunk': { type: 'string', default: '15' },
    keep: { type: 'boolean', default: false },
    fixture: { type: 'string' },
    cache: { type: 'string' },
  },
});

const ffDir = path.join(repoRoot, 'ffmpeg', `${os.platform()}-${os.arch()}`, ...(os.platform() === 'darwin' ? [] : ['lib']));
const ffmpegPath = process.env['FFMPEG_PATH'] ?? path.join(ffDir, os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ffprobePath = process.env['FFPROBE_PATH'] ?? path.join(ffDir, os.platform() === 'win32' ? 'ffprobe.exe' : 'ffprobe');
const ffEnv = { ...process.env, LD_LIBRARY_PATH: ffDir };

function run(bin: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { env: ffEnv });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${path.basename(bin)} exited with ${code}\n${stderr.slice(-4000)}`));
    });
  });
}
const ffmpeg = async (args: string[]) => run(ffmpegPath, ['-loglevel', 'error', ...args]);

// --- built-in example: T02 media, flexible horizontal crops, a vertical with some zoom room ---
function exampleProject(mediaDir: string): MixProject {
  const project = createEmptyMixProject();
  const source = (id: string, file: string, width: number, height: number): MixSource => ({ id, path: path.join(mediaDir, file), absolutePath: path.join(mediaDir, file), name: file, width, height });
  project.sources = [
    source('h1080', 'h-1080p-10s.mp4', 1920, 1080),
    source('h720', 'h-720p-25fps-8s.mp4', 1280, 720),
    source('v1080', 'v-1080x1920-12s.mp4', 1080, 1920),
    source('rot', 'v-rotated-9s.mp4', 1080, 1920),
    source('sq', 'sq-1080-6s.mp4', 1080, 1080),
    source('v720', 'v-720x1280-silent-7s.mp4', 720, 1280),
  ];
  const full = (w: number, h: number): Rect => ({ x: 0, y: 0, width: w, height: h });
  const centered = (w: number, h: number, mw: number, mh: number): Rect => ({ x: 2 * Math.round((w - mw) / 4), y: 2 * Math.round((h - mh) / 4), width: mw, height: mh });
  let n = 0;
  const clip = (sourceId: string, start: number, end: number, maxRect: Rect, minRect?: Rect): MixClip => {
    n += 1;
    return { id: `c${n}`, sourceId, name: `clip ${n}`, color: n, start, end, maxRect, ...(minRect && { minRect }), muted: false, gainDb: 0 };
  };
  project.clips = [
    clip('h1080', 0, 5, full(1920, 1080), centered(1920, 1080, 800, 1080)),
    clip('v1080', 0, 7, full(1080, 1920), centered(1080, 1920, 1080, 1400)),
    clip('sq', 0, 4, full(1080, 1080)),
    clip('h720', 1, 7, full(1280, 720), centered(1280, 720, 560, 720)),
    clip('rot', 0.5, 6, full(1080, 1920)),
    clip('v720', 0, 5, full(720, 1280), centered(720, 1280, 720, 1000)),
    clip('h1080', 5, 9, full(1920, 1080)),
  ];
  project.settings = { ...project.settings, gap: { width: 8, color: '#303030' }, transition: { type: 'fade', duration: 0.5 } };
  return project;
}

const nodeDeps = { path, fs: await import('node:fs/promises') };
const mediaDir = path.join(repoRoot, 'test-media');
const [width, height] = opts.size.split('x').map(Number) as [number, number];

async function fromProject() {
  let projectFile = positionals[0];
  let dir: string;
  if (projectFile == null) {
    dir = path.resolve(opts.out ?? path.join(mediaDir, 'render-example'));
    await mkdir(dir, { recursive: true });
    projectFile = path.join(dir, 'example.vmx');
    await saveMixProject(nodeDeps, projectFile, exampleProject(mediaDir));
    console.log(`wrote ${projectFile}`);
  } else {
    dir = path.resolve(opts.out ?? path.join(mediaDir, `render-${path.basename(projectFile, path.extname(projectFile))}`));
  }
  const { project, missingSourceIds } = await loadMixProject(nodeDeps, path.resolve(projectFile));
  if (missingSourceIds.length > 0) throw new Error(`Missing sources: ${missingSourceIds.join(', ')} (run yarn generate-test-media?)`);
  const input = getPlannerInput(project);
  // The plan is computed for the output size (preview path of ADR-001); the gap scales with it.
  const gap = 2 * Math.round((input.settings.gap * Math.min(width, height)) / 1080 / 2); // by the short side (T29)
  input.settings = { ...input.settings, width, height, gap };
  const plan = planMix(input);
  return {
    dir,
    plan,
    clips: project.clips,
    sourcePaths: Object.fromEntries(project.sources.map((s) => [s.id, s.absolutePath])),
    sourceFrames: Object.fromEntries(project.sources.map((s) => [s.id, s])),
    settings: { ...project.settings, gap: { ...project.settings.gap, width: gap } },
  };
}

// --fixture <name>: a hand-written plan of render/renderTestFixtures.ts (e.g. relayout = the ADR-001 example)
async function fromFixture(name: string) {
  const fixtures = await importRenderer<FixturesModule>('videomix/render/renderTestFixtures.ts');
  const fixture = fixtures.testPlans[name];
  if (fixture == null) throw new Error(`Unknown fixture ${name}: ${Object.keys(fixtures.testPlans).join(', ')}`);
  const settings = fixtures.testSettings();
  const scale = width / fixture.width;
  return {
    dir: path.resolve(opts.out ?? path.join(mediaDir, `render-fixture-${name}`)),
    plan: fixtures.scalePlan(fixture, width, height),
    clips: fixtures.testClips,
    sourcePaths: fixtures.testSourcePaths(mediaDir),
    sourceFrames: undefined,
    settings: { ...settings, gap: { ...settings.gap, width: 2 * Math.round((settings.gap.width * scale) / 2) } },
  };
}

const { dir: outDir, plan, clips, sourcePaths, sourceFrames, settings } = opts.fixture != null ? await fromFixture(opts.fixture) : await fromProject();
await mkdir(outDir, { recursive: true });
console.log(formatPlan(plan));
if (plan.warnings.length > 0) console.log('warnings:', JSON.stringify(plan.warnings));

const outPath = path.join(outDir, 'out.mp4');
const workDir = path.join(outDir, 'work');
await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });
const job = buildRenderJob({
  plan,
  clips,
  sourcePaths,
  sourceFrames,
  settings,
  encoding: { crf: Number(opts.crf), preset: opts.preset },
  workDir,
  outPath,
  maxChunkSeconds: Number(opts['max-chunk']),
  join: path.join,
});

// --cache: the app's path (renderCache + runRenderJob), timed as a whole
if (opts.cache != null) {
  const cacheDir = path.resolve(opts.cache);
  const { stat, rename, readdir, utimes } = await import('node:fs/promises');
  const inputPaths = [...new Set(Object.values(sourcePaths))];
  const fileIdentities = Object.fromEntries(await Promise.all(inputPaths.map(async (p) => [p, renderCache.getFileIdentity(await stat(p))] as const)));
  const t0 = performance.now();
  const cachedJob = renderCache.applyRenderCache(job, { dir: cacheDir, keys: await renderCache.getRenderCacheKeys(job, { fileIdentities }), runId: String(process.pid), join: path.join, fps: settings.fps });
  const result = await runRenderJob({
    job: cachedJob,
    workDir,
    outPath,
    concurrency: Number(opts.concurrency),
    deps: {
      mkdir: async (dir: string) => { await mkdir(dir, { recursive: true }); },
      writeFile: async (p: string, c: string) => writeFile(p, c),
      rm: async (p: string) => rm(p, { recursive: true, force: true }),
      rename: async (a: string, b: string) => rename(a, b),
      runFfmpeg: async ({ args }: { args: string[] }) => { await ffmpeg(args); },
      abortAll: () => undefined,
      verifyCached: async (p: string, { duration, tolerance }: { duration: number, tolerance: number }) => {
        try {
          if ((await stat(p)).size === 0) return false;
          const probed = Number((await run(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p])).trim());
          if (!(Math.abs(probed - duration) <= tolerance)) return false;
          await utimes(p, new Date(), new Date());
          return true;
        } catch {
          return false;
        }
      },
    },
  });
  const pruned = await renderCache.pruneRenderCache({
    root: path.dirname(cacheDir),
    dir: cacheDir,
    keep: renderCache.getRenderCacheFileNames(cachedJob, path.basename),
    maxBytes: Infinity,
    now: Date.now(),
    deps: {
      list: async (dir: string) => Promise.all((await readdir(dir).catch(() => [] as string[])).map(async (name) => {
        const s = await stat(path.join(dir, name));
        return { name, size: s.size, mtimeMs: s.mtimeMs, isDirectory: s.isDirectory() };
      })),
      rm: async (p: string) => rm(p, { recursive: true, force: true }),
    },
    join: path.join,
  });
  console.log(`rendered ${outPath} with the cache in ${((performance.now() - t0) / 1000).toFixed(2)} s: ${result.renderedChunks} chunk(s) encoded, ${result.reusedChunks} reused, audio ${result.audioReused ? 'reused' : 'encoded'}; removed ${pruned.removedFiles} unused cache file(s), cache ${(pruned.totalBytes / 1e6).toFixed(1)} MB`);
} else {
  for (const file of job.files) await writeFile(file.path, file.content);

  const started = performance.now();
  let done = 0;
  let next = 0;
  await Promise.all(Array.from({ length: Number(opts.concurrency) }, async () => {
    while (next < job.chunks.length) {
      const step = job.chunks[next]!;
      const index = next;
      next += 1;
      const t0 = performance.now();
      // eslint-disable-next-line no-await-in-loop
      await ffmpeg(step.args);
      done += step.frames;
      console.log(`chunk ${index} [${step.chunk.f0}, ${step.chunk.f1})${step.chunk.animated ? ' animated' : ''}: ${((performance.now() - t0) / 1000).toFixed(2)} s, progress ${Math.round((100 * done) / job.totalFrames)} %`);
    }
  }));
  await ffmpeg(job.audio.args);
  await ffmpeg(job.concat.args);
  console.log(`rendered ${outPath} (${job.chunks.length} chunks) in ${((performance.now() - started) / 1000).toFixed(1)} s`);
}
console.log(await run(ffprobePath, ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,width,height,nb_read_frames,duration', '-of', 'compact', outPath]));

if (opts.frames != null) {
  for (const t of opts.frames.split(',')) {
    const png = path.join(outDir, `frame-${t}.png`);
    // eslint-disable-next-line no-await-in-loop
    await ffmpeg(['-y', '-ss', t, '-i', outPath, '-frames:v', '1', png]);
    console.log(`wrote ${png}`);
  }
}
if (!opts.keep) await rm(workDir, { recursive: true, force: true });
if (!existsSync(outPath)) throw new Error('no output');
