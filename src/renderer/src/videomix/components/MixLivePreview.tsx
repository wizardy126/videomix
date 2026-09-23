import type { CSSProperties, MouseEventHandler } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FaPause, FaPlay } from 'react-icons/fa';

import { useSegColors } from '../../contexts';
import useUserSettings from '../../hooks/useUserSettings';
import { formatDuration } from '../../util/duration';
import { warningColor } from '../../colors';
import type { MixClip } from '../types';
import type { UseMixLivePreview } from '../hooks/useMixLivePreview';

// Live preview of the mix (A1, T32) over the player area while the Mix tab is active: the engine's canvas, fitted to
// the area with the output's aspect, and a control bar (play/pause, time, a seek bar and the "approximate" notice).
// The canvas is sized in device px (at most the output size), so drawing never works on more pixels than shown.

/** The time display is refreshed at most this often while playing (ms): a React render each time. */
const TIME_DISPLAY_INTERVAL = 100;
const CONTROLS_HEIGHT = 32;

const barButtonStyle: CSSProperties = { background: 'none', border: 'none', color: 'var(--gray-12)', cursor: 'pointer', padding: '0 .5em', display: 'flex', alignItems: 'center', fontSize: 14 };

function MixLivePreview({ preview, clips }: {
  preview: UseMixLivePreview,
  clips: MixClip[],
}) {
  const { t } = useTranslation();
  const { darkMode } = useUserSettings();
  const { getSegColor } = useSegColors();
  const { engine, playing, togglePlay, seek, hasPlan, outputSize, unnormalizedCount } = preview;

  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cssSize, setCssSize] = useState<{ width: number, height: number }>();

  // placeholders of unplayable sources use the clip colours of the lists
  useEffect(() => {
    engine.setClipColors(new Map(clips.map((clip) => [clip.id, getSegColor({ segColorIndex: clip.color }).desaturate(0.1).lightness(darkMode ? 40 : 55).string()])));
  }, [clips, darkMode, engine, getSegColor]);

  // Fit the canvas in the area with the output's aspect (contain)
  useEffect(() => {
    const area = areaRef.current;
    if (area == null || outputSize == null) return undefined;
    const update = () => {
      const scale = Math.min(area.clientWidth / outputSize.width, area.clientHeight / outputSize.height);
      setCssSize(scale > 0 ? { width: outputSize.width * scale, height: outputSize.height * scale } : undefined);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(area);
    return () => observer.disconnect();
  }, [outputSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas == null || cssSize == null || outputSize == null) return;
    const scale = Math.min(window.devicePixelRatio || 1, outputSize.width / cssSize.width);
    canvas.width = Math.max(1, Math.round(cssSize.width * scale));
    canvas.height = Math.max(1, Math.round(cssSize.height * scale));
    engine.invalidate();
  }, [cssSize, engine, outputSize]);

  useEffect(() => {
    engine.setCanvas(canvasRef.current ?? undefined);
    return () => engine.setCanvas(undefined);
  }, [engine, hasPlan]);

  // Time display, throttled
  const [time, setTime] = useState(0);
  useEffect(() => {
    let last = 0;
    const update = () => {
      const now = performance.now();
      if (engine.playing && now - last < TIME_DISPLAY_INTERVAL) return;
      last = now;
      setTime(engine.getTime());
    };
    update();
    return engine.subscribe(update);
  }, [engine]);

  const { duration } = engine;

  const handleSeekBarPointer = useCallback<MouseEventHandler<HTMLDivElement>>((e) => {
    if (e.buttons !== 1 && e.type !== 'mousedown') return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    seek(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * duration);
  }, [duration, seek]);

  const fps = engine.getFrameInterval() > 0 ? Math.round(1000 / engine.getFrameInterval()) : undefined;
  const timeText = useMemo(() => `${formatDuration({ seconds: time, shorten: true })} / ${formatDuration({ seconds: duration, shorten: true })}`, [duration, time]);

  return (
    <div className="no-user-select" data-testid="mix-live-preview" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'black', zIndex: 1 }}>
      <div ref={areaRef} style={{ flexGrow: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {hasPlan ? (
          <canvas
            ref={canvasRef}
            role="button"
            tabIndex={-1}
            onClick={togglePlay}
            style={{ width: cssSize?.width ?? 0, height: cssSize?.height ?? 0, display: 'block', cursor: 'pointer' }}
          />
        ) : (
          <div style={{ color: 'var(--gray-11)', fontSize: '.9em' }}>{t('Add clips to see the mix plan here.')}</div>
        )}
        <div style={{ position: 'absolute', top: '.5em', left: '.5em', padding: '.15em .5em', borderRadius: '.3em', background: 'rgba(0,0,0,.6)', color: 'white', fontSize: '.75em', pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: '.1em' }}>
          <span>{t('Approximate live preview: the render is the reference')}</span>
          {unnormalizedCount > 0 && (
            <span style={{ color: warningColor }}>{t('Audio levels are not normalized until the clips have been analysed (preview or render the mix once)')}</span>
          )}
        </div>
      </div>

      <div style={{ height: CONTROLS_HEIGHT, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '.5em', padding: '0 .5em', background: 'var(--gray-3)', color: 'var(--gray-12)', fontSize: '.8em' }}>
        <button type="button" style={barButtonStyle} onClick={togglePlay} disabled={!hasPlan} title={playing ? t('Pause') : t('Play')}>
          {playing ? <FaPause /> : <FaPlay />}
        </button>
        <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{timeText}</span>
        <div
          role="slider"
          tabIndex={-1}
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={time}
          onMouseDown={handleSeekBarPointer}
          onMouseMove={handleSeekBarPointer}
          style={{ flexGrow: 1, height: 14, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
        >
          <div style={{ position: 'relative', width: '100%', height: 4, borderRadius: 2, background: 'var(--gray-7)' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${duration > 0 ? (time / duration) * 100 : 0}%`, borderRadius: 2, background: 'var(--red-9)' }} />
          </div>
        </div>
        {playing && fps != null && <span style={{ opacity: 0.6, whiteSpace: 'nowrap' }} title={t('Frames drawn per second')}>{t('{{fps}} fps', { fps })}</span>}
      </div>
    </div>
  );
}

export default memo(MixLivePreview);
