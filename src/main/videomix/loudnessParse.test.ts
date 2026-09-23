// eslint-disable-next-line import/no-extraneous-dependencies
import { describe, expect, test } from 'vitest';
import { parseFfprobeAudioStream, parseLoudnormOutput, toLoudnessAnalysis } from './loudnessParse';

// Real ffmpeg 8 output (`-nostats`, stderr tail)
const stderr = `  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 69 kb/s (default)
      vendor_id       : [0][0][0][0]
Stream mapping:
  Stream #0:1 -> #0:0 (aac (native) -> pcm_s16le (native))
[Parsed_loudnorm_0 @ 0x7f25c4001d40]
{
\t"input_i" : "-18.76",
\t"input_tp" : "-17.69",
\t"input_lra" : "0.00",
\t"input_thresh" : "-28.76",
\t"output_i" : "-16.00",
\t"output_tp" : "-14.90",
\t"output_lra" : "0.10",
\t"output_thresh" : "-26.00",
\t"normalization_type" : "dynamic",
\t"target_offset" : "0.00"
}
[out#0/null @ 0x561f5270a040] video:0KiB audio:1500KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: unknown
`;

const silentStderr = `[Parsed_loudnorm_0 @ 0x7f5810001d40]
{
\t"input_i" : "-inf",
\t"input_tp" : "-inf",
\t"input_lra" : "0.00",
\t"input_thresh" : "-70.00",
\t"output_i" : "-inf",
\t"output_tp" : "-inf",
\t"output_lra" : "0.00",
\t"output_thresh" : "-70.00",
\t"normalization_type" : "dynamic",
\t"target_offset" : "inf"
}
`;

describe('parseLoudnormOutput', () => {
  test('parses the json block', () => {
    expect(parseLoudnormOutput(stderr)).toEqual({ inputI: -18.76, inputTp: -17.69, inputLra: 0, inputThresh: -28.76 });
  });

  test('silence', () => {
    expect(parseLoudnormOutput(silentStderr)).toEqual({ inputI: -Infinity, inputTp: -Infinity, inputLra: 0, inputThresh: -70 });
  });

  test('missing or broken block', () => {
    expect(parseLoudnormOutput('Stream map \'\' matches no streams.')).toBeUndefined();
    expect(parseLoudnormOutput('[Parsed_loudnorm_0 @ 0x1] \n{ "input_i" : ')).toBeUndefined();
    expect(parseLoudnormOutput('[Parsed_loudnorm_0 @ 0x1] \n{ "input_i" : "x", "input_tp": "1", "input_lra": "1", "input_thresh": "1" }')).toBeUndefined();
  });
});

describe('toLoudnessAnalysis', () => {
  test('with audio', () => {
    expect(toLoudnessAnalysis(parseLoudnormOutput(stderr)!, { channels: 1, channelLayout: 'mono' })).toEqual({
      hasAudio: true, inputI: -18.76, inputTp: -17.69, inputLra: 0, inputThresh: -28.76, channels: 1, channelLayout: 'mono',
    });
  });

  test('without stream info', () => {
    expect(toLoudnessAnalysis(parseLoudnormOutput(stderr)!)).toEqual({ hasAudio: true, inputI: -18.76, inputTp: -17.69, inputLra: 0, inputThresh: -28.76 });
  });

  test('silence counts as no audio', () => {
    expect(toLoudnessAnalysis(parseLoudnormOutput(silentStderr)!)).toEqual({ hasAudio: false });
    expect(toLoudnessAnalysis({ inputI: -70, inputTp: -60, inputLra: 0, inputThresh: -80 })).toEqual({ hasAudio: false });
  });
});

describe('parseFfprobeAudioStream', () => {
  test('stream', () => {
    expect(parseFfprobeAudioStream('{"programs":[],"stream_groups":[],"streams":[{"index":1,"channels":2,"channel_layout":"stereo"}]}'))
      .toEqual({ channels: 2, channelLayout: 'stereo' });
    expect(parseFfprobeAudioStream('{"streams":[{"index":1,"channels":4,"channel_layout":"4 channels (UNSD+UNSD+UNSD+UNSD)"}]}'))
      .toEqual({ channels: 4, channelLayout: '4 channels (UNSD+UNSD+UNSD+UNSD)' });
    expect(parseFfprobeAudioStream('{"streams":[{"index":1}]}')).toEqual({ channels: undefined, channelLayout: undefined });
  });

  test('no audio stream', () => {
    expect(parseFfprobeAudioStream('{"programs":[],"stream_groups":[],"streams":[]}')).toBeUndefined();
    expect(parseFfprobeAudioStream('{}')).toBeUndefined();
  });
});
