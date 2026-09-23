// eslint-disable-next-line import/no-extraneous-dependencies
import { describe, test, expect } from 'vitest';

import { getEncoderName, resolveEncoderHardware, hardwareEncoderCandidates, AUTO_HARDWARE_PRIORITY } from './encoder.js';

describe('getEncoderName', () => {
  test('software falls back to libx264/libx265', () => {
    expect(getEncoderName({ codec: 'h264', hardware: 'none' })).toBe('libx264');
    expect(getEncoderName({ codec: 'h265', hardware: 'none' })).toBe('libx265');
  });

  test('hardware candidates', () => {
    expect(getEncoderName({ codec: 'h264', hardware: 'nvenc' })).toBe('h264_nvenc');
    expect(getEncoderName({ codec: 'h265', hardware: 'nvenc' })).toBe('hevc_nvenc');
    expect(getEncoderName({ codec: 'h264', hardware: 'qsv' })).toBe('h264_qsv');
    expect(getEncoderName({ codec: 'h265', hardware: 'qsv' })).toBe('hevc_qsv');
    expect(getEncoderName({ codec: 'h264', hardware: 'videotoolbox' })).toBe('h264_videotoolbox');
    expect(getEncoderName({ codec: 'h265', hardware: 'videotoolbox' })).toBe('hevc_videotoolbox');
    expect(getEncoderName({ codec: 'h264', hardware: 'vaapi' })).toBe('h264_vaapi');
    expect(getEncoderName({ codec: 'h265', hardware: 'vaapi' })).toBe('hevc_vaapi');
  });

  test('every candidate has a matching entry (both codecs, all 4 families)', () => {
    expect(hardwareEncoderCandidates).toHaveLength(8);
    expect(AUTO_HARDWARE_PRIORITY).toHaveLength(4);
  });
});

describe('resolveEncoderHardware', () => {
  test('none always stays software, regardless of what\'s available', () => {
    expect(resolveEncoderHardware({ encoder: { codec: 'h264', hardware: 'none' }, available: [{ codec: 'h264', hardware: 'nvenc' }] })).toBe('none');
  });

  test('a specific choice that is available is kept', () => {
    expect(resolveEncoderHardware({ encoder: { codec: 'h264', hardware: 'qsv' }, available: [{ codec: 'h264', hardware: 'qsv' }] })).toBe('qsv');
  });

  test('a specific choice that isn\'t available falls back to software instead of failing', () => {
    expect(resolveEncoderHardware({ encoder: { codec: 'h264', hardware: 'nvenc' }, available: [{ codec: 'h264', hardware: 'qsv' }] })).toBe('none');
  });

  test('a specific choice available for the other codec only still falls back', () => {
    expect(resolveEncoderHardware({ encoder: { codec: 'h264', hardware: 'nvenc' }, available: [{ codec: 'h265', hardware: 'nvenc' }] })).toBe('none');
  });

  test('auto picks the first available in priority order', () => {
    const available = [{ codec: 'h264' as const, hardware: 'vaapi' as const }, { codec: 'h264' as const, hardware: 'qsv' as const }];
    expect(resolveEncoderHardware({ encoder: { codec: 'h264', hardware: 'auto' }, available })).toBe('qsv');
  });

  test('auto falls back to software with nothing available', () => {
    expect(resolveEncoderHardware({ encoder: { codec: 'h264', hardware: 'auto' }, available: [] })).toBe('none');
  });
});
