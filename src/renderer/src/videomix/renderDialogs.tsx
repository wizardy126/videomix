import i18n from 'i18next';

import getSwal from '../swal';
import { formatDuration } from '../util/duration';
import type { MixProjectIssue } from './project';
import type { RenderWarning } from './render/renderOutput';

// Texts and dialogs of the render/preview flow (hooks/useMixRender.ts): what blocks a render and the warnings to
// confirm before it.

/** Translated text of a validateMixProject issue (its `message` is English, for logs). */
export function getIssueText(issue: MixProjectIssue, clipName: string | undefined, overlayName?: string | undefined, blockName?: string | undefined): string {
  const clip = clipName ?? issue.clipId ?? '';
  // T22: callers that know the overlays pass the name; the id is a readable enough fallback
  const overlay = overlayName ?? issue.overlayId ?? '';
  // T57: same for the blocks (the name of its content)
  const block = blockName ?? issue.blockId ?? issue.blockDefId ?? '';
  // T57: a member's content issue (`blockDefId` + `overlayId`) says in which block it is
  if (issue.blockDefId != null && issue.overlayId != null && !issue.code.includes('block')) return i18n.t('Block "{{block}}": {{issue}}', { block, issue: getIssueText({ ...issue, blockDefId: undefined }, clipName, overlayName) });
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
    case 'overlay-empty-text': { return i18n.t('Text "{{overlay}}" is empty', { overlay }); }
    case 'overlay-invalid-entry': { return i18n.t('Text "{{overlay}}": choose the side it slides in from', { overlay }); }
    case 'overlay-entry-too-long': { return i18n.t('Text "{{overlay}}": its entry animation is longer than its duration', { overlay }); }
    case 'overlay-invalid-font-size': { return i18n.t('Text "{{overlay}}": its text size is not valid', { overlay }); }
    case 'pin-time-out-of-range': { return i18n.t('Clip "{{clip}}": its fixed start time is not valid', { clip }); }
    case 'pin-time-after-end': { return i18n.t('Clip "{{clip}}" is pinned after the end of the other clips: it will start earlier', { clip }); }
    case 'group-too-small': { return i18n.t('Clip "{{clip}}" is the only clip of its group: it is not grouped', { clip }); }
    case 'group-pin-conflict': { return i18n.t('A group has clips fixed at different times'); }
    case 'duplicate-music-track-id': { return i18n.t('The project has duplicate music track ids'); }
    case 'max-duration-out-of-range': { return i18n.t('The maximum duration must be greater than 0'); }
    case 'always-visible-unknown-clip': { return i18n.t('The always-visible sequence references a clip that is not in the project'); }
    case 'duplicate-always-visible-id': { return i18n.t('The always-visible sequence has a clip more than once'); }
    case 'clip-in-sequence-and-group': { return i18n.t('Clip "{{clip}}" is in the always-visible sequence and in a group', { clip }); }
    // v7 (T56, T57): blocks of overlays
    case 'duplicate-block-id': { return i18n.t('The project has duplicate block ids'); }
    case 'duplicate-block-def-id': { return i18n.t('The project has duplicate block content ids'); }
    case 'block-unknown-def': { return i18n.t('Block "{{block}}": its content is not in the project', { block }); }
    case 'block-def-unused': { return i18n.t('Block "{{block}}" is not used in the video', { block }); }
    case 'block-empty': { return i18n.t('Block "{{block}}" is empty', { block }); }
    case 'duplicate-block-member-id': { return i18n.t('Block "{{block}}" has duplicate overlay ids', { block }); }
    case 'invalid-block-member-id': { return i18n.t('Block "{{block}}": the id of overlay "{{overlay}}" is not valid', { block, overlay }); }
    case 'block-member-invalid-reference': { return i18n.t('Block "{{block}}": overlay "{{overlay}}" depends on something outside the block', { block, overlay }); }
    case 'block-broken-reference': { return i18n.t('Block "{{block}}": the clip or overlay it depends on is not in the project', { block }); }
    case 'block-cycle': { return i18n.t('Block "{{block}}": its anchors form a cycle', { block }); }
    case 'block-missing-variable': { return i18n.t('Block "{{block}}" has text variables without a value', { block }); }
    default: { return issue.message; }
  }
}

