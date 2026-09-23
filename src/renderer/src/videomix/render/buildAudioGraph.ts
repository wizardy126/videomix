import invariant from 'tiny-invariant';

import { formatFfmpegNumber, getFixChannelLayoutFilter } from '../../../../common/util';
import type { LoudnessMeasurement, MixClip, MixSettings, SoundOverlay } from '../types';
import type { ColumnPlacement, MixPlan } from '../planner/types';
import type { ResolvedOverlayTimes } from '../overlays/resolveOverlayTimes';

/** Integrated loudness every clip is normalized to (LUFS). Decided by the user (01-requisitos §5). */
export const LOUDNESS_TARGET = -16;
/**
 * Normalization never boosts more than this (dB): near-silent clips (room tone) would only bring up noise.
 * Brings clips down to -40 LUFS (a quiet phone recording) to the target.
 */
export const MAX_NORMALIZATION_GAIN = 24;
/**
 * The normalization gain is also capped so that the clip's true peak stays ≤ this (dBTP), i.e. the limiter never has to
 * take more than ~6 dB off a clip's peaks. Very dynamic clips then stay a bit below the target instead of being squashed.
 */
export const MAX_NORMALIZED_PEAK = 5;
/** Output ceiling of the final limiter (dBFS). */
export const LIMITER_CEILING = -1;
/** Shortest fade at any clip boundary (s), so that cutting a waveform mid-cycle doesn't click. */
export const DECLICK_DURATION = 0.01;
/** The music fades out over max(this, D) at the end of the video (04-diseno §5.2). */
export const MUSIC_FADE_OUT = 2;
export const AUDIO_SAMPLE_RATE = 48000;

// Extra input duration read after the clip (s), trimmed exactly in the graph (ADR-001 §6)
const INPUT_MARGIN = 0.1;
// Times closer than this are the same instant (plan times are sums of floats)
const EPS = 1e-6;

