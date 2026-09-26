import type { CSSProperties, FormEventHandler, ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FaExclamationTriangle, FaFolderOpen } from 'react-icons/fa';

import * as Dialog from '../../components/Dialog';
import { DialogButton } from '../../components/Button';
import Checkbox from '../../components/Checkbox';
import Select from '../../components/Select';
import TextInput from '../../components/TextInput';
import { useGenericDialogContext } from '../../components/GenericDialog';
import type { ShowGenericDialog } from '../../components/GenericDialog';
import { formatDuration } from '../../util/duration';
import { warningColor } from '../../colors';
import type { MixClip, MixOutputAspect, MixOverlay } from '../types';
import { getOverlayTypeLabel } from '../overlayTexts';
import { getBlockDefTimes } from '../blocks/expandBlocks';
import { renderTemplatePreview } from '../blocks/blockPreview';
import type { BlockLibraryEntry } from '../blocks/blockTemplateFiles';
import { relinkTemplateFile } from '../blocks/blockTemplateFiles';
import type { VmxBlockPlacement, VmxBlockTemplate } from '../blocks/vmxBlockFile';

// Dialogs of the block templates (H2, H3, T58): export options, import (preview, placement, variables, adapt, missing
// files) and the library ("Insert block"). Shown in the app's generic dialog; each `show…` resolves with the choice, or
// undefined if cancelled.

export interface TemplatePreviewDeps {
  getFileUrl: (path: string) => string,
  defaultFontPath: string | undefined,
}

const sectionStyle: CSSProperties = { marginBottom: '1em' };
const headingStyle: CSSProperties = { margin: '0 0 .4em 0', fontSize: '.9em', borderBottom: '1px solid var(--gray-6)', paddingBottom: '.2em' };
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '.5em', flexWrap: 'wrap', marginBottom: '.4em', fontSize: '.9em' };
const numberInputStyle: CSSProperties = { flexGrow: 0, width: '5em', padding: '.2em .3em' };
const detailsStyle: CSSProperties = { opacity: 0.7, fontSize: '.85em' };

const formatTime = (seconds: number) => formatDuration({ seconds, shorten: true });
const formatSeconds = (seconds: number) => `${Math.round(seconds * 100) / 100} s`;

function Section({ title, children }: { title: string, children: ReactNode }) {
  return (
    <div style={sectionStyle}>
      <h4 style={headingStyle}>{title}</h4>
      {children}
    </div>
  );
}

/** The central frame of a template, drawn when it (or what it's drawn with) changes. */
// eslint-disable-next-line react/display-name
const TemplatePicture = memo(({ template, width, variables, aspect, deps, style }: {
  template: Pick<VmxBlockTemplate, 'members' | 'aspect'>,
  width: number,
  variables?: Readonly<Record<string, string>> | undefined,
  aspect?: MixOutputAspect | undefined,
  deps: TemplatePreviewDeps,
  style?: CSSProperties,
}) => {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let active = true;
    renderTemplatePreview(template, { width, variables, aspect, ...deps }).then((u) => { if (active) setUrl(u); }, (err) => console.warn('Block preview failed', err));
    return () => { active = false; };
  }, [aspect, deps, template, variables, width]);
  return url != null && url !== ''
    ? <img src={url} alt="" data-testid="block-template-picture" style={{ display: 'block', width, borderRadius: '.3em', ...style }} />
    : <div style={{ width, aspectRatio: template.aspect.replace(':', '/'), backgroundColor: 'var(--gray-4)', borderRadius: '.3em', ...style }} />;
});

// ---- export

export interface BlockExportChoice { name: string, includeFiles: boolean }

