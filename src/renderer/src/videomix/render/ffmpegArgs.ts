// Small formatting helpers for ffmpeg args and filter graphs, shared by the graph builders.

/** Number for ffmpeg args/expressions: at most 6 decimals, never exponent notation. */
export const formatNumber = (v: number) => {
  const rounded = Math.round(v * 1e6) / 1e6 + 0;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(6).replace(/0+$/, '');
};

/** `#rrggbb` / `#rrggbbaa` (project format) → `0xrrggbb` / `0xrrggbbaa` (unambiguous in filter graphs). */
export const toFfmpegColor = (color: string) => (/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(color) ? `0x${color.slice(1)}` : color);

/**
 * A literal string (text, file path) as a filter option value inside a filter graph. Two levels of escaping, as ffmpeg
 * parses it twice (https://ffmpeg.org/ffmpeg-filters.html#Notes-on-filtergraph-escaping):
 * 1. option level (`key=value:…`): quoted, so `:` (drive letters, drawtext's `%{…:…}`) and `\` (Windows paths) are literal;
 * 2. graph level: `\ ' [ ] , ;` backslash-escaped.
 */
export function escapeFilterValue(value: string) {
  const quoted = `'${value.replaceAll('\'', String.raw`'\''`)}'`;
  return quoted.replaceAll(/[\\'[\],;]/g, (c) => `\\${c}`);
}
