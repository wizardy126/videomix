import type { ChangeEventHandler, CSSProperties, FormEventHandler } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FaExclamationTriangle, FaFolderOpen, FaGripVertical, FaMusic, FaTimes } from 'react-icons/fa';
import type { DragEndEvent } from '@dnd-kit/core';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { nanoid } from 'nanoid';

import Button from '../../components/Button';
import Switch from '../../components/Switch';
import Truncated from '../../components/Truncated';
import { showOpenDialog } from '../../dialogs';
import mainApi from '../../mainApi';
import { warningColor } from '../../colors';
import type { EditOptions } from '../hooks/useMixProject';
import type { MixMusicPlaylist, MixMusicTrack } from '../types';
import { createMusicTrack } from '../workspace';

const { basename, dirname } = window.require('node:path');

/** Audio containers accepted for the music tracks (01-requisitos §5). */
const MUSIC_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'];

const detailsStyle: CSSProperties = { opacity: 0.75, fontSize: '.85em', marginTop: '.2em' };
const rowStyle: CSSProperties = { display: 'block', marginBottom: '1em' };
const inlineRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '.6em', marginBottom: '1em', flexWrap: 'wrap' };
const iconButtonStyle: CSSProperties = { font: 'inherit', fontSize: '.8em', padding: '.2em .4em', border: '1px solid var(--gray-7)', borderRadius: '.3em', background: 'var(--gray-3)', color: 'var(--gray-12)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '.3em' };

// eslint-disable-next-line react/display-name
const TrackRow = memo(({ track, missing, onVolumeChange, onRemove, onLocate }: {
  track: MixMusicTrack,
  missing: boolean,
  onVolumeChange: (trackId: string, volumeDb: number, options?: EditOptions) => void,
  onRemove: (trackId: string) => void,
  onLocate: (trackId: string) => void,
}) => {
  const { t } = useTranslation();
  const sortable = useSortable({ id: track.id, transition: { duration: 150, easing: 'ease-in-out' } });
  const setRef = useCallback((node: HTMLDivElement | null) => sortable.setNodeRef(node), [sortable]);

  const style = useMemo<CSSProperties>(() => ({
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    position: 'relative',
    zIndex: sortable.isDragging ? 1 : undefined,
    padding: '.3em .5em',
    marginBottom: '.3em',
    background: 'var(--gray-3)',
    border: '1px solid var(--gray-6)',
    borderRadius: '.3em',
  }), [sortable.isDragging, sortable.transform, sortable.transition]);

  const handleVolumeInput = useCallback<FormEventHandler<HTMLInputElement>>((e) => onVolumeChange(track.id, Number(e.currentTarget.value), { transient: true }), [onVolumeChange, track.id]);
  const handleVolumeCommit = useCallback<ChangeEventHandler<HTMLInputElement>>((e) => onVolumeChange(track.id, Number(e.target.value)), [onVolumeChange, track.id]);

  return (
    <div ref={setRef} style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5em' }}>
        <div
          // eslint-disable-next-line react/jsx-props-no-spreading
          {...sortable.attributes}
          // eslint-disable-next-line react/jsx-props-no-spreading
          {...sortable.listeners}
          role="button"
          tabIndex={-1}
          style={{ cursor: 'grab', display: 'flex', alignItems: 'center', color: 'var(--gray-10)' }}
          title={t('Drag to reorder')}
        >
          <FaGripVertical />
        </div>
        <FaMusic style={{ flexShrink: 0 }} />
        <Truncated maxWidth="14em" title={track.absolutePath}>{basename(track.absolutePath) as string}</Truncated>
        <div style={{ flexGrow: 1 }} />
        <button type="button" style={{ ...iconButtonStyle, border: 'none', background: 'transparent' }} title={t('Remove track')} onClick={() => onRemove(track.id)}><FaTimes /></button>
      </div>

      {missing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.3em', fontSize: '.85em', margin: '.3em 0' }}>
          <FaExclamationTriangle style={{ color: warningColor, flexShrink: 0 }} />
          <span style={{ flexGrow: 1 }}>{t('File not found')}</span>
          <button type="button" style={iconButtonStyle} onClick={() => onLocate(track.id)}>{t('Locate...')}</button>
        </div>
      )}

      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
      <label style={{ display: 'block', fontSize: '.9em' }}>
        {t('Volume')}: {t('{{db}} dB', { db: track.volumeDb.toFixed(1) })}<br />
        <input type="range" min={-30} max={6} step={0.5} style={{ width: '100%' }} value={track.volumeDb} onInput={handleVolumeInput} onChange={handleVolumeCommit} />
      </label>
    </div>
  );
});

/**
 * Music section of the mix settings (C1, C2): the playlist (add several files, drag to reorder, volume per track,
 * remove, and "Locate..." for the files that are missing), the crossfade, "Repeat the list" and the ducking.
 *
 * Controlled like MixSettingsDialog: every edit is a new playlist through `onChange`, sliders send `{ transient: true }`
 * while dragging and a final call on release.
 */
