/**
 * Whether an element is narrower than `thresholdPx`.
 *
 * The menu editor lays three columns side by side. At a 1100px window that
 * left the item form about 200px wide, and inline styles cannot carry a media
 * query, so the editor measures its own box and drops the category column into
 * a dropdown when it has to. Measured on the ELEMENT, not the window: the rail
 * can be wider or narrower depending on the workspace.
 */
import { useEffect, useState, type RefObject } from 'react';

export function useNarrow(ref: RefObject<HTMLElement | null>, thresholdPx: number): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setNarrow(el.getBoundingClientRect().width < thresholdPx);
    measure();
    // jsdom has no ResizeObserver; a test renders the wide layout.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, thresholdPx]);
  return narrow;
}