const fmt = (n: number) => {
  const rounded = Math.round(n * 1e6) / 1e6;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

/**
 * Static gain (dB) that brings a clip to `LOUDNESS_TARGET` (second loudnorm pass as a linear gain: no pumping),
 * see the caps above. The clip's manual `gainDb` goes on top.
 */
export function getNormalizationGain(measurement: Extract<LoudnessMeasurement, { hasAudio: true }>) {
  return Math.min(LOUDNESS_TARGET - measurement.inputI, MAX_NORMALIZATION_GAIN, MAX_NORMALIZED_PEAK - measurement.inputTp);
}

/**
 * Duration of the global fade from/to black (s), 0 if disabled. Video and audio use the same one: the global
 * transition duration (01-requisitos §4.5).
 */
export const getGlobalFadeDuration = (settings: Pick<MixSettings, 'fadeInOut' | 'transition'>) => (settings.fadeInOut ? settings.transition.duration : 0);

/**
 * Audio fade in/out of a placement (s), following what the video does (01-requisitos §4.3, §4.5):
 * - crossfade in its column: the incoming clip's `transitionIn`, for both clips;
 * - a column that appears (or disappears) in a re-layout: the duration of that layout animation;
 * - the end of the video, when the clip fades into the fill: `transitionOut`;
 * - otherwise a hard cut, softened by `DECLICK_DURATION`.
 */
export function getPlacementFades(plan: Pick<MixPlan, 'placements' | 'layouts'>, placement: ColumnPlacement) {
  const { column, startTime, endTime } = placement;
  const duration = endTime - startTime;

  let fadeIn = placement.transitionIn;
  if (fadeIn <= 0 && startTime > EPS) {
    // a new column grows from width 0 while its first clip starts
    const index = plan.layouts.findIndex((layout) => Math.abs(layout.time - startTime) < EPS);
    const layout = plan.layouts[index];
    const previous = plan.layouts[index - 1];
    if (layout != null && previous != null && layout.columns.some((c) => c.column === column) && !previous.columns.some((c) => c.column === column)) {
      fadeIn = layout.transitionDuration;
    }
  }

  const next = plan.placements.find((p) => p !== placement && p.column === column && p.startTime > startTime + EPS && p.startTime < endTime + EPS);
  let fadeOut = next != null ? next.transitionIn : (placement.transitionOut ?? 0);
  if (fadeOut <= 0 && next == null) {
    // the column shrinks to 0 in a re-layout and the clip ends with the animation
    const index = plan.layouts.findIndex((layout) => layout.transitionDuration > 0 && Math.abs(layout.time + layout.transitionDuration - endTime) < EPS);
    const layout = plan.layouts[index];
    const previous = plan.layouts[index - 1];
    if (layout != null && previous != null && previous.columns.some((c) => c.column === column) && !layout.columns.some((c) => c.column === column)) {
      fadeOut = layout.transitionDuration;
    }
  }

  fadeIn = Math.max(fadeIn, DECLICK_DURATION);
  fadeOut = Math.max(fadeOut, DECLICK_DURATION);
  // never more than the clip itself (the planner already keeps transitions ≤ duration / 2)
  const scale = Math.min(1, duration / (fadeIn + fadeOut));
  return { fadeIn: fadeIn * scale, fadeOut: fadeOut * scale };
}

/** Compensation for `n` simultaneous (uncorrelated) sources, as amplitude: -10·log10(n) dB. */
const getCompensation = (n: number) => 1 / Math.sqrt(Math.max(n, 1));

/**
 * Compensation for the number of clips sounding at the same time (04-diseno §5.2 point 3), as a `volume` expression
 * of `t` applied once to the sum of the clips.
 *
 * - A clip counts from the middle of its fade-in to the middle of its fade-out. In a crossfade the incoming clip starts
 *   counting just when the outgoing one stops, so a substitution doesn't change the gain (the clip fades are
 *   equal-power, `qsin`, so their power adds up to 1 too).
 * - Each change is a linear ramp centred on that instant, as long as the fade that caused it.
 * - Written as a flat sum of ramps `g0 + Δ·clip((t-a)/r,0,1) + …` (never nested `if()`, ADR-001).
 */
export function getCompensationExpr(audible: { startTime: number, endTime: number, fadeIn: number, fadeOut: number }[], duration: number) {
  const changes = new Map<number, { delta: number, ramp: number }>();
  const addChange = (time: number, delta: number, ramp: number) => {
    const key = Math.round(time * 1e6) / 1e6;
    const change = changes.get(key) ?? { delta: 0, ramp: 0 };
    changes.set(key, { delta: change.delta + delta, ramp: Math.max(change.ramp, ramp) });
  };
  let count = 0;
  audible.forEach(({ startTime, endTime, fadeIn, fadeOut }) => {
    if (startTime < EPS) count += 1;
    else addChange(startTime + fadeIn / 2, 1, fadeIn);
    if (endTime < duration - EPS) addChange(endTime - fadeOut / 2, -1, fadeOut);
  });

  const initial = getCompensation(count);
  const terms: string[] = [];
  [...changes.entries()].sort(([a], [b]) => a - b).forEach(([time, { delta, ramp }]) => {
    if (delta === 0) return;
    const gainDelta = getCompensation(count + delta) - getCompensation(count);
    count += delta;
    if (Math.abs(gainDelta) < 1e-6) return;
    const sign = gainDelta < 0 ? '-' : '+';
    const step = ramp > EPS
      ? `clip((t-${fmt(time - ramp / 2)})/${fmt(ramp)},0,1)`
      : `gte(t,${fmt(time)})`;
    terms.push(`${sign}${fmt(Math.abs(gainDelta))}*${step}`);
  });
  if (terms.length === 0) return initial === 1 ? undefined : fmt(initial);
  return `${fmt(initial)}${terms.join('')}`;
}

/** The clip fields the audio pass uses. */
export type AudioClip = Pick<MixClip, 'id' | 'sourceId' | 'start' | 'muted' | 'gainDb'>;

/**
 * Audio pass graph. Same shape as `AudioGraph` of render/buildRenderJob.ts (T11), which encodes it as AAC 192 kbps,
 * 48 kHz, stereo into an `.m4a` and muxes it with the video chunks.
 */
export interface AudioPass {
  /** Per input: its input options followed by `-i <path>`, in input index order. */
  inputs: string[][],
  /** Written to a file and passed with `-/filter_complex <file>` (ADR-001). */
  filterComplex: string,
  /** Output pad, map it with `-map [<outLabel>]`. */
  outLabel: string,
}

/**
 * Audio of the whole mix, rendered in one separate pass and muxed with the video chunks with `-c copy` (ADR-001).
 * Graph (04-diseno §5.2):
 * - per audible clip (not muted, with audio): `-vn -ss/-t` input → stereo 48 kHz → `volume` (normalization + gainDb)
 *   → equal-power `afade` in/out (see getPlacementFades) → `adelay` to its start;
 * - `amix` (normalize=0) → simultaneity compensation (getCompensationExpr) → pad to the video duration;
 * - optional music (the first track of `musicPlaylist`; the whole playlist is T27): looped with `-stream_loop -1` if
 *   the playlist loops, trimmed, normalized like a clip plus the track's `volumeDb` (T12b: 0 dB means as loud as the
 *   clips) and faded out;
 * - `alimiter` at `LIMITER_CEILING`, then the global fade in/out if `fadeInOut`.
 *
 * Without any audible clip the clips' mix is silence, so the output always has an audio track of the video's duration.
 *
 * Plugs into `buildRenderJob`'s `buildAudioGraph` hook by closing over the loudness (and the full clips, since the
 * hook's `RenderClip` has no `muted`/`gainDb`):
 * `buildAudioGraph: (input) => buildAudioGraph({ ...input, clips: project.clips, loudness })`.
 *
 * @param sourcePaths `sourceId` → media path (the same paths the loudness was measured on, `MixSource.absolutePath`).
 * @param duration exact output duration (frames / fps); defaults to `plan.duration`.
 * @param loudness measurements by clip id, from `ensureLoudness`. Every audible clip of the plan must have one. The
 *   music track's measurement (T12b), if any, is under its track id; without one, only `volumeDb` applies. A sound
 *   overlay's (T21) is under its own overlay id, like a clip's.
 * @param overlays sound overlays to mix in (T21), with `overlayTimes` (`resolveOverlayTimes`'s result): each one is
 *   normalized to `LOUDNESS_TARGET` plus its `gainDb`, delayed to its resolved start and trimmed to its resolved end
 *   (already cut to the video's duration), then summed in **after** the simultaneity compensation and **before** the
 *   `alimiter` — the global fade doesn't reach them. An overlay missing from `overlayTimes`, resolved to zero
 *   duration (`start === end`), or confirmed silent (`hasAudio: false`, no `unmeasured`), is left out. One flagged
 *   `unmeasured` (T21b: its whole-file measurement failed outright) is still mixed in, at `gainDb` alone (no
 *   normalization gain, since none could be measured) — the caller should have already warned about it. Both
 *   optional and left out together: existing callers (without overlays) are unaffected.
 */
export function buildAudioGraph({ plan, clips, sourcePaths, settings, duration, loudness, overlays, overlayTimes }: {
  plan: Pick<MixPlan, 'duration' | 'placements' | 'layouts'>,
  clips: AudioClip[],
  sourcePaths: Record<string, string>,
  settings: Pick<MixSettings, 'transition' | 'fadeInOut' | 'musicPlaylist'>,
  duration?: number | undefined,
  loudness: Record<string, LoudnessMeasurement>,
  overlays?: Pick<SoundOverlay, 'id' | 'absolutePath' | 'gainDb'>[] | undefined,
  overlayTimes?: ResolvedOverlayTimes | undefined,
}): AudioPass {
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  const totalDuration = duration ?? plan.duration;

  const inputs: string[][] = [];
  const filters: string[] = [];
  const clipLabels: string[] = [];
  const audible: Parameters<typeof getCompensationExpr>[0] = [];

  plan.placements.forEach((placement) => {
    const clip = clipsById.get(placement.clipId);
    invariant(clip != null, `Clip ${placement.clipId} not found`);
    if (clip.muted) return;
    const measurement = loudness[clip.id];
    invariant(measurement != null, `Missing loudness of clip ${clip.id}`);
    if (!measurement.hasAudio) return;
    const path = sourcePaths[clip.sourceId];
    invariant(path != null, `Source ${clip.sourceId} not found`);

    const clipDuration = placement.endTime - placement.startTime;
    const { fadeIn, fadeOut } = getPlacementFades(plan, placement);
    const inputIndex = inputs.length;
    inputs.push(['-vn', '-ss', formatFfmpegNumber(clip.start), '-t', formatFfmpegNumber(clipDuration + INPUT_MARGIN), '-i', path]);

    const label = `a${inputIndex}`;
    const chain = [
      'asetpts=PTS-STARTPTS',
      getFixChannelLayoutFilter(measurement),
      `aresample=${AUDIO_SAMPLE_RATE}`,
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
      `atrim=duration=${fmt(clipDuration)}`,
      `volume=${fmt(getNormalizationGain(measurement) + clip.gainDb)}dB`,
      `afade=t=in:d=${fmt(fadeIn)}:curve=qsin`,
      `afade=t=out:st=${fmt(clipDuration - fadeOut)}:d=${fmt(fadeOut)}:curve=qsin`,
      `adelay=${Math.round(placement.startTime * AUDIO_SAMPLE_RATE)}S:all=1`,
    ].filter((filter) => filter != null);
    filters.push(`[${inputIndex}:a:0]${chain.join(',')}[${label}]`);
    clipLabels.push(`[${label}]`);
    audible.push({ startTime: placement.startTime, endTime: placement.endTime, fadeIn, fadeOut });
  });

  const pad = `apad=whole_dur=${fmt(totalDuration)}`;
  if (clipLabels.length === 0) {
    filters.push(`anullsrc=r=${AUDIO_SAMPLE_RATE}:cl=stereo,atrim=duration=${fmt(totalDuration)}[clips]`);
  } else {
    const compensation = getCompensationExpr(audible, totalDuration);
    filters.push(`${clipLabels.join('')}${[
      clipLabels.length > 1 ? `amix=inputs=${clipLabels.length}:normalize=0:duration=longest` : 'anull',
      compensation != null ? `volume='${compensation}':eval=frame` : undefined,
      pad,
    ].filter((filter) => filter != null).join(',')}[clips]`);
  }

  let mix = 'clips';
  const { musicPlaylist } = settings;
  const [music] = musicPlaylist.tracks;
  if (music != null) {
    const inputIndex = inputs.length;
    inputs.push([...(musicPlaylist.loop ? ['-stream_loop', '-1'] : []), '-vn', '-i', music.absolutePath]);
    const fadeOut = Math.min(Math.max(MUSIC_FADE_OUT, settings.transition.duration), totalDuration);
    // Normalized like the clips (T12b), so 0 dB means "as loud as the clips"; without a measurement (shouldn't happen
    // once ensureLoudness is called with the music), only volumeDb applies.
    const musicMeasurement = loudness[music.id];
    const musicGain = musicMeasurement?.hasAudio === true ? getNormalizationGain(musicMeasurement) + music.volumeDb : music.volumeDb;
    filters.push(
      `[${inputIndex}:a:0]${[
        `aresample=${AUDIO_SAMPLE_RATE}`,
        'aformat=sample_fmts=fltp:channel_layouts=stereo',
        `atrim=duration=${fmt(totalDuration)}`,
        `volume=${fmt(musicGain)}dB`,
        `afade=t=out:st=${fmt(totalDuration - fadeOut)}:d=${fmt(fadeOut)}`,
      ].join(',')}[music]`,
      // duration=first: the clips' mix is padded to the video duration, a shorter (unlooped) music just ends
      '[clips][music]amix=inputs=2:normalize=0:duration=first[mix]',
    );
    mix = 'mix';
  }

  // Sound overlays (T21): after the simultaneity compensation (and the music), before the limiter and the global fade
  const soundLabels: string[] = [];
  (overlays ?? []).forEach((overlay) => {
    const times = overlayTimes?.get(overlay.id);
    if (times == null || times.end <= times.start) return;
    const measurement = loudness[overlay.id];
    invariant(measurement != null, `Missing loudness of sound overlay ${overlay.id}`);
    // Confirmed silence (T21) is dropped; unmeasured (T21b) still plays, at gainDb alone (no normalization gain).
    if (!measurement.hasAudio && measurement.unmeasured !== true) return;
    const gainDb = measurement.hasAudio ? getNormalizationGain(measurement) + overlay.gainDb : overlay.gainDb;

    const soundDuration = times.end - times.start;
    const inputIndex = inputs.length;
    inputs.push(['-vn', '-i', overlay.absolutePath]);

    const label = `s${inputIndex}`;
    const chain = [
      'asetpts=PTS-STARTPTS',
      getFixChannelLayoutFilter(measurement.hasAudio ? measurement : {}),
      `aresample=${AUDIO_SAMPLE_RATE}`,
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
      `atrim=duration=${fmt(soundDuration)}`,
      `volume=${fmt(gainDb)}dB`,
      `adelay=${Math.round(times.start * AUDIO_SAMPLE_RATE)}S:all=1`,
    ].filter((filter) => filter != null);
    filters.push(`[${inputIndex}:a:0]${chain.join(',')}[${label}]`);
    soundLabels.push(`[${label}]`);
  });
  if (soundLabels.length > 0) {
    // duration=first: the mix so far is already padded/trimmed to the video's duration
    filters.push(`[${mix}]${soundLabels.join('')}amix=inputs=${soundLabels.length + 1}:normalize=0:duration=first[withSounds]`);
    mix = 'withSounds';
  }

  const globalFade = Math.min(getGlobalFadeDuration(settings), totalDuration / 2);
  filters.push(`[${mix}]${[
    `atrim=duration=${fmt(totalDuration)}`,
    // latency=1: compensate the lookahead delay (A/V sync) and flush it at the end
    `alimiter=limit=${fmt(10 ** (LIMITER_CEILING / 20))}:level=disabled:latency=1`,
    ...(globalFade > 0 ? [`afade=t=in:d=${fmt(globalFade)}`, `afade=t=out:st=${fmt(totalDuration - globalFade)}:d=${fmt(globalFade)}`] : []),
    `aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo`,
  ].join(',')}[aout]`);

  return { inputs, filterComplex: filters.join(';\n'), outLabel: 'aout' };
}
