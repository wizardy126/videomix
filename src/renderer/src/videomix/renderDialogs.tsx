import i18n from 'i18next';

import getSwal from '../swal';
import { formatDuration } from '../util/duration';
import type { MixProjectIssue } from './project';
import type { RenderWarning } from './render/renderOutput';

// Texts and dialogs of the render/preview flow (hooks/useMixRender.ts): what blocks a render and the warnings to
// confirm before it.

/** Translated text of a validateMixProject issue (its `message` is English, for logs). */
export function getIssueText(issue: MixProjectIssue, clipName: string | undefined, overlayName?: string | undefined) {
  const clip = clipName ?? issue.clipId ?? '';
  // T22: callers that know the overlays pass the name; the id is a readable enough fallback
  const overlay = overlayName ?? issue.overlayId ?? '';
  switch (issue.code) {
    case 'duplicate-source-id': { return i18n.t('The project has duplicate source ids'); }
    case 'duplicate-clip-id': { return i18n.t('The project has duplicate clip ids'); }
    case 'unknown-source': { return i18n.t('Clip "{{clip}}": its source is not in the project', { clip }); }
    case 'invalid-time-range': { return i18n.t('Clip "{{clip}}": the end must be after the start', { clip }); }
    case 'end-after-source-duration': { return i18n.t('Clip "{{clip}}": it ends after the end of its source', { clip }); }
    case 'rect-too-small': { return i18n.t('Clip "{{clip}}": a rectangle is too small', { clip }); }
    case 'max-rect-outside-frame': { return i18n.t('Clip "{{clip}}": the max rectangle is outside the video frame', { clip }); }
    case 'min-rect-outside-max': { return i18n.t('Clip "{{clip}}": the min rectangle is not inside the max rectangle', { clip }); }
    case 'clip-shorter-than-transitions': { return i18n.t('Clip "{{clip}}" is shorter than two transitions: its transitions will be shortened', { clip }); }
    case 'odd-gap': { return i18n.t('The gap between columns is odd: a 1 px column of fill may show'); }
    case 'duplicate-overlay-id': { return i18n.t('The project has duplicate overlay ids'); }
    case 'overlay-broken-reference': { return i18n.t('Overlay "{{overlay}}": the clip or overlay it depends on is not in the project', { overlay }); }
    case 'overlay-cycle': { return i18n.t('Overlay "{{overlay}}": its anchors form a cycle', { overlay }); }
    case 'overlay-box-out-of-range': { return i18n.t('Overlay "{{overlay}}": its box is outside the video frame', { overlay }); }
    case 'overlay-invalid-duration': { return i18n.t('Overlay "{{overlay}}": the duration must be greater than 0', { overlay }); }
    case 'overlay-invalid-color': { return i18n.t('Overlay "{{overlay}}": invalid color', { overlay }); }
    case 'overlay-fades-too-long': { return i18n.t('Overlay "{{overlay}}": its fades are longer than its duration', { overlay }); }
    default: { return issue.message; }
  }
}

export function getRenderWarningText(warning: RenderWarning) {
  switch (warning.type) {
    case 'upscale': { return i18n.t('Clip "{{clip}}" is enlarged ×{{factor}}: it may look blurry', { clip: warning.clipName, factor: warning.factor.toFixed(1) }); }
    case 'pillarbox': { return i18n.t('Clip "{{clip}}" gets fill on its sides from {{time}}', { clip: warning.clipName, time: formatDuration({ seconds: warning.time, shorten: true }) }); }
    case 'letterbox': { return i18n.t('Clip "{{clip}}" gets fill above and below from {{time}}', { clip: warning.clipName, time: formatDuration({ seconds: warning.time, shorten: true }) }); }
    case 'fill': { return i18n.t('The clips can\'t fill the whole width from {{time}}: {{width}} px are filled', { time: formatDuration({ seconds: warning.time, shorten: true }), width: warning.width }); }
    default: { return ''; }
  }
}

const listStyle = { textAlign: 'left' as const, margin: '1em 0 0 0', paddingLeft: '1.2em', maxHeight: '50vh', overflowY: 'auto' as const };

function List({ lines }: { lines: string[] }) {
  // eslint-disable-next-line react/no-array-index-key
  return <ul style={listStyle}>{lines.map((line, i) => <li key={i}>{line}</li>)}</ul>;
}

/** Problems that block a render (validation errors, missing files). */
export async function showRenderProblems({ title, lines }: { title: string, lines: string[] }) {
  await getSwal().ReactSwal.fire({
    icon: 'error',
    title,
    html: <List lines={lines} />,
  });
}

/** Warnings of the plan/project: returns whether to render anyway. */
export async function askForRenderWarnings({ lines, preview }: { lines: string[], preview: boolean }) {
  const { isConfirmed } = await getSwal().ReactSwal.fire({
    icon: 'warning',
    title: i18n.t('Check the mix before rendering'),
    html: <List lines={lines} />,
    showCancelButton: true,
    confirmButtonText: preview ? i18n.t('Preview anyway') : i18n.t('Render anyway'),
    cancelButtonText: i18n.t('Cancel'),
  });
  return isConfirmed;
}
