import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import JSON5 from 'json5';

import { deserializeMixProject, loadMixProject, resolveProjectPath, saveMixProject, serializeMixProject, toProjectRelativePath, toSavedMixProject } from './projectFile';
import type { NodeDeps } from './projectFile';
import { deleteRecoveryFile, findRecoverableProjects, getRecoveryDir, resolveRecoveredProject, writeRecoveryFile } from './projectRecovery';
import { createMixSource } from './projectReducer';
import { createEmptyMixProject } from './types';
import type { MixProject } from './types';

const deps: NodeDeps = { path, fs };

function makeProject(dir: string): MixProject {
  const project = createEmptyMixProject();
  return {
    ...project,
    sources: [
      createMixSource({ id: 's1', filePath: path.join(dir, 'media', 'a.mp4'), name: 'a.mp4' }),
      { ...createMixSource({ id: 's2', filePath: path.join(dir, 'b.mp4'), name: 'b.mp4' }), width: 1920, height: 1080, duration: 12.5 },
    ],
    clips: [{ id: 'c1', sourceId: 's1', name: 'a #1', color: 2, start: 1, end: 3.5, maxRect: { x: 0, y: 0, width: 640, height: 480 }, minRect: { x: 10, y: 10, width: 100, height: 100 }, muted: false, gainDb: -2 }],
    settings: { ...project.settings, music: { path: path.join(dir, 'music.mp3'), absolutePath: path.join(dir, 'music.mp3'), volumeDb: -6, loop: true } },
    loudnessCache: { abc: { hasAudio: true, inputI: -20, inputTp: -1, inputLra: 5, inputThresh: -30 } },
  };
}

describe('project paths', () => {
  test('toProjectRelativePath posix', () => {
    const p = path.posix as NodeDeps['path'];
    expect(toProjectRelativePath(p, '/home/u/proj', '/home/u/proj/media/a.mp4')).toBe('media/a.mp4');
    expect(toProjectRelativePath(p, '/home/u/proj', '/home/u/videos/a.mp4')).toBe('../videos/a.mp4');
    expect(toProjectRelativePath(p, '/home/u/proj', 'already/relative.mp4')).toBe('already/relative.mp4');
  });

  test('toProjectRelativePath win32 uses forward slashes and keeps other drives absolute', () => {
    const p = path.win32 as NodeDeps['path'];
    expect(toProjectRelativePath(p, String.raw`C:\proj`, String.raw`C:\proj\media\a.mp4`)).toBe('media/a.mp4');
    expect(toProjectRelativePath(p, String.raw`C:\proj`, String.raw`C:\videos\a.mp4`)).toBe('../videos/a.mp4');
    expect(toProjectRelativePath(p, String.raw`C:\proj`, String.raw`D:\videos\a.mp4`)).toBe(String.raw`D:\videos\a.mp4`);
  });

  test('resolveProjectPath', () => {
    expect(resolveProjectPath(path.posix as NodeDeps['path'], '/home/u/proj', '../videos/a.mp4')).toBe('/home/u/videos/a.mp4');
    expect(resolveProjectPath(path.posix as NodeDeps['path'], '/home/u/proj', '/abs/a.mp4')).toBe('/abs/a.mp4');
    expect(resolveProjectPath(path.posix as NodeDeps['path'], undefined, 'a.mp4')).toBe('a.mp4');
    expect(resolveProjectPath(path.win32 as NodeDeps['path'], String.raw`C:\proj`, 'media/a.mp4')).toBe(String.raw`C:\proj\media\a.mp4`);
  });

  test('toSavedMixProject only makes `path` relative', () => {
    const project = makeProject('/home/u/proj');
    const saved = toSavedMixProject(path.posix as NodeDeps['path'], '/home/u/proj/my.vmx', project);
    expect(saved.sources.map((s) => [s.path, s.absolutePath])).toEqual([
      ['media/a.mp4', '/home/u/proj/media/a.mp4'],
      ['b.mp4', '/home/u/proj/b.mp4'],
    ]);
    expect(saved.settings.music).toMatchObject({ path: 'music.mp3', absolutePath: '/home/u/proj/music.mp3' });
    expect(project.sources[0]!.path).toBe('/home/u/proj/media/a.mp4');
  });

  test('serialize → deserialize', () => {
    const project = makeProject('/x');
    expect(deserializeMixProject(serializeMixProject(project))).toEqual(project);
  });
});

