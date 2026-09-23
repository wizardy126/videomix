import type { CSSProperties, MouseEventHandler } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDebounce } from 'use-debounce';
import { FaExclamationTriangle } from 'react-icons/fa';

import { useSegColors } from '../../contexts';
import useUserSettings from '../../hooks/useUserSettings';
import { controlsBackground, darkModeTransition, timelineBackground, warningColor } from '../../colors';
import { formatDuration } from '../../util/duration';
import type { MixClip, MixSettings } from '../types';
import type { ColumnPlacement, MixPlan, PlanWarning } from '../planner/types';
import { planRender } from '../render/renderOutput';
import { getColumnsAtFrame, getFillSpansAtFrame, getRenderTimeline } from '../render/renderTimeline';
import { getColumnFillSpans, getLaneColumns, getPlacementAt, getPlacementWarnings, timeToPercent } from '../mixPlanLayout';

// Timeline of the mix plan (T15, 04-diseno §6.6): an alternative to the source Timeline that shows the MixPlan
// instead of the active source. A lane per column, the mini frame view and the fill/warning markers reuse the exact
// geometry the render uses (render/renderTimeline.ts), so what's shown here matches T13's render.

const PLAN_DEBOUNCE_MS = 300;
const LANE_HEIGHT = 22;
const MAX_LANES_HEIGHT = 6 * LANE_HEIGHT;
const FRAME_HEIGHT = 60;

const fillStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  background: 'repeating-linear-gradient(45deg, var(--gray-6) 0, var(--gray-6) 4px, transparent 4px, transparent 8px)',
};

const relayoutBandStyle: CSSProperties = { position: 'absolute', top: 0, bottom: 0, background: 'var(--gray-8)', opacity: 0.35, pointerEvents: 'none' };

function warningTooltip(t: (key: string) => string, warnings: PlanWarning[]) {
  return warnings.map((w) => {
    if (w.type === 'upscale') return t('Enlarged more than the recommended limit');
    if (w.type === 'pillarbox' || w.type === 'letterbox') return t('Gets fill around it in this column');
    return t('Its transition is shortened');
  }).join('; ');
}

