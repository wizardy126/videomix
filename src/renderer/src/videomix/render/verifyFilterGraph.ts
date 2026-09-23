// Structural checks of a generated filter graph (04-diseno §4.2 "invariantes"), used by the tests: every label is
// produced once and consumed once, input streams exist and are used once, crops of the inputs stay inside the source
// frame, split counts match and no expression nests if() (ffmpeg's parser limit, ADR-001).

/**
 * Split `text` on `separator` outside single quotes (expressions are quoted and contain commas), keeping quotes and
 * escapes. Like ffmpeg's av_get_token, a backslash outside quotes escapes the next character (drawtext texts, font paths).
 */
function splitOutsideQuotes(text: string, separator: string) {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '\\' && !quoted && i + 1 < text.length) {
      current += ch + text[i + 1]!;
      i += 1;
    } else {
      if (ch === "'") quoted = !quoted;
      if (ch === separator && !quoted) {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  parts.push(current);
  return parts;
}

/** One level of ffmpeg's unescaping (av_get_token without terminators): quotes removed, `\x` → `x` outside quotes. */
export function unescapeFilterToken(text: string) {
  let out = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === "'") quoted = !quoted;
    else if (ch === '\\' && !quoted && i + 1 < text.length) {
      out += text[i + 1]!;
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Options of a filter as ffmpeg sees them after both levels of unescaping (graph, then `key=value:…`). */
export function parseFilterOptions(filter: string): Record<string, string> {
  const args = unescapeFilterToken(filter.slice(filter.indexOf('=') + 1));
  return Object.fromEntries(splitOutsideQuotes(args, ':').map((option) => {
    const eq = option.indexOf('=');
    return [option.slice(0, eq), unescapeFilterToken(option.slice(eq + 1))];
  }));
}

export interface ParsedChain {
  inputs: string[],
  outputs: string[],
  filters: string[],
}

export function parseFilterGraph(filterComplex: string): ParsedChain[] {
  return splitOutsideQuotes(filterComplex, ';').map((raw) => {
    let rest = raw.trim();
    const inputs: string[] = [];
    const outputs: string[] = [];
    for (let m = /^\[([^\]]+)\]/.exec(rest); m != null; m = /^\[([^\]]+)\]/.exec(rest)) {
      inputs.push(m[1]!);
      rest = rest.slice(m[0].length);
    }
    for (let m = /\[([^\]]+)\]$/.exec(rest); m != null; m = /\[([^\]]+)\]$/.exec(rest)) {
      outputs.unshift(m[1]!);
      rest = rest.slice(0, -m[0].length);
    }
    return { inputs, outputs, filters: splitOutsideQuotes(rest, ',') };
  });
}

const filterName = (filter: string) => filter.split('=')[0]!;
const filterArgs = (filter: string) => splitOutsideQuotes(filter.slice(filter.indexOf('=') + 1), ':');

/**
 * Returns the problems found (empty = valid). `sourceSizes` gives the oriented size of each input index, to check that
 * the crops applied to it stay inside the frame.
 */
export function verifyFilterGraph(
  { inputs, filterComplex, outLabel }: { inputs: string[][], filterComplex: string, outLabel: string },
  { sourceSizes = [] }: { sourceSizes?: ({ width: number, height: number } | undefined)[] } = {},
) {
  const issues: string[] = [];
  const chains = parseFilterGraph(filterComplex);
  const produced = new Map<string, number>();
  const consumed = new Map<string, number>();
  const count = (map: Map<string, number>, label: string) => map.set(label, (map.get(label) ?? 0) + 1);

  chains.forEach((chain, i) => {
    chain.outputs.forEach((l) => count(produced, l));
    chain.inputs.forEach((l) => count(consumed, l));
    if (chain.outputs.length === 0) issues.push(`chain ${i} has no output label`);
    if (chain.filters.some((f) => f.trim() === '')) issues.push(`chain ${i} has an empty filter`);
    if (chain.filters.some((f) => /\bif\(/.test(f))) issues.push(`chain ${i} uses if() (nesting limit)`);

    // overlays (T20): a timed filter only where it's shown, drawtext with its font and a balanced %{…} text
    for (const filter of chain.filters.filter((f) => filterName(f) === 'drawtext' || filterName(f) === 'overlay')) {
      const name = filterName(filter);
      const options = parseFilterOptions(filter);
      const between = options['enable'] != null ? /^between\(t,(-?[\d.]+),(-?[\d.]+)\)$/.exec(options['enable']) : undefined;
      if (between === null || (between != null && !(Number(between[1]) < Number(between[2])))) issues.push(`chain ${i}: bad enable in ${filter}`);
      if (name === 'drawtext') {
        if (!options['fontfile']) issues.push(`chain ${i}: drawtext without fontfile`);
        const text = options['text'] ?? '';
        if (text === '' || text.split('%{').length !== text.split('}').length) issues.push(`chain ${i}: bad drawtext text ${text}`);
        if (options['enable'] == null) issues.push(`chain ${i}: drawtext without enable`);
      }
    }

    const last = chain.filters.at(-1)!;
    if (filterName(last) === 'split') {
      const n = last.includes('=') ? Number(filterArgs(last)[0]) : 2;
      if (n !== chain.outputs.length) issues.push(`chain ${i}: split=${n} with ${chain.outputs.length} outputs`);
    }

    // crops applied to an input stream (before any filter that changes its geometry) must fit in the source frame
    const inputMatch = chain.inputs.length === 1 ? /^(\d+):v$/.exec(chain.inputs[0]!) : null;
    if (inputMatch != null) {
      const size = sourceSizes[Number(inputMatch[1])];
      for (const filter of chain.filters) {
        const name = filterName(filter);
        if (name === 'scale' || name === 'split') break;
        if (name === 'crop' && size != null) {
          const [w, h, x, y] = filterArgs(filter).map(Number) as [number, number, number, number];
          if (![w, h, x, y].every((v) => Number.isInteger(v) && v >= 0 && v % 2 === 0)) issues.push(`chain ${i}: crop ${filter} not even/integer`);
          if (x + w > size.width || y + h > size.height || w <= 0 || h <= 0) issues.push(`chain ${i}: ${filter} outside the ${size.width}x${size.height} source`);
        }
      }
    }
  });

  for (const [label, n] of produced) {
    if (n > 1) issues.push(`label ${label} produced ${n} times`);
    const uses = consumed.get(label) ?? 0;
    if (label === outLabel) {
      if (uses > 0) issues.push(`output ${label} is consumed`);
    } else if (uses !== 1) {
      issues.push(`label ${label} consumed ${uses} times`);
    }
  }
  for (const [label, n] of consumed) {
    const input = /^(\d+):[av]$/.exec(label);
    if (input != null) {
      if (Number(input[1]) >= inputs.length) issues.push(`input ${label} does not exist (${inputs.length} inputs)`);
      if (n !== 1) issues.push(`input ${label} consumed ${n} times`);
    } else if (!produced.has(label)) {
      issues.push(`label ${label} consumed but never produced`);
    }
  }
  if (!produced.has(outLabel)) issues.push(`output ${outLabel} not produced`);
  inputs.forEach((args, i) => {
    if (args.at(-2) !== '-i') issues.push(`input ${i} doesn't end with -i <path>`);
    if (!consumed.has(`${i}:v`) && !consumed.has(`${i}:a`) && !consumed.has(`${i}:a:0`)) issues.push(`input ${i} unused`);
  });
  return issues;
}
