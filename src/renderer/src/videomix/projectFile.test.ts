import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import JSON5 from 'json5';

import { deserializeMixProject, loadMixProject, resolveProjectPath, saveMixProject, serializeMixProject, toProjectRelativePath, toSavedMixProject } from './projectFile';
import type { NodeDeps } from './projectFile';
import { deleteRecoveryFile, findRecoverableProjects, getRecoveryDir, resolveRecoveredProject, writeRecoveryFile } from './projectRecovery';
import { createMixSource } from './projectReducer';
import { createEmptyMixProject, defaultMixSettings } from './types';
import type { MixProject } from './types';
import { createCountdownOverlay, createImageOverlay, createProgressBarOverlay, createSoundOverlay, createTextOverlay } from './overlays/factories';

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
    settings: {
      ...project.settings,
      musicPlaylist: {
        ...project.settings.musicPlaylist,
        tracks: [
          { id: 't1', path: path.join(dir, 'music.mp3'), absolutePath: path.join(dir, 'music.mp3'), volumeDb: -6 },
          { id: 't2', path: path.join(dir, 'audio', 'music2.mp3'), absolutePath: path.join(dir, 'audio', 'music2.mp3'), volumeDb: -3 },
        ],
      },
    },
    loudnessCache: { abc: { hasAudio: true, inputI: -20, inputTp: -1, inputLra: 5, inputThresh: -30 } },
    overlays: [
      createImageOverlay({ id: 'o1', name: 'Logo', filePath: path.join(dir, 'img', 'logo.png') }),
      { ...createCountdownOverlay({ id: 'o2', name: 'Countdown' }), font: { path: path.join(dir, 'font.ttf'), absolutePath: path.join(dir, 'font.ttf') } },
      createCountdownOverlay({ id: 'o3', name: 'Countdown (bundled font)' }),
      createProgressBarOverlay({ id: 'o4', name: 'Bar', linkedCountdownId: 'o2' }),
      createSoundOverlay({ id: 'o5', name: 'Beep', filePath: path.join(dir, 'beep.wav') }),
      { ...createTextOverlay({ id: 'o6', name: 'Title', text: 'Hi' }), font: { path: path.join(dir, 'text.ttf'), absolutePath: path.join(dir, 'text.ttf') } },
    ],
  };
}

