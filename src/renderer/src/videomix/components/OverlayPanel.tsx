import type { ChangeEventHandler, CSSProperties, KeyboardEventHandler, ReactNode } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FaAngleDoubleDown, FaAngleDoubleUp, FaArrowDown, FaArrowUp, FaClone, FaExclamationTriangle, FaFolderOpen, FaTimes, FaTrash } from 'react-icons/fa';

import Select from '../../components/Select';
import Switch from '../../components/Switch';
import Truncated from '../../components/Truncated';
import { controlsBackground, darkModeTransition, warningColor } from '../../colors';
import { formatDuration } from '../../util/duration';
import type { CountdownOverlay, MixClip, MixOverlay, OverlayAnchor, OverlayBox, TextOverlay } from '../types';
import { progressBarDirections } from '../types';
import type { MixOverlayPatch } from '../projectReducer';
import type { OverlayFileKind } from '../projectFile';
import type { ResolvedOverlayTime } from '../overlays/resolveOverlayTimes';
import { canOverlayDependOn, getOverlaysById, getLinkedCountdown } from '../overlays/anchors';
import { getOverlayBoxPreset } from '../overlays/factories';
import { getTextOverlayFontSize, getTextOverlayLayoutPatch } from '../overlays/textLayout';
import { isStyledOverlay } from '../overlayStylePresets';
import OverlayStylePresets from './OverlayStylePresets';
import type { OverlayBoxPreset } from '../overlays/factories';
import { getAnchorOfKind, joinOverlayColor, roundOverlayTime, splitOverlayColor } from '../overlayTimeline';
import { getOverlayTimeWarningText, getOverlayTypeLabel } from '../overlayTexts';
import type { UseMixOverlays } from '../hooks/useMixOverlays';

const { basename } = window.require('node:path');

// Properties of the overlay selected in the Mix view (T22, 01-requisitos §9.3). It replaces the clip list in the right
// bar while an overlay is selected. Every field is one undo step (typed values are applied on blur/Enter; colors while
// picking are transient edits committed on blur).

const sectionTitleStyle: CSSProperties = { margin: '.8em 0 .3em', fontSize: '.8em', fontWeight: 600, borderBottom: '1px solid var(--gray-6)', paddingBottom: '.2em' };
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '.4em', marginBottom: '.35em', flexWrap: 'wrap' };
const labelStyle: CSSProperties = { fontSize: '.75em', color: 'var(--gray-11)', minWidth: '5.5em' };
const inputStyle: CSSProperties = { font: 'inherit', fontSize: '.8em', width: '5em', background: 'var(--gray-3)', color: 'var(--gray-12)', border: '1px solid var(--gray-7)', borderRadius: '.3em', padding: '.1em .3em' };
const iconButtonStyle: CSSProperties = { font: 'inherit', fontSize: '.8em', padding: '.2em .4em', border: '1px solid var(--gray-7)', borderRadius: '.3em', background: 'var(--gray-3)', color: 'var(--gray-12)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '.3em' };
const selectStyle: CSSProperties = { fontSize: '.8em', maxWidth: '100%' };

const presetLabels: Record<OverlayBoxPreset, string> = { topLeft: '↖', topRight: '↗', bottomLeft: '↙', bottomRight: '↘', center: '●', fullScreen: '⛶' };
const presets = Object.keys(presetLabels) as OverlayBoxPreset[];

function Row({ label, children }: { label: string, children: ReactNode }) {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      {children}
    </div>
  );
}

