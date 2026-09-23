import type { ChangeEventHandler, FormEventHandler, ReactNode } from 'react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FaFolderOpen, FaMusic, FaRandom, FaTimes } from 'react-icons/fa';
import { nanoid } from 'nanoid';

import * as Dialog from '../../components/Dialog';
import Button from '../../components/Button';
import Select from '../../components/Select';
import Switch from '../../components/Switch';
import Truncated from '../../components/Truncated';
import { showOpenDialog } from '../../dialogs';
import type { EditOptions } from '../hooks/useMixProject';
import { getOutputSize, mixFpsValues, mixOutputResolutions, mixPresets, transitionTypes } from '../types';
import type { MixOutput, MixOutputResolution, MixSettings, TransitionType } from '../types';
import { replaceMusic } from '../workspace';

const { basename } = window.require('node:path');

/** Audio containers accepted for the music track (01-requisitos §5). */
const MUSIC_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'];

// e.g. "1080p (1920×1080)", "4K (3840×2160)"
function getResolutionLabel(output: MixOutput) {
  const { width, height } = getOutputSize(output);
  return `${output.resolution === '2160' ? '4K' : `${output.resolution}p`} (${width}×${height})`;
}

const transitionLabels: Record<TransitionType, string> = {
  fade: 'Fade',
  dissolve: 'Dissolve',
  fadeblack: 'Fade to black',
  wipeleft: 'Wipe left',
  wiperight: 'Wipe right',
  wipeup: 'Wipe up',
  wipedown: 'Wipe down',
  slideleft: 'Slide left',
  slideright: 'Slide right',
  slideup: 'Slide up',
  slidedown: 'Slide down',
  smoothleft: 'Smooth left',
  smoothright: 'Smooth right',
  smoothup: 'Smooth up',
  smoothdown: 'Smooth down',
  circleopen: 'Circle open',
};

const detailsStyle = { opacity: 0.75, fontSize: '.85em', marginTop: '.2em' };
const rowStyle = { display: 'block', marginBottom: '1em' };
const inlineRowStyle = { display: 'flex', alignItems: 'center', gap: '.6em', marginBottom: '1em', flexWrap: 'wrap' as const };

function Section({ title, children }: { title: string, children: ReactNode }) {
  return (
    <div style={{ marginBottom: '1.5em' }}>
      <h4 style={{ margin: '0 0 .6em 0', borderBottom: '1px solid var(--gray-6)', paddingBottom: '.3em' }}>{title}</h4>
      {children}
    </div>
  );
}

// clamp to a non-negative even number (yuv420p needs even widths, see validateMixProject)
function toEvenNonNegative(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value / 2) * 2);
}

/**
 * Dialog to edit all `MixSettings` of the project. Controlled: mount it with `open`/`onOpenChange` and
 * pass the project's `settings`; every edit goes through `onChange`, which the caller normally wires to
 * `useMixProject().updateSettings` so it lands in undo history and marks the project dirty.
 *
 * Continuous controls (CRF, transition duration, music volume) send `{ transient: true }` while dragging
 * and a final call without it on release, matching `useMixProject`'s transient-edit convention: the caller
 * doesn't need to call `commitTransient` itself (a non-transient `updateSettings` call already does).
 *
 * `onPickMusicFile` lets the caller supply its own music file picker (e.g. to reuse app-level dialog
 * state); if omitted, an audio-filtered `showOpenDialog` is used.
 */
