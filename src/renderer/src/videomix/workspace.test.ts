import { describe, expect, test } from 'vitest';

import { classifyOpenedPaths, countClipsBySource, getFileExtension, getMixProjectTitle, getSourceMeta, isSourceMetaChanged, appendMusicTracks } from './workspace';
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
    })).toEqual({ width: 1920, height: 1080, duration: 12.5, sar: { num: 1, den: 1 } });
  });

  test('oriented size with rotation', () => {
    expect(getSourceMeta({ format, streams: [stream({ codec_type: 'video', width: 1920, height: 1080, tags: { rotate: '90' } })] }))
      .toEqual({ width: 1080, height: 1920, duration: 12.5, sar: { num: 1, den: 1 } });
  });

  test('B1: display size with the SAR, like videoWidth/videoHeight', () => {
    expect(getSourceMeta({ format, streams: [stream({ codec_type: 'video', width: 1280, height: 720, sample_aspect_ratio: '679:640' })] }))
      .toEqual({ width: 1358, height: 720, duration: 12.5, sar: { num: 679, den: 640 } });
    expect(getSourceMeta({ format, streams: [stream({ codec_type: 'video', width: 720, height: 480, sample_aspect_ratio: '8:9' })] }))
      .toEqual({ width: 720, height: 540, duration: 12.5, sar: { num: 8, den: 9 } });
    // unknown SAR = square
    expect(getSourceMeta({ format, streams: [stream({ codec_type: 'video', width: 1280, height: 720, sample_aspect_ratio: '0:1' })] }))
      .toEqual({ width: 1280, height: 720, duration: 12.5, sar: { num: 1, den: 1 } });
  });

  test('B1: SAR applied before the rotation, stored for the rotated frame', () => {
    // display-matrix rotation (side data, ffmpeg ≥ 5) and the old rotate tag
    const sideData = stream({ codec_type: 'video', width: 1280, height: 720, sample_aspect_ratio: '679:640' });
    Object.assign(sideData, { side_data_list: [{ side_data_type: 'Display Matrix', rotation: 90 }] });
    expect(getSourceMeta({ format, streams: [sideData] })).toEqual({ width: 720, height: 1358, duration: 12.5, sar: { num: 640, den: 679 } });
    expect(getSourceMeta({ format, streams: [stream({ codec_type: 'video', width: 1280, height: 720, sample_aspect_ratio: '679:640', tags: { rotate: '270' } })] }))
      .toEqual({ width: 720, height: 1358, duration: 12.5, sar: { num: 640, den: 679 } });
    expect(getSourceMeta({ format, streams: [stream({ codec_type: 'video', width: 1280, height: 720, sample_aspect_ratio: '679:640', tags: { rotate: '180' } })] }))
      .toEqual({ width: 1358, height: 720, duration: 12.5, sar: { num: 679, den: 640 } });
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

  test('B1: the SAR counts; square = no SAR stored', () => {
    expect(isSourceMetaChanged(source, { width: 1920, height: 1080, duration: 10, sar: { num: 1, den: 1 } })).toBe(false);
    expect(isSourceMetaChanged(source, { width: 1920, height: 1080, duration: 10, sar: { num: 4, den: 3 } })).toBe(true);
    expect(isSourceMetaChanged({ ...source, sar: { num: 4, den: 3 } }, { width: 1920, height: 1080, duration: 10, sar: { num: 1, den: 1 } })).toBe(true);
    expect(isSourceMetaChanged({ ...source, sar: { num: 4, den: 3 } }, { width: 1920, height: 1080, duration: 10, sar: undefined })).toBe(false);
  });
});

describe('appendMusicTracks', () => {
  const track = (id: string) => ({ id, path: `/${id}.mp3`, absolutePath: `/${id}.mp3`, volumeDb: -12 });

  test('new music does not loop; existing music keeps its tracks and loop', () => {
    const empty = { ...defaultMusicPlaylist, loop: true };
    expect(appendMusicTracks(empty, [track('a'), track('b')])).toEqual({ ...empty, tracks: [track('a'), track('b')], loop: false });
    const withMusic = { ...defaultMusicPlaylist, loop: true, tracks: [track('a')] };
    expect(appendMusicTracks(withMusic, [track('b')])).toEqual({ ...withMusic, tracks: [track('a'), track('b')], loop: true });
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
