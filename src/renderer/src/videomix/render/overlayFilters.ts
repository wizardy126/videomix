import { overlayPxToOutput } from '../overlays/factories';
import { getCountdownMinutesFormat, getOverlayFrames, getOverlayPixelBox } from '../overlays/overlayFrames';
import type { ResolvedOverlayTimes } from '../overlays/resolveOverlayTimes';
import { getTextEntryFrames, getTextLineCenters, getTextOverlayFontSize, getTypewriterStages, splitTextLines } from '../overlays/textLayout';
import type { CountdownOverlay, ImageOverlay, MixOverlay, ProgressBarOverlay, TextOverlay } from '../types';
import { escapeFilterValue, formatNumber, toFfmpegColor as toColor } from './ffmpegArgs';

// Filters of the visual overlays of one render chunk (T20, 04-diseno §8.2), composed over the chunk's canvas after the
// columns, fills and gap bars and before the global fade, in layer order. Only the overlays visible in the chunk enter
// its graph. Times are absolute output frames (the chunk's local frame n is frame f0 + n of the video), so an overlay
// split across chunks is continuous, and every per-frame value is integer maths on frames: exact at the cuts.

export interface VideoGraphOverlays {
  /** `project.overlays`, in layer order (the last one on top). Sounds are ignored here. */
  overlays: readonly MixOverlay[],
  /** `resolveOverlayTimes(project, plan, …)` for the plan being rendered. */
  times: ResolvedOverlayTimes,
  /** Bundled font (main: `getDefaultOverlayFontPath`), for countdowns and texts without their own. */
  defaultFontPath: string,
}

interface Context {
  width: number,
  height: number,
  fps: number,
  /** Chunk frames [f0, f1) of the video. */
  f0: number,
  f1: number,
  /** Index of the first input added here. */
  firstInput: number,
  newLabel: (prefix: string) => string,
}

/** Reference px → output px; a non-zero length stays at least 1 px. */
export const lengthPx = (value: number, height: number) => (value > 0 ? Math.max(1, Math.round(overlayPxToOutput(value, height))) : 0);

const alignFactors = { left: '0', center: '0.5', right: '1' } as const;

/** drawtext options shared by the countdown and the text: font, size (px), color, border and shadow. */
function textStyleOptions(overlay: CountdownOverlay | TextOverlay, fontSize: number, defaultFontPath: string, height: number) {
  const borderWidth = lengthPx(overlay.border.width, height);
  return [
    `fontfile=${escapeFilterValue(overlay.font?.absolutePath ?? defaultFontPath)}`,
    `fontsize=${fontSize}`,
    `fontcolor=${toColor(overlay.color)}`,
    ...(borderWidth > 0 ? [`borderw=${borderWidth}`, `bordercolor=${toColor(overlay.border.color)}`] : []),
    ...(overlay.shadow != null ? [
      `shadowx=${Math.round(overlayPxToOutput(overlay.shadow.x, height))}`,
      `shadowy=${Math.round(overlayPxToOutput(overlay.shadow.y, height))}`,
      `shadowcolor=${toColor(overlay.shadow.color)}`,
    ] : []),
  ];
}

