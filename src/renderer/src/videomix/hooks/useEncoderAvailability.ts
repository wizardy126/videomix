import { useEffect, useState } from 'react';

import { detectEncoders } from '../encoders';
import type { HardwareEncoderCandidate } from '../types';

/**
 * Hardware encoders detected on this machine (T25), for `MixSettingsDialog`'s Output section to show which
 * codec/hardware combinations actually work. `undefined` while still detecting; a failed detection (very unlikely:
 * main only fails here if ffmpeg itself can't run) is treated as "none available" rather than left pending forever.
 */
export default function useEncoderAvailability() {
  const [available, setAvailable] = useState<HardwareEncoderCandidate[] | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await detectEncoders();
        if (!cancelled) setAvailable(result);
      } catch (err) {
        console.warn('Failed to detect hardware encoders', err);
        if (!cancelled) setAvailable([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return available;
}
