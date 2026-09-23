import { describe, expect, test } from 'vitest';

import { classifyOpenedPaths, countClipsBySource, getFileExtension, getMixProjectTitle, getSourceMeta, isSourceMetaChanged, replaceMusic } from './workspace';
import { defaultMusicPlaylist } from './types';
import type { MixSource } from './types';
import type { FFprobeStream } from '../../../common/ffprobe';

// Only the fields getSourceMeta reads
const stream = (s: Partial<FFprobeStream>) => s as FFprobeStream;

describe('getFileExtension', () => {
  test('lowercase, last dot only', () => {
    expect(getFileExtension('/a/b/Video.Final.MP4')).toBe('mp4');
    expect(getFileExtension(String.raw`C:\x\song.mp3`)).toBe('mp3');
    expect(getFileExtension('/a.b/noext')).toBe('');
    expect(getFileExtension('/a/.hidden')).toBe('');
    expect(getFileExtension('/a/x.vmx-recovery')).toBe('vmx-recovery');
  });
});

describe('classifyOpenedPaths', () => {
  test('splits projects, audio, media and unsupported', () => {
    expect(classifyOpenedPaths(['/a/p.VMX', '/a/v1.mp4', '/a/m.m4a', '/a/v2.mkv', '/a/v2-proj.llc', '/a/cuts.csv', '/a/song.FLAC'])).toEqual({
      projectPaths: ['/a/p.VMX'],
      audioPaths: ['/a/m.m4a', '/a/song.FLAC'],
      mediaPaths: ['/a/v1.mp4', '/a/v2.mkv'],
      unsupportedPaths: ['/a/v2-proj.llc', '/a/cuts.csv'],
    });
  });

  test('unknown extensions are tried as media', () => {
    expect(classifyOpenedPaths(['/a/clip.mts', '/a/noext']).mediaPaths).toEqual(['/a/clip.mts', '/a/noext']);
  });

  // T16/T17: "Open folder" reads a directory recursively; images found there must not become video sources
  test('images are unsupported, not media', () => {
    expect(classifyOpenedPaths(['/a/photo.JPG', '/a/icon.png', '/a/v.mp4'])).toEqual({
      projectPaths: [],
      audioPaths: [],
      mediaPaths: ['/a/v.mp4'],
      unsupportedPaths: ['/a/photo.JPG', '/a/icon.png'],
    });
  });
});

describe('getSourceMeta', () => {
  const format = { duration: '12.5' };

  test('first real video stream, ignoring cover art', () => {
    expect(getSourceMeta({
      format,
      streams: [
        stream({ codec_type: 'audio' }),
        stream({ codec_type: 'video', width: 600, height: 600, disposition: { attached_pic: 1 } as FFprobeStream['disposition'] }),
        stream({ codec_type: 'video', width: 1920, height: 1080 }),
      ],
    })).toEqual({ width: 1920, height: 1080, duration: 12.5 });
  });

  test('oriented size with rotation', () => {
    expect(getSourceMeta({ format, streams: [stream({ codec_type: 'video', width: 1920, height: 1080, tags: { rotate: '90' } })] }))
      .toEqual({ width: 1080, height: 1920, duration: 12.5 });
  });

  test('audio only or invalid duration', () => {
    expect(getSourceMeta({ format: { duration: 'N/A' }, streams: [stream({ codec_type: 'audio' })] }))
      .toEqual({ width: undefined, height: undefined, duration: undefined });
  });
});

describe('isSourceMetaChanged', () => {
  const source: MixSource = { id: 's', path: '/a.mp4', absolutePath: '/a.mp4', name: 'a.mp4', width: 1920, height: 1080, duration: 10 };

  test('only defined values that differ count', () => {
    expect(isSourceMetaChanged(source, { width: 1920, height: 1080, duration: 10 })).toBe(false);
    expect(isSourceMetaChanged(source, { width: undefined, height: undefined, duration: undefined })).toBe(false);
    expect(isSourceMetaChanged(source, { width: 1920, height: 1080, duration: 10.5 })).toBe(true);
    expect(isSourceMetaChanged({ id: 's', path: '/a.mp4', absolutePath: '/a.mp4', name: 'a.mp4' }, { width: 1, height: undefined, duration: undefined })).toBe(true);
  });
});

describe('replaceMusic', () => {
  test('a single track, keeping the volume and loop of the replaced music', () => {
    const empty = { ...defaultMusicPlaylist, loop: true };
    expect(replaceMusic(empty, { id: 'a', filePath: '/m.mp3', loopIfNew: false })).toEqual({
      ...empty, tracks: [{ id: 'a', path: '/m.mp3', absolutePath: '/m.mp3', volumeDb: -12 }], loop: false, // T12b default volume
    });
    const withMusic = { ...defaultMusicPlaylist, loop: true, tracks: [{ id: 'a', path: '/m.mp3', absolutePath: '/m.mp3', volumeDb: -6 }, { id: 'b', path: '/o.mp3', absolutePath: '/o.mp3', volumeDb: 0 }] };
    expect(replaceMusic(withMusic, { id: 'c', filePath: '/n.mp3', loopIfNew: false })).toEqual({
      ...withMusic, tracks: [{ id: 'c', path: '/n.mp3', absolutePath: '/n.mp3', volumeDb: -6 }], loop: true,
    });
  });
});

describe('getMixProjectTitle', () => {
  test('name without extension, * when dirty', () => {
    expect(getMixProjectTitle({ projectPath: '/x/My mix.vmx', dirty: false, untitledName: 'Untitled' })).toBe('My mix');
    expect(getMixProjectTitle({ projectPath: String.raw`C:\x\a.VMX`, dirty: true, untitledName: 'Untitled' })).toBe('a*');
    expect(getMixProjectTitle({ projectPath: undefined, dirty: true, untitledName: 'Untitled' })).toBe('Untitled*');
  });
});

describe('countClipsBySource', () => {
  test('counts', () => {
    const counts = countClipsBySource([{ sourceId: 'a' }, { sourceId: 'b' }, { sourceId: 'a' }]);
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
    expect(counts.get('c')).toBeUndefined();
  });
});
