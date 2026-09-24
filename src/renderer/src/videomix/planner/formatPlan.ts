import { getPlanAxis } from './types';
import type { MixPlan, PlanWarning } from './types';

const s = (t: number) => t.toFixed(2);

function formatWarning(w: PlanWarning) {
  switch (w.type) {
    case 'upscale': { return `upscale ${w.clipId} x${w.factor.toFixed(2)}`; }
    case 'pillarbox':
    case 'letterbox': { return `${w.type} ${w.clipId} @${s(w.time)}`; }
    case 'transition-shortened': { return `transition-shortened ${w.clipId} ${s(w.duration)}s`; }
    case 'fill': { return `fill ${w.width}px @${s(w.time)}`; }
    case 'pin-shifted': { return `pin-shifted ${w.clipId} ${s(w.pinTime)} -> ${s(w.time)}`; }
    case 'group-split': { return `group-split ${w.groupId} (${w.clipIds.join(', ')})`; }
    case 'truncated': { return `truncated @${s(w.time)} -${s(w.seconds)}s lost (${w.clipIds.join(', ')}) cut (${w.cutClipIds.join(', ')})`; }
    case 'extended': { return `extended ${w.clipId} +${w.pixels}px @${s(w.time)}-${s(w.endTime)}`; }
    default: { return JSON.stringify(w); }
  }
}

/**
 * Compact text view of a plan, for tests and debugging:
 * a header (size, `rows` for a vertical plan, duration), one line per layout (`time+animation: fill=px | cN=px | …`,
 * along the main axis), one per column (clips with start-end, `>` marks a
 * crossfaded substitution, `~fade` the end-of-video fade out to fill) and one per warning.
 */
// eslint-disable-next-line import/prefer-default-export
export function formatPlan(plan: MixPlan) {
  // rows (T29): the layout lengths are heights, top to bottom
  const lines = [`plan ${plan.width}x${plan.height}${getPlanAxis(plan) === 'rows' ? ' rows' : ''}, ${s(plan.duration)}s`];
  plan.layouts.forEach((layout) => {
    const items = [
      ...layout.columns.map((c) => ({ x: c.x, text: `c${c.column}=${c.width}` })),
      ...layout.fills.map((f) => ({ x: f.x, text: `fill=${f.width}` })),
    ].sort((a, b) => a.x - b.x);
    const time = layout.transitionDuration > 0 ? `${s(layout.time)}+${s(layout.transitionDuration)}` : s(layout.time);
    lines.push(`layout ${time}: ${items.map((i) => i.text).join(' | ')}`);
  });
  const columns = [...new Set(plan.placements.map((p) => p.column))].sort((a, b) => a - b);
  columns.forEach((column) => {
    const clips = plan.placements.filter((p) => p.column === column).sort((a, b) => a.startTime - b.startTime);
    lines.push(`c${column}: ${clips.map((p) => `${p.clipId} ${s(p.startTime)}-${s(p.endTime)}${p.transitionOut ? ` ~fade ${s(p.transitionOut)}` : ''}`).join(' > ')}`);
  });
  plan.warnings.forEach((w) => lines.push(`warning: ${formatWarning(w)}`));
  return lines.join('\n');
}
