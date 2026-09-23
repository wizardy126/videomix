import { MIN_RECT_SIZE, MIX_PROJECT_VERSION, OVERLAY_COLOR_REGEX, defaultMixSettings, defaultMusicPlaylist, mixProjectSchema } from './types';
import type { MixClip, MixOverlay, MixProject, Rect } from './types';
import { rectContains } from './geometry';
import { findOverlayCycleIds, getOverlaysById } from './overlays/anchors';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v != null && !Array.isArray(v);

/** Id of the track migrated from a v2 project's single `settings.music` (unique within the playlist). */
export const MIGRATED_MUSIC_TRACK_ID = 'music';

/**
 * v2 → v3 settings (T24): `resolution: '1080p'` becomes `output: { aspect: '16:9', resolution: '1080' }` and the
 * optional `music` a playlist with one track (keeping its `loop`). An unknown resolution is carried over as is, so the
 * schema still rejects it. Missing fields (`encoder`, or `output` if `resolution` was missing) come from the defaults.
 */
function migrateSettingsV2ToV3(settings: Record<string, unknown>): Record<string, unknown> {
  const { resolution, music, ...rest } = settings;
  const ret: Record<string, unknown> = { ...rest };
  if (resolution !== undefined) {
    ret['output'] = { aspect: '16:9', resolution: typeof resolution === 'string' ? resolution.replace(/p$/, '') : resolution };
  }
  if (isObject(music)) {
    const { path, absolutePath, volumeDb, loop } = music;
    ret['musicPlaylist'] = { ...structuredClone(defaultMusicPlaylist), tracks: [{ id: MIGRATED_MUSIC_TRACK_ID, path, absolutePath, volumeDb }], loop };
  }
  return ret;
}

