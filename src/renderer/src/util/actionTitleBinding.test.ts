import { describe, expect, test } from 'vitest';

import pickTooltipBinding from './actionTitleBinding';

describe('pickTooltipBinding', () => {
  const bindings = [
    { keys: 'ControlLeft+ShiftLeft+KeyM', action: 'showMixSettings' },
    { keys: 'MetaLeft+ShiftLeft+KeyM', action: 'showMixSettings' },
  ];

  test('Ctrl binding on Linux/Windows, Meta on macOS', () => {
    expect(pickTooltipBinding(bindings, false)?.keys).toBe('ControlLeft+ShiftLeft+KeyM');
    expect(pickTooltipBinding(bindings, true)?.keys).toBe('MetaLeft+ShiftLeft+KeyM');
    // whatever the order
    expect(pickTooltipBinding([...bindings].reverse(), false)?.keys).toBe('ControlLeft+ShiftLeft+KeyM');
  });

  test('a single binding is always shown', () => {
    expect(pickTooltipBinding([{ keys: 'KeyN' }], true)?.keys).toBe('KeyN');
    expect(pickTooltipBinding([{ keys: 'MetaLeft+Backspace' }], false)?.keys).toBe('MetaLeft+Backspace');
    expect(pickTooltipBinding([], false)).toBeUndefined();
  });
});
