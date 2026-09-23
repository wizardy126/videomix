// eslint-disable-next-line import/no-extraneous-dependencies
import { describe, test, expect } from 'vitest';

import { isKeyboardActionRetired, retiredKeyboardActions, videoMixMode } from './legacyUi.ts';
import type { KeyboardAction } from '../types.ts';

describe('retired LosslessCut actions', () => {
  test('the app runs as VideoMix', () => {
    expect(videoMixMode).toBe(true);
  });

  test('actions used to mark times, play, edit clips and render stay available', () => {
    const kept: KeyboardAction[] = [
      'setCutStart', 'setCutEnd', 'splitCurrentSegment', 'removeCurrentCutpoint', 'labelCurrentSegment', 'undo', 'redo',
      'togglePlayResetSpeed', 'seekBackwards', 'seekForwardsKeyframe', 'jumpCutStart', 'jumpNextSegment', 'timelineZoomIn',
      'captureSnapshot', 'toggleWaveformMode', 'toggleShowThumbnails', 'toggleShowKeyframes', 'toggleSettings', 'toggleKeyboardShortcuts',
      'openFilesDialog', 'export', 'html5ify',
      'newProject', 'openProject', 'saveProject', 'saveProjectAs', 'addSourcesDialog', 'addClip', 'duplicateCurrentClip', 'removeCurrentClip',
      'showMixSettings', 'previewMix', 'renderMix', 'clearRenderCache',
    ];
    expect(kept.filter((action) => isKeyboardActionRetired(action))).toEqual([]);
  });

  test('lossless export, tracks, batch and segment bulk operations are retired', () => {
    const retired: KeyboardAction[] = ['addSegment', 'cleanupFilesDialog', 'concatBatch', 'toggleStripAll', 'detectSceneChanges', 'selectSegmentsByExpr', 'increaseRotation', 'exportYouTube'];
    expect(retired.every((action) => isKeyboardActionRetired(action))).toBe(true);
    expect(retiredKeyboardActions.size).toBeGreaterThan(retired.length);
  });
});
