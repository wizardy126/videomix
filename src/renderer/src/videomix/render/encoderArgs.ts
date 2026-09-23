import { getEncoderName } from '../../../../common/videomix/encoder';
import type { ResolvedEncoder } from '../../../../common/videomix/encoder';
import type { mixPresets } from '../types';

export type { ResolvedEncoder } from '../../../../common/videomix/encoder';

// Per-encoder argument mapping (D2, T25): quality equivalent to the project's CRF, speed preset and pixel format,
// for whichever encoder `resolveEncoderHardware` (common/videomix/encoder.ts) picked. Pure, so it can be snapshot-
// tested without ffmpeg; the concat demuxer needs every chunk's args to be identical (buildRenderJob), which this
// already gives for free since it only depends on its arguments.

export interface VideoEncodeArgs {
  /** Before any `-i` (only VAAPI needs one, to init its device). */
  globalArgs: string[],
  /** After `-map`: the codec, its quality/speed/pixel format and (VAAPI) the upload filter. */
  outputArgs: string[],
}

/** NVENC and QSV keep x264-style preset names (a subset of ours); VideoToolbox and VAAPI have no speed preset. */
const NVENC_PRESET: Record<typeof mixPresets[number], string> = { ultrafast: 'fast', veryfast: 'fast', fast: 'fast', medium: 'medium', slow: 'slow' };
const QSV_PRESET: Record<typeof mixPresets[number], string> = { ultrafast: 'veryfast', veryfast: 'veryfast', fast: 'fast', medium: 'medium', slow: 'slow' };

/** MP4 tag Apple/QuickTime need to play back H.265 (task spec calls this out for libx265; hardware HEVC needs it too). */
const getHevcTagArgs = (codec: ResolvedEncoder['codec']) => (codec === 'h265' ? ['-tag:v', 'hvc1'] : []);

/**
 * ffmpeg args for one chunk's video encode. `crf` (0–51, lower = better) is mapped to whatever quality control the
 * encoder actually has (04-diseno §9 / T25 spec): `-cq` (NVENC), `-global_quality` (QSV), `-q:v` (VideoToolbox,
 * inverted scale: higher = worse) or `-qp` (VAAPI). VAAPI also needs `hwupload`/`format=nv12` (its encoder only
 * takes hardware frames): {@link globalArgs} inits the device, {@link outputArgs} starts with the upload filter.
 */
export function getVideoEncodeArgs({ codec, hardware, fps, crf, preset }: ResolvedEncoder & { fps: number, crf: number, preset: typeof mixPresets[number] }): VideoEncodeArgs {
  const name = getEncoderName({ codec, hardware });
  const hvc1 = getHevcTagArgs(codec);

  switch (hardware) {
    case 'none': {
      return { globalArgs: [], outputArgs: ['-c:v', name, '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps), ...hvc1] };
    }
    case 'nvenc': {
      return { globalArgs: [], outputArgs: ['-c:v', name, '-preset', NVENC_PRESET[preset], '-rc', 'vbr', '-cq', String(crf), '-b:v', '0', '-pix_fmt', 'yuv420p', '-r', String(fps), ...hvc1] };
    }
    case 'qsv': {
      return { globalArgs: [], outputArgs: ['-c:v', name, '-preset', QSV_PRESET[preset], '-global_quality', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps), ...hvc1] };
    }
    case 'videotoolbox': {
      // -q:v is 1 (best) to 100 (worst): the opposite direction of CRF, so invert it.
      const q = Math.max(1, Math.min(100, Math.round((crf / 51) * 100)));
      return { globalArgs: [], outputArgs: ['-c:v', name, '-q:v', String(q), '-pix_fmt', 'yuv420p', '-r', String(fps), ...hvc1] };
    }
    case 'vaapi': {
      return {
        // The device path is the common Linux default (ffmpeg's own VAAPI examples); not configurable from the UI.
        globalArgs: ['-vaapi_device', '/dev/dri/renderD128'],
        // No -pix_fmt: format=nv12,hwupload turns the frame into a VAAPI hardware surface, not yuv420p.
        outputArgs: ['-vf', 'format=nv12,hwupload', '-c:v', name, '-qp', String(crf), '-r', String(fps), ...hvc1],
      };
    }
    default: {
      throw new Error(`Unknown hardware: ${hardware satisfies never}`);
    }
  }
}
