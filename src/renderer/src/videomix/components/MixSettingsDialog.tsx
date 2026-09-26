import type { ChangeEventHandler, FocusEventHandler, KeyboardEventHandler, ReactNode } from 'react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FaRandom } from 'react-icons/fa';

import * as Dialog from '../../components/Dialog';
import Button from '../../components/Button';
import Checkbox from '../../components/Checkbox';
import Select from '../../components/Select';
import Switch from '../../components/Switch';
import { formatDuration, parseDuration } from '../../util/duration';
import type { EditOptions } from '../hooks/useMixProject';
import useEncoderAvailability from '../hooks/useEncoderAvailability';
import { getOutputSize, mixEncoderCodecs, mixEncoderHardware, mixFpsValues, mixOutputAspects, mixOutputResolutions, mixPresets, transitionTypes } from '../types';
import type { MixEncoderCodec, MixEncoderHardware, MixMusicPlaylist, MixOutput, MixOutputAspect, MixOutputResolution, MixPlanPriority, MixSettings, TransitionType } from '../types';
import MixMusicSection from './MixMusicSection';
import { ColorInput, NumberField, RangeInput } from './TransientInputs';

// E4: sensible starting point when the switch is turned on with no previous value.
const DEFAULT_MAX_DURATION = 60;
// E8: the window "Unlimited" goes back to when unchecked with no previous number (the default window).
const DEFAULT_REORDER_WINDOW = 3;

// e.g. "1080p (1920×1080)", "4K (3840×2160)"
function getResolutionLabel(output: MixOutput) {
  const { width, height } = getOutputSize(output);
  return `${output.resolution === '2160' ? '4K' : `${output.resolution}p`} (${width}×${height})`;
}

// B5: 9:16 stacks full-width rows, 1:1 picks columns or rows, whichever fits the clips better (T29)
const aspectLabels: Record<MixOutputAspect, string> = {
  '16:9': '16:9 (landscape, clips side by side)',
  '9:16': '9:16 (vertical, clips stacked)',
  '1:1': '1:1 (square, side by side or stacked)',
};

const codecLabels: Record<MixEncoderCodec, string> = {
  h264: 'H.264',
  h265: 'H.265 (HEVC)',
};

const hardwareLabels: Record<MixEncoderHardware, string> = {
  auto: 'Auto (hardware if available)',
  none: 'Software only',
  nvenc: 'NVIDIA NVENC',
  qsv: 'Intel Quick Sync',
  videotoolbox: 'Apple VideoToolbox',
  vaapi: 'VAAPI',
};

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
 * Continuous controls (CRF, transition duration, music volumes…) send `{ transient: true }` while dragging
 * and a final call without it on release, matching `useMixProject`'s transient-edit convention: the caller
 * doesn't need to call `commitTransient` itself (a non-transient `updateSettings` call already does).
 *
 * The Music section (playlist and ducking, T27) is MixMusicSection.
 */
