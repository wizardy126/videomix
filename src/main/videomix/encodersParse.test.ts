// eslint-disable-next-line import/no-extraneous-dependencies
import { describe, test, expect } from 'vitest';

import { parseEncoderNames, getCompiledHardwareCandidates } from './encodersParse';

// A trimmed, realistic sample of `ffmpeg -hide_banner -encoders` output (Linux build with NVENC and VAAPI, no QSV
// or VideoToolbox), used to check the parsing without running ffmpeg.
const SAMPLE = `Encoders:
 V..... = Video
 A..... = Audio
 S..... = Subtitle
 .F.... = Frame-level multithreading
 ..S... = Slice-level multithreading
 ...X.. = Codec is experimental
 ....B. = Supports draw_horiz_band
 .....D = Supports direct rendering method 1
 ------
 V..... a64multi             Multicolor charset for Commodore 64 (codec a64_multi)
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V..... libx265              libx265 H.265 / HEVC (codec hevc)
 V..... h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V..... hevc_nvenc           NVIDIA NVENC hevc encoder (codec hevc)
 V..... h264_vaapi           H.264/AVC (VAAPI) (codec h264)
 V..... hevc_vaapi           H.265/HEVC (VAAPI) (codec hevc)
 A..... aac                  AAC (Advanced Audio Coding)
`;

describe('parseEncoderNames', () => {
  test('extracts the encoder name from each line, ignoring the legend and the flags', () => {
    const names = parseEncoderNames(SAMPLE);
    expect(names.has('libx264')).toBe(true);
    expect(names.has('libx265')).toBe(true);
    expect(names.has('h264_nvenc')).toBe(true);
    expect(names.has('hevc_nvenc')).toBe(true);
    expect(names.has('h264_vaapi')).toBe(true);
    expect(names.has('hevc_vaapi')).toBe(true);
    expect(names.has('aac')).toBe(true);
    // not present in the sample
    expect(names.has('h264_qsv')).toBe(false);
    expect(names.has('h264_videotoolbox')).toBe(false);
  });

  test('an empty or unrelated text yields no names', () => {
    expect(parseEncoderNames('').size).toBe(0);
    expect(parseEncoderNames('not encoder output at all\n').size).toBe(0);
  });
});

describe('getCompiledHardwareCandidates', () => {
  test('only the hardware candidates actually listed in the text', () => {
    const candidates = getCompiledHardwareCandidates(SAMPLE);
    expect(candidates.map((c) => c.id).sort()).toEqual(['h264_nvenc', 'h264_vaapi', 'hevc_nvenc', 'hevc_vaapi'].sort());
  });

  test('none compiled in (e.g. a minimal software-only build)', () => {
    expect(getCompiledHardwareCandidates('V....D libx264 …\n')).toEqual([]);
  });
});
