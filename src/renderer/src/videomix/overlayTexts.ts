import i18n from 'i18next';

import type { MixOverlayType } from './types';
import type { OverlayTimeWarning } from './overlays/resolveOverlayTimes';
import type { OverlayLaneId } from './overlayTimeline';

// Translated texts of the overlay UI (T22) that are shared by the Mix view lanes and the properties panel.

export function getOverlayTypeLabel(type: MixOverlayType) {
  switch (type) {
    case 'image': { return i18n.t('Image'); }
    case 'countdown': { return i18n.t('Countdown'); }
    case 'progressBar': { return i18n.t('Progress bar'); }
    case 'sound': { return i18n.t('Sound'); }
    case 'text': { return i18n.t('Text'); }
    default: { return type; }
  }
}

export function getOverlayLaneLabel(lane: OverlayLaneId) {
  switch (lane) {
    case 'images': { return i18n.t('Images'); }
    case 'countdownsAndBars': { return i18n.t('Texts, countdowns and bars'); }
    case 'sounds': { return i18n.t('Sounds'); }
    default: { return lane; }
  }
}

/** Warning of resolveOverlayTimes, for the block tooltip and the properties panel. */
export function getOverlayTimeWarningText(warning: OverlayTimeWarning) {
  switch (warning.type) {
    case 'cycle': { return i18n.t('Its anchors form a cycle: it starts at its offset from the start of the video'); }
    case 'missing-clip': { return i18n.t('The clip it is anchored to is not in the mix: it starts at its offset from the start of the video'); }
    case 'missing-element': { return i18n.t('The overlay it is anchored to no longer exists: it starts at its offset from the start of the video'); }
    case 'missing-linked-countdown': { return i18n.t('The linked countdown no longer exists: it uses its own start and duration'); }
    case 'unknown-duration': { return i18n.t('The duration of the sound file is not known yet (or the file can\'t be read)'); }
    case 'clipped': { return i18n.t('Partly outside the video: it is cut'); }
    case 'outside-video': { return i18n.t('Outside the video: it won\'t be seen or heard'); }
    default: { return ''; }
  }
}