const overlayPaths = (project: MixProject) => project.overlays.flatMap((o) => {
  if (o.type === 'image' || o.type === 'sound') return [[o.id, o.path, o.absolutePath]];
  if ((o.type === 'countdown' || o.type === 'text') && o.font != null) return [[o.id, o.font.path, o.font.absolutePath]];
  return [];
});

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
    expect(saved.settings.musicPlaylist.tracks.map((t) => [t.id, t.path, t.absolutePath])).toEqual([
      ['t1', 'music.mp3', '/home/u/proj/music.mp3'],
      ['t2', 'audio/music2.mp3', '/home/u/proj/audio/music2.mp3'],
    ]);
    expect(overlayPaths(saved)).toEqual([
      ['o1', 'img/logo.png', '/home/u/proj/img/logo.png'],
      ['o2', 'font.ttf', '/home/u/proj/font.ttf'],
      ['o5', 'beep.wav', '/home/u/proj/beep.wav'],
      ['o6', 'text.ttf', '/home/u/proj/text.ttf'],
    ]);
    expect(saved.overlays[2]).toBe(project.overlays[2]);
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
    await Promise.all(['media/a.mp4', 'b.mp4', 'music.mp3', 'audio/music2.mp3', 'img/logo.png', 'font.ttf', 'beep.wav', 'text.ttf'].map((p) => touch(path.join(tmpDir, p))));
    const vmxPath = path.join(tmpDir, 'p.vmx');

    await saveMixProject(deps, vmxPath, project);
    const json = JSON5.parse(await fs.readFile(vmxPath, 'utf8'));
    expect(json.sources[0].path).toBe('media/a.mp4');
    expect(json.sources[0].absolutePath).toBe(path.join(tmpDir, 'media', 'a.mp4'));

    expect(json.version).toBe(7);
    expect(json.overlays[0].path).toBe('img/logo.png');
    expect(json.settings.musicPlaylist.tracks[1].path).toBe('audio/music2.mp3');

    expect(await loadMixProject(deps, vmxPath)).toEqual({ project, missingSourceIds: [], missingMusicTrackIds: [], missingOverlayFiles: [] });
  });

  test('block members\' files (T56): relative when saved, resolved when loaded, missing ones reported with their definition', async () => {
    const project: MixProject = {
      ...makeProject(tmpDir),
      blockDefs: [{
        id: 'D',
        name: 'Block',
        color: 1,
        members: [
          createImageOverlay({ id: 'm1', name: 'Logo', filePath: path.join(tmpDir, 'blocks', 'logo.png') }),
          { ...createTextOverlay({ id: 'm2', name: 'Title', text: '{{who}}' }), font: { path: path.join(tmpDir, 'blocks', 'gone.ttf'), absolutePath: path.join(tmpDir, 'blocks', 'gone.ttf') } },
        ],
      }],
      blocks: [{ id: 'B', defId: 'D', anchor: { kind: 'absolute', time: 1 }, variables: { who: 'Ana' }, locked: true }],
    };
    await touch(path.join(tmpDir, 'blocks', 'logo.png'));
    const vmxPath = path.join(tmpDir, 'p.vmx');
    await saveMixProject(deps, vmxPath, project);
    const json = JSON5.parse(await fs.readFile(vmxPath, 'utf8'));
    expect(json.version).toBe(7);
    expect(json.blockDefs[0].members[0].path).toBe('blocks/logo.png');
    expect(json.blockDefs[0].members[1].font.path).toBe('blocks/gone.ttf');
    expect(json.blocks).toEqual(project.blocks);

    const loaded = await loadMixProject(deps, vmxPath);
    expect(loaded.project.blockDefs).toEqual(project.blockDefs);
    expect(loaded.project.blocks).toEqual(project.blocks);
    expect(loaded.missingOverlayFiles.filter((m) => m.blockDefId != null)).toEqual([{ overlayId: 'm2', kind: 'font', blockDefId: 'D' }]);
  });

  test('project moved together with its media: relative path wins', async () => {
    const project = makeProject(tmpDir);
    await saveMixProject(deps, path.join(tmpDir, 'p.vmx'), project);

    const movedDir = path.join(tmpDir, 'moved');
    await touch(path.join(movedDir, 'media', 'a.mp4'));
    await touch(path.join(movedDir, 'audio', 'music2.mp3'));
    await fs.copyFile(path.join(tmpDir, 'p.vmx'), path.join(movedDir, 'p.vmx'));
    const loaded = await loadMixProject(deps, path.join(movedDir, 'p.vmx'));
    expect(loaded.project.sources[0]).toMatchObject({ path: path.join(movedDir, 'media', 'a.mp4'), absolutePath: path.join(movedDir, 'media', 'a.mp4') });
    expect(loaded.missingSourceIds).toEqual(['s2']);
    expect(loaded.project.settings.musicPlaylist.tracks[1]).toMatchObject({ path: path.join(movedDir, 'audio', 'music2.mp3'), absolutePath: path.join(movedDir, 'audio', 'music2.mp3') });
    expect(loaded.missingMusicTrackIds).toEqual(['t1']);
    expect(loaded.missingOverlayFiles).toEqual([{ overlayId: 'o1', kind: 'media' }, { overlayId: 'o2', kind: 'font' }, { overlayId: 'o5', kind: 'media' }, { overlayId: 'o6', kind: 'font' }]);
  });

  test('overlay files: relative path wins, then the absolute fallback, else reported', async () => {
    const project = makeProject(tmpDir);
    await touch(path.join(tmpDir, 'font.ttf'));
    await touch(path.join(tmpDir, 'text.ttf'));
    await saveMixProject(deps, path.join(tmpDir, 'p.vmx'), project);

    const movedDir = path.join(tmpDir, 'moved');
    await touch(path.join(movedDir, 'img', 'logo.png'));
    await fs.copyFile(path.join(tmpDir, 'p.vmx'), path.join(movedDir, 'p.vmx'));
    const loaded = await loadMixProject(deps, path.join(movedDir, 'p.vmx'));
    expect(overlayPaths(loaded.project)).toEqual([
      ['o1', path.join(movedDir, 'img', 'logo.png'), path.join(movedDir, 'img', 'logo.png')],
      ['o2', path.join(tmpDir, 'font.ttf'), path.join(tmpDir, 'font.ttf')],
      ['o5', path.join(movedDir, 'beep.wav'), path.join(tmpDir, 'beep.wav')],
      ['o6', path.join(tmpDir, 'text.ttf'), path.join(tmpDir, 'text.ttf')],
    ]);
    expect(loaded.missingOverlayFiles).toEqual([{ overlayId: 'o5', kind: 'media' }]);
  });

  // Settings as saved before T24 (v1/v2): `resolution` and a single `music` with a relative path
  const legacySettings = () => {
    const rest: Record<string, unknown> = { ...defaultMixSettings };
    delete rest['output'];
    delete rest['encoder'];
    delete rest['musicPlaylist'];
    return { ...rest, resolution: '720p', music: { path: 'music.mp3', absolutePath: path.join(tmpDir, 'music.mp3'), volumeDb: -6, loop: true } };
  };

  test('opens a v1 project', async () => {
    const vmxPath = path.join(tmpDir, 'old.vmx');
    const { overlays, settings, ...v1 } = makeProject(tmpDir);
    await touch(path.join(tmpDir, 'music.mp3'));
    await fs.writeFile(vmxPath, JSON5.stringify({ ...toSavedMixProject(path, vmxPath, { ...v1, settings, overlays: [] }), settings: legacySettings(), version: 1, overlays: undefined }));
    const loaded = await loadMixProject(deps, vmxPath);
    expect(loaded.project).toMatchObject({ version: 7, overlays: [], clips: v1.clips });
    expect(loaded.project.settings.output).toEqual({ aspect: '16:9', resolution: '720' });
    expect(loaded.project.settings.musicPlaylist).toMatchObject({ tracks: [{ path: path.join(tmpDir, 'music.mp3'), volumeDb: -6 }], loop: true });
    expect(loaded.missingOverlayFiles).toEqual([]);
    expect(loaded.missingMusicTrackIds).toEqual([]);
    expect(overlays).toHaveLength(6);
  });

  test('opens a v2 project: missing music reported by track id', async () => {
    const vmxPath = path.join(tmpDir, 'old.vmx');
    const project = makeProject(tmpDir);
    const saved = toSavedMixProject(path, vmxPath, { ...project, overlays: project.overlays.filter((o) => o.type !== 'text') });
    await fs.writeFile(vmxPath, JSON5.stringify({ ...saved, settings: legacySettings(), version: 2 }));
    const loaded = await loadMixProject(deps, vmxPath);
    expect(loaded.project.version).toBe(7);
    expect(loaded.project.overlays).toHaveLength(5);
    const [track] = loaded.project.settings.musicPlaylist.tracks;
    expect(track).toMatchObject({ path: path.join(tmpDir, 'music.mp3'), absolutePath: path.join(tmpDir, 'music.mp3'), volumeDb: -6 });
    expect(loaded.missingMusicTrackIds).toEqual([track!.id]);
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
