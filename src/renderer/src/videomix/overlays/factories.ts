import { OVERLAY_REFERENCE_HEIGHT } from '../types';
import type { CountdownOverlay, ImageOverlay, OverlayAnchor, OverlayBox, ProgressBarOverlay, SoundOverlay, TextOverlay } from '../types';

// Defaults for new overlays (T22 places them at the Mix view cursor with an absolute anchor).

/** Distance from the frame edges used by the presets (fraction of the frame). */
export const OVERLAY_MARGIN = 0.03;

export const DEFAULT_IMAGE_DURATION = 5;
export const DEFAULT_COUNTDOWN_DURATION = 10;
export const DEFAULT_TEXT_DURATION = 5;

export type OverlayBoxPreset = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'center' | 'fullScreen';

/** A box of `size` (fractions) placed at a preset position, `margin` away from the edges. `fullScreen` ignores both. */
export function getOverlayBoxPreset(preset: OverlayBoxPreset, size: Pick<OverlayBox, 'width' | 'height'>, margin = OVERLAY_MARGIN): OverlayBox {
  const { width, height } = size;
  const left = margin;
  const right = 1 - margin - width;
  const top = margin;
  const bottom = 1 - margin - height;
  switch (preset) {
    case 'topLeft': { return { x: left, y: top, width, height }; }
    case 'topRight': { return { x: right, y: top, width, height }; }
    case 'bottomLeft': { return { x: left, y: bottom, width, height }; }
    case 'bottomRight': { return { x: right, y: bottom, width, height }; }
    case 'center': { return { x: (1 - width) / 2, y: (1 - height) / 2, width, height }; }
    case 'fullScreen': { return { x: 0, y: 0, width: 1, height: 1 }; }
    default: {
      const exhaustive: never = preset;
      throw new Error(`Unknown preset ${String(exhaustive)}`);
    }
  }
}

/** Reference px (border, shadow) to output px. */
export const overlayPxToOutput = (value: number, outputHeight: number) => (value * outputHeight) / OVERLAY_REFERENCE_HEIGHT;

const absoluteAnchor = (time: number): OverlayAnchor => ({ kind: 'absolute', time: Math.max(0, time) });

interface CommonParams { id: string, name: string, start?: number | undefined }

/** Centered, 30 % of the frame width (the caller may fix the height to the image's aspect ratio). */
export function createImageOverlay({ id, name, start = 0, filePath }: CommonParams & { filePath: string }): ImageOverlay {
  return {
    id,
    name,
    type: 'image',
    anchor: absoluteAnchor(start),
    path: filePath,
    absolutePath: filePath,
    duration: DEFAULT_IMAGE_DURATION,
    box: getOverlayBoxPreset('center', { width: 0.3, height: 0.3 }),
    fadeIn: 0.5,
    fadeOut: 0.5,
  };
}

/** 10 s, top right, white text with a black border and the bundled font. */
export function createCountdownOverlay({ id, name, start = 0 }: CommonParams): CountdownOverlay {
  return {
    id,
    name,
    type: 'countdown',
    anchor: absoluteAnchor(start),
    duration: DEFAULT_COUNTDOWN_DURATION,
    box: getOverlayBoxPreset('topRight', { width: 0.2, height: 0.1 }),
    align: 'right',
    decimals: 0,
    leadingZeros: false,
    color: '#ffffff',
    border: { width: 4, color: '#000000' },
    fadeOut: 0,
  };
}

/**
 * At the bottom, full width minus the margins, filling left to right.
 * With `linkedCountdownId` it takes the countdown's start and duration (the anchor/duration fields are then kept as they are).
 */
export function createProgressBarOverlay({ id, name, start = 0, linkedCountdownId }: CommonParams & { linkedCountdownId?: string | undefined }): ProgressBarOverlay {
  const height = 0.03;
  return {
    id,
    name,
    type: 'progressBar',
    anchor: absoluteAnchor(start),
    duration: DEFAULT_COUNTDOWN_DURATION,
    ...(linkedCountdownId != null && { linkedCountdownId }),
    box: { x: OVERLAY_MARGIN, y: 1 - OVERLAY_MARGIN - height, width: 1 - 2 * OVERLAY_MARGIN, height },
    fillColor: '#ffffff',
    backgroundColor: '#00000080',
    border: { width: 2, color: '#000000' },
    direction: 'ltr',
    mode: 'fill',
  };
}

/** Centered white text with a black border and the bundled font, fading in and out, without an entry animation. */
export function createTextOverlay({ id, name, start = 0, text }: CommonParams & { text: string }): TextOverlay {
  return {
    id,
    name,
    type: 'text',
    anchor: absoluteAnchor(start),
    text,
    duration: DEFAULT_TEXT_DURATION,
    box: getOverlayBoxPreset('center', { width: 0.6, height: 0.1 }),
    align: 'center',
    color: '#ffffff',
    border: { width: 4, color: '#000000' },
    lineSpacing: 0.2,
    fadeIn: 0.5,
    fadeOut: 0.5,
    entry: { kind: 'none', duration: 0.5 },
  };
}

/**
 * Font size of a text overlay, as a fraction of the output height: its lines (and the `lineSpacing` between them) fill
 * the box height, so one line is as high as the box (like the countdown).
 */
export function getTextOverlayFontSize({ text, box, lineSpacing }: Pick<TextOverlay, 'text' | 'box' | 'lineSpacing'>) {
  const lines = text.split('\n').length;
  return box.height / (lines + (lines - 1) * lineSpacing);
}

/** 0 dB = as loud as the clips (after normalization). */
export function createSoundOverlay({ id, name, start = 0, filePath }: CommonParams & { filePath: string }): SoundOverlay {
  return {
    id,
    name,
    type: 'sound',
    anchor: absoluteAnchor(start),
    path: filePath,
    absolutePath: filePath,
    gainDb: 0,
  };
}

/** Visual overlays are layered (images, countdowns, bars); sounds are not. */
export const isVisualOverlay = (overlay: { type: string }) => overlay.type !== 'sound';