describe('save / load', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'videomix-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function touch(filePath: string) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '');
  }

  test('round trip', async () => {
    const project = makeProject(tmpDir);
    await Promise.all([path.join(tmpDir, 'media', 'a.mp4'), path.join(tmpDir, 'b.mp4'), path.join(tmpDir, 'music.mp3')].map((p) => touch(p)));
    const vmxPath = path.join(tmpDir, 'p.vmx');

    await saveMixProject(deps, vmxPath, project);
    const json = JSON5.parse(await fs.readFile(vmxPath, 'utf8'));
    expect(json.sources[0].path).toBe('media/a.mp4');
    expect(json.sources[0].absolutePath).toBe(path.join(tmpDir, 'media', 'a.mp4'));

    expect(await loadMixProject(deps, vmxPath)).toEqual({ project, missingSourceIds: [], missingMusic: false });
  });

  test('project moved together with its media: relative path wins', async () => {
    const project = makeProject(tmpDir);
    await saveMixProject(deps, path.join(tmpDir, 'p.vmx'), project);

    const movedDir = path.join(tmpDir, 'moved');
    await touch(path.join(movedDir, 'media', 'a.mp4'));
    await fs.copyFile(path.join(tmpDir, 'p.vmx'), path.join(movedDir, 'p.vmx'));
    const loaded = await loadMixProject(deps, path.join(movedDir, 'p.vmx'));
    expect(loaded.project.sources[0]).toMatchObject({ path: path.join(movedDir, 'media', 'a.mp4'), absolutePath: path.join(movedDir, 'media', 'a.mp4') });
    expect(loaded.missingSourceIds).toEqual(['s2']);
    expect(loaded.missingMusic).toBe(true);
  });

  test('project moved without its media: absolute fallback', async () => {
    const project = makeProject(tmpDir);
    await touch(path.join(tmpDir, 'media', 'a.mp4'));
    const otherDir = path.join(tmpDir, 'other');
    await fs.mkdir(otherDir);
    await saveMixProject(deps, path.join(tmpDir, 'p.vmx'), project);
    await fs.rename(path.join(tmpDir, 'p.vmx'), path.join(otherDir, 'p.vmx'));

    const loaded = await loadMixProject(deps, path.join(otherDir, 'p.vmx'));
    expect(loaded.project.sources[0]).toMatchObject({ path: path.join(tmpDir, 'media', 'a.mp4'), absolutePath: path.join(tmpDir, 'media', 'a.mp4') });
    // missing: keeps the resolved relative candidate and the stored absolute path
    expect(loaded.missingSourceIds).toEqual(['s2']);
    expect(loaded.project.sources[1]).toMatchObject({ path: path.join(otherDir, 'b.mp4'), absolutePath: path.join(tmpDir, 'b.mp4') });
  });

  test('invalid file throws', async () => {
    const vmxPath = path.join(tmpDir, 'bad.vmx');
    await fs.writeFile(vmxPath, '{ version: 1, sources: "nope" }');
    await expect(loadMixProject(deps, vmxPath)).rejects.toThrow();
  });

  describe('recovery', () => {
    test('write, find, resolve, delete', async () => {
      const recoveryDir = getRecoveryDir(deps, tmpDir);
      expect(await findRecoverableProjects(deps, { recoveryDir })).toEqual([]);

      const project = makeProject(tmpDir);
      await touch(path.join(tmpDir, 'b.mp4'));
      const vmxPath = path.join(tmpDir, 'p.vmx');
      await saveMixProject(deps, vmxPath, project);
      const { mtimeMs } = await fs.stat(vmxPath);

      await writeRecoveryFile(deps, { recoveryDir, sessionId: 'old', projectPath: vmxPath, project, now: mtimeMs - 1000 });
      await writeRecoveryFile(deps, { recoveryDir, sessionId: 'new', projectPath: undefined, project, now: mtimeMs + 1000 });
      await writeRecoveryFile(deps, { recoveryDir, sessionId: 'current', projectPath: undefined, project });
      await fs.writeFile(path.join(recoveryDir, 'broken.vmx-recovery'), '{');
      await fs.writeFile(path.join(recoveryDir, 'other.txt'), '');

      const found = await findRecoverableProjects(deps, { recoveryDir, excludeSessionId: 'current' });
      expect(found.map(({ sessionId, projectPath, newerThanProjectFile }) => ({ sessionId, projectPath, newerThanProjectFile }))).toEqual([
        { sessionId: 'new', projectPath: undefined, newerThanProjectFile: true },
        { sessionId: 'old', projectPath: vmxPath, newerThanProjectFile: false },
      ]);
      expect(found[0]!.project).toEqual(project);

      const resolved = await resolveRecoveredProject(deps, found[0]!);
      expect(resolved.missingSourceIds).toEqual(['s1']);
      expect(resolved.project.sources[1]).toEqual(project.sources[1]);

      await deleteRecoveryFile(deps, { recoveryDir, sessionId: 'new' });
      await deleteRecoveryFile(deps, { recoveryDir, sessionId: 'new' }); // missing file is fine
      expect((await findRecoverableProjects(deps, { recoveryDir })).map((e) => e.sessionId).sort()).toEqual(['current', 'old']);
    });
  });
});
