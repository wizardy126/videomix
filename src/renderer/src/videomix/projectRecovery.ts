import JSON5 from 'json5';
import { z } from 'zod';

import { parseMixProject } from './project';
import { pathExists, resolveMixProjectPaths } from './projectFile';
import type { NodeDeps } from './projectFile';
import type { MixProject } from './types';

// Recovery files wrap the in-memory project (absolute paths) with where it belongs, so it's not a plain .vmx.
const recoveryFileExtension = '.vmx-recovery';

const recoveryFileSchema = z.object({
  version: z.literal(1),
  /** The .vmx the project was opened from / saved to, if any. */
  projectPath: z.string().optional(),
  /** Epoch ms. */
  savedAt: z.number(),
  project: z.unknown(),
});

export interface RecoverableProject {
  recoveryFilePath: string,
  sessionId: string,
  projectPath?: string | undefined,
  savedAt: number,
  /** False if the .vmx was saved after this recovery file (it's probably stale then). Always true for unsaved projects. */
  newerThanProjectFile: boolean,
  project: MixProject,
}

export const getRecoveryDir = (deps: Pick<NodeDeps, 'path'>, userDataPath: string) => deps.path.join(userDataPath, 'videomix-recovery');

const getRecoveryFilePath = (deps: Pick<NodeDeps, 'path'>, recoveryDir: string, sessionId: string) => deps.path.join(recoveryDir, `${sessionId}${recoveryFileExtension}`);

export async function writeRecoveryFile(deps: NodeDeps, { recoveryDir, sessionId, projectPath, project, now = Date.now() }: {
  recoveryDir: string,
  sessionId: string,
  projectPath: string | undefined,
  project: MixProject,
  now?: number | undefined,
}) {
  await deps.fs.mkdir(recoveryDir, { recursive: true });
  const data: z.infer<typeof recoveryFileSchema> = { version: 1, ...(projectPath != null && { projectPath }), savedAt: now, project };
  await deps.fs.writeFile(getRecoveryFilePath(deps, recoveryDir, sessionId), JSON5.stringify(data, null, 2));
}

export async function deleteRecoveryFilePath(deps: NodeDeps, recoveryFilePath: string) {
  try {
    await deps.fs.unlink(recoveryFilePath);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return;
    throw err;
  }
}

export async function deleteRecoveryFile(deps: NodeDeps, { recoveryDir, sessionId }: { recoveryDir: string, sessionId: string }) {
  await deleteRecoveryFilePath(deps, getRecoveryFilePath(deps, recoveryDir, sessionId));
}

/**
 * Recovery files left by previous sessions (e.g. after a crash), newest first.
 * Invalid files are skipped (and logged), not deleted.
 */
export async function findRecoverableProjects(deps: NodeDeps, { recoveryDir, excludeSessionId }: {
  recoveryDir: string,
  excludeSessionId?: string | undefined,
}): Promise<RecoverableProject[]> {
  if (!(await pathExists(deps.fs, recoveryDir))) return [];
  const fileNames = (await deps.fs.readdir(recoveryDir)).filter((name) => name.endsWith(recoveryFileExtension));

  const entries = await Promise.all(fileNames.map(async (fileName): Promise<RecoverableProject | undefined> => {
    const sessionId = fileName.slice(0, -recoveryFileExtension.length);
    if (sessionId === excludeSessionId) return undefined;
    const recoveryFilePath = deps.path.join(recoveryDir, fileName);
    try {
      const { projectPath, savedAt, project } = recoveryFileSchema.parse(JSON5.parse(await deps.fs.readFile(recoveryFilePath, 'utf8')));
      let newerThanProjectFile = true;
      if (projectPath != null && await pathExists(deps.fs, projectPath)) {
        newerThanProjectFile = savedAt > (await deps.fs.stat(projectPath)).mtimeMs;
      }
      return { recoveryFilePath, sessionId, projectPath, savedAt, newerThanProjectFile, project: parseMixProject(project) };
    } catch (err) {
      console.warn('Ignoring invalid recovery file', recoveryFilePath, err);
      return undefined;
    }
  }));

  return entries.filter((e) => e != null).sort((a, b) => b.savedAt - a.savedAt);
}

/** Resolve a recovered project's paths (they're absolute, but the files may have moved). */
export const resolveRecoveredProject = async (deps: NodeDeps, { project }: Pick<RecoverableProject, 'project'>) => resolveMixProjectPaths(deps, undefined, project);
