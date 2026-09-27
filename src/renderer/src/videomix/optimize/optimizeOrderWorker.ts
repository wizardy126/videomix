import { createOrderOptimizer } from '../planner/optimizeOrder';
import type { OptimizeOrderRequest, OptimizeOrderResponse } from './optimizeOrderMessages';

// I2 (T61): runs the order optimizer off the UI thread. It reports the best order as soon as it improves (so stopping
// the worker keeps it) and the progress a few times per second; it ends by itself when the time is up.

/** Candidates between two looks at the clock (a candidate takes a few ms with 40 clips). */
const CHUNK = 5;
const PROGRESS_INTERVAL_MS = 200;

const post = (message: OptimizeOrderResponse) => postMessage(message);

onmessage = (event: MessageEvent<OptimizeOrderRequest>) => {
  const { input, seed, durationMs } = event.data;
  const startedAt = performance.now();
  try {
    const optimizer = createOrderOptimizer(input, { seed });
    let best = optimizer.getBest();
    const progress = (type: 'progress' | 'done') => post({ type, elapsedMs: performance.now() - startedAt, evaluations: optimizer.evaluations, initial: optimizer.initial, best });
    progress('progress');
    let lastProgress = performance.now();
    while (optimizer.canMove && performance.now() - startedAt < durationMs) {
      optimizer.step(CHUNK);
      const next = optimizer.getBest();
      const improved = next.evaluation !== best.evaluation;
      best = next;
      if (improved || performance.now() - lastProgress >= PROGRESS_INTERVAL_MS) {
        progress('progress');
        lastProgress = performance.now();
      }
    }
    progress('done');
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
