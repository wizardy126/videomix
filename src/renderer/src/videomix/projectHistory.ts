/**
 * Undo/redo history with support for transient (continuous) edits.
 *
 * - A normal edit pushes the previous `present` to `past` and clears `future`.
 * - A transient edit (e.g. every mousemove while dragging a rect) only replaces `present` and remembers
 *   `transientBase`, the state before the first transient edit. `commitTransient` then records the whole
 *   gesture as one step (`transientBase` → `present`), and `cancelTransient` reverts to `transientBase`.
 * - Any normal edit, undo or redo commits a pending transient edit first, so nothing is lost.
 * - Edits that return the same object are no-ops and don't create steps.
 */
export interface History<T> {
  past: T[],
  present: T,
  future: T[],
  transientBase?: T | undefined,
}

export const DEFAULT_HISTORY_LIMIT = 100;

export const createHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

function pushStep<T>(history: History<T>, prev: T, next: T, limit: number): History<T> {
  if (prev === next) return { past: history.past, present: next, future: history.future };
  return { past: [...history.past, prev].slice(-limit), present: next, future: [] };
}

export function commitTransient<T>(history: History<T>, limit = DEFAULT_HISTORY_LIMIT): History<T> {
  if (history.transientBase === undefined) return history;
  return pushStep(history, history.transientBase, history.present, limit);
}

export function cancelTransient<T>(history: History<T>): History<T> {
  if (history.transientBase === undefined) return history;
  return { past: history.past, present: history.transientBase, future: history.future };
}

export function applyEdit<T>(history: History<T>, update: (present: T) => T, { transient = false, limit = DEFAULT_HISTORY_LIMIT }: {
  transient?: boolean | undefined,
  limit?: number | undefined,
} = {}): History<T> {
  if (transient) {
    const next = update(history.present);
    if (next === history.present) return history;
    return { ...history, present: next, transientBase: history.transientBase ?? history.present };
  }

  const committed = commitTransient(history, limit);
  const next = update(committed.present);
  if (next === committed.present) return committed;
  return pushStep(committed, committed.present, next, limit);
}

/** Wrap `update` so the same input object always maps to the same output object (keeps reference equality checks working). */
export function memoizeByRef<T extends object>(update: (state: T) => T) {
  const cache = new WeakMap<T, T>();
  return (state: T) => {
    let ret = cache.get(state);
    if (ret === undefined) {
      ret = update(state);
      cache.set(state, ret);
    }
    return ret;
  };
}

/**
 * Apply `update` to every snapshot without creating a step, for derived data that must survive undo/redo
 * (e.g. the loudness cache).
 */
export function applyToAll<T extends object>(history: History<T>, update: (state: T) => T): History<T> {
  const map = memoizeByRef(update);
  return {
    past: history.past.map((s) => map(s)),
    present: map(history.present),
    future: history.future.map((s) => map(s)),
    ...(history.transientBase !== undefined && { transientBase: map(history.transientBase) }),
  };
}

export function undo<T>(history: History<T>, limit = DEFAULT_HISTORY_LIMIT): History<T> {
  const committed = commitTransient(history, limit);
  const prev = committed.past.at(-1);
  if (prev === undefined) return committed;
  return { past: committed.past.slice(0, -1), present: prev, future: [committed.present, ...committed.future] };
}

export function redo<T>(history: History<T>, limit = DEFAULT_HISTORY_LIMIT): History<T> {
  const committed = commitTransient(history, limit);
  const [next, ...future] = committed.future;
  if (next === undefined) return committed;
  return { past: [...committed.past, committed.present].slice(-limit), present: next, future };
}

export const canUndo = (history: History<unknown>) => history.past.length > 0 || (history.transientBase !== undefined && history.transientBase !== history.present);
// A pending transient change is committed (clearing `future`) before a redo, so there's nothing to redo.
export const canRedo = (history: History<unknown>) => history.future.length > 0 && (history.transientBase === undefined || history.transientBase === history.present);
