import type { CSSProperties, RefObject } from 'react';
import { memo, useEffect, useRef } from 'react';

// Inputs whose continuous edit is one undo step (T51): `onInput` on every move (a transient edit), `onCommit` once when
// it ends. React's `onChange` can't be the commit: for range and color inputs it fires on every move, like `input`,
// so each move became an undo step. The native `change` event fires once: on release (range; also per arrow key
// press) or when the color picker is closed.

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
