import { DECLICK_DURATION, DUCKING_ATTACK, DUCKING_RELEASE, MUSIC_FADE_OUT, evaluateCompensation, getCompensationSteps, getGlobalFadeDuration, getMusicSchedule, getNormalizationGain, getPlacementFades } from '../render/buildAudioGraph';
import type { MusicOccurrence } from '../render/buildAudioGraph';
import type { ResolvedOverlayTimes } from '../overlays/resolveOverlayTimes';
import type { MixPlan } from '../planner/types';
import type { LoudnessMeasurement, MixClip, MixSettings, SoundOverlay } from '../types';

// Audio levels of the live preview (A1, T32): the render's mix (render/buildAudioGraph.ts) as gains evaluated at any
// time, which the engine applies to WebAudio gain nodes every frame. Same normalization gains, clip fades
// (getPlacementFades, equal-power `qsin`), simultaneity compensation (getCompensationSteps), music schedule and fades
// (getMusicSchedule), global fade and sound overlays. Approximations: the ducking follows the clips' activity (when an
// audible clip plays) with the render's attack/release times instead of a sidechain compressor on the real signal, and
// the final limiter is a DynamicsCompressorNode. Clips, tracks or sounds without a cached loudness measurement play at
// their manual gain only (the preview never runs the analysis). Pure.

export const dbToGain = (db: number) => 10 ** (db / 20);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** ffmpeg's `afade` `curve=qsin` (equal power): the gain at the linear progress `p` of the fade. */
export const qsin = (p: number) => Math.sin((clamp01(p) * Math.PI) / 2);

/** Gain of a fade-in of `fadeIn` s and a fade-out of `fadeOut` s (qsin) at `t` s into something `duration` s long. */
function fadeEnvelope(t: number, duration: number, fadeIn: number, fadeOut: number) {
  let gain = 1;
  if (fadeIn > 0) gain = Math.min(gain, qsin(t / fadeIn));
  if (fadeOut > 0) gain = Math.min(gain, qsin((duration - t) / fadeOut));
  return gain;
}

export interface PreviewAudioClip {
  /** Same key as the video element (previewSchedule: `p<placement index>`). */
  key: string,
  clipId: string,
  startTime: number,
  endTime: number,
  /** Normalization + `gainDb`, linear. */
  gain: number,
  fadeIn: number,
  fadeOut: number,
  /** Whether a loudness measurement was cached (else `gain` is `gainDb` alone). */
  normalized: boolean,
}

export interface PreviewAudioMusic {
  /** Same key as the music element (previewSchedule: `m<occurrence index>`). */
  key: string,
  occurrence: MusicOccurrence,
  gain: number,
  fadeIn: number,
  fadeOut: number,
}

export interface PreviewAudioSound {
  id: string,
  path: string,
  start: number,
  end: number,
  gain: number,
}

export interface PreviewAudioModel {
  duration: number,
  clips: PreviewAudioClip[],
  compensation: ReturnType<typeof getCompensationSteps>,
  music: PreviewAudioMusic[],
  /** Linear fade-out of the music at the end of the video (the render's final `afade=t=out`). */
  musicFadeOut: { start: number, duration: number },
  /** Ducking (C1): the music goes down `amountDb` while an audible clip plays (merged intervals). */
  ducking: { amountDb: number, intervals: [number, number][] } | undefined,
  sounds: PreviewAudioSound[],
  /** Global fade in/out (s, linear), over everything. */
  globalFade: number,
  /** Audible clips without a cached loudness measurement: the UI tells that the levels aren't normalized. */
  unnormalizedCount: number,
}