// eslint-disable-next-line react/display-name
const Block = memo(({ placement, laneWidthPercent, color, name, warnings, isSelected }: {
  placement: ColumnPlacement,
  laneWidthPercent: { left: number, width: number },
  color: string,
  name: string,
  warnings: PlanWarning[],
  isSelected: boolean,
}) => {
  const { t } = useTranslation();
  const duration = placement.endTime - placement.startTime;
  // Crossfade with the previous/next clip of the column, as a fraction of this block's own width (visual only).
  const inFrac = duration > 0 ? Math.min(1, placement.transitionIn / duration) : 0;
  const outFrac = duration > 0 ? Math.min(1, (placement.transitionOut ?? 0) / duration) : 0;

  const style = useMemo<CSSProperties>(() => ({
    position: 'absolute',
    top: 1,
    bottom: 1,
    left: `${laneWidthPercent.left}%`,
    width: `${laneWidthPercent.width}%`,
    background: color,
    borderRadius: 3,
    overflow: 'hidden',
    border: `1px solid ${isSelected ? 'var(--gray-12)' : 'transparent'}`,
    boxSizing: 'border-box',
    cursor: 'pointer',
  }), [color, isSelected, laneWidthPercent.left, laneWidthPercent.width]);

  return (
    <div style={style} title={`${name}${warnings.length > 0 ? ` — ${warningTooltip(t, warnings)}` : ''}`}>
      {inFrac > 0 && <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${inFrac * 100}%`, background: 'linear-gradient(90deg, rgba(255,255,255,.4), transparent)', pointerEvents: 'none' }} />}
      {outFrac > 0 && <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: `${outFrac * 100}%`, background: 'linear-gradient(90deg, transparent, rgba(0,0,0,.4))', pointerEvents: 'none' }} />}
      <div className="no-user-select" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: '.2em', padding: '0 .3em', fontSize: '.75em', color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', pointerEvents: 'none' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
        {warnings.length > 0 && <FaExclamationTriangle style={{ flexShrink: 0, color: warningColor }} />}
      </div>
    </div>
  );
});

/** Mini view of the output frame at `time` (real column widths, no video): matches the render's per-frame geometry. */
// eslint-disable-next-line react/display-name
const FramePreview = memo(({ plan, tl, time, clipsById, getColor }: {
  plan: Pick<MixPlan, 'width' | 'height' | 'placements'>,
  tl: ReturnType<typeof getRenderTimeline>,
  time: number,
  clipsById: Map<string, MixClip>,
  getColor: (clip: MixClip) => string,
}) => {
  const frame = Math.round(time * tl.settings.fps);
  const columns = getColumnsAtFrame(tl, frame);
  const fills = getFillSpansAtFrame(tl, columns);
  const placementAt = (column: number) => plan.placements.find((p) => p.column === column && time >= p.startTime && time < p.endTime);

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: `${plan.width} / ${plan.height}`, background: 'var(--gray-3)', overflow: 'hidden', borderRadius: 3 }}>
      {[...fills.values()].map((f) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={`${f.x}-${f.width}`} style={{ ...fillStyle, left: `${(f.x / plan.width) * 100}%`, width: `${(f.width / plan.width) * 100}%` }} />
      ))}
      {[...columns.entries()].map(([column, geom]) => {
        const placement = placementAt(column);
        const clip = placement != null ? clipsById.get(placement.clipId) : undefined;
        return (
          <div
            key={column}
            style={{ position: 'absolute', top: 0, bottom: 0, left: `${(geom.x / plan.width) * 100}%`, width: `${(geom.width / plan.width) * 100}%`, background: clip != null ? getColor(clip) : 'var(--gray-6)' }}
          />
        );
      })}
    </div>
  );
});

function MixPlanView({ clips, settings, selectedClipId, onSelect }: {
  clips: MixClip[],
  settings: MixSettings,
  selectedClipId: string | undefined,
  onSelect: (clipId: string) => void,
}) {
  const { t } = useTranslation();
  const { darkMode } = useUserSettings();
  const { getSegColor } = useSegColors();
  const [hoverTime, setHoverTime] = useState<number>();

  // The planner is fast (04-diseno §3.3), but recomputing on every keystroke/drag would still be wasteful.
  const [debouncedClips] = useDebounce(clips, PLAN_DEBOUNCE_MS);
  const [debouncedSettings] = useDebounce(settings, PLAN_DEBOUNCE_MS);
  const plan = useMemo<MixPlan | undefined>(
    () => (debouncedClips.length > 0 ? planRender({ clips: debouncedClips, settings: debouncedSettings }).plan : undefined),
    [debouncedClips, debouncedSettings],
  );

  const clipsById = useMemo(() => new Map(clips.map((clip) => [clip.id, clip])), [clips]);
  const getColor = useCallback((clip: MixClip) => getSegColor({ segColorIndex: clip.color }).desaturate(0.1).lightness(darkMode ? 40 : 55).string(), [darkMode, getSegColor]);

  const laneColumns = useMemo(() => (plan != null ? getLaneColumns(plan) : []), [plan]);
  const relayouts = useMemo(() => (plan != null ? plan.layouts.filter((l) => l.transitionDuration > 0) : []), [plan]);

  const tl = useMemo(() => (plan != null ? getRenderTimeline(plan, { fps: settings.fps, gap: settings.gap.width, transitionDuration: settings.transition.duration }) : undefined), [plan, settings.fps, settings.gap.width, settings.transition.duration]);

  const handleMouseMove = useCallback<MouseEventHandler<HTMLDivElement>>((e) => {
    if (plan == null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    setHoverTime(Math.min(plan.duration, Math.max(0, frac * plan.duration)));
  }, [plan]);
  const handleMouseLeave = useCallback(() => setHoverTime(undefined), []);

  const handleLaneClick = useCallback((laneIndex: number): MouseEventHandler<HTMLDivElement> => (e) => {
    if (plan == null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const time = rect.width > 0 ? ((e.clientX - rect.left) / rect.width) * plan.duration : 0;
    const placement = getPlacementAt(plan, laneColumns, laneIndex, time);
    if (placement != null) onSelect(placement.clipId);
  }, [laneColumns, onSelect, plan]);

  const lanesHeight = Math.min(MAX_LANES_HEIGHT, Math.max(LANE_HEIGHT, laneColumns.length * LANE_HEIGHT));

  if (plan == null || tl == null) {
    return (
      <div className="no-user-select" style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: timelineBackground, transition: darkModeTransition, color: 'var(--gray-11)', fontSize: '.85em', padding: '0 1em', textAlign: 'center' }}>
        {t('Add clips to see the mix plan here.')}
      </div>
    );
  }

  return (
    <div style={{ flexGrow: 1, display: 'flex', overflow: 'hidden', background: controlsBackground, transition: darkModeTransition, padding: '.3em .5em', gap: '.5em', boxSizing: 'border-box' }}>
      <div style={{ width: FRAME_HEIGHT * (plan.width / plan.height), flexShrink: 0 }}>
        <FramePreview plan={plan} tl={tl} time={hoverTime ?? 0} clipsById={clipsById} getColor={getColor} />
        <div className="no-user-select" style={{ textAlign: 'center', fontSize: '.7em', opacity: 0.7, marginTop: 2 }}>
          {formatDuration({ seconds: hoverTime ?? 0, shorten: true })}
        </div>
      </div>

      <div style={{ flexGrow: 1, overflowY: 'auto', minWidth: 0 }} className="consistent-scrollbar">
        <div
          role="presentation"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ position: 'relative', height: lanesHeight, background: timelineBackground }}
        >
          {relayouts.map((layout) => (
            <div
              key={layout.time}
              style={{ ...relayoutBandStyle, left: `${timeToPercent(layout.time, plan.duration)}%`, width: `${timeToPercent(layout.time + layout.transitionDuration, plan.duration) - timeToPercent(layout.time, plan.duration)}%` }}
            />
          ))}

          {laneColumns.map((column, laneIndex) => (
            <div
              key={column}
              role="button"
              tabIndex={-1}
              onClick={handleLaneClick(laneIndex)}
              style={{ position: 'absolute', top: laneIndex * LANE_HEIGHT, left: 0, right: 0, height: LANE_HEIGHT, borderBottom: '1px solid var(--gray-6)', cursor: 'pointer' }}
            >
              {getColumnFillSpans(plan, column).map((span) => (
                <div
                  key={`${span.from}-${span.to}`}
                  style={{ ...fillStyle, left: `${timeToPercent(span.from, plan.duration)}%`, width: `${timeToPercent(span.to, plan.duration) - timeToPercent(span.from, plan.duration)}%` }}
                />
              ))}

              {plan.placements.filter((p) => p.column === column).map((placement) => {
                const clip = clipsById.get(placement.clipId);
                const left = timeToPercent(placement.startTime, plan.duration);
                const width = timeToPercent(placement.endTime, plan.duration) - left;
                return (
                  <Block
                    key={placement.clipId}
                    placement={placement}
                    laneWidthPercent={{ left, width }}
                    color={clip != null ? getColor(clip) : 'var(--gray-8)'}
                    name={clip?.name ?? placement.clipId}
                    warnings={getPlacementWarnings(plan, placement)}
                    isSelected={placement.clipId === selectedClipId}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default memo(MixPlanView);
