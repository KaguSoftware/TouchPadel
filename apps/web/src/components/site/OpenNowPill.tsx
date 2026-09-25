'use client';

import { useEffect, useState } from 'react';
// Subpath import: the '@touch/i18n' index carries both message catalogs.
import { isolateLtr } from '@touch/i18n/bidi';
import { openState, type OpenState, type OpeningHoursBlob } from '@/lib/site/openNow';

/**
 * "● Open now · 09:00–02:00" (style reference §9), computed IN THE BROWSER on the venue's
 * clock: the page is server-rendered, and a server answer would be as old as the
 * response. Re-checked every minute.
 *
 * Before hydration, and without JS, it renders the honest part it knows without a
 * clock: "Every day · 09:00–02:00" with a neutral dot. The status is never colour alone:
 * the words change with it. The server passes pre-translated strings, so no message
 * catalog ships to the browser for this.
 */
export interface OpenNowLabels {
  openNow: string;
  closedNow: string;
  everyDay: string;
  /** `site.hours.opensAt` already interpolated up to `{time}`, e.g. "Opens {time}". */
  opensAt: string;
}

export function OpenNowPill({
  hours,
  openingHours,
  closedDates,
  labels,
  className,
}: {
  /** The every-day window, already formatted and isolated (lib/site/hours.ts). */
  hours: string;
  openingHours: OpeningHoursBlob;
  closedDates: readonly string[];
  labels: OpenNowLabels;
  className?: string;
}) {
  const [state, setState] = useState<OpenState | null>(null);

  useEffect(() => {
    const tick = () => setState(openState(openingHours, closedDates, new Date()));
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [openingHours, closedDates]);

  let lead = labels.everyDay;
  let status = 'unknown';
  let trail = hours;
  if (state?.open) {
    lead = labels.openNow;
    status = 'open';
  } else if (state) {
    lead = labels.closedNow;
    status = 'closed';
    if (state.opensAt) trail = labels.opensAt.replace('{time}', isolateLtr(state.opensAt));
  }

  return (
    <p className={['tp-open', className].filter(Boolean).join(' ')} data-status={status}>
      <span className="tp-open__dot" aria-hidden="true" />
      <span className="tp-open__lead">{lead}</span>
      <span className="tp-open__sep" aria-hidden="true">
        ·
      </span>
      <span className="tp-open__hours">{trail}</span>
    </p>
  );
}
