import type { RenderChunkStep, RenderJob, RenderStep } from './buildRenderJob';
import { escapeFilterValue } from './ffmpegArgs';
import type { PathLike } from './renderOutput';

// Incremental render (T28, D1): the video chunks and the audio pass are cached by a key made of what ffmpeg is asked
// to do, so an unchanged chunk is reused instead of re-encoded. Pure: file system access is injected.
//
// A step's key hashes its args with the job's own temp paths taken out (the graph file is replaced by its content,
// the output by a placeholder), plus the identity (size + mtime) of every project file the step reads, so replacing
// a source file in place also invalidates it. The encoder args are part of the args (codec, resolved hardware
// encoder, CRF/preset, fps), so a change there re-renders everything.

/** Bump when the meaning of a key changes without the args changing (e.g. a different container for chunks). */
export const RENDER_CACHE_VERSION = 1;

/** Default of the `renderCacheMaxBytes` setting: total size of one project's render cache. 0 disables the cache. */
export const DEFAULT_RENDER_CACHE_MAX_BYTES = 5 * 1024 ** 3;

/** Partial files of a render still running (another window or instance) look like this: left alone for a while. */
export const PARTIAL_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Caches of unsaved projects (userData/videomix-cache/<id>) not used for this long are removed at startup. */
export const UNSAVED_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Identity of an input file: its content is assumed unchanged while its size and mtime are. */
export const getFileIdentity = ({ size, mtimeMs }: { size: number, mtimeMs: number }) => `${size}:${Math.round(mtimeMs)}`;

/** Hidden folder next to the project (01-requisitos D1): `.<name>.vmx.cache`. */
export const getProjectCacheRoot = (path: PathLike, projectPath: string) => path.join(path.dirname(projectPath), `.${path.basename(projectPath)}.cache`);

/** Unsaved projects: `userData/videomix-cache/<id>` (`id` lives for the session). */
export const getUnsavedCacheParent = (path: PathLike, userDataDir: string) => path.join(userDataDir, 'videomix-cache');

/**
 * Subfolder for one kind of render: the final render and each preview resolution are cached apart, so a preview's
 * cleanup never removes the final render's chunks (and vice versa).
 */
export const getRenderCacheDir = (path: PathLike, root: string, { preview, width, height }: { preview: boolean, width: number, height: number }) => (
  path.join(root, preview ? `preview-${width}x${height}` : 'render')
);

// v-<key>.mp4 (video chunk), a-<key>.m4a (audio pass) and their partials v-<key>.<run>-<n>.part.mp4
const cacheFilePattern = /^[av]-[\da-f]{16,}(?:\.[\w-]+\.part)?\.(?:mp4|m4a)$/;
const partialFilePattern = /\.part\.(?:mp4|m4a)$/;

/** The text a step's key is the hash of. Exported for tests. */
export function getStepKeySource(step: RenderStep, { files, fileIdentities }: {
  /** The job's text files by path (graphs): an arg that is one of them is replaced by its content. */
  files: Map<string, string>,
  fileIdentities: Record<string, string>,
}) {
  const contents: string[] = [];
  const args = step.args.map((arg) => {
    if (arg === step.outPath) return '<out>';
    const content = files.get(arg);
    if (content == null) return arg;
    contents.push(content);
    return `<file ${contents.length - 1}>`;
  });
  // Inputs (-i) are args; fonts are only in the graph, escaped
  const inputs = Object.entries(fileIdentities)
    .filter(([filePath]) => step.args.includes(filePath) || contents.some((content) => content.includes(escapeFilterValue(filePath))))
    .sort(([a], [b]) => (a < b ? -1 : (a > b ? 1 : 0)));
  return JSON.stringify({ version: RENDER_CACHE_VERSION, args, contents, inputs });
}

export interface RenderCacheKeys {
  chunks: string[],
  audio: string,
}

/** SHA-256 in hex with Web Crypto (renderer and Node alike). */
export async function sha256Hex(text: string) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Cache keys of the chunks and of the audio pass of a job. `fileIdentities`: {@link getFileIdentity} of every project
 * file (sources, music, overlay files, fonts) by the path used in the job. The key is also the file name.
 */
