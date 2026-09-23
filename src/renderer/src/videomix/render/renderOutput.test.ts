import path from 'node:path';
import { describe, test, expect } from 'vitest';

import { getDefaultOutputPath, getOrphanTempEntries, getPartialOutputPath, ORPHAN_TEMP_MAX_AGE_MS, getPreviewFps, getPreviewOutputPath, getPreviewSize, getRenderWarnings, getRenderWorkDir, planRender, scaleGap, withOutputExtension } from './renderOutput';
import { createEmptyMixProject } from '../types';
import type { MixClip, MixProject } from '../types';

const p = path.posix;

describe('orphan temp files', () => {
  test('only our render/preview entries, and only old ones', () => {
    const now = 1_000_000_000_000;
    const old = now - ORPHAN_TEMP_MAX_AGE_MS - 1;
    const recent = now - 60_000;
    const entries = [
      { name: path.basename(getRenderWorkDir(p, '/tmp', 'render', 'aB3_x-9Z')), mtimeMs: old },
      { name: path.basename(getRenderWorkDir(p, '/tmp', 'preview', 'Q1w2E3r4')), mtimeMs: old },
      { name: path.basename(getPreviewOutputPath(p, '/tmp', 'zzzzzzzz')), mtimeMs: old },
      // in use (another instance may be rendering) or too recent to tell
      { name: path.basename(getRenderWorkDir(p, '/tmp', 'render', 'recent00')), mtimeMs: recent },
      // not ours, or not exactly our names
      { name: 'videomix-recovery', mtimeMs: old },
      { name: 'videomix-render-abc', mtimeMs: old },
      { name: 'videomix-render-aB3_x-9Z.part.mp4', mtimeMs: old },
      { name: 'videomix-preview-zzzzzzzz.mov', mtimeMs: old },
      { name: 'other-render-aB3_x-9Z', mtimeMs: old },
    ];
    expect(getOrphanTempEntries(entries, now)).toEqual(['videomix-render-aB3_x-9Z', 'videomix-preview-Q1w2E3r4', 'videomix-preview-zzzzzzzz.mp4']);
  });
});

describe('output paths', () => {
  test('default output: project name next to the project', () => {
    expect(getDefaultOutputPath({ path: p, projectPath: '/videos/trip/Trip 2025.vmx', firstSourcePath: '/other/a.mp4', fallbackDir: '/home', untitledName: 'Untitled' }))
      .toBe('/videos/trip/Trip 2025.mp4');
  });

  test('default output of an unsaved project: next to the first source, or in the fallback dir', () => {
    expect(getDefaultOutputPath({ path: p, firstSourcePath: '/media/a.mov', fallbackDir: '/home/me/Videos', untitledName: 'VideoMix' })).toBe('/media/VideoMix.mp4');
    expect(getDefaultOutputPath({ path: p, fallbackDir: '/home/me/Videos', untitledName: 'VideoMix' })).toBe('/home/me/Videos/VideoMix.mp4');
  });

  test('the last output of the session wins', () => {
    expect(getDefaultOutputPath({ path: p, projectPath: '/a/b.vmx', lastOutputPath: '/out/final.mp4', fallbackDir: '/home', untitledName: 'x' })).toBe('/out/final.mp4');
  });

  test('adds the extension when missing', () => {
    expect(withOutputExtension('/out/mix')).toBe('/out/mix.mp4');
    expect(withOutputExtension('/out/mix.MP4')).toBe('/out/mix.MP4');
    expect(withOutputExtension('/out/mix.v2')).toBe('/out/mix.v2.mp4');
  });

  test('partial output: same dir, keeps .mp4 so ffmpeg picks the muxer', () => {
    expect(getPartialOutputPath(p, '/out/My mix.mp4', 'abc')).toBe('/out/My mix.abc.part.mp4');
    expect(getPartialOutputPath(path.win32, String.raw`C:\out\mix.mp4`, 'abc')).toBe(String.raw`C:\out\mix.abc.part.mp4`);
  });

  test('temp paths', () => {
    expect(getRenderWorkDir(p, '/tmp', 'render', 'x1')).toBe('/tmp/videomix-render-x1');
    expect(getRenderWorkDir(p, '/tmp', 'preview', 'x1')).toBe('/tmp/videomix-preview-x1');
    expect(getPreviewOutputPath(p, '/tmp', 'x1')).toBe('/tmp/videomix-preview-x1.mp4');
  });
});

describe('preview settings', () => {
  test('gap scaled to the preview height, even', () => {
    expect(scaleGap(8, 1080, 360)).toBe(2);
    expect(scaleGap(16, 1080, 360)).toBe(6);
    expect(scaleGap(0, 1080, 360)).toBe(0);
    expect(scaleGap(8, 720, 360)).toBe(4);
    expect(scaleGap(2, 2160, 360)).toBe(0);
  });

  test('fps: halved above 30', () => {
    expect([24, 25, 30, 50, 60].map((fps) => getPreviewFps(fps as 24))).toEqual([24, 25, 30, 25, 30]);
  });
});

const clip = (id: string, sourceId: string, width: number, height: number, duration: number): MixClip => ({
  id, sourceId, name: `Clip ${id}`, color: 0, start: 0, end: duration, maxRect: { x: 0, y: 0, width, height }, muted: false, gainDb: 0,
});

