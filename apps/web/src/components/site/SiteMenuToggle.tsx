'use client';

import { useEffect, useRef, useState } from 'react';

/** Where the bar stops folding its links into the sheet (header.css.ts). */
const WIDE = '(min-width: 64rem)';

/**
 * The header's small-screen disclosure: below 64rem the four section links, the language
 * and the theme fold into a full-height sheet under the bar, and this button opens it. The
 * green "Book a court" never folds away: it stays in the bar at every width.
 *
 * One set of controls serves every width: at 64rem and up CSS lays the sheet's contents
 * straight into the bar (`display: contents`) and hides this button, so nothing is
 * rendered twice and the theme toggle never has a twin to fall out of step with.
 *
 * It marks the header `data-js` on mount; until then (and without JS at all) the sheet
 * is not a sheet but a second row of the bar, always visible, so the links never depend
 * on a script. Open, the sheet covers the page, so everything beside the header goes
 * `inert` (no tabbing or reading into the covered page) and CSS stops the page scrolling
 * under it. It closes on Escape (focus back here), on a tap outside the header, when one
 * of its links is followed, and when the window widens past the sheet's breakpoint.
 *
 * The icon is two court lines that cross into an X, drawn in CSS so they can turn.
 */
export function SiteMenuToggle({
  controls,
  label,
}: {
  /** The id of the sheet this button shows and hides. */
  controls: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const header = buttonRef.current?.closest<HTMLElement>('.tp-site-header');
    if (!header) return;
    header.setAttribute('data-js', '');
    header.setAttribute('data-menu', open ? 'open' : 'closed');
    if (!open) return;

    const panel = document.getElementById(controls);
    const covered = [...(header.parentElement?.children ?? [])].filter(
      (el): el is HTMLElement => el !== header && el instanceof HTMLElement,
    );
    for (const el of covered) el.inert = true;

    const wide = window.matchMedia(WIDE);
    const onWide = () => {
      if (wide.matches) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!header.contains(event.target as Node)) setOpen(false);
    };
    const onFollow = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest('a')) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    panel?.addEventListener('click', onFollow);
    wide.addEventListener('change', onWide);
    return () => {
      for (const el of covered) el.inert = false;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      panel?.removeEventListener('click', onFollow);
      wide.removeEventListener('change', onWide);
    };
  }, [open, controls]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className="tp-site-iconbtn tp-site-menu-toggle"
      aria-controls={controls}
      aria-expanded={open}
      aria-label={label}
      onClick={() => setOpen((value) => !value)}
    >
      <span className="tp-burger" aria-hidden="true">
        <span />
        <span />
      </span>
    </button>
  );
}
