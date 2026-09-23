import invariant from 'tiny-invariant';

import { formatFfmpegNumber, getFixChannelLayoutFilter } from '../../../../common/util';
import type { LoudnessMeasurement, MixClip, MixMusicPlaylist, MixMusicTrack, MixSettings, SoundOverlay } from '../types';
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
/**
 * Ducking (C1) attack and release (ms, as ffmpeg's `sidechaincompress` takes them): the music goes down smoothly when a
 * clip starts sounding and comes back up gently in the silences, without pumping on every syllable.
 */
export const DUCKING_ATTACK = 50;
export const DUCKING_RELEASE = 400;
/**
 * The ducking's control signal is the clips' sum boosted by this (dB) and hard-clipped at 0 dBFS: any clip sounding above
 * ≈ -30 dBFS (the clips are normalized to -16 LUFS) saturates it, so the music always goes down by exactly the
 * ducking amount, never more; room tone/noise below ≈ -40 dBFS barely moves it.
 */
export const DUCKING_SIDECHAIN_GAIN = 30;
// Highest ratio of sidechaincompress: over the saturated control signal, (0 dB - threshold)·(1 - 1/ratio) = amount
const DUCKING_RATIO = 20;
/** More repetitions of a looped playlist than this are cut (a tiny jingle looped over a long video): one input each. */
export const MAX_MUSIC_OCCURRENCES = 500;
// Tracks shorter than this (s) are skipped: they can't be crossfaded, and an empty file would loop forever
const MIN_MUSIC_TRACK_DURATION = 0.05;

// Extra input duration read after the clip (s), trimmed exactly in the graph (ADR-001 §6)
const INPUT_MARGIN = 0.1;
// Times closer than this are the same instant (plan times are sums of floats)
const EPS = 1e-6;
// After every amix: it sometimes (a race between its inputs' threads) outputs frames without timestamps, and then the
// compensation's `t` is NaN (volume 0), the fades misplace and the output can end at the first clip's end (T27, seen
// with ffmpeg 8.0 in about 1 of 4 renders with music). The samples are right, so the timestamps are rebuilt from them.
const AMIX_TIMESTAMPS = 'asetpts=N/SR/TB';

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

/** One change of the simultaneity compensation: a linear ramp of `gainDelta` (amplitude) centred on `time`, `ramp` s long (0 = a step). */
export interface CompensationStep { time: number, ramp: number, gainDelta: number }

/**
 * Compensation for the number of clips sounding at the same time (04-diseno §5.2 point 3), as its initial gain and
 * its changes. Shared by the render (`getCompensationExpr`) and the live preview (T32), which evaluates it per frame.
 *
 * - A clip counts from the middle of its fade-in to the middle of its fade-out. In a crossfade the incoming clip starts
 *   counting just when the outgoing one stops, so a substitution doesn't change the gain (the clip fades are
 *   equal-power, `qsin`, so their power adds up to 1 too).
 * - Each change is a linear ramp centred on that instant, as long as the fade that caused it.
 */
export function getCompensationSteps(audible: { startTime: number, endTime: number, fadeIn: number, fadeOut: number }[], duration: number) {
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
  const steps: CompensationStep[] = [];
  [...changes.entries()].sort(([a], [b]) => a - b).forEach(([time, { delta, ramp }]) => {
    if (delta === 0) return;
    const gainDelta = getCompensation(count + delta) - getCompensation(count);
    count += delta;
    if (Math.abs(gainDelta) < 1e-6) return;
    steps.push({ time, ramp: ramp > EPS ? ramp : 0, gainDelta });
  });
  return { initial, steps };
}

/** Value of the compensation (`getCompensationSteps`) at `t`: what the render's `volume` expression evaluates to. */
export function evaluateCompensation({ initial, steps }: ReturnType<typeof getCompensationSteps>, t: number) {
  let gain = initial;
  for (const { time, ramp, gainDelta } of steps) {
    if (ramp > 0) gain += gainDelta * Math.min(1, Math.max(0, (t - (time - ramp / 2)) / ramp));
    else if (t >= time) gain += gainDelta;
  }
  return gain;
}