function MixSettingsDialog({ open, onOpenChange, settings, onChange }: {
  open: boolean,
  onOpenChange: (isOpen: boolean) => void,
  settings: MixSettings,
  onChange: (patch: Partial<MixSettings>, options?: EditOptions) => void,
}) {
  const { t } = useTranslation();

  // E4: local draft of the "m:ss" field, so an in-progress edit (e.g. "1:3") isn't clobbered by re-formatting on
  // every keystroke; committed (parsed) on blur or Enter, discarded on Escape.
  const [maxDurationText, setMaxDurationText] = useState<string>();
  const maxDurationEnabled = settings.maxDuration != null;

  const handleMaxDurationToggle = useCallback((checked: boolean) => {
    onChange({ maxDuration: checked ? (settings.maxDuration ?? DEFAULT_MAX_DURATION) : undefined });
  }, [onChange, settings.maxDuration]);

  const commitMaxDurationText = useCallback((text: string) => {
    const seconds = parseDuration(text);
    if (seconds != null && seconds > 0) onChange({ maxDuration: seconds });
    setMaxDurationText(undefined);
  }, [onChange]);

  const handleMaxDurationBlur = useCallback<FocusEventHandler<HTMLInputElement>>((e) => {
    if (maxDurationText != null) commitMaxDurationText(e.target.value);
  }, [commitMaxDurationText, maxDurationText]);

  const handleMaxDurationKeyDown = useCallback<KeyboardEventHandler<HTMLInputElement>>((e) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    else if (e.key === 'Escape') { setMaxDurationText(undefined); e.currentTarget.blur(); }
  }, []);

  // Hardware encoders actually detected on this machine (T25); undefined while still detecting.
  const availableEncoders = useEncoderAvailability();
  const isHardwareAvailable = useCallback((hardware: MixEncoderHardware) => (
    availableEncoders?.some((c) => c.codec === settings.encoder.codec && c.hardware === hardware) ?? false
  ), [availableEncoders, settings.encoder.codec]);

  const handleCodecChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ encoder: { ...settings.encoder, codec: e.target.value as MixEncoderCodec } });
  }, [onChange, settings.encoder]);

  const handleEncoderHardwareChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ encoder: { ...settings.encoder, hardware: e.target.value as MixEncoderHardware } });
  }, [onChange, settings.encoder]);

  const handleAspectChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ output: { ...settings.output, aspect: e.target.value as MixOutputAspect } });
  }, [onChange, settings.output]);

  const handleResolutionChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ output: { ...settings.output, resolution: e.target.value as MixOutputResolution } });
  }, [onChange, settings.output]);

  const handleFpsChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ fps: Number(e.target.value) as MixSettings['fps'] });
  }, [onChange]);

  const handleCrfInput = useCallback((crf: number) => {
    onChange({ crf }, { transient: true });
  }, [onChange]);

  const handleCrfCommit = useCallback((crf: number) => {
    onChange({ crf });
  }, [onChange]);

  const handlePresetChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ preset: e.target.value as MixSettings['preset'] });
  }, [onChange]);

  const handleMaxColumnsChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ maxColumns: Number(e.target.value) });
  }, [onChange]);

  // T54 (G4/T51 follow-up): NumberField applies one typed value on blur/Enter, not one undo step per digit
  const handleGapWidthCommit = useCallback((width: number) => {
    onChange({ gap: { ...settings.gap, width: toEvenNonNegative(width) } });
  }, [onChange, settings.gap]);

  const handleGapColorInput = useCallback((color: string) => {
    onChange({ gap: { ...settings.gap, color } }, { transient: true });
  }, [onChange, settings.gap]);

  const handleGapColorCommit = useCallback((color: string) => {
    onChange({ gap: { ...settings.gap, color } });
  }, [onChange, settings.gap]);

  const handleFillModeChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ fill: { ...settings.fill, mode: e.target.value as MixSettings['fill']['mode'] } });
  }, [onChange, settings.fill]);

  const handleFillColorInput = useCallback((color: string) => {
    onChange({ fill: { ...settings.fill, color } }, { transient: true });
  }, [onChange, settings.fill]);

  const handleFillColorCommit = useCallback((color: string) => {
    onChange({ fill: { ...settings.fill, color } });
  }, [onChange, settings.fill]);

  // A7 (T47): on by default (01-requisitos §12)
  const handleAutoCropBlackBarsChange = useCallback((checked: boolean) => {
    onChange({ autoCropBlackBars: checked });
  }, [onChange]);

  const handleOrderModeChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ order: { ...settings.order, mode: e.target.value as MixSettings['order']['mode'] } });
  }, [onChange, settings.order]);

  const handleShuffleClick = useCallback(() => {
    onChange({ order: { ...settings.order, seed: Math.floor(Math.random() * 2 ** 31) } });
  }, [onChange, settings.order]);

  // E8: numeric window, or unlimited. The last number is kept to go back to it when "Unlimited" is unchecked.
  const reorderUnlimited = settings.reorderWindow === 'unlimited';
  const [lastReorderWindow, setLastReorderWindow] = useState(() => (typeof settings.reorderWindow === 'number' ? settings.reorderWindow : DEFAULT_REORDER_WINDOW));
  const reorderWindowNumber = typeof settings.reorderWindow === 'number' ? settings.reorderWindow : lastReorderWindow;

  // T54: an integer ≥ 0 (the schema's rule), without practical upper limit; one undo step per commit, not per digit
  const handleReorderWindowCommit = useCallback((value: number) => {
    const reorderWindow = Math.min(Number.MAX_SAFE_INTEGER, Math.round(value));
    setLastReorderWindow(reorderWindow);
    onChange({ reorderWindow });
  }, [onChange]);

  const handleReorderUnlimitedChange = useCallback((checked: boolean | 'indeterminate') => {
    onChange({ reorderWindow: checked === true ? 'unlimited' : lastReorderWindow });
  }, [lastReorderWindow, onChange]);

  // G2 (T52): what makes a plan better when the planner compares its candidates
  const handlePlanPriorityChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ planPriority: e.target.value as MixPlanPriority });
  }, [onChange]);

  // E2 (T39): automatic links between clips of a source. T54: one undo step per commit (blur/Enter), not per digit.
  const handleMaxGapCommit = useCallback((maxGap: number) => {
    onChange({ links: { ...settings.links, maxGap } });
  }, [onChange, settings.links]);

  const handleLinkTransitionChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ links: { ...settings.links, transition: e.target.value as MixSettings['links']['transition'] } });
  }, [onChange, settings.links]);

  const handleTransitionTypeChange = useCallback<ChangeEventHandler<HTMLSelectElement>>((e) => {
    onChange({ transition: { ...settings.transition, type: e.target.value as TransitionType } });
  }, [onChange, settings.transition]);

  const handleTransitionDurationInput = useCallback((duration: number) => {
    onChange({ transition: { ...settings.transition, duration } }, { transient: true });
  }, [onChange, settings.transition]);

  const handleTransitionDurationCommit = useCallback((duration: number) => {
    onChange({ transition: { ...settings.transition, duration } });
  }, [onChange, settings.transition]);

  const handleFadeInOutChange = useCallback((checked: boolean) => {
    onChange({ fadeInOut: checked });
  }, [onChange]);

  const handleMusicPlaylistChange = useCallback((musicPlaylist: MixMusicPlaylist, options?: EditOptions) => {
    onChange({ musicPlaylist }, options);
  }, [onChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content data-testid="mix-settings" style={{ width: '36em', maxHeight: '85vh', overflowY: 'auto' }} aria-describedby={undefined}>
          <Dialog.Title>{t('Mix settings')}</Dialog.Title>

          <Section title={t('Output')}>
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label style={rowStyle}>
              {t('Aspect ratio')}<br />
              <Select value={settings.output.aspect} onChange={handleAspectChange}>
                {mixOutputAspects.map((aspect) => <option key={aspect} value={aspect}>{t(aspectLabels[aspect])}</option>)}
              </Select>
              {settings.output.aspect === '1:1' && <div style={detailsStyle}>{t('A square video shows the clips side by side or stacked, whichever fits them better.')}</div>}
            </label>

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
              <RangeInput min={0} max={51} step={1} style={{ width: '100%' }} value={settings.crf} onInput={handleCrfInput} onCommit={handleCrfCommit} />
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

            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label style={rowStyle}>
              {t('Video codec')}<br />
              <Select value={settings.encoder.codec} onChange={handleCodecChange}>
                {mixEncoderCodecs.map((codec) => <option key={codec} value={codec}>{t(codecLabels[codec])}</option>)}
              </Select>
            </label>

            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label style={rowStyle}>
              {t('Encoder')}<br />
              <Select value={settings.encoder.hardware} onChange={handleEncoderHardwareChange}>
                {mixEncoderHardware.map((hardware) => {
                  const isFixed = hardware === 'auto' || hardware === 'none';
                  const available = isFixed || isHardwareAvailable(hardware);
                  const suffix = isFixed ? '' : (available ? t(' (detected)') : t(' (not detected)'));
                  return (
                    <option key={hardware} value={hardware} disabled={!isFixed && !available}>
                      {t(hardwareLabels[hardware])}{suffix}
                    </option>
                  );
                })}
              </Select>
              <div style={detailsStyle}>{t('"Auto" uses the first available hardware encoder and falls back to software if none work or if it fails while rendering.')}</div>
            </label>

            {/* E4: off by default (01-requisitos §11); the render, the preview and the Mix view cut the mix at the limit (T39) */}
            <div style={inlineRowStyle}>
              <span>{t('Limit the length of the mix')}</span>
              <Switch checked={maxDurationEnabled} onCheckedChange={handleMaxDurationToggle} />
              {maxDurationEnabled && (
                // eslint-disable-next-line jsx-a11y/label-has-associated-control
                <label>
                  {t('Maximum duration (m:ss)')}<br />
                  <input
                    type="text"
                    style={{ width: '6em', fontFamily: 'monospace' }}
                    value={maxDurationText ?? formatDuration({ seconds: settings.maxDuration ?? 0, shorten: true, showFraction: false })}
                    onChange={(e) => setMaxDurationText(e.target.value)}
                    onBlur={handleMaxDurationBlur}
                    onKeyDown={handleMaxDurationKeyDown}
                  />
                </label>
              )}
            </div>
            {maxDurationEnabled && (
              <div style={detailsStyle}>{t('If the mix would be longer, it is cut at the limit with the global fade-out. The estimate next to Settings/Preview/Render is highlighted when this happens.')}</div>
            )}
          </Section>

          <Section title={t('Composition')}>
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label style={rowStyle}>
              {settings.output.aspect === '16:9' ? t('Maximum visible columns') : (settings.output.aspect === '9:16' ? t('Maximum visible rows') : t('Maximum visible columns or rows'))}<br />
              <Select value={settings.maxColumns} onChange={handleMaxColumnsChange}>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </label>

            <div style={inlineRowStyle}>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label>
                {settings.output.aspect === '16:9' ? t('Gap between columns (px)') : (settings.output.aspect === '9:16' ? t('Gap between rows (px)') : t('Gap between columns or rows (px)'))}<br />
                <NumberField min={0} step={2} style={{ width: '6em' }} value={settings.gap.width} onCommit={handleGapWidthCommit} />
              </label>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label>
                {t('Gap color')}<br />
                <ColorInput value={settings.gap.color} onInput={handleGapColorInput} onCommit={handleGapColorCommit} />
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
                <ColorInput disabled={settings.fill.mode !== 'color'} value={settings.fill.color} onInput={handleFillColorInput} onCommit={handleFillColorCommit} />
              </label>
            </div>

            {/* A7 (T47) */}
            <div style={inlineRowStyle}>
              <span>{t('Remove black bars automatically')}</span>
              <Switch data-testid="auto-crop-black-bars" checked={settings.autoCropBlackBars} onCheckedChange={handleAutoCropBlackBarsChange} />
            </div>
            <div style={detailsStyle}>{t('New clips of a source are created without its black bars (letterbox/pillarbox), once detected in the background. The "Remove black bars" button in the clip editor always works, on or off.')}</div>
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

            {/* E8: no practical upper limit, or unlimited */}
            <div style={rowStyle}>
              <div style={{ ...inlineRowStyle, alignItems: 'flex-end', marginBottom: 0 }}>
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                <label>
                  {t('Reorder window (± positions)')}<br />
                  <NumberField min={0} step={1} style={{ width: '6em' }} disabled={reorderUnlimited} value={reorderWindowNumber} onCommit={handleReorderWindowCommit} />
                </label>
                <Checkbox label={t('Unlimited')} checked={reorderUnlimited} onCheckedChange={handleReorderUnlimitedChange} />
              </div>
              <div style={detailsStyle}>
                {reorderUnlimited
                  ? t('Clips may come from anywhere in the project to fill the gaps. Among equally good options, the list order still wins.')
                  : t('How far a clip may move from its position in the list to fit the layout.')}
              </div>
            </div>

            {/* G2 (T52) */}
            <div style={rowStyle}>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label>
                {t('Prioritize')}<br />
                <Select value={settings.planPriority} onChange={handlePlanPriorityChange}>
                  <option value="duration">{t('Shortest video')}</option>
                  <option value="fill">{t('Least fill')}</option>
                </Select>
              </label>
              <div style={detailsStyle}>
                {settings.planPriority === 'fill'
                  ? t('The plan with the least fill wins, then the shortest one, the one closest to the list order and the one with fewer layout changes. Plans with smaller reorder windows are tried too.')
                  : t('The shortest plan wins, then the one with the least fill, the one closest to the list order and the one with fewer layout changes. Plans with smaller reorder windows are tried too.')}
              </div>
            </div>
          </Section>

          {/* E2 (T39) */}
          <Section title={t('Linked clips')}>
            <div style={inlineRowStyle}>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label>
                {t('Link clips of a source up to this far apart (s)')}<br />
                <NumberField data-testid="links-max-gap" min={0} step={0.5} style={{ width: '6em' }} value={settings.links.maxGap} onCommit={handleMaxGapCommit} />
              </label>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label>
                {t('Between linked clips')}<br />
                <Select data-testid="links-transition" value={settings.links.transition} onChange={handleLinkTransitionChange}>
                  <option value="cut">{t('Direct cut')}</option>
                  <option value="global">{t('The transition of the mix')}</option>
                </Select>
              </label>
            </div>
            <div style={detailsStyle}>
              {settings.links.maxGap > 0
                ? t('Two clips of the same source are linked when the second one starts at most this long after the first one ends (clips that overlap are not): they play one after the other in the same slot. 0 turns it off. A link can be broken or made by hand from the clip list.')
                : t('Clips are not linked automatically. A link can still be made by hand from the clip list.')}
            </div>
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
              <RangeInput min={0.1} max={2} step={0.1} style={{ width: '100%' }} value={settings.transition.duration} onInput={handleTransitionDurationInput} onCommit={handleTransitionDurationCommit} />
            </label>

            <div style={inlineRowStyle}>
              <span>{t('Fade in/out at the start/end of the video')}</span>
              <Switch checked={settings.fadeInOut} onCheckedChange={handleFadeInOutChange} />
            </div>
          </Section>

          <Section title={t('Music')}>
            <MixMusicSection playlist={settings.musicPlaylist} onChange={handleMusicPlaylistChange} />
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
