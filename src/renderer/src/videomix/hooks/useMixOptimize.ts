import { useCallback, useEffect, useRef, useState } from 'react';

import type { MixOrderMetrics } from '../optimize/optimizeMix';
import { applyPlannerOrder, countMovedClips, getMixOrderMetrics, getOptimizeInput } from '../optimize/optimizeMix';
import type { OptimizeOrderRequest, OptimizeOrderResponse } from '../optimize/optimizeOrderMessages';
// https://vite.dev/guide/features.html#import-with-query-suffixes (like worker/eval.ts)
import OptimizeOrderWorker from '../optimize/optimizeOrderWorker?worker';
import { getOptimizeOrderBlocker } from '../planner/optimizeOrder';
import type { OrderOptimizerBest, OrderQuality } from '../planner/optimizeOrder';
import { comparePlanQuality } from '../planner/planMix';
import type { PlanPriority } from '../planner/types';
import type { MixClip, MixSettings } from '../types';

// I2 (T61): fixed, so the same project and time give the same order (the search is deterministic given its seed)
const SEED = 1;

/**
 * Only an order that makes the mix shorter or with less fill is offered: one that just matches the list to what the
 * planner already plays (the order and re-layout tie-breaks) isn't worth reordering the list.
 */
const isClearlyBetter = (best: OrderQuality, initial: OrderQuality, priority: PlanPriority | undefined) => (
  comparePlanQuality({ ...best, order: 0, relayouts: 0 }, { ...initial, order: 0, relayouts: 0 }, priority) < 0
);

export type MixOptimizeState =
  | { phase: 'idle' }
  | { phase: 'running', durationMs: number, elapsedMs: number, evaluations: number, initial: OrderQuality | undefined, best: OrderOptimizerBest | undefined, stopping: boolean }
  | {
    phase: 'done',
    evaluations: number,
    /** The project's clips and settings when the search started, and the list (ids) with the best order found. */
    clips: MixClip[],
    settings: MixSettings,
    order: string[],
    improved: boolean,
    moved: number,
    before: MixOrderMetrics,
    after: MixOrderMetrics,
  }
  | { phase: 'error', message: string };

/**
 * "Optimize mix" (I2, T61): runs the order optimizer in a Web Worker for the chosen time, with its progress, and
 * compares the best order found with the current one. Stopping keeps the best order so far. `apply` hands the new
 * clip list to `onApply` (a single undoable reorder) unless the clips changed in the meantime.
 */
export default function useMixOptimize({ clips, settings, onApply }: {
  clips: MixClip[],
  settings: MixSettings,
  onApply: (ids: string[]) => void,
}) {
  const [state, setState] = useState<MixOptimizeState>({ phase: 'idle' });
  const workerRef = useRef<Worker>(undefined);
  const runRef = useRef<{ clips: MixClip[], settings: MixSettings, best: OrderOptimizerBest | undefined, initial: OrderQuality | undefined, evaluations: number }>(undefined);

  const blocker = getOptimizeOrderBlocker(getOptimizeInput({ clips, settings }));

  const terminate = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = undefined;
  }, []);

  useEffect(() => terminate, [terminate]);

  const finish = useCallback(() => {
    terminate();
    const run = runRef.current;
    if (run == null) return;
    runRef.current = undefined;
    const input = getOptimizeInput(run);
    const clipIds = run.clips.map((clip) => clip.id);
    const { best, initial } = run;
    const improved = best != null && initial != null && isClearlyBetter(best.quality, initial, input.settings.priority);
    const order = improved ? applyPlannerOrder(clipIds, best.order) : clipIds;
    setState({
      phase: 'done',
      evaluations: run.evaluations,
      clips: run.clips,
      settings: run.settings,
      order,
      improved,
      moved: countMovedClips(clipIds, order),
      before: getMixOrderMetrics(input),
      after: getMixOrderMetrics(input, improved ? best.order : undefined),
    });
  }, [terminate]);

  const start = useCallback((durationMs: number) => {
    terminate();
    const input = getOptimizeInput({ clips, settings });
    runRef.current = { clips, settings, best: undefined, initial: undefined, evaluations: 0 };
    setState({ phase: 'running', durationMs, elapsedMs: 0, evaluations: 0, initial: undefined, best: undefined, stopping: false });

    const worker = new OptimizeOrderWorker();
    workerRef.current = worker;
    worker.addEventListener('message', (event: MessageEvent<OptimizeOrderResponse>) => {
      if (workerRef.current !== worker) return;
      const message = event.data;
      if (message.type === 'error') {
        terminate();
        runRef.current = undefined;
        setState({ phase: 'error', message: message.message });
        return;
      }
      const run = runRef.current;
      if (run == null) return;
      run.best = message.best;
      run.initial = message.initial;
      run.evaluations = message.evaluations;
      if (message.type === 'done') {
        finish();
        return;
      }
      setState((prev) => (prev.phase === 'running' ? { ...prev, elapsedMs: message.elapsedMs, evaluations: message.evaluations, initial: message.initial, best: message.best } : prev));
    });
    worker.addEventListener('error', (event) => {
      if (workerRef.current !== worker) return;
      console.error('Optimizer worker error', event);
      terminate();
      runRef.current = undefined;
      setState({ phase: 'error', message: event.message });
    });
    worker.postMessage({ input, seed: SEED, durationMs } satisfies OptimizeOrderRequest);
  }, [clips, finish, settings, terminate]);

  /** Stops the search and keeps the best order found so far. */
  const stop = useCallback(() => {
    setState((prev) => (prev.phase === 'running' ? { ...prev, stopping: true } : prev));
    // let the "stopping" state paint before planning the before/after
    setTimeout(finish, 0);
  }, [finish]);

  const reset = useCallback(() => {
    terminate();
    runRef.current = undefined;
    setState({ phase: 'idle' });
  }, [terminate]);

  /**
   * Applies the best order; false if the clips or the settings changed since the search started (any edit makes new
   * ones, see projectReducer): then nothing is applied, the order was found for another project.
   */
  const apply = useCallback(() => {
    if (state.phase !== 'done' || !state.improved) return false;
    if (clips !== state.clips || settings !== state.settings) return false;
    onApply(state.order);
    return true;
  }, [clips, onApply, settings, state]);

  return { state, blocker, start, stop, reset, apply };
}

export type UseMixOptimize = ReturnType<typeof useMixOptimize>;