function MixMusicSection({ playlist, onChange }: {
  playlist: MixMusicPlaylist,
  onChange: (newPlaylist: MixMusicPlaylist, options?: EditOptions) => void,
}) {
  const { t } = useTranslation();
  const { tracks } = playlist;

  // Tracks whose file isn't there (checked when shown and whenever the paths change)
  const [missingIds, setMissingIds] = useState<ReadonlySet<string>>(new Set());
  const pathsKey = tracks.map((track) => `${track.id}\n${track.absolutePath}`).join('\n');
  useEffect(() => {
    let canceled = false;
    (async () => {
      const missing = await Promise.all(tracks.map(async (track) => (await mainApi.pathExists(track.absolutePath) ? undefined : track.id)));
      if (!canceled) setMissingIds(new Set(missing.filter((id) => id != null)));
    })().catch((err) => console.error('Failed to check the music files', err));
    return () => { canceled = true; };
  // only when a path changes, not on every volume drag
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey]);

  const setTracks = useCallback((newTracks: MixMusicTrack[], options?: EditOptions) => onChange({ ...playlist, tracks: newTracks }, options), [onChange, playlist]);

  const handleAddClick = useCallback(async () => {
    const { canceled, filePaths } = await showOpenDialog({
      title: t('Choose music files'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: t('Audio files'), extensions: MUSIC_EXTENSIONS }],
    });
    if (canceled || filePaths.length === 0) return;
    // Same absolute path for both fields at pick time; saving the project relativizes `path` (projectFile.ts)
    setTracks([...tracks, ...filePaths.map((filePath) => createMusicTrack({ id: nanoid(), filePath }))]);
  }, [setTracks, t, tracks]);

  const handleVolumeChange = useCallback((trackId: string, volumeDb: number, options?: EditOptions) => {
    setTracks(tracks.map((track) => (track.id === trackId ? { ...track, volumeDb } : track)), options);
  }, [setTracks, tracks]);

  const handleRemove = useCallback((trackId: string) => setTracks(tracks.filter((track) => track.id !== trackId)), [setTracks, tracks]);

  const handleLocate = useCallback(async (trackId: string) => {
    const track = tracks.find((tr) => tr.id === trackId);
    if (track == null) return;
    const { canceled, filePaths } = await showOpenDialog({ properties: ['openFile'], defaultPath: dirname(track.absolutePath), title: t('Locate {{name}}', { name: basename(track.absolutePath) }) });
    const [newPath] = filePaths;
    if (canceled || newPath == null) return;
    setTracks(tracks.map((tr) => (tr.id === trackId ? { ...tr, path: newPath, absolutePath: newPath } : tr)));
  }, [setTracks, t, tracks]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const handleDragEnd = useCallback(({ active, over }: DragEndEvent) => {
    if (over == null || active.id === over.id) return;
    const ids = tracks.map((track) => track.id);
    setTracks(arrayMove(tracks, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  }, [setTracks, tracks]);

  const handleCrossfadeInput = useCallback<FormEventHandler<HTMLInputElement>>((e) => onChange({ ...playlist, crossfade: Number(e.currentTarget.value) }, { transient: true }), [onChange, playlist]);
  const handleCrossfadeCommit = useCallback<ChangeEventHandler<HTMLInputElement>>((e) => onChange({ ...playlist, crossfade: Number(e.target.value) }), [onChange, playlist]);
  const handleLoopChange = useCallback((checked: boolean) => onChange({ ...playlist, loop: checked }), [onChange, playlist]);
  const handleDuckingChange = useCallback((checked: boolean) => onChange({ ...playlist, ducking: { ...playlist.ducking, enabled: checked } }), [onChange, playlist]);
  const handleDuckingAmountInput = useCallback<FormEventHandler<HTMLInputElement>>((e) => onChange({ ...playlist, ducking: { ...playlist.ducking, amountDb: Number(e.currentTarget.value) } }, { transient: true }), [onChange, playlist]);
  const handleDuckingAmountCommit = useCallback<ChangeEventHandler<HTMLInputElement>>((e) => onChange({ ...playlist, ducking: { ...playlist.ducking, amountDb: Number(e.target.value) } }), [onChange, playlist]);

  return (
    <>
      {tracks.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
          <SortableContext items={tracks} strategy={verticalListSortingStrategy}>
            <div style={{ marginBottom: '.5em' }}>
              {tracks.map((track) => (
                <TrackRow key={track.id} track={track} missing={missingIds.has(track.id)} onVolumeChange={handleVolumeChange} onRemove={handleRemove} onLocate={handleLocate} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <div style={{ marginBottom: '1em' }}>
        <Button onClick={handleAddClick}>
          <FaFolderOpen style={{ verticalAlign: 'middle', marginRight: '.3em' }} />{t('Add music files…')}
        </Button>
        {tracks.length > 0 && <div style={detailsStyle}>{t('Played in this order, drag to reorder. Volume: 0 dB = as loud as the clips.')}</div>}
      </div>

      {tracks.length > 0 && (
        <>
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label style={rowStyle}>
            {t('Crossfade between tracks')}: {t('{{seconds}}s', { seconds: playlist.crossfade.toFixed(1) })}<br />
            <input type="range" min={0} max={10} step={0.5} style={{ width: '100%' }} value={playlist.crossfade} onInput={handleCrossfadeInput} onChange={handleCrossfadeCommit} />
          </label>

          <div style={inlineRowStyle}>
            <span>{t('Repeat the list if shorter than the video')}</span>
            <Switch checked={playlist.loop} onCheckedChange={handleLoopChange} />
          </div>

          <div style={{ ...inlineRowStyle, marginBottom: '.3em' }}>
            <span>{t('Lower the music while clips sound (ducking)')}</span>
            <Switch checked={playlist.ducking.enabled} onCheckedChange={handleDuckingChange} />
          </div>
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
          <label style={{ ...rowStyle, opacity: playlist.ducking.enabled ? undefined : 0.5 }}>
            {t('Ducking amount')}: {t('{{db}} dB', { db: playlist.ducking.amountDb.toFixed(0) })}<br />
            <input type="range" min={-30} max={-3} step={1} style={{ width: '100%' }} disabled={!playlist.ducking.enabled} value={playlist.ducking.amountDb} onInput={handleDuckingAmountInput} onChange={handleDuckingAmountCommit} />
            <div style={detailsStyle}>{t('The music comes back up smoothly in the silences.')}</div>
          </label>
        </>
      )}
    </>
  );
}

export default memo(MixMusicSection);
