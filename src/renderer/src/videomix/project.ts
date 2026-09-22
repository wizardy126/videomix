import { MIN_RECT_SIZE, MIX_PROJECT_VERSION, defaultMixSettings, mixProjectV1Schema } from './types';
import type { MixClip, MixProject, Rect } from './types';
import { rectContains } from './geometry';

// Each entry upgrades a raw project from version `n` to `n + 1`. Empty while only v1 exists.
const migrations: Record<number, (json: Record<string, unknown>) => Record<string, unknown>> = {};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v != null && !Array.isArray(v);

/**
 * Parse and validate a raw `.vmx` object (already JSON5-parsed), migrating older versions.
 * Missing settings fields are taken from the defaults, so projects saved by older builds keep loading.
 * Throws (ZodError for schema errors) if the project is invalid or from a newer version.
 */
export function parseMixProject(json: unknown): MixProject {
  if (!isObject(json)) throw new Error('Invalid project file: not an object');
  let project = json;
  const { version } = project;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new Error('Invalid project file: missing version');
  if (version > MIX_PROJECT_VERSION) throw new Error(`Project version ${version} is newer than supported (${MIX_PROJECT_VERSION})`);

  for (let v = version; v < MIX_PROJECT_VERSION; v += 1) {
    const migrate = migrations[v];
    if (migrate == null) throw new Error(`No migration from project version ${v}`);
    project = migrate(project);
  }

  const { settings } = project;
  return mixProjectV1Schema.parse({
    ...project,
    settings: isObject(settings) ? { ...structuredClone(defaultMixSettings), ...settings } : settings,
  });
}

export type MixProjectIssueCode =
  | 'duplicate-source-id'
  | 'duplicate-clip-id'
  | 'unknown-source'
  | 'invalid-time-range'
  | 'end-after-source-duration'
  | 'rect-too-small'
  | 'max-rect-outside-frame'
  | 'min-rect-outside-max'
  | 'clip-shorter-than-transitions'
  | 'odd-gap';

/** A problem found by {@link validateMixProject}. `message` is English for logs; the UI should map `code` to a translated text. */
export interface MixProjectIssue {
  level: 'error' | 'warning',
  code: MixProjectIssueCode,
  message: string,
  clipId?: string | undefined,
  sourceId?: string | undefined,
}

export const getClipDuration = (clip: Pick<MixClip, 'start' | 'end'>) => clip.end - clip.start;

/** Clips grouped by `sourceId`, keeping list order inside each group. */
export function clipsBySource(clips: MixClip[]) {
  const map = new Map<string, MixClip[]>();
  clips.forEach((clip) => {
    const list = map.get(clip.sourceId);
    if (list) list.push(clip);
    else map.set(clip.sourceId, [clip]);
  });
  return map;
}

/**
 * Semantic checks of 04-diseno §1.2 that the schema can't express.
 * Source size/duration come from the source cache, overridable with fresher values (e.g. from ffprobe).
 * Checks that need an unknown size/duration are skipped.
 * Errors make the project unrenderable; warnings are handled downstream (e.g. the planner shortens the transition).
 */
export function validateMixProject(project: MixProject, { sourceDurations = {}, sourceSizes = {} }: {
  sourceDurations?: Record<string, number>,
  sourceSizes?: Record<string, { width: number, height: number }>,
} = {}): MixProjectIssue[] {
  const issues: MixProjectIssue[] = [];
  const { settings } = project;

  const sourcesById = new Map(project.sources.map((s) => [s.id, s]));
  if (sourcesById.size !== project.sources.length) {
    issues.push({ level: 'error', code: 'duplicate-source-id', message: 'Duplicate source id' });
  }

  const clipIds = new Set<string>();
  project.clips.forEach((clip) => {
    const clipId = clip.id;
    const error = (code: MixProjectIssueCode, message: string) => issues.push({ level: 'error', code, message, clipId, sourceId: clip.sourceId });

    if (clipIds.has(clipId)) error('duplicate-clip-id', `Duplicate clip id ${clipId}`);
    clipIds.add(clipId);

    const source = sourcesById.get(clip.sourceId);
    if (source == null) error('unknown-source', `Clip ${clipId} references unknown source ${clip.sourceId}`);

    if (!(clip.start >= 0 && clip.start < clip.end)) {
      error('invalid-time-range', `Clip ${clipId} has invalid time range ${clip.start}-${clip.end}`);
    } else {
      const duration = sourceDurations[clip.sourceId] ?? source?.duration;
      if (duration != null && clip.end > duration) error('end-after-source-duration', `Clip ${clipId} ends after its source (${duration}s)`);

      const minDuration = 2 * settings.transition.duration;
      if (getClipDuration(clip) <= minDuration) {
        issues.push({ level: 'warning', code: 'clip-shorter-than-transitions', message: `Clip ${clipId} is not longer than 2 transitions`, clipId, sourceId: clip.sourceId });
      }
    }

    const rects: Rect[] = [clip.maxRect, ...(clip.minRect ? [clip.minRect] : [])];
    if (rects.some((r) => r.width < MIN_RECT_SIZE || r.height < MIN_RECT_SIZE)) {
      error('rect-too-small', `Clip ${clipId} has a rect smaller than ${MIN_RECT_SIZE}px`);
    }

    const size = sourceSizes[clip.sourceId] ?? (source?.width != null && source.height != null ? { width: source.width, height: source.height } : undefined);
    if (size != null && !rectContains({ x: 0, y: 0, ...size }, clip.maxRect)) {
      error('max-rect-outside-frame', `Clip ${clipId} max rect is outside the source frame`);
    }

    if (clip.minRect != null && !rectContains(clip.maxRect, clip.minRect)) {
      error('min-rect-outside-max', `Clip ${clipId} min rect is not inside its max rect`);
    }
  });

  if (settings.gap.width % 2 !== 0) {
    issues.push({ level: 'warning', code: 'odd-gap', message: 'Odd gap width can leave a 1px fill column (yuv420p needs even widths)' });
  }

  return issues;
}
