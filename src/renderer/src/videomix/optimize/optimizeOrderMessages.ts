import type { OrderOptimizerBest, OrderQuality } from '../planner/optimizeOrder';
import type { PlanMixInput } from '../planner/types';

// I2 (T61): messages between the UI and the optimizer worker.

export interface OptimizeOrderRequest {
  input: PlanMixInput,
  seed: number,
  /** The search stops by itself after this long. */
  durationMs: number,
}

export type OptimizeOrderResponse =
  | { type: 'progress' | 'done', elapsedMs: number, evaluations: number, initial: OrderQuality, best: OrderOptimizerBest }
  | { type: 'error', message: string };