/** A number typed freely and applied on blur or Enter (Escape reverts), so typing "12.5" is one edit, not four. */
// eslint-disable-next-line react/display-name
const NumberField = memo(({ value, onCommit, step = 0.1, min, max, disabled, title }: {
  value: number,
  onCommit: (newValue: number) => void,
  step?: number | undefined,
  min?: number | undefined,
  max?: number | undefined,
  disabled?: boolean | undefined,
  title?: string | undefined,
}) => {
  const [draft, setDraft] = useState<string>();
  const shown = draft ?? String(value);

  const commit = useCallback(() => {
    if (draft == null) return;
    setDraft(undefined);
    const parsed = Number(draft.replace(',', '.'));
    if (draft.trim() === '' || !Number.isFinite(parsed)) return;
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
    if (clamped !== value) onCommit(clamped);
  }, [draft, max, min, onCommit, value]);

  const handleChange = useCallback<ChangeEventHandler<HTMLInputElement>>((e) => {
    // the spinner arrows are discrete steps: apply them right away
    const native = e.nativeEvent as InputEvent;
    if (native.inputType == null || native.inputType === '') {
      setDraft(undefined);
      const parsed = Number(e.target.value);
      if (Number.isFinite(parsed) && e.target.value !== '') onCommit(parsed);
      return;
    }
    setDraft(e.target.value);
  }, [onCommit]);

  const handleKeyDown = useCallback<KeyboardEventHandler<HTMLInputElement>>((e) => {
    // don't trigger the app's keyboard shortcuts while typing
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setDraft(undefined);
  }, [commit]);

  return (
    <input type="number" style={inputStyle} value={shown} step={step} min={min} max={max} disabled={disabled} title={title} onChange={handleChange} onBlur={commit} onKeyDown={handleKeyDown} />
  );
});

/** `<input type="color">` (no alpha) plus, with `withAlpha`, an opacity in %. Picking is transient, committed on blur. */
// eslint-disable-next-line react/display-name
const ColorField = memo(({ value, onChange, onCommit, withAlpha }: {
  value: string,
  onChange: (color: string, transient: boolean) => void,
  onCommit: () => void,
  withAlpha?: boolean | undefined,
}) => {
  const { t } = useTranslation();
  const { rgb, alpha } = splitOverlayColor(value);
  const handleColorChange = useCallback<ChangeEventHandler<HTMLInputElement>>((e) => onChange(joinOverlayColor(e.target.value, alpha), true), [alpha, onChange]);
  const handleAlphaCommit = useCallback((percent: number) => onChange(joinOverlayColor(rgb, percent / 100), false), [onChange, rgb]);
  return (
    <>
      <input type="color" value={rgb} onChange={handleColorChange} onBlur={onCommit} style={{ width: '2.5em', height: '1.6em', padding: 0, border: 'none', background: 'transparent' }} />
      {withAlpha && (
        <>
          <NumberField value={Math.round(alpha * 100)} step={5} min={0} max={100} onCommit={handleAlphaCommit} title={t('Opacity (%)')} />
          <span style={{ fontSize: '.75em' }}>%</span>
        </>
      )}
    </>
  );
});

// eslint-disable-next-line react/display-name
const SecondsField = memo(({ label, value, onCommit, allowNegative = false }: { label: string, value: number, onCommit: (seconds: number) => void, allowNegative?: boolean | undefined }) => {
  const { t } = useTranslation();
  return (
    <Row label={label}>
      <NumberField value={value} min={allowNegative ? undefined : 0} onCommit={onCommit} />
      <span style={{ fontSize: '.75em' }}>{t('s')}</span>
    </Row>
  );
});

/** A box field (fraction) shown and typed in %. */
// eslint-disable-next-line react/display-name
const PercentField = memo(({ label, field, box, onChange }: { label: string, field: keyof OverlayBox, box: OverlayBox, onChange: (newBox: OverlayBox) => void }) => {
  const handleCommit = useCallback((percent: number) => onChange({ ...box, [field]: percent / 100 }), [box, field, onChange]);
  return (
    <Row label={label}>
      <NumberField value={Math.round(box[field] * 1000) / 10} step={1} onCommit={handleCommit} />
      <span style={{ fontSize: '.75em' }}>%</span>
    </Row>
  );
});

/** Multi-line text, applied on blur or Ctrl/Cmd+Enter (Escape reverts), so typing is one edit. */
// eslint-disable-next-line react/display-name
const TextField = memo(({ value, onCommit }: { value: string, onCommit: (text: string) => void }) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string>();
  const commit = useCallback(() => {
    if (draft != null && draft !== value) onCommit(draft);
    setDraft(undefined);
  }, [draft, onCommit, value]);
  const handleKeyDown = useCallback<KeyboardEventHandler<HTMLTextAreaElement>>((e) => {
    // Enter adds a line; don't trigger the app's keyboard shortcuts while typing
    e.stopPropagation();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
    if (e.key === 'Escape') setDraft(undefined);
  }, [commit]);
  return (
    <textarea
      style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', fontSize: '.85em', resize: 'vertical', minHeight: '3.5em', marginBottom: '.35em' }}
      rows={Math.min(8, Math.max(2, (draft ?? value).split('\n').length))}
      value={draft ?? value}
      title={t('One line per row. Applied when leaving the field (or with Ctrl+Enter).')}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  );
});