function BlockExportDialog({ title, defaultName, numFiles, confirmText, askIncludeFiles, resolve }: {
  title: string,
  defaultName: string,
  numFiles: number,
  confirmText: string,
  askIncludeFiles: boolean,
  resolve: (choice: BlockExportChoice) => void,
}) {
  const { t } = useTranslation();
  const { onOpenChange } = useGenericDialogContext();
  const [name, setName] = useState(defaultName);
  const [includeFiles, setIncludeFiles] = useState(false);

  const handleSubmit = useCallback<FormEventHandler<HTMLFormElement>>((e) => {
    e.preventDefault();
    if (name.trim() === '') return;
    resolve({ name: name.trim(), includeFiles });
    onOpenChange(false);
  }, [includeFiles, name, onOpenChange, resolve]);

  return (
    <Dialog.Content aria-describedby={undefined} style={{ width: '32em' }} data-testid="block-export-dialog">
      <Dialog.Title>{title}</Dialog.Title>
      <form onSubmit={handleSubmit}>
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label style={{ ...rowStyle, flexWrap: 'nowrap' }}>
          {t('Name')}
          <TextInput value={name} onChange={(e) => setName(e.target.value)} style={{ padding: '.3em' }} autoFocus />
        </label>
        {askIncludeFiles && (
          <>
            <Checkbox label={t('Include files')} checked={includeFiles} onCheckedChange={(checked) => setIncludeFiles(checked === true)} disabled={numFiles === 0} />
            <div style={{ ...detailsStyle, marginLeft: '1.8em' }}>
              {numFiles === 0
                ? t('The block uses no image, sound or font files.')
                : t('Copies its {{count}} image, sound and font file(s) to a folder next to the block file, so it can be moved or shared. Otherwise the block file refers to them where they are.', { count: numFiles })}
            </div>
          </>
        )}
        <Dialog.ButtonRow>
          <Dialog.Close asChild>
            <DialogButton type="button">{t('Cancel')}</DialogButton>
          </Dialog.Close>
          <DialogButton type="submit" primary disabled={name.trim() === ''}>{confirmText}</DialogButton>
        </Dialog.ButtonRow>
      </form>
    </Dialog.Content>
  );
}

/** Name of the block (and, with `askIncludeFiles`, "Include files") before exporting it. */
export const showBlockExportDialog = (showGenericDialog: ShowGenericDialog, props: Omit<Parameters<typeof BlockExportDialog>[0], 'resolve'>) => new Promise<BlockExportChoice | undefined>((resolve) => {
  showGenericDialog({
    // eslint-disable-next-line react/jsx-props-no-spreading
    render: () => <BlockExportDialog {...props} resolve={resolve} />,
    onClose: () => resolve(undefined),
  });
});

// ---- import

export interface BlockImportChoice {
  /** With the located files. */
  template: VmxBlockTemplate,
  placement: VmxBlockPlacement,
  variables: Record<string, string>,
  /** H7: adapt the boxes to the project's aspect. */
  adapt: boolean,
  /** Import the members as loose overlays. */
  ungroup: boolean,
}

type PlacementKind = VmxBlockPlacement['kind'];

function parseNumber(text: string) {
  const n = Number(text.replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) ? n : undefined;
}

