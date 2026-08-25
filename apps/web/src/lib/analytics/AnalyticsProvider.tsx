'use client';

import { useEffect } from 'react';

import { initAnalytics, registerSuperProps } from './posthog';

export type AnalyticsProviderProps = {
  locale: string;
  /** Table number once the QR session is bound; null while browsing without a table. */
  tableNumber: string | null;
};

/**
 * Mounts PostHog for the GUEST cafe app only (never the operator app).
 * Renders nothing. No-ops entirely when NEXT_PUBLIC_POSTHOG_KEY is unset or the
 * viewer switched analytics off — see posthog.ts.
 */
export function AnalyticsProvider({ locale, tableNumber }: AnalyticsProviderProps): null {
  useEffect(() => {
    initAnalytics(locale);
  }, [locale]);

  useEffect(() => {
    registerSuperProps({
      locale,
      has_table: tableNumber !== null,
      ...(tableNumber !== null ? { table_number: tableNumber } : {}),
    });
  }, [locale, tableNumber]);

  return null;
}

export default AnalyticsProvider;
