'use client';

import { useId, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

export interface TournamentTab {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * The tournament page's segmented switch (`app/[locale]/events/[id]/page.tsx`): "Standings" and
 * "Schedule" as two segments over one panel. Both panels are rendered by the server and only
 * hidden here, so a visitor without script still reads the first, and a 30 s refresh in play
 * keeps the chosen segment. Arrow keys move between the segments (Home and End jump), as a
 * native segmented control does. The blue thumb is one element that slides to the chosen segment.
 */
export function TournamentTabs({
  tabs,
  label,
  initial,
}: {
  tabs: TournamentTab[];
  label: string;
  initial?: string;
}) {
  const base = useId();
  const [active, setActive] = useState(initial ?? tabs[0]?.id ?? '');
  const activeIndex = tabs.findIndex((tab) => tab.id === active);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    const step =
      e.key === 'ArrowRight' ? (rtl ? -1 : 1) : e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
    let next = index;
    if (step !== 0) next = (index + step + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    setActive(tabs[next]!.id);
    document.getElementById(`${base}-tab-${tabs[next]!.id}`)?.focus();
  };
  return (
    <div className="tp-tpage__tabs-wrap">
      <div className="tp-tpage__tabs" role="tablist" aria-label={label}>
        <span
          className="tp-tpage__thumb"
          aria-hidden="true"
          style={
            {
              '--tp-tab-n': tabs.length,
              '--tp-tab-i': Math.max(0, activeIndex),
            } as CSSProperties
          }
        />
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            id={`${base}-tab-${tab.id}`}
            type="button"
            role="tab"
            className="tp-tpage__tab"
            aria-selected={active === tab.id}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => setActive(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${base}-panel-${tab.id}`}
          role="tabpanel"
          className="tp-tpage__panel"
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={active !== tab.id}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
