// eslint-disable-next-line import/no-extraneous-dependencies
import { describe, test, expect } from 'vitest';

import { parseCropDetectOutput } from './cropDetect.js';

// ffmpeg's cropdetect lines (stderr), letterboxed 1920×1080 (bars of 140 px), plus the noise around them
const line = (x1: number, x2: number, y1: number, y2: number, crop = '1920:800:0:140') => (
  `[Parsed_cropdetect_0 @ 0x55d0c8c0a4c0] x1:${x1} x2:${x2} y1:${y1} y2:${y2} w:${x2 - x1 + 1} h:${y2 - y1 + 1} x:0 y:140 pts:1024 t:0.040000 limit:0.094118 crop=${crop}`
);

describe('parseCropDetectOutput', () => {
  test('one sample: the raw bounds, not the rounded crop=', () => {
    const output = [
      'Input #0, mov,mp4,m4a,3gp,3g2,mj2, from \'a.mp4\':',
      line(0, 1919, 140, 939),
      line(0, 1919, 139, 940, '1920:800:0:140'),
      'frame=   25 fps=0.0 q=-0.0 Lsize=N/A time=00:00:01.00 bitrate=N/A speed=10x',
    ].join('\n');
    expect(parseCropDetectOutput(output)).toEqual({ x: 0, y: 139, width: 1920, height: 802 });
  });

  test('several samples: the union', () => {
    const output = [line(10, 1909, 140, 939), line(0, 1899, 150, 949), line(20, 1919, 130, 930)].join('\r\n');
    expect(parseCropDetectOutput(output)).toEqual({ x: 0, y: 130, width: 1920, height: 820 });
  });

  test('ignores all-black frames (empty bounds) and other lines', () => {
    // cropdetect starts with x1 = w - 1, x2 = 0 while it has seen no picture
    const output = [line(1919, 0, 1079, 0, '0:0:0:0'), '[Parsed_other_1 @ 0x2] x1:0 x2:100 y1:0 y2:100', line(0, 1919, 140, 939)].join('\n');
    expect(parseCropDetectOutput(output)).toEqual({ x: 0, y: 140, width: 1920, height: 800 });
    expect(parseCropDetectOutput(line(1919, 0, 1079, 0))).toBeUndefined();
    expect(parseCropDetectOutput('')).toBeUndefined();
  });

  test('falls back to crop= without bounds', () => {
    expect(parseCropDetectOutput('[Parsed_cropdetect_0 @ 0x1] crop=1440:1080:240:0')).toEqual({ x: 240, y: 0, width: 1440, height: 1080 });
  });
});