type TextStyledOverlay = CountdownOverlay | TextOverlay;

/** Color and font of a countdown or a text. */
// eslint-disable-next-line react/display-name
const FontRows = memo(({ overlay, set, setTransient, commitTransient, onChooseFont }: {
  overlay: TextStyledOverlay,
  set: (patch: MixOverlayPatch) => void,
  setTransient: (patch: MixOverlayPatch, transient: boolean) => void,
  commitTransient: () => void,
  onChooseFont: () => void,
}) => {
  const { t } = useTranslation();
  return (
    <>
      <Row label={t('Color')}>
        <ColorField value={overlay.color} onChange={(color, transient) => setTransient({ color }, transient)} onCommit={commitTransient} />
      </Row>
      <Row label={t('Font')}>
        <Truncated maxWidth="7em" title={overlay.font?.absolutePath ?? ''}>{overlay.font != null ? basename(overlay.font.absolutePath) : t('Default font')}</Truncated>
        <button type="button" style={iconButtonStyle} title={t('Choose a font')} onClick={onChooseFont}><FaFolderOpen /></button>
        {overlay.font != null && <button type="button" style={iconButtonStyle} title={t('Use the default font')} onClick={() => set({ font: undefined })}><FaTimes /></button>}
      </Row>
    </>
  );
});

/** Alignment, border and shadow of a countdown or a text. */
// eslint-disable-next-line react/display-name
const OutlineRows = memo(({ overlay, set, setTransient, commitTransient }: {
  overlay: TextStyledOverlay,
  set: (patch: MixOverlayPatch) => void,
  setTransient: (patch: MixOverlayPatch, transient: boolean) => void,
  commitTransient: () => void,
}) => {
  const { t } = useTranslation();
  const { shadow } = overlay;
  return (
    <>
      <Row label={t('Align')}>
        <Select style={selectStyle} value={overlay.align} onChange={(e) => set({ align: e.target.value as 'left' | 'center' | 'right' })}>
          <option value="left">{t('Left')}</option>
          <option value="center">{t('Center')}</option>
          <option value="right">{t('Right')}</option>
        </Select>
      </Row>
      <Row label={t('Border (px)')}>
        <NumberField value={overlay.border.width} step={1} min={0} onCommit={(v) => set({ border: { ...overlay.border, width: v } })} />
        <ColorField value={overlay.border.color} onChange={(color, transient) => setTransient({ border: { ...overlay.border, color } }, transient)} onCommit={commitTransient} />
      </Row>
      <Row label={t('Shadow')}>
        <Switch checked={shadow != null} onCheckedChange={(checked) => set({ shadow: checked ? { x: 3, y: 3, color: '#000000' } : undefined })} />
      </Row>
      {shadow != null && (
        <Row label={t('Shadow (px)')}>
          <NumberField value={shadow.x} step={1} onCommit={(v) => set({ shadow: { ...shadow, x: v } })} title={t('Horizontal')} />
          <NumberField value={shadow.y} step={1} onCommit={(v) => set({ shadow: { ...shadow, y: v } })} title={t('Vertical')} />
          <ColorField value={shadow.color} onChange={(color, transient) => setTransient({ shadow: { ...shadow, color } }, transient)} onCommit={commitTransient} />
        </Row>
      )}
    </>
  );
});

