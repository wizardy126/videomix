import { useCallback, useMemo } from 'react';
import { nanoid } from 'nanoid';
import i18n from 'i18next';

import { showOpenDialog } from '../../dialogs';
import { getDefaultOverlayFontPath } from '../../ffmpeg';
import type { WithErrorHandling } from '../../hooks/useErrorHandling';
import type { ShowGenericDialog } from '../../components/GenericDialog';
import { UserFacingError } from '../../../errors';
import type { UseMixProject } from './useMixProject';
import { getKnownSoundDurations } from './useOverlaySoundDurations';
import type { MixProjectAction } from '../projectReducer';
import { resolveProjectTimes } from '../overlayRemoval';
import { expandBlocks } from '../blocks/expandBlocks';
import { getBlockExport, getOverlaysExport, instantiateVmxBlock, VmxBlockParseError, vmxBlockExtension } from '../blocks/vmxBlockFile';
import type { VmxBlockExport, VmxBlockTemplate } from '../blocks/vmxBlockFile';
import { findMissingTemplateFiles, getBlockLibraryDir, getNewLibraryFilePath, getTemplateSelection, getUserFiles, listBlockLibrary, MissingVmxBlockFilesError, readVmxBlockFile, writeVmxBlockFile } from '../blocks/blockTemplateFiles';
import type { BlockFileDeps, BlockTemplateSelection } from '../blocks/blockTemplateFiles';
import { showBlockExportDialog, showBlockImportDialog, showBlockLibraryDialog } from '../components/BlockTemplateDialogs';
import type { TemplatePreviewDeps } from '../components/BlockTemplateDialogs';

const remote = window.require('@electron/remote');
const { pathToFileURL } = remote.require('./index.js');
const path = window.require('node:path');
const fs = window.require('node:fs/promises');

const deps: BlockFileDeps = { path, fs };

const vmxBlockFilters = () => [{ name: i18n.t('VideoMix blocks'), extensions: [vmxBlockExtension] }];

/**
 * Block templates (H2, H3, H4, H7; T58): export a block or a selection of loose overlays to a `.vmxblock`, import one
 * (preview, placement, variables, adapt to the aspect, missing files: one undo step), and the template library (a
 * folder in the app's user data): "Save to library", "Insert block", "Open library folder".
 */
