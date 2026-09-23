import { describe, test, expect } from 'vitest';

import { getVideoEncodeArgs } from './encoderArgs';

describe('getVideoEncodeArgs', () => {
  test('software h264 (unchanged since before T25)', () => {
    expect(getVideoEncodeArgs({ codec: 'h264', hardware: 'none', fps: 30, crf: 20, preset: 'medium' })).toEqual({
      globalArgs: [],
      outputArgs: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30'],
    });
  });

  test('software h265 adds the hvc1 tag (Apple/QuickTime compatibility)', () => {
    expect(getVideoEncodeArgs({ codec: 'h265', hardware: 'none', fps: 25, crf: 23, preset: 'slow' })).toEqual({
      globalArgs: [],
      outputArgs: ['-c:v', 'libx265', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '25', '-tag:v', 'hvc1'],
    });
  });

  test('nvenc: -rc vbr -cq, x264-style preset name', () => {
    expect(getVideoEncodeArgs({ codec: 'h264', hardware: 'nvenc', fps: 30, crf: 20, preset: 'ultrafast' })).toEqual({
      globalArgs: [],
      outputArgs: ['-c:v', 'h264_nvenc', '-preset', 'fast', '-rc', 'vbr', '-cq', '20', '-b:v', '0', '-pix_fmt', 'yuv420p', '-r', '30'],
    });
    expect(getVideoEncodeArgs({ codec: 'h265', hardware: 'nvenc', fps: 30, crf: 20, preset: 'medium' })).toEqual({
      globalArgs: [],
      outputArgs: ['-c:v', 'hevc_nvenc', '-preset', 'medium', '-rc', 'vbr', '-cq', '20', '-b:v', '0', '-pix_fmt', 'yuv420p', '-r', '30', '-tag:v', 'hvc1'],
    });
  });

  test('qsv: -global_quality', () => {
    expect(getVideoEncodeArgs({ codec: 'h264', hardware: 'qsv', fps: 24, crf: 22, preset: 'fast' })).toEqual({
      globalArgs: [],
      outputArgs: ['-c:v', 'h264_qsv', '-preset', 'fast', '-global_quality', '22', '-pix_fmt', 'yuv420p', '-r', '24'],
    });
  });

  test('videotoolbox: -q:v, inverted 0-51 -> 1-100 scale, no speed preset', () => {
    expect(getVideoEncodeArgs({ codec: 'h264', hardware: 'videotoolbox', fps: 30, crf: 0, preset: 'medium' })).toEqual({
      globalArgs: [],
      outputArgs: ['-c:v', 'h264_videotoolbox', '-q:v', '1', '-pix_fmt', 'yuv420p', '-r', '30'],
    });
    expect(getVideoEncodeArgs({ codec: 'h264', hardware: 'videotoolbox', fps: 30, crf: 51, preset: 'medium' })).toEqual({
      globalArgs: [],
      outputArgs: ['-c:v', 'h264_videotoolbox', '-q:v', '100', '-pix_fmt', 'yuv420p', '-r', '30'],
    });
  });

  test('vaapi: device init + hwupload, -qp, no -pix_fmt (the frame is a hardware surface)', () => {
    expect(getVideoEncodeArgs({ codec: 'h265', hardware: 'vaapi', fps: 30, crf: 20, preset: 'medium' })).toEqual({
      globalArgs: ['-vaapi_device', '/dev/dri/renderD128'],
      outputArgs: ['-vf', 'format=nv12,hwupload', '-c:v', 'hevc_vaapi', '-qp', '20', '-r', '30', '-tag:v', 'hvc1'],
    });
  });
});