// Each entry upgrades a raw project from version `n` to `n + 1`.
const migrations: Record<number, (json: Record<string, unknown>) => Record<string, unknown>> = {
  // v2 (T19): overlays
  1: (json) => ({ ...json, version: 2, overlays: [] }),
  // v3 (T24): output aspect/resolution, encoder, music playlist (and, additive: text overlays, pinned/grouped clips)
  2: ({ settings, ...json }) => ({ ...json, version: 3, settings: isObject(settings) ? migrateSettingsV2ToV3(settings) : settings }),
};

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
  return mixProjectSchema.parse({
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
  | 'odd-gap'
  | 'duplicate-overlay-id'
  | 'overlay-broken-reference'
  | 'overlay-cycle'
  | 'overlay-box-out-of-range'
  | 'overlay-invalid-duration'
  | 'overlay-invalid-color'
  | 'overlay-fades-too-long'
  // v3 (T24)
  | 'overlay-empty-text'
  | 'overlay-invalid-entry'
  | 'overlay-entry-too-long'
  | 'pin-time-out-of-range'
  | 'pin-time-after-end'
  | 'group-too-small'
  | 'group-pin-conflict'
  | 'duplicate-music-track-id';

/** A problem found by {@link validateMixProject}. `message` is English for logs; the UI should map `code` to a translated text. */
export interface MixProjectIssue {
  level: 'error' | 'warning',
  code: MixProjectIssueCode,
  message: string,
  clipId?: string | undefined,
  sourceId?: string | undefined,
  overlayId?: string | undefined,
  /** Music playlist track. */
  trackId?: string | undefined,
  groupId?: string | undefined,
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

// Tolerance for boxes computed with floats (e.g. 1 - margin - height)
const BOX_EPSILON = 1e-9;

const overlayColors = (overlay: MixOverlay): string[] => {
  switch (overlay.type) {
    case 'countdown':
    case 'text': { return [overlay.color, overlay.border.color, ...(overlay.shadow ? [overlay.shadow.color] : [])]; }
    case 'progressBar': { return [overlay.fillColor, overlay.backgroundColor, overlay.border.color]; }
    default: { return []; }
  }
};

/**
 * Broken references and cycles are warnings: resolveOverlayTimes falls back to an absolute time, so the project still renders.
 * Boxes, durations and colors are errors, as the render relies on them.
 */
function validateOverlays({ overlays }: MixProject, clipIds: ReadonlySet<string>): MixProjectIssue[] {
  const issues: MixProjectIssue[] = [];
  const byId = getOverlaysById(overlays);
  const cycleIds = findOverlayCycleIds(overlays, byId);

  const seen = new Set<string>();
  overlays.forEach((overlay) => {
    const overlayId = overlay.id;
    const add = (level: MixProjectIssue['level'], code: MixProjectIssueCode, message: string) => issues.push({ level, code, message, overlayId });

    if (seen.has(overlayId)) add('error', 'duplicate-overlay-id', `Duplicate overlay id ${overlayId}`);
    seen.add(overlayId);

    const { anchor } = overlay;
    if (anchor.kind === 'clip' && !clipIds.has(anchor.clipId)) {
      add('warning', 'overlay-broken-reference', `Overlay ${overlayId} is anchored to unknown clip ${anchor.clipId}`);
    }
    if (anchor.kind === 'element' && !byId.has(anchor.elementId)) {
      add('warning', 'overlay-broken-reference', `Overlay ${overlayId} is anchored to unknown overlay ${anchor.elementId}`);
    }
    if (overlay.type === 'progressBar' && overlay.linkedCountdownId != null && byId.get(overlay.linkedCountdownId)?.type !== 'countdown') {
      add('warning', 'overlay-broken-reference', `Progress bar ${overlayId} is linked to unknown countdown ${overlay.linkedCountdownId}`);
    }
    if (cycleIds.has(overlayId)) add('warning', 'overlay-cycle', `Overlay ${overlayId} is part of an anchor cycle`);

    if (overlay.type === 'sound') return;

    const { box } = overlay;
    const inRange = (v: number) => Number.isFinite(v) && v >= -BOX_EPSILON && v <= 1 + BOX_EPSILON;
    if (![box.x, box.y, box.width, box.height, box.x + box.width, box.y + box.height].every((v) => inRange(v)) || box.width <= 0 || box.height <= 0) {
      add('error', 'overlay-box-out-of-range', `Overlay ${overlayId} box is outside the frame or empty`);
    }

    // A linked bar's own duration is not used
    const linked = overlay.type === 'progressBar' && overlay.linkedCountdownId != null;
    if (!linked && !(Number.isFinite(overlay.duration) && overlay.duration > 0)) {
      add('error', 'overlay-invalid-duration', `Overlay ${overlayId} has invalid duration ${overlay.duration}`);
    } else {
      const fades = overlay.type === 'image' || overlay.type === 'text' ? overlay.fadeIn + overlay.fadeOut : (overlay.type === 'countdown' ? overlay.fadeOut : 0);
      if (fades > overlay.duration) add('warning', 'overlay-fades-too-long', `Overlay ${overlayId} fades are longer than its duration`);
      if (overlay.type === 'text' && overlay.entry.kind !== 'none' && overlay.entry.duration > overlay.duration) {
        add('warning', 'overlay-entry-too-long', `Text ${overlayId} entry animation is longer than its duration`);
      }
    }

    if (overlay.type === 'text') {
      // Renders nothing: probably left empty by mistake
      if (overlay.text.trim() === '') add('warning', 'overlay-empty-text', `Text ${overlayId} is empty`);
      if (overlay.entry.kind === 'slide' && overlay.entry.from == null) add('error', 'overlay-invalid-entry', `Text ${overlayId} slides in from no side`);
    }

    if (overlayColors(overlay).some((color) => !OVERLAY_COLOR_REGEX.test(color))) {
      add('error', 'overlay-invalid-color', `Overlay ${overlayId} has an invalid color`);
    }
  });

  return issues;
}

/**
 * Pinned and grouped clips (A4). A negative (or not finite) `pinTime` is an error. The rest are warnings, handled by the
 * planner (T30): a clip pinned after the end of all the others can only start there with a gap before it, a group of
 * one clip is ignored, and a group can't start at two pinned times.
 */
function validateClipPlacement(clips: MixClip[]): MixProjectIssue[] {
  const issues: MixProjectIssue[] = [];
  const totalDuration = clips.reduce((acc, clip) => acc + Math.max(0, getClipDuration(clip)), 0);

  const groups = new Map<string, MixClip[]>();
  clips.forEach((clip) => {
    const { id: clipId, sourceId, pinTime, groupId } = clip;
    if (pinTime != null) {
      if (!(Number.isFinite(pinTime) && pinTime >= 0)) {
        issues.push({ level: 'error', code: 'pin-time-out-of-range', message: `Clip ${clipId} is pinned at invalid time ${pinTime}`, clipId, sourceId });
      } else if (pinTime > totalDuration - Math.max(0, getClipDuration(clip))) {
        issues.push({ level: 'warning', code: 'pin-time-after-end', message: `Clip ${clipId} is pinned after the end of the other clips`, clipId, sourceId });
      }
    }
    if (groupId != null) groups.set(groupId, [...(groups.get(groupId) ?? []), clip]);
  });

  groups.forEach((members, groupId) => {
    if (members.length < 2) {
      issues.push({ level: 'warning', code: 'group-too-small', message: `Group ${groupId} has only one clip`, groupId, clipId: members[0]?.id });
    }
    const pinTimes = new Set(members.flatMap((clip) => (clip.pinTime != null ? [clip.pinTime] : [])));
    if (pinTimes.size > 1) issues.push({ level: 'warning', code: 'group-pin-conflict', message: `Group ${groupId} has clips pinned at different times`, groupId });
  });

  return issues;
}

/**
 * Semantic checks of 04-diseno §1.2 and §8.1 that the schema can't express.
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

  issues.push(...validateClipPlacement(project.clips));

  const trackIds = new Set<string>();
  settings.musicPlaylist.tracks.forEach(({ id: trackId }) => {
    if (trackIds.has(trackId)) issues.push({ level: 'error', code: 'duplicate-music-track-id', message: `Duplicate music track id ${trackId}`, trackId });
    trackIds.add(trackId);
  });

  if (settings.gap.width % 2 !== 0) {
    issues.push({ level: 'warning', code: 'odd-gap', message: 'Odd gap width can leave a 1px fill column (yuv420p needs even widths)' });
  }

  issues.push(...validateOverlays(project, clipIds));

  return issues;
}