export async function getRenderCacheKeys(job: RenderJob, { fileIdentities }: {
  fileIdentities: Record<string, string>,
}): Promise<RenderCacheKeys> {
  const files = new Map(job.files.map((f) => [f.path, f.content]));
  // 160 bits are plenty, and keep the names short
  const key = async (step: RenderStep) => (await sha256Hex(getStepKeySource(step, { files, fileIdentities }))).slice(0, 40);
  const [audio, ...chunks] = await Promise.all([job.audio, ...job.chunks].map(async (step) => key(step)));
  return { chunks, audio: audio! };
}

/** A line of the concat demuxer's list: quoted, so any path works (https://ffmpeg.org/ffmpeg-formats.html#concat-1). */
export const getConcatListLine = (filePath: string) => `file '${filePath.replaceAll('\'', String.raw`'\''`)}'\n`;

const replaceArg = (args: string[], from: string, to: string) => args.map((arg) => (arg === from ? to : arg));

/**
 * The job with its chunks and audio pass cached in `dir`: each writes to a partial name there (`runId` keeps two runs
 * apart) and the runner renames it to its key's name, so a cache file is always complete. The concat reads the cache
 * files (absolute paths in its list, which stays in the work dir).
 */
export function applyRenderCache(job: RenderJob, { dir, keys, runId, join, fps }: {
  dir: string,
  keys: RenderCacheKeys,
  runId: string,
  join: (parent: string, name: string) => string,
  fps: number,
}): RenderJob {
  const chunks = job.chunks.map((chunk, index): RenderChunkStep => {
    const key = keys.chunks[index]!;
    // per step: two identical chunks of one job may render at the same time
    const partialPath = join(dir, `v-${key}.${runId}-${index}.part.mp4`);
    return {
      ...chunk,
      outPath: partialPath,
      args: replaceArg(chunk.args, chunk.outPath, partialPath),
      // the container duration of a chunk of N frames is N/fps: allow one frame
      cache: { path: join(dir, `v-${key}.mp4`), tolerance: 1 / fps + 0.001 },
    };
  });
  const audioPartialPath = join(dir, `a-${keys.audio}.${runId}.part.m4a`);
  const audioCachePath = join(dir, `a-${keys.audio}.m4a`);
  const audio: RenderStep = {
    ...job.audio,
    outPath: audioPartialPath,
    args: replaceArg(job.audio.args, job.audio.outPath, audioPartialPath),
    // AAC works in frames of 1024 samples (+ priming)
    cache: { path: audioCachePath, tolerance: 0.1 },
  };

  // -f concat -safe 0 -i <list>
  const listIndex = job.concat.args.indexOf('concat');
  const listPath = job.concat.args[listIndex + 4];
  if (listIndex < 0 || job.concat.args[listIndex + 3] !== '-i' || listPath == null) throw new Error('Unexpected concat args');
  const files = job.files.map((file) => (file.path === listPath ? { ...file, content: chunks.map((c) => getConcatListLine(c.cache!.path)).join('') } : file));

  return {
    ...job,
    files,
    chunks,
    audio,
    concat: { ...job.concat, args: replaceArg(job.concat.args, job.audio.outPath, audioCachePath) },
    // the partials are the runner's business; the cache files stay
    tempPaths: job.files.map((f) => f.path),
    cacheDir: dir,
  };
}

/** The file names in the cache dir that a (cached) job uses. */
export const getRenderCacheFileNames = (job: RenderJob, basename: (p: string) => string) => (
  [...job.chunks, job.audio].flatMap((step) => (step.cache != null ? [basename(step.cache.path)] : []))
);

export interface CacheDirEntry {
  name: string,
  size: number,
  mtimeMs: number,
  isDirectory: boolean,
}

export interface RenderCacheFsDeps {
  /** Entries of `dir` (without following links); [] if it doesn't exist. */
  list: (dir: string) => Promise<CacheDirEntry[]>,
  /** Recursive, no error if missing. */
  rm: (filePath: string) => Promise<void>,
}