export default function useBlockTemplates({ mixProject, cursorTime, selectedBlockIds, selectedOverlayIds, showGenericDialog, withErrorHandling }: {
  mixProject: UseMixProject,
  /** Where "At the cursor" places an imported block (the Mix view cursor). */
  cursorTime: number,
  /** The Mix view selection (T57), what "Export block…" and "Save block to library…" act on: one block, or loose overlays. */
  selectedBlockIds: readonly string[],
  selectedOverlayIds: readonly string[],
  showGenericDialog: ShowGenericDialog,
  withErrorHandling: WithErrorHandling,
}) {
  const { getProject, getProjectPath, dispatch } = mixProject;

  const selection = useMemo(() => getTemplateSelection(selectedBlockIds, selectedOverlayIds), [selectedBlockIds, selectedOverlayIds]);

  const libraryDir = useMemo(() => getBlockLibraryDir(path, remote.app.getPath('userData')), []);

  const previewDeps = useMemo<TemplatePreviewDeps>(() => ({
    getFileUrl: (p) => pathToFileURL(p).href,
    defaultFontPath: (() => {
      try {
        return getDefaultOverlayFontPath();
      } catch (err) {
        console.warn('No default overlay font', err);
        return undefined;
      }
    })(),
  }), []);

  /** The export data of a selection, with the times of the project right now. */
  const getExport = useCallback((sel: BlockTemplateSelection, name?: string): VmxBlockExport | undefined => {
    const project = getProject();
    const times = resolveProjectTimes(project, getKnownSoundDurations(expandBlocks(project).all));
    if ('blockId' in sel) {
      const data = getBlockExport(project, sel.blockId, times);
      return data != null && name != null ? { ...data, def: { ...data.def, name } } : data;
    }
    return getOverlaysExport(project, sel.overlayIds, times, { name: name ?? i18n.t('Block') });
  }, [getProject]);

  const getDefaultName = useCallback((sel: BlockTemplateSelection) => {
    const project = getProject();
    if ('blockId' in sel) {
      const block = project.blocks.find((b) => b.id === sel.blockId);
      return project.blockDefs.find((d) => d.id === block?.defId)?.name ?? i18n.t('Block');
    }
    const [first, ...rest] = project.overlays.filter((o) => sel.overlayIds.includes(o.id));
    return first != null && rest.length === 0 ? first.name : i18n.t('Block');
  }, [getProject]);

  const write = useCallback(async (blockFilePath: string, data: VmxBlockExport, includeFiles: boolean) => {
    try {
      await writeVmxBlockFile(deps, { blockFilePath, data, includeFiles });
    } catch (err) {
      if (err instanceof MissingVmxBlockFilesError) throw new UserFacingError(i18n.t('These files can\'t be included because they don\'t exist:\n{{files}}', { files: err.missing.join('\n') }));
      throw err;
    }
  }, []);

  const warnNothingSelected = useCallback(() => {
    throw new UserFacingError(i18n.t('Select one block, or one or more overlays that aren\'t in a block, in the Mix view first.'));
  }, []);

  /** H2 "Export": a block, or loose overlays as one block. */
  const userExportBlock = useCallback(async (sel: BlockTemplateSelection | undefined = selection) => {
    await withErrorHandling(async () => {
      if (sel == null) { warnNothingSelected(); return; }
      const preview = getExport(sel);
      if (preview == null) { warnNothingSelected(); return; }
      const choice = await showBlockExportDialog(showGenericDialog, {
        title: 'blockId' in sel ? i18n.t('Export block') : i18n.t('Export selection as a block'),
        defaultName: getDefaultName(sel),
        numFiles: getUserFiles(preview.def.members).length,
        confirmText: i18n.t('Export…'),
        askIncludeFiles: true,
      });
      if (choice == null) return;
      const projectPath = getProjectPath();
      const { canceled, filePath } = await remote.dialog.showSaveDialog({
        title: i18n.t('Export block'),
        defaultPath: path.join(projectPath != null ? path.dirname(projectPath) : remote.app.getPath('documents'), `${choice.name}.${vmxBlockExtension}`),
        filters: vmxBlockFilters(),
      });
      if (canceled || filePath == null) return;
      const data = getExport(sel, choice.name);
      if (data == null) return;
      await write(filePath, data, choice.includeFiles);
    }, i18n.t('Failed to export the block'));
  }, [getDefaultName, getExport, getProjectPath, selection, showGenericDialog, warnNothingSelected, withErrorHandling, write]);

  /** H3 "Save to library": always with its files, so the library works on its own. */
  const userSaveBlockToLibrary = useCallback(async (sel: BlockTemplateSelection | undefined = selection) => {
    await withErrorHandling(async () => {
      if (sel == null || getExport(sel) == null) { warnNothingSelected(); return; }
      const choice = await showBlockExportDialog(showGenericDialog, {
        title: i18n.t('Save block to library'),
        defaultName: getDefaultName(sel),
        numFiles: 0,
        confirmText: i18n.t('Save'),
        askIncludeFiles: false,
      });
      if (choice == null) return;
      const data = getExport(sel, choice.name);
      if (data == null) return;
      await fs.mkdir(libraryDir, { recursive: true });
      await write(await getNewLibraryFilePath(deps, libraryDir, choice.name), data, true);
    }, i18n.t('Failed to save the block to the library'));
  }, [getDefaultName, getExport, libraryDir, selection, showGenericDialog, warnNothingSelected, withErrorHandling, write]);

  const askToLocate = useCallback(async (missingPath: string) => {
    const { canceled, filePaths } = await showOpenDialog({ properties: ['openFile'], defaultPath: path.dirname(missingPath), title: i18n.t('Locate {{name}}', { name: path.basename(missingPath) }) });
    const [newPath] = filePaths;
    return canceled ? undefined : newPath;
  }, []);

  /** Preview and placement of a template, then one undo step (`addBlocks`, or with `ungroupBlock` in a batch). */
  const importTemplate = useCallback(async (template: VmxBlockTemplate, blockFilePath: string, { title, defaultPlacement }: { title: string, defaultPlacement: 'original' | 'cursor' }) => {
    const project = getProject();
    const missingFiles = await findMissingTemplateFiles(fs, template);
    const choice = await showBlockImportDialog(showGenericDialog, {
      title,
      fileName: path.basename(blockFilePath),
      template,
      missingFiles,
      clips: project.clips.map(({ id, name }) => ({ id, name })),
      projectAspect: project.settings.output.aspect,
      cursorTime,
      defaultPlacement,
      previewDeps,
      onLocate: askToLocate,
    });
    if (choice == null) return;
    const blockId = nanoid();
    const { def, block } = instantiateVmxBlock(choice.template, {
      defId: nanoid(),
      blockId,
      placement: choice.placement,
      variables: choice.variables,
      adaptTo: choice.adapt ? getProject().settings.output.aspect : undefined,
    });
    const add: MixProjectAction = { type: 'addBlocks', defs: [def], blocks: [block] };
    dispatch(choice.ungroup ? { type: 'batch', actions: [add, { type: 'ungroupBlock', blockId }] } : add);
  }, [askToLocate, cursorTime, dispatch, getProject, previewDeps, showGenericDialog]);

  const readTemplate = useCallback(async (blockFilePath: string) => {
    try {
      return await readVmxBlockFile(deps, blockFilePath);
    } catch (err) {
      // every problem with its field, nothing imported
      if (err instanceof VmxBlockParseError) throw new UserFacingError(`${i18n.t('The block file has errors, nothing was imported:')}\n\n${err.message}`);
      throw err;
    }
  }, []);

  /** H2 "Import block…". */
  const userImportBlock = useCallback(async () => {
    await withErrorHandling(async () => {
      const projectPath = getProjectPath();
      const { canceled, filePaths } = await showOpenDialog({
        title: i18n.t('Import block'),
        properties: ['openFile'],
        ...(projectPath != null && { defaultPath: path.dirname(projectPath) }),
        filters: vmxBlockFilters(),
      });
      const [filePath] = filePaths;
      if (canceled || filePath == null) return;
      await importTemplate(await readTemplate(filePath), filePath, { title: i18n.t('Import block'), defaultPlacement: 'original' });
    }, i18n.t('Failed to import the block'));
  }, [getProjectPath, importTemplate, readTemplate, withErrorHandling]);

  const userOpenBlockLibraryFolder = useCallback(async () => {
    await withErrorHandling(async () => {
      await fs.mkdir(libraryDir, { recursive: true });
      const error: string = await remote.shell.openPath(libraryDir);
      if (error !== '') throw new Error(error);
    }, i18n.t('Failed to open the library folder'));
  }, [libraryDir, withErrorHandling]);

  /** H3 "Insert block": the library with thumbnails, then the import dialog (at the cursor by default). */
  const userInsertBlockFromLibrary = useCallback(async () => {
    await withErrorHandling(async () => {
      const entries = await listBlockLibrary(deps, libraryDir);
      const choice = await showBlockLibraryDialog(showGenericDialog, { entries, libraryDir, previewDeps });
      if (choice == null) return;
      if (choice.kind === 'openFolder') {
        await userOpenBlockLibraryFolder();
        return;
      }
      await importTemplate(choice.entry.template, choice.entry.filePath, { title: i18n.t('Insert block'), defaultPlacement: 'cursor' });
    }, i18n.t('Failed to import the block'));
  }, [importTemplate, libraryDir, previewDeps, showGenericDialog, userOpenBlockLibraryFolder, withErrorHandling]);

  return {
    libraryDir,
    userExportBlock,
    userSaveBlockToLibrary,
    userImportBlock,
    userInsertBlockFromLibrary,
    userOpenBlockLibraryFolder,
  };
}

export type UseBlockTemplates = ReturnType<typeof useBlockTemplates>;
