import type { KeyboardAction } from '../types.ts';

/**
 * The app always runs as VideoMix (01-requisitos P1). The LosslessCut code paths that don't apply are switched off with
 * this flag instead of being deleted, so the changes to the inherited files stay small and easy to follow.
 * Typed as `boolean` so the disabled branches still type-check. Shared by main (menu, default key bindings) and the
 * renderer.
 */
export const videoMixMode = true as boolean;

/**
 * LosslessCut actions that make no sense in a VideoMix project (T16): lossless export options, tracks, batch/concat,
 * segment selection/tags/expressions, bulk segment generation, scene detection, file operations that load a different
 * file than the project's sources, rotation and timecode offset.
 * They are left out of the menu, the default key bindings and the keyboard shortcuts dialog, and do nothing if an
 * older config still binds them or the HTTP API calls them. The code behind them stays for the non-VideoMix mode.
 */
export const retiredKeyboardActions: ReadonlySet<KeyboardAction> = new Set<KeyboardAction>([
  // segments: "Add clip", "Duplicate clip" and "Remove clip" replace the first three
  'addSegment',
  'duplicateCurrentSegment',
  'removeCurrentSegment',
  'editCurrentSegmentTags',
  'copySegmentsToClipboard',
  'reorderSegsByStartTime',
  'invertAllSegments',
  'fillSegmentsGaps',
  'shiftAllSegmentTimes',
  'alignSegmentTimesToKeyframes',
  'combineOverlappingSegments',
  'combineSelectedSegments',
  'shuffleSegments',
  'clearSegments',
  // bulk segment generation / detection
  'createSegmentsFromKeyframes',
  'createFixedDurationSegments',
  'createNumSegments',
  'createFixedByteSizedSegments',
  'createRandomSegments',
  'detectBlackScenes',
  'detectSilentScenes',
  'detectSceneChanges',
  // segment selection (the clip list has no selection; a deselected segment would still be rendered)
  'selectSegmentsAtCursor',
  'selectOnlyCurrentSegment',
  'toggleCurrentSegmentSelected',
  'deselectAllSegments',
  'selectAllSegments',
  'invertSelectedSegments',
  'removeSelectedSegments',
  'selectAllMarkers',
  'selectSegmentsByLabel',
  'selectSegmentsByExpr',
  'labelSelectedSegments',
  'mutateSegmentsByExpr',
  'extractSelectedSegmentsFramesAsImages',
  // tracks (the render decides which streams it uses)
  'toggleStreamsSelector',
  'showStreamsSelector',
  'extractAllStreams',
  'showIncludeExternalStreamsDialog',
  'toggleStripAudio',
  'toggleStripVideo',
  'toggleStripSubtitle',
  'toggleStripThumbnail',
  'toggleStripCurrentFilter',
  'toggleStripAll',
  // lossless export
  'toggleKeyframeCutMode',
  'captureSnapshotAsCoverArt',
  'exportYouTube',
  // batch list and concat (the sources list replaces them)
  'batchPreviousFile',
  'batchNextFile',
  'batchOpenPreviousFile',
  'batchOpenNextFile',
  'batchOpenSelectedFile',
  'closeBatch',
  'concatBatch',
  'convertFormatBatch',
  // file operations: they would trash the project's sources or load a new file that isn't a source
  'cleanupFilesDialog',
  'fixInvalidDuration',
  'decimate',
  // rotation doesn't reach the render (T06/T07) and the timecode offset only changes the displayed times
  'increaseRotation',
  'setStartTimeOffset',
  'makeCursorTimeZero',
]);

export const isKeyboardActionRetired = (action: KeyboardAction) => videoMixMode && retiredKeyboardActions.has(action);
