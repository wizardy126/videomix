import { runFfmpeg } from '../ffmpeg.js';
import { getCompiledHardwareCandidates } from './encodersParse.js';
import type { HardwareEncoderCandidate } from '../../common/videomix/encoder.js';

// Hardware encoder detection (D2, T25, 04-diseno §9): `ffmpeg -encoders` (compiled in) plus a real, short test
// encode per candidate (some are compiled in but don't actually work: no matching GPU, missing driver…). Cached
// for the session, since it's the same probe every time and running 8 test encodes isn't instant.

/** 1s of `testsrc2` at 256×144 (T25 spec): small and short enough that a working encoder finishes almost instantly. */
function getTestEncodeArgs(candidate: HardwareEncoderCandidate): string[] {
  const isVaapi = candidate.hardware === 'vaapi';
  return [
    '-hide_banner', '-nostdin', '-y',
    // VAAPI needs a device to upload frames to before it can encode them (ffmpeg's vaapi_encode docs); the other
    // hardware encoders accept plain software frames.
    ...(isVaapi ? ['-vaapi_device', '/dev/dri/renderD128'] : []),
    '-f', 'lavfi', '-i', 'testsrc2=size=256x144:rate=25', '-t', '1',
    ...(isVaapi ? ['-vf', 'format=nv12,hwupload'] : []),
    '-c:v', candidate.id,
    '-f', 'null', '-',
  ];
}

async function canReallyEncode(candidate: HardwareEncoderCandidate): Promise<boolean> {
  try {
    await runFfmpeg(getTestEncodeArgs(candidate));
    return true;
  } catch {
    // Compiled in but not usable here (no GPU, wrong driver, VAAPI device missing…): not an error, just unavailable.
    return false;
  }
}

let cache: Promise<HardwareEncoderCandidate[]> | undefined;

async function detectEncodersUncached(): Promise<HardwareEncoderCandidate[]> {
  const { stdout } = await runFfmpeg(['-hide_banner', '-encoders']);
  const compiled = getCompiledHardwareCandidates(new TextDecoder().decode(stdout));
  const results = await Promise.all(compiled.map(async (candidate) => ({ candidate, ok: await canReallyEncode(candidate) })));
  return results.filter((r) => r.ok).map((r) => r.candidate);
}

/**
 * Hardware encoders (of the 8 candidates in common/videomix/encoder.ts) that actually work on this machine, cached
 * for the session (exposed to the renderer via remoteApiLegacy's `videomix` namespace, src/main/index.ts).
 */
// eslint-disable-next-line import/prefer-default-export -- named, like main/videomix/loudness.ts's measureLoudness
export function detectEncoders(): Promise<HardwareEncoderCandidate[]> {
  if (cache == null) {
    cache = detectEncodersUncached().catch((err: unknown) => {
      cache = undefined; // don't stick a transient failure (e.g. ffmpeg missing at the wrong time) for the whole session
      throw err;
    });
  }
  return cache;
}
