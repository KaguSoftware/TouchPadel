/**
 * The ONLY global CSS in the operator app (everything else is inline +
 * logical properties): keyframes used by Spinner/Skeleton/stale-ticket pulse,
 * and print rules for the A6 QR cards. Mounted once in routes/__root.tsx.
 */
import { useEffect } from 'react';

const GLOBAL_CSS = `
@keyframes tpPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
@keyframes tpSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes tpMarquee {
  from { transform: translateX(calc(100% * var(--tp-dir-sign, 1))); }
  to { transform: translateX(calc(-100% * var(--tp-dir-sign, 1))); }
}
@media print {
  [data-no-print] { display: none !important; }
  body { background: #fff; }
  body[data-print="a6"] { margin: 0; }
  body[data-print="a6"] [data-print-page] {
    inline-size: 105mm;
    block-size: 148mm;
    overflow: hidden;
    break-after: page;
    page-break-after: always;
  }
}
`;

/** `@page` cannot be scoped by a selector, so it is injected only while body[data-print="a6"]. */
const A6_PAGE_CSS = '@page { size: A6 portrait; margin: 0; }';
const A6_STYLE_ID = 'tp-page-a6';

export type PrintMode = 'a6';

export function GlobalStyles() {
  useEffect(() => {
    const el = document.createElement('style');
    el.id = A6_STYLE_ID;
    el.textContent = A6_PAGE_CSS;
    const sync = () => {
      const on = document.body.dataset.print === 'a6';
      if (on && !el.isConnected) document.head.appendChild(el);
      else if (!on && el.isConnected) el.remove();
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-print'] });
    sync();
    return () => {
      observer.disconnect();
      el.remove();
    };
  }, []);
  return <style>{GLOBAL_CSS}</style>;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Print with a page mode: sets `body[data-print]`, waits a frame so the
 * `@page` rule and print CSS apply, opens the print dialog, then clears.
 */
export async function printWithMode(mode: PrintMode): Promise<void> {
  document.body.dataset.print = mode;
  try {
    await nextFrame();
    window.print();
  } finally {
    delete document.body.dataset.print;
  }
}
