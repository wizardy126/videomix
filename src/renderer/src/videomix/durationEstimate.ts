import { formatDuration } from '../util/duration';

// E3/E4 (01-requisitos §11): the "≈ m:ss" estimate shown in MixRenderButtons, and the highlight when it goes over
// the project's maximum duration. Pure so it's testable without the planner or React.

const formatShort = (seconds: number) => formatDuration({ seconds, shorten: true, showFraction: false });

/** "≈ m:ss", or `undefined` while there's no estimate yet (no clips, or the plan hasn't been computed). */
export function formatEstimatedDuration(duration: number | undefined): string | undefined {
  if (duration == null) return undefined;
  return `≈ ${formatShort(duration)}`;
}

/** True when the estimate goes over the project's maximum duration (`undefined` = no limit). */
export function exceedsMaxDuration(duration: number | undefined, maxDuration: number | undefined): boolean {
  return duration != null && maxDuration != null && duration > maxDuration;
}

/** "m:ss" of the limit itself, for the "→ cut at …" indicator next to the estimate. */
export function formatMaxDuration(maxDuration: number): string {
  return formatShort(maxDuration);
}
