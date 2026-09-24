// Remaining time of a render (T41), for the render progress dialog. Pure: the dialog feeds it the progress events
// (0–1) of the render phase with their time, and asks for the estimate as often as it redraws.
//
// - The rate is measured over a sliding window (a moving average): the last ETA_WINDOW_MS, or the second half of the
//   time since the baseline while that's shorter, so the start-up of the first ffmpegs (seconds with no progress,
//   a lot for a short render) doesn't weigh on the estimate for long.
// - The baseline is where the timed work starts. Cached blocks (T28) count as done at once, before the first ffmpeg
//   runs, so the render moves the baseline past them (`rebaseRenderEta`) and they don't make the rate look faster
//   than it is.
// - Nothing is estimated until there's enough data (ETA_MIN_ELAPSED_MS and ETA_MIN_PROGRESS since the baseline).
// - That rate is smoothed further (exponential moving average), so the estimate doesn't jump at every event; between
//   events it counts down on its own.

/** Progress (0–1) at a time (ms, any clock, as long as it's always the same). */
export interface EtaSample {
  time: number,
  progress: number,
}

export interface RenderEtaState {
  /** Where the timed work starts: progress before it (cached blocks) doesn't count for the rate. */
  baseline: EtaSample | undefined,
  /** Samples since the baseline within the window (the oldest may be just before it: the rate is measured from it). */
  samples: EtaSample[],
  /** Smoothed rate (progress per ms) at `time`, once there's enough data. */
  rate: { time: number, value: number } | undefined,
}

export const ETA_WINDOW_MS = 20_000;
export const ETA_MIN_ELAPSED_MS = 3000;
export const ETA_MIN_PROGRESS = 0.02;
/**
 * Time constant (ms) of the exponential moving average of the rate: by time rather than by event, so a burst of
 * events (several ffmpegs, queued IPC) weighs as much as the time it covers.
 */
export const ETA_SMOOTHING_MS = 2000;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function createRenderEta(): RenderEtaState {
  return { baseline: undefined, samples: [], rate: undefined };
}

/** The timed work starts at `sample`: the progress so far (e.g. cached blocks) is left out of the rate. */
export function rebaseRenderEta(sample: EtaSample): RenderEtaState {
  const baseline = { time: sample.time, progress: clamp01(sample.progress) };
  return { baseline, samples: [baseline], rate: undefined };
}

/** The sample the rate is measured from at `now`: the last one at or before the start of the window. */
function getReference(samples: EtaSample[], baseline: EtaSample, now: number) {
  const windowStart = Math.max(now - ETA_WINDOW_MS, baseline.time + (now - baseline.time) / 2);
  let reference = samples[0];
  for (const sample of samples) {
    if (sample.time > windowStart) break;
    reference = sample;
  }
  return reference;
}

/** Rate over the window (progress per ms), or undefined if there isn't enough data yet. */
function getWindowRate({ baseline, samples }: RenderEtaState, now: number) {
  const last = samples.at(-1);
  if (baseline == null || last == null) return undefined;
  if (now - baseline.time < ETA_MIN_ELAPSED_MS || last.progress - baseline.progress < ETA_MIN_PROGRESS) return undefined;
  const reference = getReference(samples, baseline, now);
  if (reference == null || now <= reference.time) return undefined;
  return (last.progress - reference.progress) / (now - reference.time);
}

/**
 * A progress event. The first one is the baseline unless `rebaseRenderEta` set one; progress going backwards (the
 * render starting over, e.g. with another encoder) starts over as well.
 */
export function addRenderEtaSample(state: RenderEtaState, sampleIn: EtaSample): RenderEtaState {
  const sample = { time: sampleIn.time, progress: clamp01(sampleIn.progress) };
  const last = state.samples.at(-1);
  if (state.baseline == null || (last != null && sample.progress < last.progress)) return rebaseRenderEta(sample);

  // Keep the reference of the window (the last sample at or before its start: the window only moves forward) and
  // what's after it
  const samples = [...state.samples, sample];
  const reference = getReference(samples, state.baseline, sample.time);
  const kept = reference != null ? samples.slice(samples.indexOf(reference)) : samples;

  const next: RenderEtaState = { ...state, samples: kept };
  const windowRate = getWindowRate(next, sample.time);
  if (windowRate == null) return next;
  const previous = state.rate;
  const weight = previous != null ? 1 - Math.exp(-(sample.time - previous.time) / ETA_SMOOTHING_MS) : 1;
  const value = previous != null ? previous.value + weight * (windowRate - previous.value) : windowRate;
  return { ...next, rate: { time: sample.time, value } };
}

/**
 * Remaining ms at `now` (counting down since the last event, never below 0), or undefined while it's still being
 * calculated.
 */
export function getRenderEtaRemainingMs({ samples, rate }: RenderEtaState, now: number) {
  const last = samples.at(-1);
  if (last == null) return undefined;
  if (last.progress >= 1) return 0;
  // no progress over the whole window (a stall): nothing sensible to say
  if (rate == null || rate.value <= 0) return undefined;
  return Math.max(0, (1 - last.progress) / rate.value - (now - last.time));
}
