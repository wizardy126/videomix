import type { EtaSample } from './renderEta';

/**
 * Phase of a render or preview (T41). 'confirm': a question (e.g. the hardware encoder fallback) is shown meanwhile,
 * so the progress dialog steps aside.
 */
export type MixRenderPhase = 'loudness' | 'render' | 'confirm';

/** What the render progress dialog shows, carried in the working state (useLoading) while a render runs. */
export interface MixRenderStatus {
  kind: 'mix' | 'preview',
  /** `Date.now()` at the start of the whole render: the elapsed time counts from here, over all phases. */
  startedAt: number,
  phase: MixRenderPhase,
  /** `Date.now()` when the current phase (re)started, with the progress from 0 again. */
  phaseStartedAt: number,
  /** Render phase: when the first ffmpeg started, with the progress of the cached blocks done by then. */
  etaBaseline?: EtaSample | undefined,
}