function MixSettingsDialog({ open, onOpenChange, settings, onChange, onPickMusicFile }: {
  open: boolean,
  onOpenChange: (isOpen: boolean) => void,
  settings: MixSettings,
  onChange: (patch: Partial<MixSettings>, options?: EditOptions) => void,
  onPickMusicFile?: (() => Promise<string | undefined>) | undefined,
}) {
  const { t } = useTranslation();

  const handleResolutionChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ output: { ...settings.output, resolution: e.target.value as MixOutputResolution } });
  }, [onChange, settings.output]);

  const handleFpsChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ fps: Number(e.target.value) as MixSettings['fps'] });
  }, [onChange]);

  const handleCrfInput = useCallback<FormEventHandler<HTMLInputElement>>((e) => {
    onChange({ crf: Number(e.currentTarget.value) }, { transient: true });
  }, [onChange]);

  const handleCrfCommit = useCallback<ChangeEventHandler<HTMLInputElement>>((e) => {
    onChange({ crf: Number(e.target.value) });
  }, [onChange]);

  const handlePresetChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ preset: e.target.value as MixSettings['preset'] });
  }, [onChange]);

  const handleMaxColumnsChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ maxColumns: Number(e.target.value) });
  }, [onChange]);

  const handleGapWidthChange = useCallback<ChangeEventHandler<HTMLInputElement>>((e) => {
    onChange({ gap: { ...settings.gap, width: toEvenNonNegative(Number(e.target.value)) } });
  }, [onChange, settings.gap]);

  const handleGapColorChange = useCallback<ChangeEventHandler<HTMLInputElement>>((e) => {
    onChange({ gap: { ...settings.gap, color: e.target.value } });
  }, [onChange, settings.gap]);

  const handleFillModeChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ fill: { ...settings.fill, mode: e.target.value as MixSettings['fill']['mode'] } });
  }, [onChange, settings.fill]);

  const handleFillColorChange = useCallback<ChangeEventHandler<HTMLInputElement>>((e) => {
    onChange({ fill: { ...settings.fill, color: e.target.value } });
  }, [onChange, settings.fill]);

  const handleOrderModeChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ order: { ...settings.order, mode: e.target.value as MixSettings['order']['mode'] } });
  }, [onChange, settings.order]);

  const handleShuffleClick = useCallback(() => {
    onChange({ order: { ...settings.order, seed: Math.floor(Math.random() * 2 ** 31) } });
  }, [onChange, settings.order]);

  const handleReorderWindowChange = useCallback<ChangeEventHandler<HTMLInputElement>>((e) => {
    onChange({ reorderWindow: Math.max(0, Math.min(10, Math.round(Number(e.target.value)))) });
  }, [onChange]);

  const handleTransitionTypeChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ transition: { ...settings.transition, type: e.target.value as TransitionType } });
  }, [onChange, settings.transition]);

  const handleTransitionDurationInput = useCallback<FormEventHandler<HTMLInputElement>>((e) => {
    onChange({ transition: { ...settings.transition, duration: Number(e.currentTarget.value) } }, { transient: true });
  }, [onChange, settings.transition]);

  const handleTransitionDurationCommit = useCallback<ChangeEventHandler<HTMLInputElement>>((e) => {
    onChange({ transition: { ...settings.transition, duration: Number(e.target.value) } });
  }, [onChange, settings.transition]);

  const handleFadeInOutChange = useCallback((checked: boolean) => {
    onChange({ fadeInOut: checked });
  }, [onChange]);

  const pickMusicFile = useCallback(async () => {
    if (onPickMusicFile) return onPickMusicFile();
    const { canceled, filePaths } = await showOpenDialog({
      title: t('Choose a music file'),
      properties: ['openFile'],
      filters: [{ name: t('Audio files'), extensions: MUSIC_EXTENSIONS }],
    });
    const [filePath] = filePaths;
    if (canceled || filePath == null) return undefined;
    return filePath;
  }, [onPickMusicFile, t]);

  // Until the playlist UI (T27), this section edits a single track: the first one
  const { musicPlaylist } = settings;
  const [music] = musicPlaylist.tracks;

  const handleChooseMusicClick = useCallback(async () => {
    const filePath = await pickMusicFile();
    if (filePath == null) return;
    // Same absolute path for both fields at pick time; saving the project relativizes `path` (projectFile.ts)
    onChange({ musicPlaylist: replaceMusic(musicPlaylist, { id: nanoid(), filePath, loopIfNew: true }) });
  }, [musicPlaylist, onChange, pickMusicFile]);

  const handleRemoveMusicClick = useCallback(() => {
    onChange({ musicPlaylist: { ...musicPlaylist, tracks: [] } });
  }, [musicPlaylist, onChange]);

  const setMusicVolume = useCallback((volumeDb: number, options?: EditOptions) => {
    if (music == null) return;
    onChange({ musicPlaylist: { ...musicPlaylist, tracks: musicPlaylist.tracks.map((track) => (track === music ? { ...track, volumeDb } : track)) } }, options);
  }, [music, musicPlaylist, onChange]);

  const handleMusicVolumeInput = useCallback<FormEventHandler<HTMLInputElement>>((e) => {
    setMusicVolume(Number(e.currentTarget.value), { transient: true });
  }, [setMusicVolume]);

  const handleMusicVolumeCommit = useCallback<ChangeEventHandler<HTMLInputElement>>((e) => {
    setMusicVolume(Number(e.target.value));
  }, [setMusicVolume]);

  const handleMusicLoopChange = useCallback((checked: boolean) => {
    onChange({ musicPlaylist: { ...musicPlaylist, loop: checked } });
  }, [musicPlaylist, onChange]);

  const musicFileName = useMemo(() => (music != null ? basename(music.absolutePath) as string : undefined), [music]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ width: '36em', maxHeight: '85vh', overflowY: 'auto' }} aria-describedby={undefined}>
          <Dialog.Title>{t('Mix settings')}</Dialog.Title>

          <Section title={t('Output')}>
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label style={rowStyle}>
              {t('Resolution')}<br />
              <Select value={settings.output.resolution} onChange={handleResolutionChange}>
                {mixOutputResolutions.map((resolution) => (
                  <option key={resolution} value={resolution}>{getResolutionLabel({ ...settings.output, resolution })}</option>
                ))}
              </Select>
            </label>

            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label style={rowStyle}>
              {t('Frame rate')}<br />
              <Select value={settings.fps} onChange={handleFpsChange}>
                {mixFpsValues.map((fps) => <option key={fps} value={fps}>{t('{{fps}} fps', { fps })}</option>)}
              </Select>
            </label>

            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label style={rowStyle}>
              {t('Quality (CRF)')}: {settings.crf}<br />
              <input type="range" min={0} max={51} step={1} style={{ width: '100%' }} value={settings.crf} onInput={handleCrfInput} onChange={handleCrfCommit} />
              <div style={detailsStyle}>{t('Lower is higher quality and a larger file. 18–23 is typically visually lossless.')}</div>
            </label>

            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label style={rowStyle}>
              {t('Encoding speed preset')}<br />
              <Select value={settings.preset} onChange={handlePresetChange}>
                {mixPresets.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
              </Select>
              <div style={detailsStyle}>{t('Slower presets compress better at the same quality, but take longer to render.')}</div>
            </label>
          </Section>

          <Section title={t('Composition')}>
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label style={rowStyle}>
              {t('Maximum visible columns')}<br />
              <Select value={settings.maxColumns} onChange={handleMaxColumnsChange}>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </label>

            <div style={inlineRowStyle}>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label>
                {t('Gap between columns (px)')}<br />
                <input type="number" min={0} step={2} style={{ width: '6em' }} value={settings.gap.width} onChange={handleGapWidthChange} />
              </label>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label>
                {t('Gap color')}<br />
                <input type="color" value={settings.gap.color} onChange={handleGapColorChange} />
              </label>
            </div>

            <div style={inlineRowStyle}>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label>
                {t('Fill empty space with')}<br />
                <Select value={settings.fill.mode} onChange={handleFillModeChange}>
                  <option value="blur">{t('Blurred background')}</option>
                  <option value="color">{t('Solid color')}</option>
                </Select>
              </label>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label>
                {t('Fill color')}<br />
                <input type="color" disabled={settings.fill.mode !== 'color'} value={settings.fill.color} onChange={handleFillColorChange} />
              </label>
            </div>
          </Section>

          <Section title={t('Order')}>
            <div style={inlineRowStyle}>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label>
                {t('Clip order')}<br />
                <Select value={settings.order.mode} onChange={handleOrderModeChange}>
                  <option value="list">{t('List order')}</option>
                  <option value="random">{t('Random')}</option>
                </Select>
              </label>
              {settings.order.mode === 'random' && (
                <Button onClick={handleShuffleClick} title={t('Pick a new random seed')}>
                  <FaRandom style={{ verticalAlign: 'middle', marginRight: '.3em' }} />{t('Shuffle again')}
                </Button>
              )}
            </div>

            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label style={rowStyle}>
              {t('Reorder window (± positions)')}: {settings.reorderWindow}<br />
              <input type="range" min={0} max={10} step={1} style={{ width: '100%' }} value={settings.reorderWindow} onChange={handleReorderWindowChange} />
              <div style={detailsStyle}>{t('How far a clip may move from its position in the list to fit the layout.')}</div>
            </label>
          </Section>

          <Section title={t('Transition')}>
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label style={rowStyle}>
              {t('Transition type')}<br />
              <Select value={settings.transition.type} onChange={handleTransitionTypeChange}>
                {transitionTypes.map((type) => <option key={type} value={type}>{t(transitionLabels[type])}</option>)}
              </Select>
            </label>

            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label style={rowStyle}>
              {t('Transition duration')}: {t('{{seconds}}s', { seconds: settings.transition.duration.toFixed(1) })}<br />
              <input type="range" min={0.1} max={2} step={0.1} style={{ width: '100%' }} value={settings.transition.duration} onInput={handleTransitionDurationInput} onChange={handleTransitionDurationCommit} />
            </label>

            <div style={inlineRowStyle}>
              <span>{t('Fade in/out at the start/end of the video')}</span>
              <Switch checked={settings.fadeInOut} onCheckedChange={handleFadeInOutChange} />
            </div>
          </Section>

          <Section title={t('Music')}>
            {music == null ? (
              <Button onClick={handleChooseMusicClick}>
                <FaFolderOpen style={{ verticalAlign: 'middle', marginRight: '.3em' }} />{t('Choose music file…')}
              </Button>
            ) : (
              <>
                <div style={inlineRowStyle}>
                  <FaMusic style={{ verticalAlign: 'middle' }} />
                  <Truncated maxWidth="16em" title={music.absolutePath}>{musicFileName}</Truncated>
                  <Button onClick={handleRemoveMusicClick} title={t('Remove music')}><FaTimes /></Button>
                </div>

                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                <label style={rowStyle}>
                  {t('Music volume')}: {t('{{db}} dB', { db: music.volumeDb.toFixed(1) })}<br />
                  <input type="range" min={-30} max={6} step={0.5} style={{ width: '100%' }} value={music.volumeDb} onInput={handleMusicVolumeInput} onChange={handleMusicVolumeCommit} />
                  <div style={detailsStyle}>{t('0 dB = as loud as the clips')}</div>
                </label>

                <div style={inlineRowStyle}>
                  <span>{t('Loop if shorter than the video')}</span>
                  <Switch checked={musicPlaylist.loop} onCheckedChange={handleMusicLoopChange} />
                </div>
              </>
            )}
          </Section>

          <Dialog.ButtonRow>
            <Dialog.Close asChild>
              <Button>{t('Close')}</Button>
            </Dialog.Close>
          </Dialog.ButtonRow>

          <Dialog.CloseButton />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default memo(MixSettingsDialog);
