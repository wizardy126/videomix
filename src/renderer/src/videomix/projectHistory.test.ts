import { describe, test, expect } from 'vitest';

import { applyEdit, applyToAll, cancelTransient, canRedo, canUndo, commitTransient, createHistory, redo, undo } from './projectHistory';
import type { History } from './projectHistory';

interface State { n: number }

const set = (n: number) => () => ({ n });
const add = (d: number) => (s: State) => ({ n: s.n + d });
const values = (h: History<State>) => ({ past: h.past.map((s) => s.n), present: h.present.n, future: h.future.map((s) => s.n) });

describe('projectHistory', () => {
  test('edit, undo, redo', () => {
    let h = createHistory<State>({ n: 0 });
    expect(canUndo(h)).toBe(false);
    h = applyEdit(h, set(1));
    h = applyEdit(h, set(2));
    expect(values(h)).toEqual({ past: [0, 1], present: 2, future: [] });
    h = undo(h);
    h = undo(h);
    expect(values(h)).toEqual({ past: [], present: 0, future: [1, 2] });
    expect(undo(h)).toBe(h);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(values(h)).toEqual({ past: [0], present: 1, future: [2] });
    // a new edit clears the future
    h = applyEdit(h, set(5));
    expect(values(h)).toEqual({ past: [0, 1], present: 5, future: [] });
    expect(redo(h)).toBe(h);
  });

  test('no-op edits create no step', () => {
    const h = createHistory<State>({ n: 0 });
    expect(applyEdit(h, (s) => s)).toBe(h);
    expect(applyEdit(h, (s) => s, { transient: true })).toBe(h);
  });

  test('limit', () => {
    let h = createHistory<State>({ n: 0 });
    for (let i = 1; i <= 5; i += 1) h = applyEdit(h, set(i), { limit: 3 });
    expect(values(h)).toEqual({ past: [2, 3, 4], present: 5, future: [] });
  });

  test('transient edits are grouped into one step on commit', () => {
    let h = applyEdit(createHistory<State>({ n: 0 }), set(1));
    h = applyEdit(h, add(1), { transient: true });
    h = applyEdit(h, add(1), { transient: true });
    h = applyEdit(h, add(1), { transient: true });
    expect(values(h)).toEqual({ past: [0], present: 4, future: [] });
    expect(canUndo(h)).toBe(true);
    h = commitTransient(h);
    expect(h.transientBase).toBeUndefined();
    expect(values(h)).toEqual({ past: [0, 1], present: 4, future: [] });
    h = undo(h);
    expect(h.present.n).toBe(1);
    expect(commitTransient(h)).toBe(h);
  });

  test('cancelTransient reverts the gesture', () => {
    let h = applyEdit(createHistory<State>({ n: 0 }), set(1));
    h = applyEdit(h, add(5), { transient: true });
    h = cancelTransient(h);
    expect(values(h)).toEqual({ past: [0], present: 1, future: [] });
    expect(h.transientBase).toBeUndefined();
  });

  test('transient back to the start value creates no step', () => {
    let h = applyEdit(createHistory<State>({ n: 0 }), set(1));
    const start = h.present;
    h = applyEdit(h, set(2), { transient: true });
    h = applyEdit(h, () => start, { transient: true });
    expect(canUndo(h)).toBe(true);
    expect(values(commitTransient(h))).toEqual({ past: [0], present: 1, future: [] });
  });

  test('normal edit and undo commit a pending transient first', () => {
    let h = applyEdit(createHistory<State>({ n: 0 }), add(1), { transient: true });
    h = applyEdit(h, add(10));
    expect(values(h)).toEqual({ past: [0, 1], present: 11, future: [] });

    h = applyEdit(h, add(1), { transient: true });
    h = undo(h);
    expect(values(h)).toEqual({ past: [0, 1], present: 11, future: [12] });
  });

  test('canRedo is false while a transient edit is pending', () => {
    let h = undo(applyEdit(createHistory<State>({ n: 0 }), set(1)));
    expect(canRedo(h)).toBe(true);
    h = applyEdit(h, add(1), { transient: true });
    expect(canRedo(h)).toBe(false);
  });

  test('applyToAll updates every snapshot without a step and keeps shared references shared', () => {
    let h = applyEdit(applyEdit(createHistory<State>({ n: 0 }), set(1)), set(2));
    h = undo(h);
    h = applyEdit(h, add(1), { transient: true });
    const base = h.transientBase;
    const next = applyToAll(h, (s) => ({ n: s.n * 10 }));
    expect(values(next)).toEqual({ past: [0], present: 20, future: [20] });
    expect(next.transientBase?.n).toBe(10);
    expect(base?.n).toBe(1);
  });
});
