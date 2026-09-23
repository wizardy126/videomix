// Generates a fixed set of synthetic media files under test-media/ (git-ignored) so that
// VideoMix development and manual testing has reproducible fixtures without shipping real
// video assets in the repo. Run with `yarn generate-test-media` (add `--force` to regenerate
// files that already exist).
import { join } from 'node:path';
import { mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { execa } from 'execa';


const platform = os.platform();
const arch = os.arch();
const isWindows = platform === 'win32';
const isLinux = platform === 'linux';

const outDir = 'test-media';
const force = process.argv.includes('--force');

// Mirrors getFfPath() in src/main/ffmpeg.ts (dev layout), but can be overridden with FFMPEG_PATH
// for environments where the bundled ffmpeg wasn't downloaded (see 06-entorno-desarrollo.md).
function getFfmpegPath() {
  const envFfmpegPath = process.env['FFMPEG_PATH'];
  if (envFfmpegPath != null && envFfmpegPath !== '') {
    return { ffmpegPath: envFfmpegPath, ldLibraryDir: undefined };
  }

  const dir = join('ffmpeg', `${platform}-${arch}`, ...(isWindows || isLinux ? ['lib'] : []));
  return {
    ffmpegPath: join(dir, isWindows ? 'ffmpeg.exe' : 'ffmpeg'),
    // Unlike the packaged app, the dev ffmpeg binary is not built with a rpath that finds its
    // sibling .so files, so it needs LD_LIBRARY_PATH on Linux (see 06-entorno-desarrollo.md).
    ldLibraryDir: isLinux ? dir : undefined,
  };
}

const { ffmpegPath, ldLibraryDir } = getFfmpegPath();
const ffmpegEnv = ldLibraryDir != null ? { LD_LIBRARY_PATH: ldLibraryDir } : {};

async function runFfmpeg(args: string[]) {
  await execa(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { env: ffmpegEnv });
}

async function detectDrawtextSupport() {
  try {
    const { stdout } = await execa(ffmpegPath, ['-hide_banner', '-filters'], { env: ffmpegEnv });
    return /\bdrawtext\b/.test(stdout);
  } catch {
    return false;
  }
}

// testsrc2 already burns in a running clock, so when drawtext isn't available (e.g. ffmpeg built
// without libfreetype) we fall back to relying on that instead of failing the whole file.
function withTimeOverlay(videoFilter: string, hasDrawtext: boolean) {
  if (!hasDrawtext) return videoFilter;
  return `${videoFilter},drawtext=text='%{pts\\:hms}':fontsize=48:fontcolor=white:box=1:boxcolor=black@0.5:x=10:y=10`;
}

async function fileExists(path: string) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function generate(outName: string, args: string[]) {
  const outPath = join(outDir, outName);
  if (!force && await fileExists(outPath)) {
    console.log(`Skipping ${outName} (already exists, use --force to regenerate)`);
    return;
  }
  console.log(`Generating ${outName}`);
  await runFfmpeg([...args, outPath]);
}

// v-rotated-9s.mp4 needs an actual display-matrix rotation (as real camera recordings have),
// not just rotated pixels. `-display_rotation` only takes effect on an input stream (it sets the
// side data ffmpeg then carries through muxing), so we first encode a plain temp file and then
// remux it with `-c copy`, adding the rotation as an input option on that second pass. This is
// also how the as-built reads/writes rotation, see useFfmpegOperations.ts.
async function generateRotated(outName: string, encodeArgs: string[]) {
  const outPath = join(outDir, outName);
  if (!force && await fileExists(outPath)) {
    console.log(`Skipping ${outName} (already exists, use --force to regenerate)`);
    return;
  }
  console.log(`Generating ${outName}`);
  const tempPath = join(outDir, `.${outName}.unrotated.mp4`);
  try {
    await runFfmpeg([...encodeArgs, tempPath]);
    await runFfmpeg(['-display_rotation:v:0', '90', '-i', tempPath, '-c', 'copy', outPath]);
  } finally {
    await rm(tempPath, { force: true });
  }
}

// --- Synthetic music (sine chords mixed with amix, chords concatenated) ---
async function generateMusic(outName: string, durationSec: number, codecArgs: string[]) {
  const outPath = join(outDir, outName);
  if (!force && await fileExists(outPath)) {
    console.log(`Skipping ${outName} (already exists, use --force to regenerate)`);
    return;
  }
  console.log(`Generating ${outName}`);

  // A few simple chords (root, third, fifth) cycled to fill the requested duration.
  const chords = [
    [261.63, 329.63, 392], // C major
    [349.23, 440, 523.25], // F major
    [392, 493.88, 587.33], // G major
    [220, 261.63, 329.63], // A minor
  ];
  const segmentDuration = 4;
  const numSegments = Math.max(1, Math.round(durationSec / segmentDuration));
  const actualSegmentDuration = durationSec / numSegments;

  const inputArgs: string[] = [];
  const filterParts: string[] = [];
  const segmentLabels: string[] = [];
  for (let s = 0; s < numSegments; s += 1) {
    const chord = chords[s % chords.length]!;
    const noteRefs = chord.map((freq) => {
      const inputIndex = inputArgs.length / 4; // 4 args pushed per input below
      inputArgs.push('-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${actualSegmentDuration}`);
      return `[${inputIndex}:a]`;
    });
    const segmentLabel = `seg${s}`;
    filterParts.push(`${noteRefs.join('')}amix=inputs=${chord.length}:normalize=1[${segmentLabel}]`);
    segmentLabels.push(`[${segmentLabel}]`);
  }
  filterParts.push(`${segmentLabels.join('')}concat=n=${numSegments}:v=0:a=1[out]`);

  await runFfmpeg([
    ...inputArgs,
    '-filter_complex', filterParts.join(';'),
    '-map', '[out]',
    ...codecArgs,
    outPath,
  ]);
}

await mkdir(outDir, { recursive: true });

if (!await fileExists(ffmpegPath)) {
  throw new Error(`ffmpeg not found at "${ffmpegPath}". Run "yarn download-ffmpeg-${platform}-${arch}" first, or set FFMPEG_PATH. See docs/videomix/06-entorno-desarrollo.md.`);
}

const hasDrawtext = await detectDrawtextSupport();

await generate('h-1080p-10s.mp4', [
  '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=10',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10',
  '-vf', withTimeOverlay('null', hasDrawtext),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
]);

await generate('h-720p-25fps-8s.mp4', [
  '-f', 'lavfi', '-i', 'smptebars=size=1280x720:rate=25:duration=8',
  '-f', 'lavfi', '-i', 'sine=frequency=660:duration=8',
  '-vf', withTimeOverlay('null', hasDrawtext),
  '-af', 'volume=-12dB',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
]);

await generate('v-1080x1920-12s.mp4', [
  '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=12',
  '-f', 'lavfi', '-i', 'anoisesrc=color=pink:duration=12',
  '-vf', withTimeOverlay('null', hasDrawtext),
  '-af', 'volume=-24dB',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
]);

await generateRotated('v-rotated-9s.mp4', [
  '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=9',
  '-f', 'lavfi', '-i', 'sine=frequency=550:duration=9',
  '-vf', withTimeOverlay('null', hasDrawtext),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
]);

await generate('sq-1080-6s.mp4', [
  '-f', 'lavfi', '-i', 'testsrc2=size=1080x1080:rate=30:duration=6',
  '-vf', withTimeOverlay('null', hasDrawtext),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  '-an',
]);

await generate('v-720x1280-silent-7s.mp4', [
  '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30:duration=7',
  '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100:duration=7',
  '-vf', withTimeOverlay('null', hasDrawtext),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
]);

await generateMusic('music-20s.m4a', 20, ['-c:a', 'aac', '-b:a', '128k']);
await generateMusic('music-60s.mp3', 60, ['-c:a', 'libmp3lame', '-b:a', '128k']);

// T23: a transparent PNG (a plain circular "logo") and a short beep, for the overlays example project
// (script/videomix/renderOverlaysExample.ts) and manual testing of the image and sound overlay types.
await generate('overlay-logo.png', [
  '-f', 'lavfi', '-i', 'color=c=0x2266ff:s=400x400',
  '-vf', String.raw`format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(pow(X-200\,2)+pow(Y-200\,2)\,200*200)\,255\,0)'`,
  '-frames:v', '1',
]);
// 0.2 s: short enough to read as a countdown "beep" (and short enough that, pre-T21b, ffmpeg's loudnorm gating
// couldn't measure it at all — it reported -inf for any whole file under ~0.4 s, which the loudness normalization
// then treated as silence). T21b fixes this by measuring a looped copy of the file instead (measureLoudness), so
// this can now be as short as an actual countdown beep and still be normalized and heard.
await generate('overlay-beep.wav', [
  '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.2',
  '-af', 'afade=t=out:st=0.15:d=0.05',
  '-c:a', 'pcm_s16le',
]);

console.log(`Done. Files are in ${outDir}/`);
