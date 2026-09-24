import type { CSSProperties } from 'react';
import { memo } from 'react';
import { FaHandPointUp, FaPlus } from 'react-icons/fa';

import { primaryColor } from '../../colors';
import { mirrorTransform } from '../../util';

/**
 * "New clip from here" (E6): a "+" variant of the mark-start icon (`SetCutpointButton`'s mirrored `FaHandPointUp`),
 * since unlike "Mark start" it always starts a brand new marker, even with the cursor inside another clip.
 * Not tied to the current segment's color (it doesn't edit it), so it's simpler than `SegmentCutpointButton`.
 */
function NewClipFromCursorButton({ onClick, title, style }: {
  onClick?: (() => void) | undefined,
  title?: string | undefined,
  style?: CSSProperties | undefined,
}) {
  return (
    <div
      role="button"
      title={title}
      data-testid="new-clip-from-cursor-button"
      onClick={onClick}
      style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, cursor: 'pointer', ...style }}
    >
      <FaHandPointUp size={13} style={{ color: 'white', padding: '4px 4px 4px 2px', background: 'var(--gray-9)', borderRadius: 6, transform: mirrorTransform }} />
      <FaPlus size={7} style={{ position: 'absolute', right: -2, bottom: -2, color: 'white', background: primaryColor, borderRadius: '50%', padding: 1, boxSizing: 'content-box' }} />
    </div>
  );
}

export default memo(NewClipFromCursorButton);
