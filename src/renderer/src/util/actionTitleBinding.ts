/**
 * The key binding shown in a button's tooltip ("Render (Ctrl+E)") when an action has several (T33).
 * Several VideoMix actions have a Ctrl binding and a Meta (⌘) twin for macOS; the tooltip used to show the last one,
 * so Linux and Windows showed "Meta+E", a key combination that is not the one users press there.
 * macOS: the first binding with Meta, if any; elsewhere: the first binding without Meta, if any; otherwise the first.
 */
export default function pickTooltipBinding<T extends { keys: string }>(bindings: readonly T[], isMac: boolean): T | undefined {
  const hasMeta = (binding: T) => binding.keys.split('+').some((key) => key.startsWith('Meta'));
  return bindings.find((binding) => hasMeta(binding) === isMac) ?? bindings[0];
}