/** Where the overlay starts: at a time, or anchored to an edge of a clip or of another overlay (01-requisitos §9.2). */
// eslint-disable-next-line react/display-name
const AnchorFields = memo(({ overlayId, anchor, overlays, clips, rawStart, onChange }: {
  overlayId: string,
  anchor: OverlayAnchor,
  overlays: MixOverlay[],
  clips: MixClip[],
  /** Current start, kept when switching to "at a time". */
  rawStart: number,
  onChange: (newAnchor: OverlayAnchor) => void,
}) => {
  const { t } = useTranslation();

  // Only targets that don't create a cycle (the current one is kept, so the select can show it)
  const elementTargets = useMemo(() => overlays.filter((o) => o.id !== overlayId && (canOverlayDependOn(overlays, overlayId, o.id) || (anchor.kind === 'element' && anchor.elementId === o.id))), [anchor, overlayId, overlays]);

  const handleKindChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    const kind = e.target.value as OverlayAnchor['kind'];
    const targetId = kind === 'clip' ? clips[0]?.id : elementTargets[0]?.id;
    const newAnchor = getAnchorOfKind(kind, { current: anchor, rawStart, targetId });
    if (newAnchor != null) onChange(newAnchor);
  }, [anchor, clips, elementTargets, onChange, rawStart]);

  // Changing the target, edge or offset keeps the rest of the anchor
  const patch = useCallback((changes: { targetId?: string, edge?: 'start' | 'end', offset?: number }) => {
    if (anchor.kind === 'absolute') return;
    const edge = changes.edge ?? anchor.edge;
    const offset = changes.offset ?? anchor.offset;
    onChange(anchor.kind === 'clip'
      ? { kind: 'clip', clipId: changes.targetId ?? anchor.clipId, edge, offset }
      : { kind: 'element', elementId: changes.targetId ?? anchor.elementId, edge, offset });
  }, [anchor, onChange]);

  const handleTargetChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => patch({ targetId: e.target.value }), [patch]);
  const handleEdgeChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => patch({ edge: e.target.value as 'start' | 'end' }), [patch]);
  const handleOffsetCommit = useCallback((offset: number) => patch({ offset: roundOverlayTime(offset) }), [patch]);
  const handleTimeCommit = useCallback((time: number) => onChange({ kind: 'absolute', time: Math.max(0, roundOverlayTime(time)) }), [onChange]);

  return (
    <>
      <Row label={t('Start')}>
        <Select style={selectStyle} value={anchor.kind} onChange={handleKindChange}>
          <option value="absolute">{t('At a time')}</option>
          <option value="clip" disabled={clips.length === 0}>{t('Anchored to a clip')}</option>
          <option value="element" disabled={elementTargets.length === 0 && anchor.kind !== 'element'}>{t('Anchored to an overlay')}</option>
        </Select>
      </Row>

      {anchor.kind === 'absolute' && <SecondsField label={t('Time')} value={anchor.time} onCommit={handleTimeCommit} />}

      {anchor.kind !== 'absolute' && (
        <>
          <Row label={anchor.kind === 'clip' ? t('Clip') : t('Overlay')}>
            <Select style={selectStyle} value={anchor.kind === 'clip' ? anchor.clipId : anchor.elementId} onChange={handleTargetChange}>
              {anchor.kind === 'clip'
                ? clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)
                : elementTargets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              {anchor.kind === 'clip' && !clips.some((c) => c.id === anchor.clipId) && <option value={anchor.clipId}>{t('(missing)')}</option>}
              {anchor.kind === 'element' && !elementTargets.some((o) => o.id === anchor.elementId) && <option value={anchor.elementId}>{t('(missing)')}</option>}
            </Select>
          </Row>
          <Row label={t('Edge')}>
            <Select style={selectStyle} value={anchor.edge} onChange={handleEdgeChange}>
              <option value="start">{t('Start')}</option>
              <option value="end">{t('End')}</option>
            </Select>
          </Row>
          <SecondsField label={t('Offset')} value={anchor.offset} onCommit={handleOffsetCommit} allowNegative />
        </>
      )}
    </>
  );
});

