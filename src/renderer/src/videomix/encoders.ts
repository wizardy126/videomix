import type { HardwareEncoderCandidate } from '../../../common/videomix/encoder';

// src/main/videomix/encoders.ts, via @electron/remote (T25, same pattern as loudness.ts's measureLoudness). Main
// caches the detection for the session, so calling this more than once is cheap.
// eslint-disable-next-line import/prefer-default-export -- named, like loudness.ts's measureLoudness
export const detectEncoders = (): Promise<HardwareEncoderCandidate[]> => window.require('@electron/remote').require('./index.js').videomix.detectEncoders();