/**
 * The simultaneity compensation (`getCompensationSteps`) as a `volume` expression of `t` applied once to the sum of the
 * clips, written as a flat sum of ramps `g0 + Δ·clip((t-a)/r,0,1) + …` (never nested `if()`, ADR-001).
 */
export function getCompensationExpr(audible: { startTime: number, endTime: number, fadeIn: number, fadeOut: number }[], duration: number) {
  const { initial, steps } = getCompensationSteps(audible, duration);
  const terms = steps.map(({ time, ramp, gainDelta }) => {
    const sign = gainDelta < 0 ? '-' : '+';
    const step = ramp > 0
      ? `clip((t-${fmt(time - ramp / 2)})/${fmt(ramp)},0,1)`
      : `gte(t,${fmt(time)})`;
    return `${sign}${fmt(Math.abs(gainDelta))}*${step}`;
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

/** One play of a music track in the video (C2). */
export interface MusicOccurrence {
  track: MixMusicTrack,
  /** In the video (s). */
  start: number,
  /** The whole track (s); `Infinity` if unknown (no measurement or no `duration`), then it plays to the end. */
  duration: number,
  /** Crossfade with the previous occurrence (s), 0 for the first one. */
  crossfade: number,
}

/**
 * Where each music track plays (C2, 04-diseno §5.2): the tracks in order, each one starting `crossfade` before the end
 * of the previous one, and the whole list again (and again) if `loop`, until the end of the video. The crossfade is
 * shortened to half of the shorter of both tracks. A track of unknown duration (see `MusicOccurrence.duration`) ends
 * the schedule; tracks shorter than `MIN_MUSIC_TRACK_DURATION` are skipped.
 *
 * @param durations track id → duration of the whole file (s), `LoudnessMeasurement.duration`.
 */
export function getMusicSchedule({ playlist, durations, totalDuration }: {
  playlist: Pick<MixMusicPlaylist, 'tracks' | 'crossfade' | 'loop'>,
  durations: Record<string, number | undefined>,
  totalDuration: number,
}): MusicOccurrence[] {
  const tracks = playlist.tracks.map((track) => ({ track, duration: durations[track.id] ?? Infinity }))
    .filter(({ duration }) => duration >= MIN_MUSIC_TRACK_DURATION);
  const occurrences: MusicOccurrence[] = [];
  for (let i = 0; tracks.length > 0 && occurrences.length < MAX_MUSIC_OCCURRENCES; i += 1) {
    if (i >= tracks.length && !playlist.loop) break;
    const { track, duration } = tracks[i % tracks.length]!;
    const previous = occurrences.at(-1);
    const crossfade = previous != null ? Math.max(0, Math.min(playlist.crossfade, previous.duration / 2, duration / 2)) : 0;
    const start = previous != null ? previous.start + previous.duration - crossfade : 0;
    if (start >= totalDuration - EPS) break;
    occurrences.push({ track, start, duration, crossfade });
  }
  return occurrences;
}

/**
 * `sidechaincompress` for the ducking (C1), main input the music and sidechain the saturated clips' sum (see
 * `DUCKING_SIDECHAIN_GAIN`), or undefined if disabled or with nothing to reduce. With the control signal at 0 dBFS
 * while clips sound, the threshold is set so that the maximum ratio takes exactly `amountDb` off the music; hard knee.
 */
export function getDuckingFilter(ducking: MixMusicPlaylist['ducking']) {
  const reduction = -ducking.amountDb;
  if (!ducking.enabled || !(reduction > 0)) return undefined;
  const thresholdDb = -reduction / (1 - 1 / DUCKING_RATIO);
  // sidechaincompress's minimum threshold (-60 dB), i.e. at most ~57 dB of ducking
  const threshold = Math.max(10 ** (thresholdDb / 20), 1 / 1024);
  return `sidechaincompress=threshold=${fmt(threshold)}:ratio=${DUCKING_RATIO}:knee=1:attack=${DUCKING_ATTACK}:release=${DUCKING_RELEASE}:detection=rms:link=maximum`;
}

/**
 * Music of the playlist (C2), as inputs and filters ending in `[music]` (stereo, `totalDuration` long or shorter if the
 * list doesn't loop), or undefined without music. One input per occurrence (`getMusicSchedule`), each one normalized like
 * a clip (T12b) plus its `volumeDb`, trimmed to the track's duration, with equal-power (`qsin`) fades for its crossfades
 * (`DECLICK_DURATION` where there's none) and delayed to its start; all summed with `amix`, trimmed to the video and
 * faded out at the end over max(`MUSIC_FADE_OUT`, D).
 *
 * Rather than a chain of `acrossfade`s, every occurrence is placed on its own (the clips' pattern): the graph does
 * exactly what `getMusicSchedule` says, and a long looped list isn't a long chain of filters depending on each other.
 *
 * A track without a measurement only gets its `volumeDb`, and one of unknown duration is played to the end of the video,
 * looped with `-stream_loop -1` (without crossfade) if the playlist loops; `ensureLoudness` normally gives both.
 */
function buildMusic({ playlist, loudness, totalDuration, fadeDuration, firstInputIndex }: {
  playlist: MixMusicPlaylist,
  loudness: Record<string, LoudnessMeasurement>,
  totalDuration: number,
  fadeDuration: number,
  firstInputIndex: number,
}) {
  const durations = Object.fromEntries(playlist.tracks.map((track) => [track.id, loudness[track.id]?.duration]));
  const occurrences = getMusicSchedule({ playlist, durations, totalDuration });
  if (occurrences.length === 0) return undefined;

  const inputs: string[][] = [];
  const chains: { input: string, filters: string[] }[] = [];
  occurrences.forEach(({ track, start, duration, crossfade }, i) => {
    const inputIndex = firstInputIndex + inputs.length;
    const next = occurrences[i + 1];
    inputs.push([
      ...(!Number.isFinite(duration) && playlist.loop ? ['-stream_loop', '-1'] : []),
      '-vn',
      // don't decode a long last track to the end
      ...(next == null && totalDuration - start + INPUT_MARGIN < duration ? ['-t', formatFfmpegNumber(totalDuration - start + INPUT_MARGIN)] : []),
      '-i', track.absolutePath,
    ]);
    // Normalized like the clips (T12b), so 0 dB means "as loud as the clips". A silent or unmeasured (T21b) track has
    // no normalization gain; without any measurement (shouldn't happen once ensureLoudness is called with the tracks),
    // only volumeDb applies too.
    const measurement = loudness[track.id];
    const gain = measurement?.hasAudio === true ? getNormalizationGain(measurement) + track.volumeDb : track.volumeDb;
    const fadeIn = i > 0 ? Math.max(crossfade, DECLICK_DURATION) : 0;
    const fadeOut = next != null ? Math.max(next.crossfade, DECLICK_DURATION) : 0;
    chains.push({
      input: `${inputIndex}:a:0`,
      filters: [
        measurement?.hasAudio === true ? getFixChannelLayoutFilter(measurement) : undefined,
        `aresample=${AUDIO_SAMPLE_RATE}`,
        'aformat=sample_fmts=fltp:channel_layouts=stereo',
        // exact length (the next track starts from it), unknown: to the end of the video (trimmed below)
        Number.isFinite(duration) ? `atrim=duration=${fmt(duration)}` : undefined,
        `volume=${fmt(gain)}dB`,
        fadeIn > 0 ? `afade=t=in:d=${fmt(fadeIn)}:curve=qsin` : undefined,
        fadeOut > 0 ? `afade=t=out:st=${fmt(duration - fadeOut)}:d=${fmt(fadeOut)}:curve=qsin` : undefined,
        start > 0 ? `adelay=${Math.round(start * AUDIO_SAMPLE_RATE)}S:all=1` : undefined,
      ].filter((filter) => filter != null),
    });
  });

  const fadeOut = Math.min(Math.max(MUSIC_FADE_OUT, fadeDuration), totalDuration);
  const end = [`atrim=duration=${fmt(totalDuration)}`, `afade=t=out:st=${fmt(totalDuration - fadeOut)}:d=${fmt(fadeOut)}`];
  const [single] = chains;
  if (chains.length === 1 && single != null) return { inputs, filters: [`[${single.input}]${[...single.filters, ...end].join(',')}[music]`] };
  const filters = chains.map(({ input, filters: chain }, i) => `[${input}]${chain.join(',')}[m${i}]`);
  filters.push(`${chains.map((_chain, i) => `[m${i}]`).join('')}${[`amix=inputs=${chains.length}:normalize=0:duration=longest`, AMIX_TIMESTAMPS, ...end].join(',')}[music]`);
  return { inputs, filters };
}

/**
 * Audio of the whole mix, rendered in one separate pass and muxed with the video chunks with `-c copy` (ADR-001).
 * Graph (04-diseno §5.2):
 * - per audible clip (not muted, with audio): `-vn -ss/-t` input → stereo 48 kHz → `volume` (normalization + gainDb)
 *   → equal-power `afade` in/out (see getPlacementFades) → `adelay` to its start;
 * - `amix` (normalize=0) → simultaneity compensation (getCompensationExpr) → pad to the video duration;
 * - optional music (C2, T27): the tracks of `musicPlaylist` in sequence with crossfades, the whole list repeated if it
 *   loops (`getMusicSchedule`), each one normalized like a clip plus its `volumeDb` (T12b: 0 dB means as loud as the
 *   clips), trimmed and faded out at the end; with `ducking` (C1) it goes down by `amountDb` while clips sound
 *   (`getDuckingFilter`), then it's summed with the clips;
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
 *   music tracks' measurements (T12b, T24) are under their track ids: they give the normalization gain and the
 *   track's duration (to schedule the crossfades); without one, only `volumeDb` applies and the track plays to the end
 *   of the video. A sound
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
      ...(clipLabels.length > 1 ? [`amix=inputs=${clipLabels.length}:normalize=0:duration=longest`, AMIX_TIMESTAMPS] : ['anull']),
      compensation != null ? `volume='${compensation}':eval=frame` : undefined,
      pad,
    ].filter((filter) => filter != null).join(',')}[clips]`);
  }

  let mix = 'clips';
  const music = buildMusic({ playlist: settings.musicPlaylist, loudness, totalDuration, fadeDuration: settings.transition.duration, firstInputIndex: inputs.length });
  if (music != null) {
    inputs.push(...music.inputs);
    filters.push(...music.filters);
    const ducking = clipLabels.length > 0 ? getDuckingFilter(settings.musicPlaylist.ducking) : undefined;
    if (ducking != null) {
      // Ducking (C1): the clips' sum (after the compensation) drives a compressor on the music, see getDuckingFilter
      filters.push(
        '[clips]asplit=2[clipsMix][clipsSidechain]',
        `[clipsSidechain]volume=${DUCKING_SIDECHAIN_GAIN}dB,asoftclip=type=hard[duckingControl]`,
        `[music][duckingControl]${ducking}[duckedMusic]`,
        // duration=first: the clips' mix is padded to the video duration, a shorter (unlooped) music just ends
        `[clipsMix][duckedMusic]amix=inputs=2:normalize=0:duration=first,${AMIX_TIMESTAMPS}[mix]`,
      );
    } else {
      filters.push(`[clips][music]amix=inputs=2:normalize=0:duration=first,${AMIX_TIMESTAMPS}[mix]`);
    }
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
    filters.push(`[${mix}]${soundLabels.join('')}amix=inputs=${soundLabels.length + 1}:normalize=0:duration=first,${AMIX_TIMESTAMPS}[withSounds]`);
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
