import { hardwareEncoderCandidates } from '../../common/videomix/encoder.js';
import type { HardwareEncoderCandidate } from '../../common/videomix/encoder.js';

// Pure parsing of `ffmpeg -hide_banner -encoders` (T25), split out from encoders.ts so it can be tested without
// pulling in main/ffmpeg.ts (which imports Electron's `app` and can't run outside a real Electron process, like
// loudnessParse.ts does for measureLoudness).

// Each line: 6 capability flags (V/A/S, F, S, X, B, D), then the name, then the description, e.g.:
// " V..... h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)"
const ENCODER_LINE = /^\s*[VAS.][F.][S.][X.][B.][D.]\s+(\S+)\s+\S/;

/** Encoder names ffmpeg reports as compiled in. Compiled in doesn't mean working: it still needs a real test encode. */
export function parseEncoderNames(encodersOutput: string): Set<string> {
  const names = new Set<string>();
  for (const line of encodersOutput.split('\n')) {
    const match = ENCODER_LINE.exec(line);
    if (match) names.add(match[1]!);
  }
  return names;
}

/** The hardware candidates (common/videomix/encoder.ts) that `-encoders` reports as compiled in. */
export function getCompiledHardwareCandidates(encodersOutput: string): HardwareEncoderCandidate[] {
  const names = parseEncoderNames(encodersOutput);
  return hardwareEncoderCandidates.filter((candidate) => names.has(candidate.id));
}