/** Adds the overlay filters on top of the canvas `cv`. Returns the new inputs, the filter chains and the output label. */
export function buildOverlayFilters({ overlays, times, defaultFontPath }: VideoGraphOverlays, ctx: Context, cv: string) {
  const { width: W, height: H, fps, f0, f1, newLabel } = ctx;
  const sec = (frames: number) => formatNumber(frames / fps);
  const inputs: string[][] = [];
  const filters: string[] = [];
  let out = cv;

  // local frame index of the chunk (canvas time t = n / fps, exact after rounding)
  const n = `round(t*${fps})`;
  // Local frames [lo, hi): midpoint thresholds like stepExpr, never on a frame time
  const enable = (lo: number, hi: number) => `enable='between(t,${sec(lo - 0.5)},${sec(hi - 0.5)})'`;

  const addImage = (overlay: ImageOverlay, raw: { start: number, end: number }, lo: number, hi: number) => {
    const box = getOverlayPixelBox(overlay.box, W, H);
    const inputIndex = ctx.firstInput + inputs.length;
    // image2 without a pattern: a single image, whatever its file name contains (%d, *)
    inputs.push(['-f', 'image2', '-pattern_type', 'none', '-i', overlay.absolutePath]);
    // Scaled once, then repeated with loop (cheaper than decoding and scaling it on every frame). Frame times start at
    // the overlay's raw start, so the fades are exact whatever chunk the frames fall in.
    const k0 = f0 + lo - raw.start;
    const duration = (raw.end - raw.start) / fps;
    const fades: string[] = [];
    if (overlay.fadeIn > 0) fades.push(`fade=t=in:st=0:d=${formatNumber(Math.min(overlay.fadeIn, duration))}:alpha=1`);
    if (overlay.fadeOut > 0) {
      const d = Math.min(overlay.fadeOut, duration);
      fades.push(`fade=t=out:st=${formatNumber(duration - d)}:d=${formatNumber(d)}:alpha=1`);
    }
    const img = newLabel('ovimg');
    filters.push(`[${inputIndex}:v]trim=end_frame=1,scale=${box.width}:${box.height}:flags=bicubic,setsar=1,format=rgba,loop=loop=${hi - lo - 1}:size=1,settb=1/${fps},setpts=N+${k0}${fades.map((f) => `,${f}`).join('')},setpts=N+${lo}[${img}]`);
    const next = newLabel('cv');
    filters.push(`[${out}][${img}]overlay=x=${box.x}:y=${box.y}:eof_action=pass:${enable(lo, hi)}[${next}]`);
    out = next;
  };

  const addCountdown = (overlay: CountdownOverlay, raw: { start: number, end: number }, lo: number, hi: number) => {
    const box = getOverlayPixelBox(overlay.box, W, H);
    const { decimals } = overlay;
    const p = 10 ** decimals;
    // remaining frames until the raw end, and the shown value in 10^-decimals s, rounded up (overlayFrames.getCountdownUnits)
    const remaining = `(${raw.end - f0}-${n})`;
    const units = `ceil(${remaining}*${p}/${fps})`;
    const pad = overlay.leadingZeros ? ':d:2' : ':d';
    const fraction = decimals > 0 ? `.%{eif:mod(${units},${p}):d:${decimals}}` : '';
    // Format decided once, by the countdown's (uncut) duration, not by the shown value (01-requisitos §9.1): a single
    // drawtext, no if().
    const text = getCountdownMinutesFormat({ rawStart: raw.start, rawEnd: raw.end }, fps)
      ? `%{eif:floor(${units}/${60 * p})${pad}}:%{eif:mod(floor(${units}/${p}),60):d:2}${fraction}`
      : `%{eif:${decimals > 0 ? `floor(${units}/${p})` : units}${pad}}${fraction}`;

    const alignFactor = alignFactors[overlay.align];
    const options = [
      ...textStyleOptions(overlay, Math.max(1, Math.round(overlay.box.height * H)), defaultFontPath, H),
      // aligned inside the box (the text width changes with the value), vertically centred
      `x=${box.x}${alignFactor === '0' ? '' : `+(${box.width}-text_w)*${alignFactor}`}`,
      `y=${box.y}+(${box.height}-text_h)/2`,
      // linear fade over the last `fadeOut` s before reaching 0
      ...(overlay.fadeOut > 0 ? [`alpha='min(1,${remaining}/${formatNumber(overlay.fadeOut * fps)})'`] : []),
    ].join(':');

    const next = newLabel('cv');
    filters.push(`[${out}]drawtext=${options}:text=${escapeFilterValue(text)}:${enable(lo, hi)}[${next}]`);
    out = next;
  };

  // Free text (B1, T26): one drawtext per line (and per typewriter step), each aligned in the box by its own width.
  // Lines are placed by font metrics (y_align=font: y is the top of the font's ascent), so every line has the same
  // baseline offset whatever its glyphs: line centre − (font_a + font_d) / 2. The text is literal (expansion=none).
  const addText = (overlay: TextOverlay, raw: { start: number, end: number }, lo: number, hi: number) => {
    // trailing spaces don't count for the alignment
    const lines = splitTextLines(overlay.text).map((line) => line.trimEnd());
    const box = getOverlayPixelBox(overlay.box, W, H);
    const size = Math.max(1, Math.round(getTextOverlayFontSize(overlay) * H));
    const centers = getTextLineCenters({ lineCount: lines.length, fontSize: size, lineSpacing: overlay.lineSpacing, boxTop: box.y, boxHeight: box.height });
    const { entry } = overlay;
    const entryFrames = getTextEntryFrames(entry, fps);
    // frames since the raw start, and until the raw end
    const since = `(${f0 - raw.start}+${n})`;
    const remaining = `(${raw.end - f0}-${n})`;

    // linear fades (textLayout.getTextOpacity); min() takes two arguments
    const alphas = [
      ...(overlay.fadeIn > 0 ? [`${since}/${formatNumber(overlay.fadeIn * fps)}`] : []),
      ...(overlay.fadeOut > 0 ? [`${remaining}/${formatNumber(overlay.fadeOut * fps)}`] : []),
    ];
    const style = [
      ...textStyleOptions(overlay, size, defaultFontPath, H),
      'y_align=font',
      'expansion=none',
      ...(alphas.length > 0 ? [`alpha='${alphas.reduce((acc, a) => `min(${acc},${a})`, '1')}'`] : []),
    ];

    const xAligned = `${box.x}${alignFactors[overlay.align] === '0' ? '' : `+(${box.width}-text_w)*${alignFactors[overlay.align]}`}`;
    let x = xAligned;
    let yOffset = '';
    if (entry.kind === 'slide' && entry.from != null) {
      // Ease-out cubic (textLayout.getSlideRemaining) from just outside the frame side: the box, or the line if it's
      // wider, is fully out at the start. `m` covers the border, the shadow and the glyphs outside the line cell.
      const e = `pow(1-min(1,${since}/${entryFrames}),3)`;
      const shadow = Math.max(Math.abs(overlay.shadow?.x ?? 0), Math.abs(overlay.shadow?.y ?? 0));
      const m = size + lengthPx(overlay.border.width, H) + Math.ceil(overlayPxToOutput(shadow, H));
      const blockTop = Math.min(box.y, centers[0]! - size / 2);
      const blockBottom = Math.max(box.y + box.height, centers.at(-1)! + size / 2);
      if (entry.from === 'left') x = `${xAligned}-(max(${box.x + box.width},${xAligned}+text_w)+${m})*${e}`;
      if (entry.from === 'right') x = `${xAligned}+(${W}-min(${box.x},${xAligned})+${m})*${e}`;
      if (entry.from === 'top') yOffset = `-${formatNumber(blockBottom + m)}*${e}`;
      if (entry.from === 'bottom') yOffset = `+${formatNumber(H - blockTop + m)}*${e}`;
    }

    // `text` during frames [a, b) after the raw start (b undefined: until the end), cut to the chunk
    const drawLine = (i: number, text: string, a: number, b: number | undefined, extraOptions: string[] = []) => {
      const from = Math.max(lo, raw.start + a - f0);
      const to = Math.min(hi, b != null ? raw.start + b - f0 : hi);
      if (to <= from) return;
      const y = `${formatNumber(centers[i]!)}-(font_a+font_d)/2${yOffset}`;
      const next = newLabel('cv');
      const options = [...style, ...extraOptions, `x='${x}'`, `y='${y}'`];
      filters.push(`[${out}]drawtext=${options.join(':')}:text=${escapeFilterValue(text)}:${enable(from, to)}[${next}]`);
      out = next;
    };

    if (entry.kind !== 'typewriter') {
      lines.forEach((line, i) => {
        if (line.trim() !== '') drawLine(i, line, 0, undefined);
      });
      return;
    }

    // Typewriter: one drawtext per step of each line (textLayout.getTypewriterStages), without if(). A partial line is
    // drawn as `prefix\nwhole line` with the whole line pushed far below the frame (line_spacing): text_w is then the
    // whole line's width, so the prefix is already where it ends up (it doesn't move as it grows, whatever the alignment).
    getTypewriterStages(lines, entryFrames).forEach((stages, i) => {
      const whole = lines[i]!;
      stages.forEach(({ text, start, end }) => {
        if (text === whole) drawLine(i, whole, start, end);
        else drawLine(i, `${text}\n${whole}`, start, end, [`line_spacing=${10 * H}`]);
      });
    });
  };

  const addProgressBar = (overlay: ProgressBarOverlay, raw: { start: number, end: number }, lo: number, hi: number) => {
    const box = getOverlayPixelBox(overlay.box, W, H);
    const border = Math.min(lengthPx(overlay.border.width, H), Math.floor(Math.min(box.width, box.height) / 2));
    const iw = box.width - 2 * border;
    const ih = box.height - 2 * border;
    const nf = hi - lo;
    const layer = (color: string, w: number, h: number) => `color=c=${toColor(color)}:s=${w}x${h}:r=${fps}:d=${sec(nf + 1)},trim=end_frame=${nf},format=rgba`;

    // The bar is composed in its own RGBA layer of the box size: background, a fill layer of the inner size that slides
    // in from the growing side (overlay clips it to the layer; `x`/`y` per frame, a flat expression), then the border
    // on top, which hides the part of the fill that slides under it.
    const bar = newLabel('ovbar');
    const base = newLabel('ovbg');
    filters.push(`${layer(overlay.backgroundColor, box.width, box.height)}[${base}]`);
    let chain = `[${base}]`;
    if (iw > 0 && ih > 0) {
      const fill = newLabel('ovfill');
      filters.push(`${layer(overlay.fillColor, iw, ih)}[${fill}]`);
      // bar frame index of the layer's frame k: c + k, of `total`
      const c = f0 + lo - raw.start;
      const total = raw.end - raw.start;
      const done = `(${c}+${n})`;
      const shown = overlay.mode === 'fill' ? done : `(${total - c}-${n})`;
      const length = overlay.direction === 'ltr' || overlay.direction === 'rtl' ? iw : ih;
      const px = `round(${length}*${shown}/${total})`;
      const offset = {
        ltr: { x: `${border - iw}+${px}`, y: String(border) },
        rtl: { x: `${border + iw}-${px}`, y: String(border) },
        ttb: { x: String(border), y: `${border - ih}+${px}` },
        btt: { x: String(border), y: `${border + ih}-${px}` },
      }[overlay.direction];
      chain += `[${fill}]overlay=x='${offset.x}':y='${offset.y}':eval=frame:format=rgb`;
    } else {
      chain += 'null';
    }
    if (border > 0) chain += `,drawbox=x=0:y=0:w=${box.width}:h=${box.height}:color=${toColor(overlay.border.color)}:t=${border}:replace=1`;
    filters.push(`${chain},setpts=N+${lo}[${bar}]`);
    const next = newLabel('cv');
    filters.push(`[${out}][${bar}]overlay=x=${box.x}:y=${box.y}:eof_action=pass:${enable(lo, hi)}[${next}]`);
    out = next;
  };

  overlays.forEach((overlay) => {
    const time = times.get(overlay.id);
    if (overlay.type === 'sound' || time == null) return;
    const frames = getOverlayFrames(time, fps);
    const lo = Math.max(frames.start, f0) - f0;
    const hi = Math.min(frames.end, f1) - f0;
    if (hi <= lo) return;
    const raw = { start: frames.rawStart, end: frames.rawEnd };
    switch (overlay.type) {
      case 'image': { addImage(overlay, raw, lo, hi); break; }
      case 'countdown': { addCountdown(overlay, raw, lo, hi); break; }
      case 'progressBar': { addProgressBar(overlay, raw, lo, hi); break; }
      case 'text': { addText(overlay, raw, lo, hi); break; }
      default:
    }
  });

  return { inputs, filters, cv: out };
}
