import { useCallback, useMemo } from 'react';

import { useAppContext } from '../contexts';
import useUserSettings from './useUserSettings';
import { formatKeybinding, isMac } from '../util';
import pickTooltipBinding from '../util/actionTitleBinding';
import type { KeyboardAction } from '../../../common/types';


export default function useActionTitle() {
  const { keyboardLayoutMap } = useAppContext();
  const { keyBindings } = useUserSettings();

  // VideoMix (T33): the binding of this platform when there are several (Ctrl+E / ⌘E), not just the last one
  const keyBindingsByAction = useMemo(() => Map.groupBy(keyBindings, (binding) => binding.action), [keyBindings]);

  const actionTitle = useCallback((title: string, action: KeyboardAction): string => {
    const binding = pickTooltipBinding(keyBindingsByAction.get(action) ?? [], isMac);
    if (binding == null) return title;
    const formatted = formatKeybinding(binding.keys, keyboardLayoutMap);
    if (formatted == null) return title;
    return `${title} (${formatted})`;
  }, [keyBindingsByAction, keyboardLayoutMap]);

  return actionTitle;
}
