// eslint-disable-next-line import/no-extraneous-dependencies
import { describe, expect, test } from 'vitest';

import getArgsWithoutAppName from './cliArgs.js';

describe('getArgsWithoutAppName', () => {
  test('packaged: everything after the executable', () => {
    expect(getArgsWithoutAppName(['/opt/VideoMix/videomix', 'a.mp4', '--config-dir', '/tmp/c'], false)).toEqual(['a.mp4', '--config-dir', '/tmp/c']);
    expect(getArgsWithoutAppName(['/opt/VideoMix/videomix', '--no-sandbox', 'a.mp4'], false)).toEqual(['--no-sandbox', 'a.mp4']);
    expect(getArgsWithoutAppName(['/opt/VideoMix/videomix'], false)).toEqual([]);
  });

  test('unpackaged: everything after the app path', () => {
    expect(getArgsWithoutAppName(['electron', '.', 'a.mp4'], true)).toEqual(['a.mp4']);
    expect(getArgsWithoutAppName(['electron', '.'], true)).toEqual([]);
    expect(getArgsWithoutAppName(['electron'], true)).toEqual([]);
  });

  test('unpackaged, with switches before the app path (Playwright, --no-sandbox)', () => {
    expect(getArgsWithoutAppName(['electron', '--inspect=0', '--remote-debugging-port=0', '--no-sandbox', '.', '--config-dir', '/tmp/c'], true)).toEqual(['--config-dir', '/tmp/c']);
    expect(getArgsWithoutAppName(['electron', '--no-sandbox', '/path/to/app', 'a.mp4'], true)).toEqual(['a.mp4']);
  });
});
