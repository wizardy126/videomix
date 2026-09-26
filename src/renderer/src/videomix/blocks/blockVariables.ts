import type { MixBlockDef } from '../types';

// Text variables of the blocks (H4): `{{name}}` or `{{name|default}}` inside a text overlay's `text`. Each block
// instance stores its values (`MixBlock.variables`); the expansion (expandBlocks.ts) substitutes them. Pure.

/**
 * `{{ name }}` or `{{ name | default }}`. The name can't contain `{`, `}` or `|` and is trimmed (so is the default's
 * surrounding space before `|`); the default is taken verbatim (it may be empty, or contain spaces).
 */
const VARIABLE_REGEX = /\{\{([^{}|]*)(?:\|([^{}]*))?\}\}/g;

export interface TextVariable {
  name: string,
  /** `undefined` when the placeholder has no `|default` part (`''` is an explicit empty default). */
  defaultValue: string | undefined,
}

/** Variables of a text, in order of first appearance (a repeated name keeps its first default, or the first one given). */
export function getTextVariables(text: string): TextVariable[] {
  const byName = new Map<string, TextVariable>();
  for (const match of text.matchAll(VARIABLE_REGEX)) {
    const name = match[1]!.trim();
    const defaultValue = match[2];
    const existing = byName.get(name);
    if (name !== '' && (existing == null || (existing.defaultValue == null && defaultValue != null))) byName.set(name, { name, defaultValue });
  }
  return [...byName.values()];
}

/** Variables of all the text members of a block definition (member order, then order in each text). */
export function getBlockDefVariables(def: Pick<MixBlockDef, 'members'>): TextVariable[] {
  const text = def.members.flatMap((member) => (member.type === 'text' ? [member.text] : [])).join('\n');
  return getTextVariables(text);
}

/** Default value of each variable that has one (see {@link getBlockDefVariables}). */
export const getVariableDefaults = (variables: readonly TextVariable[]): Record<string, string> => Object.fromEntries(variables.flatMap(({ name, defaultValue }) => (defaultValue != null ? [[name, defaultValue]] : [])));

/**
 * `text` with its placeholders replaced: the value in `values`, else the placeholder's own default, else the default
 * given for that name elsewhere in the block (`defaults`, so `{{a|x}}` in one text also fills a bare `{{a}}` in
 * another), else the placeholder is left as written (a missing value is visible instead of silently empty;
 * validateMixProject warns about it).
 */
export function substituteTextVariables(text: string, values: Readonly<Record<string, string>> | undefined, defaults?: Readonly<Record<string, string>>): string {
  if (!text.includes('{{')) return text;
  return text.replaceAll(VARIABLE_REGEX, (placeholder, rawName: string, defaultValue: string | undefined) => {
    const name = rawName.trim();
    if (name === '') return placeholder;
    return values?.[name] ?? defaultValue ?? defaults?.[name] ?? placeholder;
  });
}

/** Names of the variables of `def` that have neither a value in `values` nor a default in any of its texts. */
export function getMissingVariables(def: Pick<MixBlockDef, 'members'>, values: Readonly<Record<string, string>> | undefined): string[] {
  return getBlockDefVariables(def).filter(({ name, defaultValue }) => values?.[name] == null && defaultValue == null).map(({ name }) => name);
}
