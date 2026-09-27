/**
 * The transactions behind a pulse tile, the way the management panel opens
 * them: `report_drill` for the figure over the page's dates, in the reports'
 * DrillDialog (when, what in words, who, amount — never raw column keys). One layer per tab; a tile calls `open` with the panel's
 * figure key, so the same figure lists the same rows on both screens.
 *
 * The court filter narrows court figures (`court:<uuid>` as the key); venue-
 * wide and cafe figures pass no key.
 */
import { useState, type ReactNode } from 'react';
import type { DateRange } from '@touch/core';
import { DrillDialog } from '../reports/DrillDialog';

/** The report_drill figure keys a pulse tile can open. */
export type DrillFigure =
  | 'revenue'
  | 'padelRevenue'
  | 'cafeNet'
  | 'cash'
  | 'card'
  | 'discounts'
  | 'refunds'
  | 'waste'
  | 'orders'
  | 'bookings'
  | 'noShows'
  | 'cancellations';

export interface DrillTarget {
  figure: DrillFigure;
  /** What the modal title calls it — the tile's label. */
  label: string;
  /** A court uuid when the court filter narrows this figure. */
  courtId?: string | null;
}

export interface AnalyticsDrill {
  open: (target: DrillTarget) => void;
  layer: ReactNode;
}

export function useAnalyticsDrill(range: DateRange): AnalyticsDrill {
  const [target, setTarget] = useState<DrillTarget | null>(null);
  const layer = target ? (
    <DrillDialog
      request={{
        what: target.label,
        figures: [{ key: target.figure, label: target.label }],
        scope: target.courtId ? `court:${target.courtId}` : null,
        from: range.from,
        to: range.to,
      }}
      onClose={() => setTarget(null)}
    />
  ) : null;
  return { open: setTarget, layer };
}