function OverlayPanel({ width, overlay, overlays, clips, resolved, missingKinds, mixOverlays, onLocate }: {
  width: number,
  overlay: MixOverlay,
  overlays: MixOverlay[],
  clips: MixClip[],
  resolved: ReadonlyMap<string, ResolvedOverlayTime>,
  /** Files of this overlay that weren't found when opening the project. */
  missingKinds: OverlayFileKind[],
  mixOverlays: UseMixOverlays,
  onLocate: (overlayId: string, kind: OverlayFileKind) => void,
}) {
  const { t } = useTranslation();
  const { update, commitTransient, userRemoveOverlay, userDuplicateOverlay, userMoveOverlayLayer, userChooseOverlayFile, setSelectedOverlayId, outputSize, withErrorHandling } = mixOverlays;
  const { id } = overlay;
  const times = resolved.get(id);

  const set = useCallback((patch: MixOverlayPatch) => update(id, patch), [id, update]);
  const setTransient = useCallback((patch: MixOverlayPatch, transient: boolean) => update(id, patch, { transient }), [id, update]);

  // The draft belongs to one overlay, so selecting another one doesn't show (or apply) it
  const [nameDraftState, setNameDraftState] = useState<{ id: string, text: string }>();
  const nameDraft = nameDraftState?.id === id ? nameDraftState.text : undefined;
  const setNameDraft = useCallback((text: string | undefined) => setNameDraftState(text != null ? { id, text } : undefined), [id]);
  const commitName = useCallback(() => {
    if (nameDraft != null && nameDraft !== overlay.name) set({ name: nameDraft });
    setNameDraft(undefined);
  }, [nameDraft, overlay.name, set, setNameDraft]);

  const byId = useMemo(() => getOverlaysById(overlays), [overlays]);
  const linkedCountdown = useMemo(() => getLinkedCountdown(overlay, byId), [byId, overlay]);
  const timeLinked = linkedCountdown != null;

  const countdownTargets = useMemo(() => overlays.filter((o) => o.type === 'countdown' && (canOverlayDependOn(overlays, id, o.id) || (overlay.type === 'progressBar' && overlay.linkedCountdownId === o.id))), [id, overlay, overlays]);

  const handleAnchorChange = useCallback((newAnchor: OverlayAnchor) => set({ anchor: newAnchor }), [set]);
  const handleDurationCommit = useCallback((duration: number) => set({ duration: roundOverlayTime(duration) }), [set]);

  const handleLinkChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => set({ linkedCountdownId: e.target.value === '' ? undefined : e.target.value }), [set]);

  const box = 'box' in overlay ? overlay.box : undefined;
  const handleBoxChange = useCallback((newBox: OverlayBox) => set({ box: newBox }), [set]);

  const handlePreset = useCallback((preset: OverlayBoxPreset) => {
    if (box == null) return;
    // a text keeps its height (fitted to its lines): "full screen" is the full width, centered
    if (overlay.type === 'text') set({ box: getOverlayBoxPreset(preset === 'fullScreen' ? 'center' : preset, { width: preset === 'fullScreen' ? 1 : Math.min(1, box.width), height: Math.min(1, box.height) }) });
    else set({ box: getOverlayBoxPreset(preset, { width: Math.min(1, box.width), height: Math.min(1, box.height) }) });
  }, [box, overlay.type, set]);

  const fileName = overlay.type === 'image' || overlay.type === 'sound' ? basename(overlay.absolutePath) as string : undefined;

  const warnings = times?.warnings ?? [];

  return (
    <div className="consistent-scrollbar" style={{ width, flexShrink: 0, overflowY: 'auto', background: controlsBackground, transition: darkModeTransition, padding: '.5em .6em', boxSizing: 'border-box', borderLeft: '1px solid var(--gray-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.3em' }}>
        <span style={{ fontSize: '.75em', color: 'var(--gray-11)', flexGrow: 1 }}>{getOverlayTypeLabel(overlay.type)}</span>
        <button type="button" style={{ ...iconButtonStyle, border: 'none', background: 'transparent' }} title={t('Close')} onClick={() => setSelectedOverlayId(undefined)}><FaTimes /></button>
      </div>
      <input
        style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', fontSize: '.9em', marginBottom: '.4em' }}
        value={nameDraft ?? overlay.name}
        onChange={(e) => setNameDraft(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setNameDraft(undefined); }}
        title={t('Name')}
      />

      <div style={{ ...rowStyle, gap: '.25em' }}>
        <button type="button" style={iconButtonStyle} title={t('Duplicate')} onClick={() => userDuplicateOverlay(id)}><FaClone /></button>
        <button type="button" style={iconButtonStyle} title={t('Delete')} onClick={() => userRemoveOverlay(id)}><FaTrash /></button>
        {overlay.type !== 'sound' && (
          <>
            <button type="button" style={iconButtonStyle} title={t('Bring forward')} onClick={() => userMoveOverlayLayer(id, 'up')}><FaArrowUp /></button>
            <button type="button" style={iconButtonStyle} title={t('Send backward')} onClick={() => userMoveOverlayLayer(id, 'down')}><FaArrowDown /></button>
            <button type="button" style={iconButtonStyle} title={t('Bring to front')} onClick={() => userMoveOverlayLayer(id, 'front')}><FaAngleDoubleUp /></button>
            <button type="button" style={iconButtonStyle} title={t('Send to back')} onClick={() => userMoveOverlayLayer(id, 'back')}><FaAngleDoubleDown /></button>
          </>
        )}
      </div>

      {(missingKinds.length > 0 || warnings.length > 0) && (
        <div style={{ fontSize: '.75em', margin: '.4em 0' }}>
          {missingKinds.map((kind) => (
            <div key={kind} style={{ display: 'flex', alignItems: 'center', gap: '.3em', marginBottom: '.2em' }}>
              <FaExclamationTriangle style={{ color: warningColor, flexShrink: 0 }} />
              <span style={{ flexGrow: 1 }}>{kind === 'font' ? t('Font file not found') : t('File not found')}</span>
              <button type="button" style={iconButtonStyle} onClick={() => onLocate(id, kind)}>{t('Locate...')}</button>
            </div>
          ))}
          {warnings.map((w) => (
            <div key={w.type} style={{ display: 'flex', gap: '.3em', marginBottom: '.2em' }}>
              <FaExclamationTriangle style={{ color: warningColor, flexShrink: 0, marginTop: '.15em' }} />
              <span>{getOverlayTimeWarningText(w)}</span>
            </div>
          ))}
        </div>
      )}

      <h4 style={sectionTitleStyle}>{t('Time')}</h4>
      {times != null && (
        <div style={{ fontSize: '.75em', opacity: 0.8, marginBottom: '.4em' }}>
          {t('{{start}} to {{end}}', { start: formatDuration({ seconds: times.start, shorten: true }), end: formatDuration({ seconds: times.end, shorten: true }) })}
        </div>
      )}

      {overlay.type === 'progressBar' && (
        <Row label={t('Link to countdown')}>
          <Select style={selectStyle} value={overlay.linkedCountdownId ?? ''} onChange={handleLinkChange}>
            <option value="">{t('None')}</option>
            {countdownTargets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            {overlay.linkedCountdownId != null && !countdownTargets.some((o) => o.id === overlay.linkedCountdownId) && <option value={overlay.linkedCountdownId}>{t('(missing)')}</option>}
          </Select>
        </Row>
      )}

      {timeLinked ? (
        <div style={{ fontSize: '.75em', opacity: 0.8, marginBottom: '.4em' }}>{t('Takes the start and duration of "{{name}}"', { name: linkedCountdown.name })}</div>
      ) : (
        <>
          <AnchorFields overlayId={id} anchor={overlay.anchor} overlays={overlays} clips={clips} rawStart={times?.rawStart ?? 0} onChange={handleAnchorChange} />
          {overlay.type !== 'sound' && <SecondsField label={t('Duration')} value={overlay.duration} onCommit={handleDurationCommit} />}
        </>
      )}
      {overlay.type === 'sound' && (
        <Row label={t('Duration')}>
          <span style={{ fontSize: '.8em' }}>{times != null && !warnings.some((w) => w.type === 'unknown-duration') ? formatDuration({ seconds: times.rawEnd - times.rawStart, shorten: true }) : t('Unknown')}</span>
        </Row>
      )}

      {box != null && (
        <>
          <h4 style={sectionTitleStyle}>{t('Position and size')}</h4>
          <div style={{ ...rowStyle, gap: '.2em' }}>
            {presets.map((preset) => (
              <button key={preset} type="button" style={{ ...iconButtonStyle, minWidth: '1.8em', justifyContent: 'center' }} title={t('Move to a preset position')} onClick={() => handlePreset(preset)}>{presetLabels[preset]}</button>
            ))}
          </div>
          <PercentField field="x" label={t('Left')} box={box} onChange={handleBoxChange} />
          <PercentField field="y" label={t('Top')} box={box} onChange={handleBoxChange} />
          <PercentField field="width" label={t('Width')} box={box} onChange={handleBoxChange} />
          {/* a text's height follows its lines and size (Text section) */}
          {overlay.type !== 'text' && <PercentField field="height" label={overlay.type === 'countdown' ? t('Text size') : t('Height')} box={box} onChange={handleBoxChange} />}
          <div style={{ fontSize: '.7em', opacity: 0.7, marginBottom: '.3em' }}>
            {t('% of the video frame ({{width}}×{{height}}). You can also drag the box on the frame view.', { width: outputSize.width, height: outputSize.height })}
          </div>
        </>
      )}

      {overlay.type === 'image' && (
        <>
          <h4 style={sectionTitleStyle}>{t('Image')}</h4>
          <Row label={t('File')}>
            <Truncated maxWidth="8em" title={overlay.absolutePath}>{fileName}</Truncated>
            <button type="button" style={iconButtonStyle} title={t('Replace…')} onClick={() => userChooseOverlayFile(id, 'media')}><FaFolderOpen /></button>
          </Row>
          <SecondsField label={t('Fade in')} value={overlay.fadeIn} onCommit={(v) => set({ fadeIn: roundOverlayTime(v) })} />
          <SecondsField label={t('Fade out')} value={overlay.fadeOut} onCommit={(v) => set({ fadeOut: roundOverlayTime(v) })} />
        </>
      )}

      {overlay.type === 'countdown' && (
        <>
          <h4 style={sectionTitleStyle}>{t('Text')}</h4>
          <FontRows overlay={overlay} set={set} setTransient={setTransient} commitTransient={commitTransient} onChooseFont={() => userChooseOverlayFile(id, 'font')} />
          <Row label={t('Decimals')}>
            <Select style={selectStyle} value={overlay.decimals} onChange={(e) => set({ decimals: Number(e.target.value) as 0 | 1 | 2 | 3 })}>
              {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Row>
          <Row label={t('Leading zeros')}>
            <Switch checked={overlay.leadingZeros} onCheckedChange={(checked) => set({ leadingZeros: checked })} />
          </Row>
          <OutlineRows overlay={overlay} set={set} setTransient={setTransient} commitTransient={commitTransient} />
          <SecondsField label={t('Fade out')} value={overlay.fadeOut} onCommit={(v) => set({ fadeOut: roundOverlayTime(v) })} />
          <div style={{ fontSize: '.7em', opacity: 0.7 }}>{t('Border and shadow in px of a 1080p video (scaled for other resolutions).')}</div>
        </>
      )}

      {overlay.type === 'text' && (
        <>
          <h4 style={sectionTitleStyle}>{t('Text')}</h4>
          <TextField key={id} value={overlay.text} onCommit={(text) => set(getTextOverlayLayoutPatch(overlay, { text }))} />
          <Row label={t('Text size')}>
            <NumberField value={Math.round(getTextOverlayFontSize(overlay) * 1000) / 10} step={0.5} min={0.5} max={100} onCommit={(percent) => set(getTextOverlayLayoutPatch(overlay, { fontSize: percent / 100 }))} title={t('% of the video frame height')} />
            <span style={{ fontSize: '.75em' }}>%</span>
          </Row>
          <Row label={t('Line spacing')}>
            <NumberField value={overlay.lineSpacing} step={0.1} min={0} max={5} onCommit={(lineSpacing) => set(getTextOverlayLayoutPatch(overlay, { lineSpacing }))} title={t('Space between lines, as a fraction of the text size')} />
          </Row>
          <FontRows overlay={overlay} set={set} setTransient={setTransient} commitTransient={commitTransient} onChooseFont={() => userChooseOverlayFile(id, 'font')} />
          <OutlineRows overlay={overlay} set={set} setTransient={setTransient} commitTransient={commitTransient} />
          <SecondsField label={t('Fade in')} value={overlay.fadeIn} onCommit={(v) => set({ fadeIn: roundOverlayTime(v) })} />
          <SecondsField label={t('Fade out')} value={overlay.fadeOut} onCommit={(v) => set({ fadeOut: roundOverlayTime(v) })} />
          <div style={{ fontSize: '.7em', opacity: 0.7 }}>{t('Border and shadow in px of a 1080p video (scaled for other resolutions).')}</div>

          <h4 style={sectionTitleStyle}>{t('Entry animation')}</h4>
          <Row label={t('Animation')}>
            <Select style={selectStyle} value={overlay.entry.kind} onChange={(e) => set({ entry: { ...overlay.entry, kind: e.target.value as TextOverlay['entry']['kind'], ...(e.target.value === 'slide' && overlay.entry.from == null && { from: 'left' as const }) } })}>
              <option value="none">{t('None')}</option>
              <option value="slide">{t('Slide in')}</option>
              <option value="typewriter">{t('Typewriter')}</option>
            </Select>
          </Row>
          {overlay.entry.kind === 'slide' && (
            <Row label={t('From')}>
              <Select style={selectStyle} value={overlay.entry.from ?? 'left'} onChange={(e) => set({ entry: { ...overlay.entry, from: e.target.value as 'left' | 'right' | 'top' | 'bottom' } })}>
                <option value="left">{t('Left')}</option>
                <option value="right">{t('Right')}</option>
                <option value="top">{t('Top')}</option>
                <option value="bottom">{t('Bottom')}</option>
              </Select>
            </Row>
          )}
          {overlay.entry.kind !== 'none' && <SecondsField label={t('Duration')} value={overlay.entry.duration} onCommit={(v) => set({ entry: { ...overlay.entry, duration: roundOverlayTime(v) } })} />}
        </>
      )}

      {overlay.type === 'progressBar' && (
        <>
          <h4 style={sectionTitleStyle}>{t('Bar')}</h4>
          <Row label={t('Fill color')}>
            <ColorField value={overlay.fillColor} withAlpha onChange={(fillColor, transient) => setTransient({ fillColor }, transient)} onCommit={commitTransient} />
          </Row>
          <Row label={t('Background')}>
            <ColorField value={overlay.backgroundColor} withAlpha onChange={(backgroundColor, transient) => setTransient({ backgroundColor }, transient)} onCommit={commitTransient} />
          </Row>
          <Row label={t('Border (px)')}>
            <NumberField value={overlay.border.width} step={1} min={0} onCommit={(v) => set({ border: { ...overlay.border, width: v } })} />
            <ColorField value={overlay.border.color} onChange={(color, transient) => setTransient({ border: { ...overlay.border, color } }, transient)} onCommit={commitTransient} />
          </Row>
          <Row label={t('Direction')}>
            <Select style={selectStyle} value={overlay.direction} onChange={(e) => set({ direction: e.target.value as typeof progressBarDirections[number] })}>
              <option value="ltr">{t('Left to right')}</option>
              <option value="rtl">{t('Right to left')}</option>
              <option value="btt">{t('Bottom to top')}</option>
              <option value="ttb">{t('Top to bottom')}</option>
            </Select>
          </Row>
          <Row label={t('Mode')}>
            <Select style={selectStyle} value={overlay.mode} onChange={(e) => set({ mode: e.target.value as 'fill' | 'empty' })}>
              <option value="fill">{t('Fills up')}</option>
              <option value="empty">{t('Empties')}</option>
            </Select>
          </Row>
        </>
      )}

      {isStyledOverlay(overlay) && (
        <>
          <h4 style={sectionTitleStyle}>{t('Style')}</h4>
          <OverlayStylePresets overlay={overlay} withErrorHandling={withErrorHandling} onApply={set} />
        </>
      )}

      {overlay.type === 'sound' && (
        <>
          <h4 style={sectionTitleStyle}>{t('Sound')}</h4>
          <Row label={t('File')}>
            <Truncated maxWidth="8em" title={overlay.absolutePath}>{fileName}</Truncated>
            <button type="button" style={iconButtonStyle} title={t('Replace…')} onClick={() => userChooseOverlayFile(id, 'media')}><FaFolderOpen /></button>
          </Row>
          <Row label={t('Volume')}>
            <NumberField value={overlay.gainDb} step={0.5} min={-40} max={20} onCommit={(v) => set({ gainDb: v })} />
            <span style={{ fontSize: '.75em' }}>{t('dB')}</span>
          </Row>
          <div style={{ fontSize: '.7em', opacity: 0.7 }}>{t('0 dB = as loud as the clips')}</div>
        </>
      )}
    </div>
  );
}

export default memo(OverlayPanel);
