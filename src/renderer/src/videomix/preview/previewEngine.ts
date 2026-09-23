import type { ResolvedOverlayTimes } from '../overlays/resolveOverlayTimes';
import type { MixClip, MixOverlay, MixSource } from '../types';
import { createPreviewClock, getClockTime, getDriftCorrection, getSeekLead, isClockAtEnd, pauseClock, playClock, seekClock, setClockDuration, smoothSeekDuration } from './previewClock';
import type { PreviewClock } from './previewClock';
import { getPreviewClipGain, getPreviewMusicGain, getPreviewSoundGain, getPreviewSoundStarts } from './previewAudio';
import type { PreviewAudioClip, PreviewAudioModel, PreviewAudioMusic, PreviewAudioSound } from './previewAudio';
import { createBlurScratch, drawPreviewFrame } from './previewCanvas';
import type { BlurScratch, PreviewCanvasResources } from './previewCanvas';
import { getPreviewDrawList } from './previewDraw';
import type { PreviewDrawModel } from './previewDraw';
import { getPreviewOverlayOps } from './previewOverlays';
import { assignPreviewPool, getPreviewMusicRequests, getPreviewVideoRequests } from './previewSchedule';
import type { PoolSlot, PreviewMediaRequest } from './previewSchedule';

// Live preview engine (A1, T32, 04-diseno §9): the master clock, a pool of <video>/<audio> elements kept in sync with
// it, the WebAudio graph and the canvas drawing, driven by requestAnimationFrame. All the decisions are in the pure
// modules next to it (clock and drift, which elements to load, draw lists, gains); this class only applies them to the
// DOM. Not React: the hook (hooks/useMixLivePreview.ts) owns one engine and feeds it the plan.
//
// Audio graph: each media element → MediaElementAudioSourceNode → GainNode (its gain, set every frame from the pure
// gain functions) → master GainNode (the app's playback volume) → DynamicsCompressorNode (≈ the render's limiter) →
// destination. Sound overlays are decoded AudioBuffers started with AudioBufferSourceNode.

/** Smoothing of the per-frame gain changes (s): no zipper noise, and fast enough for the fades. */
const GAIN_SMOOTHING = 0.015;

export interface PreviewEngineInput {
  drawModel: PreviewDrawModel,
  audioModel: PreviewAudioModel,
  clips: ReadonlyMap<string, Pick<MixClip, 'id' | 'name' | 'sourceId' | 'start'>>,
  sources: ReadonlyMap<string, Pick<MixSource, 'id' | 'absolutePath'>>,
  /** Track id → file. */
  tracks: ReadonlyMap<string, string>,
  /** Loop the music elements of unknown duration (the playlist loops). */
  loopMusic: boolean,
  overlays: readonly MixOverlay[],
  resolved: ResolvedOverlayTimes,
}

export interface PreviewEngineDeps {
  /** file:// URL of a path. */
  getFileUrl: (path: string) => string,
  readFile: (path: string) => Promise<ArrayBuffer>,
  /** The bundled overlay font. */
  defaultFontPath: string | undefined,
}

interface MediaSlot {
  id: number,
  el: HTMLMediaElement,
  gain: GainNode | undefined,
  url: string | undefined,
}

type SourceStatus = { kind: 'ok', url: string } | { kind: 'pending' } | { kind: 'unplayable' };

type Listener = () => void;

/**
 * Seeks done while playing, per element (T33): when the current one started (performance.now() ms) and the smoothed
 * duration of the previous ones, for the seek lead (getSeekLead).
 */
const playingSeeks = new WeakMap<HTMLMediaElement, { startedAt?: number | undefined, duration?: number | undefined }>();

function handleSeeked(el: HTMLMediaElement) {
  const state = playingSeeks.get(el);
  if (state?.startedAt == null) return;
  state.duration = smoothSeekDuration(state.duration, (performance.now() - state.startedAt) / 1000);
  state.startedAt = undefined;
}

