import { MIN_RECT_SIZE, MIX_PROJECT_VERSION, OVERLAY_COLOR_REGEX, defaultMixSettings, defaultMusicPlaylist, mixProjectSchema } from './types';
import type { MixClip, MixOverlay, MixProject, MixSettings, Rect } from './types';
import { rectContains } from './geometry';
import { getClipFrame } from './clipRotation';
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
  // v4 (T36): everything is additive (settings.links/maxDuration/alwaysVisible, MixClip.link), filled by parseMixProject's default merge
  3: (json) => ({ ...json, version: 4 }),
  // v5 (T44): additive too (MixClip.keyframes, MixSource.blackBars, settings.autoCropBlackBars from the defaults: on)
  4: (json) => ({ ...json, version: 5 }),
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
  // T26
  | 'overlay-invalid-font-size'
  | 'pin-time-out-of-range'
  | 'pin-time-after-end'
  | 'group-too-small'
  | 'group-pin-conflict'
  | 'duplicate-music-track-id'
  // v4 (T36)
  | 'max-duration-out-of-range'
  | 'always-visible-unknown-clip'
  | 'duplicate-always-visible-id'
  | 'clip-in-sequence-and-group'
  // v5 (T44)
  | 'invalid-keyframes';

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

/**
 * Clips of the same source are considered "touching" (gap ≈ 0) within this tolerance (s), about a couple of frames at
 * a low fps: a clip cut a hair short of the previous one's end (rounding, or the user's own trim) still counts as
 * adjacent for the automatic link, instead of as an overlap.
 */
export const LINK_GAP_TOLERANCE = 0.05;

/**
 * Automatic clip links (E2, T36): chains of clips of the same source that share a slot (column or row), one after
 * the other with a hard cut (or the project's global transition, `settings.links.transition`).
 *
 * - Clips are grouped by `sourceId` and, inside each source, ordered by `start`.
 * - A clip links to the *previous eligible* clip of its source (in that order) when `0 ≤ start − prev.end ≤ maxGap`
 *   (allowing a little slack below 0, `LINK_GAP_TOLERANCE`, for clips that only *touch*), unless overridden by
 *   `MixClip.link`: `'break'` never links it, `'force'` always does — including past `maxGap` or over an overlap.
 *   `maxGap: 0` disables automatic linking entirely (01-requisitos §11 E2): only `'force'` still links.
 * - Clips that actually **overlap** (start well before the previous one ends, past the tolerance) are *never*
 *   auto-linked, regardless of `maxGap`: E6 creates such pairs deliberately (duplicate a clip, or "new clip from
 *   here") to frame the *same* footage differently, and playing them one after the other would repeat the content.
 *   Only `'force'` links an overlapping pair.
 * - Pinned (`pinTime != null`) or grouped (`groupId != null`) clips are never auto-linked: they keep their own
 *   placement rules (T30) and are left out of the chains entirely (not even as a lone chain), same as the clips of
 *   the always-visible sequence (E5), which get their own dedicated slot. `link` is ignored on them.
 *
 * A chain always has at least one clip (an eligible clip with no link on either side is a chain of its own). Chains
 * are returned grouped by source (in the order the sources first appear among the eligible clips) and, inside a
 * source, ordered by the `start` of their first clip.
 */
export function getClipChains(project: Pick<MixProject, 'clips' | 'settings'>): MixClip[][] {
  const { maxGap } = project.settings.links;
  const alwaysVisible = new Set(project.settings.alwaysVisible.clipIds);
  const eligible = project.clips.filter((clip) => clip.pinTime == null && clip.groupId == null && !alwaysVisible.has(clip.id));

  const chains: MixClip[][] = [];
  const pushChain = (chain: MixClip[]) => { if (chain.length > 0) chains.push(chain); };

  clipsBySource(eligible).forEach((clips) => {
    const sorted = [...clips].sort((a, b) => a.start - b.start);
    let chain: MixClip[] = [];
    sorted.forEach((clip) => {
      const prev = chain.at(-1);
      const gap = prev == null ? undefined : clip.start - prev.end;
      const autoLinks = gap != null && maxGap > 0 && gap >= -LINK_GAP_TOLERANCE && gap <= maxGap;
      const linked = prev != null && (clip.link === 'force' || (clip.link !== 'break' && autoLinks));
      if (linked) {
        chain.push(clip);
      } else {
        pushChain(chain);
        chain = [clip];
      }
    });
    pushChain(chain);
  });
  return chains;
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
      if (overlay.fontSize != null && !(Number.isFinite(overlay.fontSize) && overlay.fontSize > 0)) {
        add('error', 'overlay-invalid-font-size', `Text ${overlayId} has invalid font size ${overlay.fontSize}`);
      }
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
 * `settings.maxDuration` (E4), the always-visible sequence (E5, one per project) and the interaction between the
 * two features (T36). `clipIds` unknown or duplicated inside the sequence are errors; a clip that is both in the
 * sequence and in a group is a warning (the sequence gives it its own slot, so grouping it has no effect).
 */
function validateLinksAndSequence(settings: MixSettings, clips: MixClip[]): MixProjectIssue[] {
  const issues: MixProjectIssue[] = [];
  const { maxDuration, alwaysVisible } = settings;

  if (maxDuration != null && !(Number.isFinite(maxDuration) && maxDuration > 0)) {
    issues.push({ level: 'error', code: 'max-duration-out-of-range', message: `Invalid maxDuration ${maxDuration}` });
  }

  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  const seen = new Set<string>();
  alwaysVisible.clipIds.forEach((clipId) => {
    if (seen.has(clipId)) {
      issues.push({ level: 'error', code: 'duplicate-always-visible-id', message: `Duplicate always-visible clip id ${clipId}`, clipId });
    } else if (!clipsById.has(clipId)) {
      issues.push({ level: 'error', code: 'always-visible-unknown-clip', message: `Always-visible sequence references unknown clip ${clipId}`, clipId });
    } else {
      const clip = clipsById.get(clipId)!;
      if (clip.groupId != null) {
        issues.push({ level: 'warning', code: 'clip-in-sequence-and-group', message: `Clip ${clipId} is both in the always-visible sequence and in a group`, clipId, groupId: clip.groupId });
      }
    }
    seen.add(clipId);
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

    // E9: the rects live in the frame turned by the clip's rotation
    const size = getClipFrame(clip, sourceSizes[clip.sourceId] ?? source);
    if (size != null && !rectContains({ x: 0, y: 0, ...size }, clip.maxRect)) {
      error('max-rect-outside-frame', `Clip ${clipId} max rect is outside the source frame`);
    }

    if (clip.minRect != null && !rectContains(clip.maxRect, clip.minRect)) {
      error('min-rect-outside-max', `Clip ${clipId} min rect is not inside its max rect`);
    }

    // A9: the reducer keeps them sorted and finite (normalizeKeyframes); only a hand-edited file breaks this
    const keyframes = clip.keyframes ?? [];
    const finite = keyframes.every((k) => [k.time, k.centerX, k.centerY, k.scale].every((v) => Number.isFinite(v)));
    if (!finite || keyframes.some((k, i) => i > 0 && !(k.time > keyframes[i - 1]!.time))) {
      error('invalid-keyframes', `Clip ${clipId} has keyframes that are not finite or not sorted by time`);
    }
  });

  issues.push(...validateClipPlacement(project.clips), ...validateLinksAndSequence(settings, project.clips));

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
