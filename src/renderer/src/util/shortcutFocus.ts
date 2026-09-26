/**
 * G4 (T51): whether the focused element keeps a key press for itself, so the app's keyboard shortcuts must ignore it.
 * Shortcuts work with the focus anywhere (e.g. on a button that was just clicked), except:
 * - inside a dialog or an open menu / list popup (as before: dialogs handle their own keys, menus have typeahead);
 * - in text entry: text/number inputs, textareas, selects and contentEditable (a native select doesn't use Ctrl/Cmd
 *   combinations, so those still reach the shortcuts there, e.g. Ctrl+Z right after picking an option);
 * - navigation keys (arrows, Home/End, Page Up/Down) on a keyboard-operable widget that uses them (range input,
 *   radio, slider, spin button, tab, combobox);
 * - Space and Enter on a keyboard-operable activatable element (button, link, checkbox, switch…): it activates.
 *
 * "Keyboard-operable" for ARIA roles means in the tab order (`tabIndex >= 0`): the app's `role="button"
 * tabIndex={-1}` elements are click-only and don't handle keys, so the shortcuts keep working on them.
 * Pure (a minimal element interface), so it can be tested without a DOM.
 */
export interface ShortcutFocusTarget {
  tagName: string,
  isContentEditable?: boolean | undefined,
  tabIndex: number,
  getAttribute: (name: string) => string | null,
  closest: (selectors: string) => unknown,
}

const popupSelector = ['dialog', 'alertdialog', 'menu', 'menubar', 'listbox'].map((role) => `[role="${role}"]`).join(', ');

// Input types that don't take text; any other (text, number, search, email, date…) is text entry
const nonTextInputTypes = new Set(['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'range', 'color', 'file', 'hidden']);
const activatableInputTypes = new Set(['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'color', 'file']);
const navigationInputTypes = new Set(['range', 'radio']);

const activatableRoles = new Set(['button', 'checkbox', 'switch', 'radio', 'tab', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option']);
const navigationRoles = new Set(['slider', 'spinbutton', 'radio', 'tab', 'combobox', 'scrollbar']);

const navigationCodes = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
const activationCodes = new Set(['Space', 'Enter', 'NumpadEnter']);

function getInputType(el: ShortcutFocusTarget) {
  return (el.getAttribute('type') ?? 'text').toLowerCase();
}

export function isTextEntry(el: ShortcutFocusTarget, { withCommandKey = false }: { withCommandKey?: boolean } = {}) {
  const tag = el.tagName.toUpperCase();
  if (tag === 'SELECT') return !withCommandKey;
  if (tag === 'TEXTAREA' || el.isContentEditable) return true;
  return tag === 'INPUT' && !nonTextInputTypes.has(getInputType(el));
}

function isActivatable(el: ShortcutFocusTarget) {
  const tag = el.tagName.toUpperCase();
  if (tag === 'BUTTON' || tag === 'SUMMARY') return true;
  if (tag === 'A') return el.getAttribute('href') != null;
  if (tag === 'INPUT') return activatableInputTypes.has(getInputType(el));
  const role = el.getAttribute('role');
  return role != null && activatableRoles.has(role) && el.tabIndex >= 0;
}

function usesNavigationKeys(el: ShortcutFocusTarget) {
  if (el.tagName.toUpperCase() === 'INPUT') return navigationInputTypes.has(getInputType(el));
  const role = el.getAttribute('role');
  return role != null && navigationRoles.has(role) && el.tabIndex >= 0;
}

/** `target`: the key event's target (the focused element); `code`, `ctrlKey`, `metaKey`: from the `KeyboardEvent`. */
export function isShortcutKeptByFocus(target: ShortcutFocusTarget | null | undefined, { code, ctrlKey = false, metaKey = false }: {
  code: string,
  ctrlKey?: boolean | undefined,
  metaKey?: boolean | undefined,
}) {
  if (target == null) return false;
  if (target.closest(popupSelector) != null) return true;
  if (isTextEntry(target, { withCommandKey: ctrlKey || metaKey })) return true;
  if (navigationCodes.has(code) && usesNavigationKeys(target)) return true;
  return activationCodes.has(code) && isActivatable(target);
}
