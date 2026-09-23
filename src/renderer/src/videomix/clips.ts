import type { MixProjectAction } from './projectReducer';
import type { MixClip, MixSettings, MixSource } from './types';
import type { Size } from './overlayMath';
import { getFrameRect } from './overlayMath';
import { getClipDuration } from './project';

// Pure helpers for creating and editing clips (T07). No React/Electron, tested with vitest.

/** Length of a clip created with "Add clip" when there is no marked start (seconds). */
export const DEFAULT_CLIP_DURATION = 5;

/** Shortest clip that "Add clip" creates from a marked start (seconds), so a double key press doesn't make a 1-frame clip. */
export const MIN_NEW_CLIP_DURATION = 0.1;

/** Source file name without its extension, used as the prefix of the default clip names. */
export function getSourceBaseName(name: string) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

const numberedNameRegex = /^(.*) #(\d+)$/;

/** `"<prefix> #<n>"` → `{ prefix, n }`, anything else → undefined. */
export function parseNumberedName(name: string) {
  const match = numberedNameRegex.exec(name);
  if (match == null) return undefined;
  const [, prefix, n] = match;
  if (prefix == null || n == null) return undefined;
  return { prefix, n: parseInt(n, 10) };
}

/**
 * `"<prefix> #<n>"` with `n` one more than the highest number already used with that prefix (1 if none).
 * A name equal to the bare prefix counts as #1, so duplicating "Intro" gives "Intro #2".
 * Numbers are not reused while a higher one exists, so names stay unique when clips are removed.
 */
export function getNextNumberedName(prefix: string, existingNames: Iterable<string>) {
  let max = 0;
  for (const name of existingNames) {
    if (name === prefix) max = Math.max(max, 1);
    const parsed = parseNumberedName(name);
    if (parsed != null && parsed.prefix === prefix) max = Math.max(max, parsed.n);
  }
  return `${prefix} #${max + 1}`;
}

/** Default name of a new clip: `<source without extension> #n` (01-requisitos §7). All clips count, so two sources with the same file name don't repeat names. */
export const getDefaultClipName = (source: Pick<MixSource, 'name'>, clips: Pick<MixClip, 'name'>[]) => (
  getNextNumberedName(getSourceBaseName(source.name), clips.map((c) => c.name))
);

/** Name of a copy: the next free number of the same prefix ("Clip #2" → "Clip #3", "Intro" → "Intro #2"). */
export function getDuplicateClipName(name: string, clips: Pick<MixClip, 'name'>[]) {
  const prefix = parseNumberedName(name)?.prefix ?? name;
  return getNextNumberedName(prefix, clips.map((c) => c.name));
}

/**
 * Next palette color: the least used one among the existing clips (ties → lowest index).
 * This cycles through the palette like LosslessCut's segment colors, but project-wide and without repeating a color
 * while another one is free (removing clips frees their colors).
 */
export function getNextClipColor(clips: Pick<MixClip, 'color'>[], paletteSize: number) {
  const counts = Array.from({ length: paletteSize }, () => 0);
  clips.forEach(({ color }) => {
    const index = ((color % paletteSize) + paletteSize) % paletteSize;
    counts[index] = (counts[index] ?? 0) + 1;
  });
  const min = Math.min(...counts);
  return Math.max(0, counts.indexOf(min));
}

/** A new clip showing the whole frame (max = full frame, no min), not muted, no extra gain. */
export function createClip({ id, sourceId, name, color, start, end, frameSize }: {
  id: string,
  sourceId: string,
  name: string,
  color: number,
  start: number,
  end: number,
  /** Oriented size of the source. */
  frameSize: Size,
}): MixClip {
  return { id, sourceId, name, color, start, end, maxRect: getFrameRect(frameSize), muted: false, gainDb: 0 };
}

/**
 * Time range of a clip created with "Add clip":
 * - if the current segment is a marker (start set with "Set start", no end yet) before `time`, from the marker to `time`
 *   (`fromMarker`: the marker becomes the clip);
 * - else `DEFAULT_CLIP_DURATION` from `time`, moved back if it would pass the end of the file.
 * Undefined if the file is too short.
 */
export function getNewClipRange({ time, duration, marker }: {
  time: number,
  duration: number,
  marker?: { start: number } | undefined,
}): { start: number, end: number, fromMarker: boolean } | undefined {
  if (!(duration >= MIN_NEW_CLIP_DURATION)) return undefined;
  const clampedTime = Math.min(Math.max(time, 0), duration);
  if (marker != null && clampedTime - marker.start >= MIN_NEW_CLIP_DURATION) {
    return { start: Math.max(0, marker.start), end: clampedTime, fromMarker: true };
  }
  const end = Math.min(clampedTime + DEFAULT_CLIP_DURATION, duration);
  const start = Math.max(0, Math.min(clampedTime, end - DEFAULT_CLIP_DURATION));
  return { start, end, fromMarker: false };
}

/**
 * Split `clip` at `time` (source seconds): the clip keeps the first part and a copy with the same rects/audio settings
 * gets the second part, right after it in the list. One `batch` action (one undo step). Undefined if `time` isn't inside.
 */
export function getSplitClipAction({ clip, time, newId, clips }: {
  clip: MixClip,
  time: number,
  newId: string,
  clips: MixClip[],
}): MixProjectAction | undefined {
  if (time - clip.start < MIN_NEW_CLIP_DURATION || clip.end - time < MIN_NEW_CLIP_DURATION) return undefined;
  const index = clips.findIndex((c) => c.id === clip.id);
  if (index === -1) return undefined;
  const secondPart: MixClip = { ...structuredClone(clip), id: newId, name: getDuplicateClipName(clip.name, clips), start: time };
  return {
    type: 'batch',
    actions: [
      { type: 'updateClip', clipId: clip.id, patch: { end: time } },
      { type: 'addClip', clip: secondPart, index: index + 1 },
    ],
  };
}

export interface ClipWarnings {
  /** Not longer than two transitions: the planner shortens its transitions (see validateMixProject). */
  tooShort: boolean,
  /** Informative: without a min rect the clip can't be cropped beyond its max. */
  noMin: boolean,
}

export const getClipWarnings = (clip: MixClip, settings: Pick<MixSettings, 'transition'>): ClipWarnings => ({
  tooShort: getClipDuration(clip) <= 2 * settings.transition.duration,
  noMin: clip.minRect == null,
});

/** Gain values offered per clip (dB), 01-requisitos §5. */
export const clipGainValues = Array.from({ length: 41 }, (_, i) => i - 20);