/** Keeps a media element where the clock says: playing with drift correction, or paused at its position. */
function syncElement(el: HTMLMediaElement, request: PreviewMediaRequest | undefined, playing: boolean) {
  const expectedTime = (r: PreviewMediaRequest) => (el.loop && Number.isFinite(el.duration) && el.duration > 0 ? r.mediaTime % el.duration : r.mediaTime);
  if (request == null || !request.active || !playing) {
    if (!el.paused) el.pause();
    if (request != null && el.readyState >= HTMLMediaElement.HAVE_METADATA && !el.seeking) {
      const correction = getDriftCorrection({ expected: expectedTime(request), actual: el.currentTime, playing: false });
      // eslint-disable-next-line no-param-reassign
      if (correction.kind === 'seek') el.currentTime = correction.time;
    }
    return;
  }
  if (el.readyState < HTMLMediaElement.HAVE_METADATA) return;
  if (!el.seeking) {
    const state = playingSeeks.get(el) ?? {};
    const correction = getDriftCorrection({ expected: expectedTime(request), actual: el.currentTime, playing: true, seekLead: getSeekLead(state.duration) });
    if (correction.kind === 'seek') {
      playingSeeks.set(el, { ...state, startedAt: performance.now() });
      // eslint-disable-next-line no-param-reassign
      el.currentTime = correction.time;
    }
    // ahead after a slow seek: let the clock catch up (see getDriftCorrection)
    if (correction.kind === 'wait') {
      if (!el.paused) el.pause();
      return;
    }
    // eslint-disable-next-line no-param-reassign
    if (el.playbackRate !== correction.rate) el.playbackRate = correction.rate;
  }
  if (el.paused) el.play().catch(() => undefined);
}

export default class PreviewEngine {
  private deps: PreviewEngineDeps;

  private input: PreviewEngineInput | undefined;

  private clock: PreviewClock = createPreviewClock(0);

  private canvas: HTMLCanvasElement | undefined;

  private ctx2d: CanvasRenderingContext2D | undefined;

  private blurScratch: BlurScratch | undefined;

  private rafId: number | undefined;

  private dirty = true;

  private videoPool: PoolSlot[] = [];

  private musicPool: PoolSlot[] = [];

  private videoSlots = new Map<number, MediaSlot>();

  private musicSlots = new Map<number, MediaSlot>();

  /** Video playability by source path (the original file, a playable copy, or a placeholder). */
  private sourceStatus = new Map<string, SourceStatus>();

  private images = new Map<string, HTMLImageElement>();

  private fonts = new Map<string, string>();

  private soundBuffers = new Map<string, AudioBuffer | 'loading' | 'failed'>();

  private playingSounds: { node: AudioBufferSourceNode, gain: GainNode, sound: PreviewAudioSound }[] = [];

  private audio: { ctx: AudioContext, master: GainNode, limiter: DynamicsCompressorNode } | undefined;

  private volume = 1;

  private clipColors: ReadonlyMap<string, string> = new Map();

  private listeners = new Set<Listener>();

  private findPlayableCopy: ((path: string) => Promise<string | undefined>) | undefined;

  /** Last frame's draw time, for the measured frame rate. */
  private lastFrameAt: number | undefined;

  private frameMs = 0;

  constructor(deps: PreviewEngineDeps) {
    this.deps = deps;
  }

  // ---- public API

  setInput(input: PreviewEngineInput | undefined) {
    const now = performance.now();
    this.input = input;
    this.clock = setClockDuration(this.clock, input != null ? input.audioModel.duration : 0, now);
    if (input == null) {
      this.pause();
      this.releaseMedia();
    } else {
      this.loadOverlayResources(input);
      if (this.clock.playing) this.restartSounds(getClockTime(this.clock, now));
    }
    this.dirty = true;
    this.emit();
  }

  /** How to find a file Chromium can play for a source it can't (an existing html5ified copy). */
  setPlayableCopyFinder(find: ((path: string) => Promise<string | undefined>) | undefined) {
    this.findPlayableCopy = find;
  }

