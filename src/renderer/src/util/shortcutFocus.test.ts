import { describe, expect, test } from 'vitest';

import type { ShortcutFocusTarget } from './shortcutFocus';
import { isShortcutKeptByFocus } from './shortcutFocus';

const el = ({ tagName, attributes = {}, tabIndex, isContentEditable = false, inPopup = false }: {
  tagName: string,
  attributes?: Record<string, string>,
  tabIndex?: number,
  isContentEditable?: boolean,
  inPopup?: boolean,
}): ShortcutFocusTarget => ({
  tagName,
  isContentEditable,
  tabIndex: tabIndex ?? (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(tagName) ? 0 : -1),
  getAttribute: (name) => attributes[name] ?? null,
  closest: () => (inPopup ? {} : null),
});

describe('isShortcutKeptByFocus', () => {
  test('the body or no target: shortcuts work', () => {
    expect(isShortcutKeptByFocus(el({ tagName: 'BODY' }), { code: 'KeyZ' })).toBe(false);
    expect(isShortcutKeptByFocus(undefined, { code: 'Space' })).toBe(false);
  });

  test('a button keeps only Space and Enter', () => {
    const button = el({ tagName: 'BUTTON' });
    expect(isShortcutKeptByFocus(button, { code: 'KeyZ' })).toBe(false);
    expect(isShortcutKeptByFocus(button, { code: 'ArrowLeft' })).toBe(false);
    expect(isShortcutKeptByFocus(button, { code: 'Space' })).toBe(true);
    expect(isShortcutKeptByFocus(button, { code: 'Enter' })).toBe(true);
    expect(isShortcutKeptByFocus(el({ tagName: 'A', attributes: { href: '#' } }), { code: 'Enter' })).toBe(true);
    expect(isShortcutKeptByFocus(el({ tagName: 'INPUT', attributes: { type: 'checkbox' } }), { code: 'Space' })).toBe(true);
    expect(isShortcutKeptByFocus(el({ tagName: 'INPUT', attributes: { type: 'checkbox' } }), { code: 'KeyZ' })).toBe(false);
  });

  test('click-only role="button" elements (not in the tab order) keep nothing', () => {
    expect(isShortcutKeptByFocus(el({ tagName: 'DIV', attributes: { role: 'button' }, tabIndex: -1 }), { code: 'Space' })).toBe(false);
    expect(isShortcutKeptByFocus(el({ tagName: 'DIV', attributes: { role: 'button' }, tabIndex: 0 }), { code: 'Space' })).toBe(true);
    expect(isShortcutKeptByFocus(el({ tagName: 'svg', tabIndex: -1 }), { code: 'KeyZ' })).toBe(false);
  });

  test('text entry keeps every key', () => {
    for (const type of ['text', 'number', 'search']) {
      expect(isShortcutKeptByFocus(el({ tagName: 'INPUT', attributes: { type } }), { code: 'KeyZ' })).toBe(true);
    }
    expect(isShortcutKeptByFocus(el({ tagName: 'INPUT' }), { code: 'Space' })).toBe(true);
    expect(isShortcutKeptByFocus(el({ tagName: 'TEXTAREA' }), { code: 'KeyZ' })).toBe(true);
    expect(isShortcutKeptByFocus(el({ tagName: 'SELECT' }), { code: 'KeyZ' })).toBe(true);
    expect(isShortcutKeptByFocus(el({ tagName: 'DIV', isContentEditable: true }), { code: 'KeyZ' })).toBe(true);
  });

  test('a select keeps plain keys, but not Ctrl/Cmd combinations', () => {
    const select = el({ tagName: 'SELECT' });
    expect(isShortcutKeptByFocus(select, { code: 'KeyZ', ctrlKey: true })).toBe(false);
    expect(isShortcutKeptByFocus(select, { code: 'KeyZ', metaKey: true })).toBe(false);
    expect(isShortcutKeptByFocus(select, { code: 'KeyS', ctrlKey: true })).toBe(false);
    expect(isShortcutKeptByFocus(select, { code: 'KeyZ' })).toBe(true);
    expect(isShortcutKeptByFocus(select, { code: 'ArrowDown' })).toBe(true);
    // text fields keep Ctrl combinations (their own undo, copy, paste…)
    expect(isShortcutKeptByFocus(el({ tagName: 'INPUT' }), { code: 'KeyZ', ctrlKey: true })).toBe(true);
    expect(isShortcutKeptByFocus(el({ tagName: 'TEXTAREA' }), { code: 'KeyZ', metaKey: true })).toBe(true);
    // inside a dialog, still kept
    expect(isShortcutKeptByFocus(el({ tagName: 'SELECT', inPopup: true }), { code: 'KeyZ', ctrlKey: true })).toBe(true);
  });

  test('sliders keep the navigation keys only', () => {
    const range = el({ tagName: 'INPUT', attributes: { type: 'range' } });
    expect(isShortcutKeptByFocus(range, { code: 'ArrowLeft' })).toBe(true);
    expect(isShortcutKeptByFocus(range, { code: 'Home' })).toBe(true);
    expect(isShortcutKeptByFocus(range, { code: 'KeyZ' })).toBe(false);
    expect(isShortcutKeptByFocus(range, { code: 'Space' })).toBe(false);
    expect(isShortcutKeptByFocus(el({ tagName: 'SPAN', attributes: { role: 'slider' }, tabIndex: 0 }), { code: 'ArrowRight' })).toBe(true);
    // a click-only seek bar
    expect(isShortcutKeptByFocus(el({ tagName: 'DIV', attributes: { role: 'slider' }, tabIndex: -1 }), { code: 'ArrowRight' })).toBe(false);
  });

  test('inside a dialog or a menu, every key is kept', () => {
    expect(isShortcutKeptByFocus(el({ tagName: 'DIV', inPopup: true }), { code: 'KeyZ' })).toBe(true);
    expect(isShortcutKeptByFocus(el({ tagName: 'BUTTON', inPopup: true }), { code: 'ArrowLeft' })).toBe(true);
  });
});
