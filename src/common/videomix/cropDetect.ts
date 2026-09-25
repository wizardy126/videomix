// A7 (v4, T44): parsing of ffmpeg's `cropdetect` output (black bars detection). Shared: main runs ffmpeg (T47) and the
// renderer converts the result to display pixels (renderer/src/videomix/blackBars.ts).

/** A rect in the pixels of the frame `cropdetect` analyzed (coded pixels, after ffmpeg's autorotate). */
export interface CropDetectRect { x: number, y: number, width: number, height: number }

// `[Parsed_cropdetect_0 @ 0x…] x1:0 x2:1919 y1:138 y2:941 w:1920 h:800 x:0 y:142 pts:… t:… limit:… crop=1920:800:0:142`
const boundsRegex = /\bx1:(-?\d+)\s+x2:(-?\d+)\s+y1:(-?\d+)\s+y2:(-?\d+)/;
const cropRegex = /\bcrop=(\d+):(\d+):(-?\d+):(-?\d+)/;

/**
 * The part of the frame with picture over all the frames reported in `output` (the stderr of one or several
 * `cropdetect` runs, e.g. one per sample of the clip or source): the union of the rects of every line. Uses the raw
 * bounds (`x1`…`y2`, inclusive), not `crop=`, which `cropdetect` rounds (`round`, 16 by default) and centres; `crop=`
 * is only the fallback for lines without bounds. Lines with empty bounds (`x2 < x1`, what `cropdetect` reports while
 * every frame so far is black) are ignored. Undefined if no line has picture (e.g. all black, or no cropdetect lines).
 */
export function parseCropDetectOutput(output: string): CropDetectRect | undefined {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  output.split(/\r?\n/).forEach((line) => {
    if (!line.includes('cropdetect')) return;
    let rect: { x1: number, x2: number, y1: number, y2: number } | undefined;
    const bounds = boundsRegex.exec(line);
    if (bounds != null) {
      const [x1, x2, y1, y2] = bounds.slice(1, 5).map(Number) as [number, number, number, number];
      rect = { x1, x2, y1, y2 };
    } else {
      const crop = cropRegex.exec(line);
      if (crop != null) {
        const [w, h, x, y] = crop.slice(1, 5).map(Number) as [number, number, number, number];
        rect = { x1: x, x2: x + w - 1, y1: y, y2: y + h - 1 };
      }
    }
    if (rect == null || rect.x2 < rect.x1 || rect.y2 < rect.y1) return;
    left = Math.min(left, Math.max(0, rect.x1));
    top = Math.min(top, Math.max(0, rect.y1));
    right = Math.max(right, rect.x2 + 1);
    bottom = Math.max(bottom, rect.y2 + 1);
  });
  if (!(right > left && bottom > top)) return undefined;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