function BlockImportDialog({ title, fileName, template: initialTemplate, missingFiles: initialMissing, clips, projectAspect, cursorTime, defaultPlacement, previewDeps, onLocate, resolve }: {
  title: string,
  fileName: string,
  template: VmxBlockTemplate,
  missingFiles: { path: string }[],
  clips: Pick<MixClip, 'id' | 'name'>[],
  projectAspect: MixOutputAspect,
  cursorTime: number,
  defaultPlacement: 'original' | 'cursor',
  previewDeps: TemplatePreviewDeps,
  /** "Locate…": the chosen replacement, or undefined. */
  onLocate: (path: string) => Promise<string | undefined>,
  resolve: (choice: BlockImportChoice) => void,
}) {
  const { t } = useTranslation();
  const { onOpenChange } = useGenericDialogContext();

  const [template, setTemplate] = useState(initialTemplate);
  const [missing, setMissing] = useState(initialMissing.map((m) => m.path));
  const [placementKind, setPlacementKind] = useState<PlacementKind>(defaultPlacement);
  const [shiftText, setShiftText] = useState('0');
  // the clip of the same name as the one it was exported anchored to, if the project has one
  const [clipId, setClipId] = useState(() => (template.clipAnchor != null ? clips.find((c) => c.name === template.clipAnchor!.clipName)?.id : undefined) ?? clips[0]?.id ?? '');
  const [edge, setEdge] = useState<'start' | 'end'>(template.clipAnchor?.edge ?? 'start');
  const [offsetText, setOffsetText] = useState(String(template.clipAnchor?.offset ?? 0));
  const [variables, setVariables] = useState(template.variables);
  const canAdapt = template.aspect !== projectAspect;
  const [adapt, setAdapt] = useState(true);
  const [ungroup, setUngroup] = useState(false);

  const memberTimes = useMemo(() => getBlockDefTimes(template), [template]);
  // Drawn without its missing files (no failed loads): images left out, the default font instead
  const pictureTemplate = useMemo(() => (missing.length === 0 ? template : {
    ...template,
    members: template.members.flatMap((m): MixOverlay[] => {
      if (m.type === 'image' && missing.includes(m.path)) return [];
      if ((m.type === 'text' || m.type === 'countdown') && m.font != null && missing.includes(m.font.path)) return [{ ...m, font: undefined }];
      return [m];
    }),
  }), [missing, template]);
  const shift = parseNumber(shiftText);
  const offset = parseNumber(offsetText);

  const placement = useMemo((): VmxBlockPlacement | undefined => {
    switch (placementKind) {
      case 'original': { return { kind: 'original' }; }
      case 'shift': { return shift != null ? { kind: 'shift', seconds: shift } : undefined; }
      case 'cursor': { return { kind: 'cursor', time: cursorTime }; }
      default: { return clipId !== '' && offset != null ? { kind: 'clip', clipId, edge, offset } : undefined; }
    }
  }, [clipId, cursorTime, edge, offset, placementKind, shift]);

  const handleLocate = useCallback(async (path: string) => {
    const newPath = await onLocate(path);
    if (newPath == null) return;
    setTemplate((current) => relinkTemplateFile(current, path, newPath));
    setMissing((current) => current.filter((p) => p !== path));
  }, [onLocate]);

  const canImport = placement != null && missing.length === 0;

  const handleSubmit = useCallback<FormEventHandler<HTMLFormElement>>((e) => {
    e.preventDefault();
    if (!canImport) return;
    resolve({ template, placement, variables, adapt: canAdapt && adapt, ungroup });
    onOpenChange(false);
  }, [adapt, canAdapt, canImport, onOpenChange, placement, resolve, template, ungroup, variables]);

  const radio = (kind: PlacementKind, label: string, extra?: ReactNode) => (
    <div style={rowStyle}>
      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.3em' }}>
        <input type="radio" name="block-placement" value={kind} checked={placementKind === kind} onChange={() => setPlacementKind(kind)} />
        {label}
      </label>
      {extra}
    </div>
  );

  const clipAnchorInfo = template.clipAnchor != null
    ? t('It was anchored to the {{edge}} of clip "{{clip}}" ({{offset}}).', { edge: template.clipAnchor.edge === 'start' ? t('start') : t('end'), clip: template.clipAnchor.clipName, offset: `${template.clipAnchor.offset >= 0 ? '+' : ''}${formatSeconds(template.clipAnchor.offset)}` })
    : undefined;

  const shiftFields = (
    <>
      <TextInput type="number" step={0.1} value={shiftText} onChange={(e) => { setShiftText(e.target.value); setPlacementKind('shift'); }} style={numberInputStyle} aria-label={t('Shift (s)')} />
      <span>s</span>
      {shift != null && <span style={detailsStyle}>{t('starts at {{time}}', { time: formatTime(Math.max(0, template.originalStart + shift)) })}</span>}
    </>
  );
  const clipFields = clips.length === 0 ? <span style={detailsStyle}>{t('The project has no clips')}</span> : (
    <>
      <Select value={clipId} onChange={(e) => { setClipId(e.target.value); setPlacementKind('clip'); }} aria-label={t('Clip')}>
        {clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <Select value={edge} onChange={(e) => { setEdge(e.target.value as 'start' | 'end'); setPlacementKind('clip'); }} aria-label={t('Edge')}>
        <option value="start">{t('Start')}</option>
        <option value="end">{t('End')}</option>
      </Select>
      <TextInput type="number" step={0.1} value={offsetText} onChange={(e) => { setOffsetText(e.target.value); setPlacementKind('clip'); }} style={numberInputStyle} aria-label={t('Offset (s)')} />
      <span>s</span>
    </>
  );

  return (
    <Dialog.Content aria-describedby={undefined} style={{ width: '46em' }} data-testid="block-import-dialog">
      <Dialog.Title>{title}</Dialog.Title>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', gap: '1em', marginBottom: '1em', alignItems: 'flex-start' }}>
          <TemplatePicture template={pictureTemplate} width={200} variables={variables} aspect={canAdapt && adapt ? projectAspect : undefined} deps={previewDeps} />
          <div style={{ minWidth: 0, flexGrow: 1 }}>
            <div style={{ fontWeight: 'bold', marginBottom: '.2em' }} data-testid="block-import-name">{template.name}</div>
            <div style={detailsStyle} data-testid="block-import-summary">
              {t('{{count}} overlay(s), {{duration}}', { count: template.members.length, duration: formatSeconds(template.duration) })}
              {' · '}{template.aspect}{' · '}{fileName}
            </div>
            {clipAnchorInfo != null && <div style={detailsStyle}>{clipAnchorInfo}</div>}
            <div style={{ maxHeight: '8em', overflow: 'auto', marginTop: '.4em', fontSize: '.8em' }} className="consistent-scrollbar">
              <table style={{ borderCollapse: 'collapse' }}>
                <tbody>
                  {template.members.map((m) => {
                    const times = memberTimes.get(m.id);
                    return (
                      <tr key={m.id} data-testid="block-import-member">
                        <td style={{ paddingRight: '.8em', opacity: 0.7 }}>{getOverlayTypeLabel(m.type)}</td>
                        <td style={{ paddingRight: '.8em' }}>{m.name}</td>
                        <td style={{ opacity: 0.7 }}>{times != null ? `${formatSeconds(times.start)} – ${m.type === 'sound' ? '…' : formatSeconds(times.end)}` : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {missing.length > 0 && (
          <Section title={t('Files not found')}>
            <div style={{ ...detailsStyle, marginBottom: '.4em' }}>{t('Locate them to import the block.')}</div>
            {missing.map((path) => (
              <div key={path} style={rowStyle} data-testid="block-import-missing">
                <FaExclamationTriangle style={{ color: warningColor, flexShrink: 0 }} />
                <span style={{ wordBreak: 'break-all', flexGrow: 1 }}>{path}</span>
                <DialogButton type="button" onClick={() => handleLocate(path)}>{t('Locate...')}</DialogButton>
              </div>
            ))}
          </Section>
        )}

        <Section title={t('Placement')}>
          {radio('original', t('Original times (starts at {{time}})', { time: formatTime(Math.max(0, template.originalStart)) }))}
          {radio('shift', t('Shifted by'), shiftFields)}
          {radio('cursor', t('At the cursor ({{time}})', { time: formatTime(cursorTime) }))}
          {radio('clip', t('Anchored to a clip'), clipFields)}
        </Section>

        {template.variableNames.length > 0 && (
          <Section title={t('Variables')}>
            {template.variableNames.map((name) => (
              // eslint-disable-next-line jsx-a11y/label-has-associated-control
              <label key={name} style={{ ...rowStyle, flexWrap: 'nowrap' }} data-testid="block-import-variable">
                <code style={{ minWidth: '8em' }}>{`{{${name}}}`}</code>
                <TextInput value={variables[name] ?? ''} onChange={(e) => setVariables((current) => ({ ...current, [name]: e.target.value }))} style={{ padding: '.2em .3em' }} />
              </label>
            ))}
          </Section>
        )}

        <Section title={t('Options')}>
          {canAdapt && <Checkbox label={t('Adapt to {{aspect}} (it was made for {{original}}): keeps the size relative to the height and moves the boxes into the frame', { aspect: projectAspect, original: template.aspect })} checked={adapt} onCheckedChange={(checked) => setAdapt(checked === true)} />}
          <Checkbox label={t('Import ungrouped (as loose overlays)')} checked={ungroup} onCheckedChange={(checked) => setUngroup(checked === true)} />
        </Section>

        <Dialog.ButtonRow>
          <Dialog.Close asChild>
            <DialogButton type="button">{t('Cancel')}</DialogButton>
          </Dialog.Close>
          <DialogButton type="submit" primary disabled={!canImport}>{t('Import')}</DialogButton>
        </Dialog.ButtonRow>
      </form>
    </Dialog.Content>
  );
}

export const showBlockImportDialog = (showGenericDialog: ShowGenericDialog, props: Omit<Parameters<typeof BlockImportDialog>[0], 'resolve'>) => new Promise<BlockImportChoice | undefined>((resolve) => {
  showGenericDialog({
    // eslint-disable-next-line react/jsx-props-no-spreading
    render: () => <BlockImportDialog {...props} resolve={resolve} />,
    onClose: () => resolve(undefined),
  });
});

// ---- library

export type BlockLibraryChoice = { kind: 'insert', entry: BlockLibraryEntry & { template: VmxBlockTemplate } } | { kind: 'openFolder' };

function BlockLibraryDialog({ entries, libraryDir, previewDeps, resolve }: {
  entries: BlockLibraryEntry[],
  libraryDir: string,
  previewDeps: TemplatePreviewDeps,
  resolve: (choice: BlockLibraryChoice) => void,
}) {
  const { t } = useTranslation();
  const { onOpenChange } = useGenericDialogContext();
  const choose = useCallback((choice: BlockLibraryChoice) => {
    resolve(choice);
    onOpenChange(false);
  }, [onOpenChange, resolve]);

  return (
    <Dialog.Content aria-describedby={undefined} style={{ width: '46em' }} data-testid="block-library-dialog">
      <Dialog.Title>{t('Insert block')}</Dialog.Title>
      {entries.length === 0 ? (
        <div style={{ ...detailsStyle, margin: '1em 0' }}>
          {t('The library is empty. Save a block to the library, or put .vmxblock files in its folder:')}
          <div style={{ wordBreak: 'break-all', marginTop: '.3em' }}>{libraryDir}</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(10em, 1fr))', gap: '.6em', maxHeight: '60vh', overflow: 'auto' }} className="consistent-scrollbar">
          {entries.map((entry) => (entry.template != null ? (
            <button
              key={entry.filePath}
              type="button"
              data-testid="block-library-entry"
              onClick={() => choose({ kind: 'insert', entry: { ...entry, template: entry.template } })}
              title={entry.fileName}
              style={{ all: 'unset', cursor: 'pointer', padding: '.4em', borderRadius: '.4em', border: '1px solid var(--gray-6)', backgroundColor: 'var(--gray-3)', display: 'flex', flexDirection: 'column', gap: '.3em' }}
            >
              <TemplatePicture template={entry.template} width={144} deps={previewDeps} style={{ maxHeight: '8em', objectFit: 'contain', alignSelf: 'center' }} />
              <div style={{ fontSize: '.85em', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.template.name}</div>
              <div style={detailsStyle}>{t('{{count}} overlay(s), {{duration}}', { count: entry.template.members.length, duration: formatSeconds(entry.template.duration) })}</div>
            </button>
          ) : (
            <div key={entry.filePath} data-testid="block-library-invalid" title={entry.error} style={{ padding: '.4em', borderRadius: '.4em', border: `1px solid ${warningColor}`, fontSize: '.8em', overflow: 'hidden' }}>
              <FaExclamationTriangle style={{ color: warningColor, marginRight: '.3em' }} />
              <span style={{ fontWeight: 'bold', wordBreak: 'break-all' }}>{entry.fileName}</span>
              <div style={{ ...detailsStyle, whiteSpace: 'pre-wrap', maxHeight: '6em', overflow: 'auto' }}>{entry.error}</div>
            </div>
          )))}
        </div>
      )}
      <Dialog.ButtonRow>
        <DialogButton type="button" onClick={() => choose({ kind: 'openFolder' })}><FaFolderOpen style={{ verticalAlign: 'middle', marginRight: '.3em' }} />{t('Open library folder')}</DialogButton>
        <Dialog.Close asChild>
          <DialogButton type="button">{t('Cancel')}</DialogButton>
        </Dialog.Close>
      </Dialog.ButtonRow>
    </Dialog.Content>
  );
}

export const showBlockLibraryDialog = (showGenericDialog: ShowGenericDialog, props: Omit<Parameters<typeof BlockLibraryDialog>[0], 'resolve'>) => new Promise<BlockLibraryChoice | undefined>((resolve) => {
  showGenericDialog({
    // eslint-disable-next-line react/jsx-props-no-spreading
    render: () => <BlockLibraryDialog {...props} resolve={resolve} />,
    onClose: () => resolve(undefined),
  });
});
