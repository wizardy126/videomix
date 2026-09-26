import { useEffect, useState } from 'react';

/**
 * T49: a strip above the player for the rect editor's toolbar (portalled into it by ClipRectEditor), so the toolbar
 * never covers the rects, their handles or their labels. `height` is what the player area must leave free above it
 * (0 while the strip is empty).
 */
export default function useMixToolbarSlot() {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (slot == null) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry == null) return;
      setHeight(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(slot);
    return () => observer.disconnect();
  }, [slot]);

  return { slot, setSlot, height };
}