/**
 * After a successful render (D1 "limits"):
 * 1. in `dir` (the cache dir of that kind of render), removes the cache files the render didn't use (`keep`), and
 *    partials old enough not to belong to a running render;
 * 2. if the whole cache `root` (all kinds of render) is still over `maxBytes`, removes the least recently used files
 *    (mtime: the app touches a file when it reuses it), the ones this render used last.
 * Only files named like cache files are touched.
 */
export async function pruneRenderCache({ root, dir, keep, maxBytes, now, deps, join }: {
  root: string,
  dir: string,
  keep: Iterable<string>,
  maxBytes: number,
  now: number,
  deps: RenderCacheFsDeps,
  join: (parent: string, name: string) => string,
}) {
  const keepSet = new Set(keep);
  let removedBytes = 0;
  let removedFiles = 0;
  const remove = async (filePath: string, size: number) => {
    await deps.rm(filePath);
    removedBytes += size;
    removedFiles += 1;
  };

  const unused = (await deps.list(dir)).filter((entry) => !entry.isDirectory && cacheFilePattern.test(entry.name) && !keepSet.has(entry.name)
    && !(partialFilePattern.test(entry.name) && now - entry.mtimeMs < PARTIAL_MAX_AGE_MS));
  for (const entry of unused) {
    // eslint-disable-next-line no-await-in-loop
    await remove(join(dir, entry.name), entry.size);
  }

  const files = (await Promise.all((await deps.list(root)).filter((e) => e.isDirectory).map(async (sub) => {
    const subDir = join(root, sub.name);
    return (await deps.list(subDir))
      .filter((e) => !e.isDirectory && cacheFilePattern.test(e.name) && !partialFilePattern.test(e.name))
      .map((e) => ({ ...e, path: join(subDir, e.name), used: subDir === dir && keepSet.has(e.name) }));
  }))).flat();
  let totalBytes = files.reduce((acc, f) => acc + f.size, 0);
  if (totalBytes > maxBytes) {
    const byAge = files.sort((a, b) => (Number(a.used) - Number(b.used)) || (a.mtimeMs - b.mtimeMs));
    for (const file of byAge) {
      if (totalBytes <= maxBytes) break;
      // eslint-disable-next-line no-await-in-loop
      await remove(file.path, file.size);
      totalBytes -= file.size;
    }
  }
  return { removedFiles, removedBytes, totalBytes };
}

/**
 * "Clear render cache" (T28): removes the entries of the cache `root`, except the ones named in `keep` (T43: the
 * converted previews of the sources, T42, which aren't render cache and can be slow to make again). The root itself
 * goes too when nothing is kept. Returns the bytes freed.
 */
export async function clearRenderCache({ root, keep, deps, join }: {
  root: string,
  keep: Iterable<string>,
  deps: RenderCacheFsDeps,
  join: (parent: string, name: string) => string,
}) {
  const keepSet = new Set(keep);
  const sizeOf = async (dir: string): Promise<number> => (await Promise.all((await deps.list(dir)).map(async (entry) => (
    entry.isDirectory ? sizeOf(join(dir, entry.name)) : entry.size
  )))).reduce((acc, size) => acc + size, 0);

  const entries = await deps.list(root);
  const toRemove = entries.filter((entry) => !keepSet.has(entry.name));
  const bytes = (await Promise.all(toRemove.map(async (entry) => (entry.isDirectory ? sizeOf(join(root, entry.name)) : entry.size))))
    .reduce((acc, size) => acc + size, 0);
  await (toRemove.length === entries.length
    ? deps.rm(root)
    : Promise.all(toRemove.map(async (entry) => deps.rm(join(root, entry.name)))));
  return bytes;
}

/** Caches of unsaved projects not used for `maxAgeMs` (entries of userData/videomix-cache). Returns their names. */
export const getStaleUnsavedCaches = (entries: CacheDirEntry[], now: number, maxAgeMs = UNSAVED_CACHE_MAX_AGE_MS) => (
  entries.filter((e) => e.isDirectory && now - e.mtimeMs > maxAgeMs).map((e) => e.name)
);
