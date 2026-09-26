import type { ChangeEventHandler, CSSProperties, KeyboardEventHandler, RefObject } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

// Inputs whose continuous edit is one undo step (T51): `onInput` on every move (a transient edit), `onCommit` once when
// it ends. React's `onChange` can't be the commit: for range and color inputs it fires on every move, like `input`,
// so each move became an undo step. The native `change` event fires once: on release (range; also per arrow key
// press) or when the color picker is closed.
//
// NumberField (T54, G5): a plain `input[type=number]` has the same problem the other way round: React's `onChange`
// fires on every keystroke, so typing "12" made two undo steps. It has no native `change`-only-on-release like range
// does (it fires on every keystroke too), so it keeps a local draft instead and commits once on blur or Enter — the
// same convention OverlayPanel's fields use, moved here so MixSettingsDialog can reuse it (T51's audit left it: the
// gap width, the reorder window and the linked clips' max gap had the same one-step-per-digit problem).

/** Calls `onCommit` with the input's value on its native `change` event. */
function useNativeChange(ref: RefObject<HTMLInputElement | null>, onCommit: (value: string) => void) {
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    const input = ref.current;
    if (input == null) return undefined;
    const handleChange = () => onCommitRef.current(input.value);
    input.addEventListener('change', handleChange);
    return () => input.removeEventListener('change', handleChange);
  }, [ref]);
}

// eslint-disable-next-line react/display-name
export const RangeInput = memo(({ value, min, max, step, disabled, style, onInput, onCommit }: {
  value: number,
  min: number,
  max: number,
  step: number,
  disabled?: boolean | undefined,
  style?: CSSProperties | undefined,
  onInput: (newValue: number) => void,
  onCommit: (newValue: number) => void,
}) => {
  const ref = useRef<HTMLInputElement>(null);
  useNativeChange(ref, (v) => onCommit(Number(v)));
  return (
    <input ref={ref} type="range" min={min} max={max} step={step} disabled={disabled} style={style} value={value} onChange={(e) => onInput(Number(e.currentTarget.value))} />
  );
});

// eslint-disable-next-line react/display-name
export const ColorInput = memo(({ value, disabled, style, onInput, onCommit }: {
  value: string,
  disabled?: boolean | undefined,
  style?: CSSProperties | undefined,
  onInput: (newValue: string) => void,
  onCommit: (newValue: string) => void,
}) => {
  const ref = useRef<HTMLInputElement>(null);
  useNativeChange(ref, onCommit);
  return (
    <input ref={ref} type="color" disabled={disabled} style={style} value={value} onChange={(e) => onInput(e.currentTarget.value)} />
  );
});

/** A number typed freely and applied on blur or Enter (Escape reverts), so typing "12.5" is one edit, not four. */
// eslint-disable-next-line react/display-name
export const NumberField = memo(({ value, onCommit, step = 1, min, max, disabled, style, title, 'data-testid': dataTestId }: {
  value: number,
  onCommit: (newValue: number) => void,
  step?: number | undefined,
  min?: number | undefined,
  max?: number | undefined,
  disabled?: boolean | undefined,
  style?: CSSProperties | undefined,
  'data-testid'?: string | undefined,
  title?: string | undefined,
}) => {
  const [draft, setDraft] = useState<string>();
  const shown = draft ?? String(value);

  const commit = useCallback(() => {
    if (draft == null) return;
    setDraft(undefined);
    const parsed = Number(draft.replace(',', '.'));
    if (draft.trim() === '' || !Number.isFinite(parsed)) return;
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
    if (clamped !== value) onCommit(clamped);
  }, [draft, max, min, onCommit, value]);

  const handleChange = useCallback<ChangeEventHandler<HTMLInputElement>>((e) => {
    // the spinner arrows are discrete steps: apply them right away
    const native = e.nativeEvent as InputEvent;
    if (native.inputType == null || native.inputType === '') {
      setDraft(undefined);
      const parsed = Number(e.target.value);
      if (Number.isFinite(parsed) && e.target.value !== '') onCommit(parsed);
      return;
    }
    setDraft(e.target.value);
  }, [onCommit]);

  const handleKeyDown = useCallback<KeyboardEventHandler<HTMLInputElement>>((e) => {
    // don't trigger the app's keyboard shortcuts while typing
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setDraft(undefined);
  }, [commit]);

  return (
    <input data-testid={dataTestId} type="number" style={style} value={shown} step={step} min={min} max={max} disabled={disabled} title={title} onChange={handleChange} onBlur={commit} onKeyDown={handleKeyDown} />
  );
});