export function getRenderWarningText(warning: RenderWarning) {
  switch (warning.type) {
    case 'upscale': { return i18n.t('Clip "{{clip}}" is enlarged ×{{factor}}: it may look blurry', { clip: warning.clipName, factor: warning.factor.toFixed(1) }); }
    case 'pillarbox': { return i18n.t('Clip "{{clip}}" gets fill on its sides from {{time}}', { clip: warning.clipName, time: formatDuration({ seconds: warning.time, shorten: true }) }); }
    case 'letterbox': { return i18n.t('Clip "{{clip}}" gets fill above and below from {{time}}', { clip: warning.clipName, time: formatDuration({ seconds: warning.time, shorten: true }) }); }
    case 'fill': {
      const time = formatDuration({ seconds: warning.time, shorten: true });
      return warning.rows
        ? i18n.t('The clips can\'t fill the whole height from {{time}}: {{height}} px are filled', { time, height: warning.width })
        : i18n.t('The clips can\'t fill the whole width from {{time}}: {{width}} px are filled', { time, width: warning.width });
    }
    case 'pin-shifted': {
      const times = { pinTime: formatDuration({ seconds: warning.pinTime, shorten: true }), time: formatDuration({ seconds: warning.time, shorten: true }) };
      return warning.time > warning.pinTime
        ? i18n.t('Clip "{{clip}}" is pinned at {{pinTime}} but starts at {{time}}: there is no room for it then', { clip: warning.clipName, ...times })
        : i18n.t('Clip "{{clip}}" is pinned at {{pinTime}} but starts at {{time}}: the other clips end before', { clip: warning.clipName, ...times });
    }
    case 'group-split': { return i18n.t('The clips {{clips}} are grouped but don\'t all start together', { clips: warning.clipNames.map((name) => `"${name}"`).join(', ') }); }
    case 'extended': {
      const range = { clip: warning.clipName, pixels: warning.pixels, from: formatDuration({ seconds: warning.time, shorten: true }), to: formatDuration({ seconds: warning.endTime, shorten: true }) };
      return warning.rows
        ? i18n.t('Clip "{{clip}}" shows {{pixels}} px above and below its max rectangle from {{from}} to {{to}}, to avoid fill', range)
        : i18n.t('Clip "{{clip}}" shows {{pixels}} px beside its max rectangle from {{from}} to {{to}}, to avoid fill', range);
    }
    case 'truncated': {
      const cut = i18n.t('The mix is longer than its maximum duration: it is cut at {{time}} with the fade-out, {{seconds}} s are left out', { time: formatDuration({ seconds: warning.time, shorten: true }), seconds: Math.round(warning.seconds) });
      const clips = (names: string[]) => names.map((name) => `"${name}"`).join(', ');
      return [
        cut,
        ...(warning.lostClipNames.length > 0 ? [i18n.t('Clips left out: {{clips}}', { clips: clips(warning.lostClipNames) })] : []),
        ...(warning.cutClipNames.length > 0 ? [i18n.t('Clips cut: {{clips}}', { clips: clips(warning.cutClipNames) })] : []),
      ].join('. ');
    }
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

/** The hardware encoder failed mid-render (T25): useMixRender retries with software before giving up. */
export async function showHardwareEncoderFallbackWarning() {
  await getSwal().ReactSwal.fire({
    icon: 'warning',
    title: i18n.t('Hardware encoding failed'),
    text: i18n.t('The hardware encoder failed while rendering. Retrying with software encoding, which is slower.'),
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