  setClipColors(colors: ReadonlyMap<string, string>) {
    this.clipColors = colors;
    this.dirty = true;
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.audio != null) this.audio.master.gain.setTargetAtTime(volume, this.audio.ctx.currentTime, GAIN_SMOOTHING);
  }

  /** The canvas to draw on (undefined: nothing to draw, the loop stops). The caller sizes it. */
  setCanvas(canvas: HTMLCanvasElement | undefined) {
    this.canvas = canvas;
    // opaque: the frame is always fully painted (gap colour first), which spares the compositor a blend
    this.ctx2d = canvas?.getContext('2d', { alpha: false }) ?? undefined;
    this.blurScratch ??= canvas != null ? createBlurScratch() : undefined;
    this.dirty = true;
    if (canvas != null) this.startLoop();
    else this.stopLoop();
  }

  /** Redraw on the next frame (e.g. after the canvas was resized). */
  invalidate() {
    this.dirty = true;
  }

  get playing() {
    return this.clock.playing;
  }

  get duration() {
    return this.clock.duration;
  }

  getTime() {
    return getClockTime(this.clock, performance.now());
  }

  /** Measured time between the last two drawn frames while playing (ms), 0 when unknown. */
  getFrameInterval() {
    return this.frameMs;
  }

  /** Called when playing starts/stops, the input changes, and on every drawn frame while playing. */
  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  play() {
    if (this.input == null || this.clock.playing) return;
    const audio = this.ensureAudio();
    if (audio != null && audio.ctx.state === 'suspended') audio.ctx.resume().catch((err) => console.warn('AudioContext resume failed', err));
    const now = performance.now();
    this.clock = playClock(this.clock, now);
    this.restartSounds(getClockTime(this.clock, now));
    this.startLoop();
    this.emit();
  }

  pause() {
    if (!this.clock.playing) return;
    this.clock = pauseClock(this.clock, performance.now());
    this.stopSounds();
    for (const slot of [...this.videoSlots.values(), ...this.musicSlots.values()]) slot.el.pause();
    this.lastFrameAt = undefined;
    this.dirty = true;
    this.emit();
  }

  togglePlay() {
    if (this.clock.playing) this.pause();
    else this.play();
  }

  seek(time: number) {
    const now = performance.now();
    this.clock = seekClock(this.clock, time, now);
    if (this.clock.playing) this.restartSounds(getClockTime(this.clock, now));
    this.dirty = true;
    this.emit();
  }

  /**
   * Stops playing and frees the media elements (the Mix view is hidden); the time is kept. Unplayable sources are
   * tried again next time (the user may have converted them meanwhile).
   */
  suspend() {
    this.pause();
    this.releaseMedia();
    this.sourceStatus.clear();
  }

  destroy() {
    this.suspend();
    this.stopLoop();
    this.listeners.clear();
    this.audio?.ctx.close().catch(() => undefined);
    this.audio = undefined;
  }

  // ---- loop

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private startLoop() {
    if (this.rafId != null || this.canvas == null) return;
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      this.tick();
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopLoop() {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.rafId = undefined;
  }

  private tick() {
    const { input } = this;
    if (input == null) return;
    const now = performance.now();
    if (isClockAtEnd(this.clock, now)) this.pause();
    const time = getClockTime(this.clock, now);
    this.syncVideos(input, time);
    this.syncMusic(input, time);
    this.updateGains(input, time);
    if (this.clock.playing || this.dirty) {
      this.draw(input, time);
      this.dirty = false;
      if (this.clock.playing) {
        if (this.lastFrameAt != null) this.frameMs = 0.9 * this.frameMs + 0.1 * (now - this.lastFrameAt);
        this.lastFrameAt = now;
        this.emit();
      }
    }
  }

  // ---- media elements

  private ensureAudio() {
    if (this.audio != null) return this.audio;
    try {
      const ctx = new AudioContext({ latencyHint: 'playback' });
      const limiter = ctx.createDynamicsCompressor();
      // ≈ the render's alimiter at -1 dBFS: a fast, hard compressor just below the ceiling
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.1;
      const master = ctx.createGain();
      master.gain.value = this.volume;
      master.connect(limiter).connect(ctx.destination);
      this.audio = { ctx, master, limiter };
    } catch (err) {
      console.warn('No WebAudio: the preview plays without audio', err);
    }
    return this.audio;
  }

  private createSlot(id: number, tag: 'video' | 'audio'): MediaSlot {
    const el = document.createElement(tag);
    el.preload = 'auto';
    if (el instanceof HTMLVideoElement) el.playsInline = true;
    const audio = this.ensureAudio();
    let gain: GainNode | undefined;
    if (audio != null) {
      // the element's own output goes to the graph only
      gain = audio.ctx.createGain();
      gain.gain.value = 0;
      audio.ctx.createMediaElementSource(el).connect(gain).connect(audio.master);
    } else {
      el.muted = true;
    }
    const markDirty = () => { this.dirty = true; };
    el.addEventListener('seeked', markDirty);
    el.addEventListener('seeked', () => handleSeeked(el));
    el.addEventListener('loadeddata', markDirty);
    return { id, el, gain, url: undefined };
  }

  private static destroySlot(slot: MediaSlot) {
    slot.el.pause();
    slot.el.removeAttribute('src');
    slot.el.load();
    slot.gain?.disconnect();
  }

  private releaseMedia() {
    for (const slot of [...this.videoSlots.values(), ...this.musicSlots.values()]) PreviewEngine.destroySlot(slot);
    this.videoSlots.clear();
    this.musicSlots.clear();
    this.videoPool = [];
    this.musicPool = [];
  }

  /** URL to load for a source video, or undefined while unknown / if it can't be played (then a placeholder). */
  private getSourceUrl(path: string) {
    let status = this.sourceStatus.get(path);
    if (status == null) {
      status = { kind: 'ok', url: this.deps.getFileUrl(path) };
      this.sourceStatus.set(path, status);
    }
    return status.kind === 'ok' ? status.url : undefined;
  }

  /** Chromium can't decode a source: use an existing html5ified copy if there is one, else show a placeholder. */
  private handleSourceError(path: string, failedUrl: string) {
    const status = this.sourceStatus.get(path);
    if (status?.kind !== 'ok' || status.url !== failedUrl) return;
    const original = this.deps.getFileUrl(path);
    if (failedUrl !== original) {
      this.sourceStatus.set(path, { kind: 'unplayable' });
      this.dirty = true;
      return;
    }
    this.sourceStatus.set(path, { kind: 'pending' });
    (this.findPlayableCopy?.(path) ?? Promise.resolve(undefined)).then((copy) => {
      this.sourceStatus.set(path, copy != null ? { kind: 'ok', url: this.deps.getFileUrl(copy) } : { kind: 'unplayable' });
    }, () => {
      this.sourceStatus.set(path, { kind: 'unplayable' });
    }).finally(() => { this.dirty = true; });
  }

  private isUnplayable(path: string | undefined) {
    return path != null && this.sourceStatus.get(path)?.kind === 'unplayable';
  }

  /** Assigns the requests to elements of a pool, loading the right file in each. */
  private syncPool({ requests, pool, slots, tag, getPath }: {
    requests: PreviewMediaRequest[],
    pool: PoolSlot[],
    slots: Map<number, MediaSlot>,
    tag: 'video' | 'audio',
    getPath: (sourceId: string) => string | undefined,
  }) {
    const { slots: newPool, created, removed } = assignPreviewPool(pool, requests);
    for (const id of removed) {
      const slot = slots.get(id);
      if (slot != null) PreviewEngine.destroySlot(slot);
      slots.delete(id);
    }
    for (const id of created) slots.set(id, this.createSlot(id, tag));
    const byKey = new Map(requests.map((r) => [r.key, r]));
    const assigned: { slot: MediaSlot, request: PreviewMediaRequest | undefined }[] = [];
    newPool.forEach((poolSlot) => {
      const slot = slots.get(poolSlot.id);
      if (slot == null) return;
      const request = poolSlot.key != null ? byKey.get(poolSlot.key) : undefined;
      const path = request != null ? getPath(request.sourceId) : undefined;
      const url = path != null ? (tag === 'video' ? this.getSourceUrl(path) : this.deps.getFileUrl(path)) : undefined;
      if (url != null && url !== slot.url) {
        slot.url = url;
        slot.el.src = url;
        // another file seeks at another speed
        playingSeeks.delete(slot.el);
        if (tag === 'video' && path != null) {
          const { el } = slot;
          // (the element may have been given another file since)
          const onError = () => {
            if (slot.url === url) this.handleSourceError(path, url);
          };
          // an audio-only decode (unsupported video codec) is no use either
          const onMeta = () => {
            if (el instanceof HTMLVideoElement && el.videoWidth === 0) onError();
          };
          el.addEventListener('error', onError, { once: true });
          el.addEventListener('loadedmetadata', onMeta, { once: true });
        }
      }
      assigned.push({ slot, request: slot.url != null && slot.url === url ? request : undefined });
    });
    return { pool: newPool, assigned };
  }

  private videoAssignments: { slot: MediaSlot, request: PreviewMediaRequest | undefined }[] = [];

  private musicAssignments: { slot: MediaSlot, request: PreviewMediaRequest | undefined }[] = [];

  private syncVideos(input: PreviewEngineInput, time: number) {
    const pathOf = (sourceId: string) => input.sources.get(sourceId)?.absolutePath;
    const requests = getPreviewVideoRequests({ tl: input.drawModel.tl, clips: input.clips, time })
      .filter((r) => !this.isUnplayable(pathOf(r.sourceId)));
    const { pool, assigned } = this.syncPool({ requests, pool: this.videoPool, slots: this.videoSlots, tag: 'video', getPath: pathOf });
    this.videoPool = pool;
    this.videoAssignments = assigned;
    for (const { slot, request } of assigned) syncElement(slot.el, request, this.clock.playing);
  }

  private syncMusic(input: PreviewEngineInput, time: number) {
    const requests = getPreviewMusicRequests({ occurrences: input.audioModel.music.map((m) => m.occurrence), time, totalDuration: input.audioModel.duration });
    const { pool, assigned } = this.syncPool({ requests, pool: this.musicPool, slots: this.musicSlots, tag: 'audio', getPath: (trackId) => input.tracks.get(trackId) });
    this.musicPool = pool;
    this.musicAssignments = assigned;
    for (const { slot, request } of assigned) {
      const music = request != null ? input.audioModel.music.find((m) => m.key === request.key) : undefined;
      // eslint-disable-next-line no-param-reassign
      slot.el.loop = input.loopMusic && music != null && !Number.isFinite(music.occurrence.duration);
      syncElement(slot.el, request, this.clock.playing);
    }
  }

  // ---- audio

  private updateGains(input: PreviewEngineInput, time: number) {
    const { audio } = this;
    if (audio == null) return;
    const { audioModel: model } = input;
    const at = audio.ctx.currentTime;
    const set = (gain: GainNode | undefined, value: number) => {
      if (gain != null && Math.abs(gain.gain.value - value) > 1e-4) gain.gain.setTargetAtTime(value, at, GAIN_SMOOTHING);
    };
    const clipsByKey = new Map<string, PreviewAudioClip>(model.clips.map((c) => [c.key, c]));
    const musicByKey = new Map<string, PreviewAudioMusic>(model.music.map((m) => [m.key, m]));
    for (const { slot, request } of this.videoAssignments) {
      const clip = request != null ? clipsByKey.get(request.key) : undefined;
      set(slot.gain, clip != null && request?.active === true && this.clock.playing ? getPreviewClipGain(model, clip, time) : 0);
    }
    for (const { slot, request } of this.musicAssignments) {
      const music = request != null ? musicByKey.get(request.key) : undefined;
      set(slot.gain, music != null && request?.active === true && this.clock.playing ? getPreviewMusicGain(model, music, time) : 0);
    }
    // sounds are started/stopped with their buffers: only the global fade changes here (see getPreviewSoundGain)
    for (const { gain, sound } of this.playingSounds) set(gain, getPreviewSoundGain(model, sound, Math.min(Math.max(time, sound.start), sound.end - 1e-6)));
  }

  private stopSounds() {
    for (const { node, gain } of this.playingSounds) {
      try {
        node.stop();
      } catch {
        // not started yet
      }
      node.disconnect();
      gain.disconnect();
    }
    this.playingSounds = [];
  }

  private restartSounds(time: number) {
    this.stopSounds();
    const { input } = this;
    const audio = this.ensureAudio();
    if (input == null || audio == null) return;
    getPreviewSoundStarts(input.audioModel.sounds, time).forEach(({ sound, delay, offset, duration }) => {
      const buffer = this.soundBuffers.get(sound.path);
      if (buffer == null || buffer === 'loading' || buffer === 'failed' || offset >= buffer.duration) return;
      const node = audio.ctx.createBufferSource();
      node.buffer = buffer;
      const gain = audio.ctx.createGain();
      gain.gain.value = getPreviewSoundGain(input.audioModel, sound, Math.max(time, sound.start));
      node.connect(gain).connect(audio.master);
      node.start(audio.ctx.currentTime + delay, offset, duration);
      this.playingSounds.push({ node, gain, sound });
    });
  }

  // ---- overlays

  private loadOverlayResources(input: PreviewEngineInput) {
    const fontPaths = new Set<string>();
    if (this.deps.defaultFontPath != null) fontPaths.add(this.deps.defaultFontPath);
    for (const overlay of input.overlays) {
      if (overlay.type === 'image' && !this.images.has(overlay.absolutePath)) {
        const image = new Image();
        image.addEventListener('load', () => { this.dirty = true; });
        image.src = this.deps.getFileUrl(overlay.absolutePath);
        this.images.set(overlay.absolutePath, image);
      }
      if ((overlay.type === 'text' || overlay.type === 'countdown') && overlay.font != null) fontPaths.add(overlay.font.absolutePath);
    }
    for (const path of fontPaths) this.loadFont(path);
    const audio = this.ensureAudio();
    if (audio == null) return;
    input.audioModel.sounds.filter((sound) => !this.soundBuffers.has(sound.path)).forEach((sound) => {
      this.soundBuffers.set(sound.path, 'loading');
      this.deps.readFile(sound.path).then((data) => audio.ctx.decodeAudioData(data)).then((buffer) => {
        this.soundBuffers.set(sound.path, buffer);
        if (this.clock.playing) this.restartSounds(this.getTime());
      }, (err) => {
        console.warn('Cannot decode sound for the preview', sound.path, err);
        this.soundBuffers.set(sound.path, 'failed');
      });
    });
  }

  private loadFont(path: string) {
    if (this.fonts.has(path) || typeof FontFace === 'undefined') return;
    const family = `videomix-preview-font-${this.fonts.size}`;
    // until it's loaded, the canvas falls back to the next family of the list
    this.fonts.set(path, `"${family}", sans-serif`);
    const face = new FontFace(family, `url("${this.deps.getFileUrl(path)}")`);
    face.load().then((loaded) => {
      document.fonts.add(loaded);
      this.dirty = true;
    }, (err) => console.warn('Cannot load font for the preview', path, err));
  }

  // ---- drawing

  private readonly resources: PreviewCanvasResources = {
    getVideo: (key) => {
      const assignment = this.videoAssignments.find((a) => a.request?.key === key);
      const el = assignment?.slot.el;
      return el instanceof HTMLVideoElement && el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && el.videoWidth > 0 ? el : undefined;
    },
    getPlaceholder: (clipId) => {
      const clip = this.input?.clips.get(clipId);
      const path = clip != null ? this.input?.sources.get(clip.sourceId)?.absolutePath : undefined;
      if (clip == null || !this.isUnplayable(path)) return undefined;
      return { color: this.clipColors.get(clipId) ?? '#555555', label: clip.name };
    },
    getImage: (path) => {
      const image = this.images.get(path);
      return image != null && image.complete && image.naturalWidth > 0 ? image : undefined;
    },
    getFontFamily: (fontPath) => {
      const path = fontPath ?? this.deps.defaultFontPath;
      return (path != null ? this.fonts.get(path) : undefined) ?? 'sans-serif';
    },
    fillColor: '#000000',
  };

  private draw(input: PreviewEngineInput, time: number) {
    const { ctx2d } = this;
    if (ctx2d == null || ctx2d.canvas.width === 0) return;
    const { plan, settings: { fps }, totalFrames } = input.drawModel.tl;
    // at the very end, the last frame stays on screen (like a player) instead of the empty frame after it
    const t = Math.min(time, Math.max(0, (totalFrames - 1) / fps));
    this.resources.fillColor = input.drawModel.settings.fill.color;
    drawPreviewFrame({
      ctx: ctx2d,
      frame: getPreviewDrawList(input.drawModel, t),
      overlays: getPreviewOverlayOps({ overlays: input.overlays, resolved: input.resolved, time: t, fps, width: plan.width, height: plan.height }),
      outputWidth: plan.width,
      resources: this.resources,
      blurScratch: this.blurScratch,
    });
  }
}