function testProject(): MixProject {
  const project = createEmptyMixProject();
  project.clips = [
    clip('a', 's1', 1080, 1920, 6),
    clip('b', 's2', 1080, 1920, 6),
    clip('c', 's1', 1080, 1920, 5),
    clip('d', 's3', 320, 180, 4), // small: upscaled
  ];
  project.settings = { ...project.settings, output: { aspect: '16:9', resolution: '1080' }, fps: 60, gap: { width: 8, color: '#101010' } };
  return project;
}

describe('planRender', () => {
  test('final render: planned at the output resolution with the project settings', () => {
    const project = testProject();
    const { plan, settings, encoding } = planRender(project);
    expect(plan).toMatchObject({ width: 1920, height: 1080 });
    expect(settings).toBe(project.settings);
    expect(encoding).toBeUndefined();
  });

  test('preview: 640x360, scaled gap, half fps, fast encoding', () => {
    const project = testProject();
    const { plan, settings, encoding } = planRender(project, { preview: true });
    expect(plan).toMatchObject({ width: 640, height: 360 });
    expect(settings.gap).toEqual({ width: 2, color: '#101010' });
    expect(settings.fps).toBe(30);
    expect(encoding).toEqual({ preset: 'ultrafast', crf: 30 });
    // adjacent columns are separated by exactly the scaled gap
    plan.layouts.forEach((layout) => layout.columns.slice(1).forEach((col, i) => {
      const prev = layout.columns[i]!;
      expect(col.x - (prev.x + prev.width)).toBe(2);
    }));
    // same clips, same timing as the final plan
    const final = planRender(project).plan;
    expect(plan.duration).toBeCloseTo(final.duration);
  });

  test('preview keeps the output aspect (T29)', () => {
    expect(getPreviewSize({ aspect: '16:9', resolution: '2160' })).toEqual({ width: 640, height: 360 });
    expect(getPreviewSize({ aspect: '9:16', resolution: '1080' })).toEqual({ width: 360, height: 640 });
    expect(getPreviewSize({ aspect: '1:1', resolution: '720' })).toEqual({ width: 360, height: 360 });
    const project = testProject();
    const vertical = { ...project, settings: { ...project.settings, output: { aspect: '9:16', resolution: '1080' } as const } };
    const { plan, settings } = planRender(vertical, { preview: true });
    expect(plan).toMatchObject({ width: 360, height: 640, axis: 'rows' });
    // scaled by the short side: 8 px at 1080 → 2 px at 360
    expect(settings.gap.width).toBe(2);
    expect(planRender(vertical).plan).toMatchObject({ width: 1080, height: 1920, axis: 'rows' });
  });

  test('1:1 preview: same axis as the final render', () => {
    const project = testProject();
    for (const clips of [project.clips, project.clips.map((c) => ({ ...c, maxRect: { x: 0, y: 0, width: 1920, height: 1080 }, minRect: { x: 0, y: 140, width: 1920, height: 800 } }))]) {
      const square = { clips, settings: { ...project.settings, output: { aspect: '1:1', resolution: '1080' } as const } };
      const final = planRender(square).plan;
      expect(planRender(square, { preview: true }).plan).toMatchObject({ width: 360, height: 360, axis: final.axis });
    }
  });

  test('a fill warning of a vertical plan is about the height', () => {
    expect(getRenderWarnings({ axis: 'rows', warnings: [{ type: 'fill', time: 1, width: 40 }] }, [])).toEqual([{ type: 'fill', time: 1, width: 40, rows: true }]);
  });

  test('warnings to confirm: upscale with the clip name, one fill', () => {
    const warnings = getRenderWarnings({
      warnings: [
        { type: 'fill', time: 0, width: 100 },
        { type: 'upscale', clipId: 'd', factor: 3.2 },
        { type: 'fill', time: 5, width: 50 },
        { type: 'transition-shortened', clipId: 'a', duration: 0.2 },
        { type: 'pillarbox', clipId: 'x', time: 2 },
      ],
    }, testProject().clips);
    expect(warnings).toEqual([
      { type: 'fill', time: 0, width: 100, rows: false },
      { type: 'upscale', clipName: 'Clip d', factor: 3.2 },
      { type: 'pillarbox', clipName: 'x', time: 2 },
    ]);
  });

  test('pins and groups the plan couldn\'t honour, with the clip names (A4)', () => {
    const warnings = getRenderWarnings({
      warnings: [
        { type: 'pin-shifted', clipId: 'd', pinTime: 3, time: 4.5 },
        { type: 'group-split', groupId: 'g', clipIds: ['d', 'x'] },
      ],
    }, testProject().clips);
    expect(warnings).toEqual([
      { type: 'pin-shifted', clipName: 'Clip d', pinTime: 3, time: 4.5 },
      { type: 'group-split', clipNames: ['Clip d', 'x'] },
    ]);
  });

  test('the small clip of the test project is reported as upscaled', () => {
    const project = testProject();
    const warnings = getRenderWarnings(planRender(project).plan, project.clips);
    expect(warnings.some((w) => w.type === 'upscale' && w.clipName === 'Clip d')).toBe(true);
  });
});