/** Sorted, merged intervals. */
function mergeIntervals(intervals: [number, number][]) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = merged.at(-1);
    if (last != null && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

/**
 * The preview's audio levels for a plan, like `buildAudioGraph` mixes them. `loudness` may be partial (cached only);
 * `musicDurations` gives the tracks' durations when their measurement doesn't (probed with ffprobe), so the playlist's
 * crossfades are scheduled like the render's.
 */
export function buildPreviewAudioModel({ plan, clips, settings, duration, loudness, musicDurations = {}, overlays = [], overlayTimes }: {
  plan: Pick<MixPlan, 'duration' | 'placements' | 'layouts'>,
  clips: readonly Pick<MixClip, 'id' | 'muted' | 'gainDb'>[],
  settings: Pick<MixSettings, 'transition' | 'fadeInOut' | 'musicPlaylist'>,
  duration?: number | undefined,
  loudness: Readonly<Record<string, LoudnessMeasurement>>,
  musicDurations?: Readonly<Record<string, number | undefined>> | undefined,
  overlays?: readonly Pick<SoundOverlay, 'id' | 'type' | 'absolutePath' | 'gainDb'>[] | undefined,
  overlayTimes?: ResolvedOverlayTimes | undefined,
}): PreviewAudioModel {
  const totalDuration = duration ?? plan.duration;
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));

  const audioClips: PreviewAudioClip[] = [];
  plan.placements.forEach((placement, index) => {
    const clip = clipsById.get(placement.clipId);
    if (clip == null || clip.muted) return;
    const measurement = loudness[clip.id];
    // confirmed silent (or without audio): nothing to play; unknown: played at its manual gain
    if (measurement != null && !measurement.hasAudio) return;
    const { fadeIn, fadeOut } = getPlacementFades(plan, placement);
    const normalization = measurement?.hasAudio === true ? getNormalizationGain(measurement) : 0;
    audioClips.push({ key: `p${index}`, clipId: clip.id, startTime: placement.startTime, endTime: placement.endTime, gain: dbToGain(normalization + clip.gainDb), fadeIn, fadeOut, normalized: measurement != null });
  });

  const { musicPlaylist } = settings;
  const durations = Object.fromEntries(musicPlaylist.tracks.map((track) => [track.id, loudness[track.id]?.duration ?? musicDurations[track.id]]));
  const occurrences = getMusicSchedule({ playlist: musicPlaylist, durations, totalDuration });
  const music = occurrences.map((occurrence, i): PreviewAudioMusic => {
    const measurement = loudness[occurrence.track.id];
    const next = occurrences[i + 1];
    const normalization = measurement?.hasAudio === true ? getNormalizationGain(measurement) : 0;
    return {
      key: `m${i}`,
      occurrence,
      gain: dbToGain(normalization + occurrence.track.volumeDb),
      fadeIn: i > 0 ? Math.max(occurrence.crossfade, DECLICK_DURATION) : 0,
      fadeOut: next != null ? Math.max(next.crossfade, DECLICK_DURATION) : 0,
    };
  });
  const musicFadeOutDuration = Math.min(Math.max(MUSIC_FADE_OUT, settings.transition.duration), totalDuration);

  const { ducking } = musicPlaylist;
  const sounds: PreviewAudioSound[] = [];
  overlays.forEach((overlay) => {
    if (overlay.type !== 'sound') return;
    const times = overlayTimes?.get(overlay.id);
    if (times == null || times.end <= times.start) return;
    const measurement = loudness[overlay.id];
    if (measurement != null && !measurement.hasAudio && measurement.unmeasured !== true) return;
    const normalization = measurement?.hasAudio === true ? getNormalizationGain(measurement) : 0;
    sounds.push({ id: overlay.id, path: overlay.absolutePath, start: times.start, end: times.end, gain: dbToGain(normalization + overlay.gainDb) });
  });

  return {
    duration: totalDuration,
    clips: audioClips,
    compensation: getCompensationSteps(audioClips, totalDuration),
    music,
    musicFadeOut: { start: totalDuration - musicFadeOutDuration, duration: musicFadeOutDuration },
    ducking: ducking.enabled && ducking.amountDb < 0 && audioClips.length > 0
      ? { amountDb: ducking.amountDb, intervals: mergeIntervals(audioClips.map((c) => [c.startTime, c.endTime])) }
      : undefined,
    sounds,
    globalFade: Math.min(getGlobalFadeDuration(settings), totalDuration / 2),
    unnormalizedCount: audioClips.filter((c) => !c.normalized).length,
  };
}

/** The global fade in/out (linear, `afade`'s default curve) at `t`. */
export function getGlobalFadeGain(model: Pick<PreviewAudioModel, 'duration' | 'globalFade'>, t: number) {
  const { globalFade: d, duration } = model;
  if (d <= 0) return 1;
  return clamp01(Math.min(t / d, (duration - t) / d));
}

/** Gain of a clip at `t` (0 outside it): its static gain, its fades, the simultaneity compensation and the global fade. */
export function getPreviewClipGain(model: PreviewAudioModel, clip: PreviewAudioClip, t: number) {
  if (t < clip.startTime || t >= clip.endTime) return 0;
  return clip.gain * fadeEnvelope(t - clip.startTime, clip.endTime - clip.startTime, clip.fadeIn, clip.fadeOut) * evaluateCompensation(model.compensation, t) * getGlobalFadeGain(model, t);
}

/**
 * How much the music is ducked at `t` (0 = not at all, 1 = by the whole amount): it goes down linearly over
 * `DUCKING_ATTACK` when an audible clip starts and comes back up over `DUCKING_RELEASE` after the clips stop.
 */
export function getDuckingAmount(intervals: readonly (readonly [number, number])[], t: number) {
  const attack = DUCKING_ATTACK / 1000;
  const release = DUCKING_RELEASE / 1000;
  let amount = 0;
  for (const [s, e] of intervals) {
    if (t < s) break;
    const reached = Math.min(1, (Math.min(t, e) - s) / attack);
    amount = Math.max(amount, t < e ? reached : reached - (t - e) / release);
  }
  return clamp01(amount);
}

/** Gain of a music occurrence at `t` (0 outside it): static gain, crossfades, ducking, end fade-out and global fade. */
export function getPreviewMusicGain(model: PreviewAudioModel, music: PreviewAudioMusic, t: number) {
  const { start, duration } = music.occurrence;
  if (t < start || t >= start + duration || t >= model.duration) return 0;
  const duck = model.ducking != null ? dbToGain(model.ducking.amountDb * getDuckingAmount(model.ducking.intervals, t)) : 1;
  const { musicFadeOut } = model;
  const end = musicFadeOut.duration > 0 ? clamp01((model.duration - t) / musicFadeOut.duration) : 1;
  return music.gain * fadeEnvelope(t - start, duration, music.fadeIn, music.fadeOut) * duck * end * getGlobalFadeGain(model, t);
}

/** Gain of a sound overlay at `t` (0 outside it). */
export function getPreviewSoundGain(model: PreviewAudioModel, sound: PreviewAudioSound, t: number) {
  if (t < sound.start || t >= sound.end) return 0;
  return sound.gain * getGlobalFadeGain(model, t);
}

/**
 * Sound overlays to start when playback starts at `t`: those not over yet, with the delay until they start (s), the
 * offset into the file and how long they play (the render trims them to their resolved end).
 */
export function getPreviewSoundStarts(sounds: readonly PreviewAudioSound[], t: number) {
  return sounds.filter((s) => s.end > t).map((s) => ({
    sound: s,
    delay: Math.max(0, s.start - t),
    offset: Math.max(0, t - s.start),
    duration: s.end - Math.max(s.start, t),
  }));
}
