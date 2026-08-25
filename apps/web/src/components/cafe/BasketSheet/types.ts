import type { Locale } from '@touch/i18n';
import type { BasketLine } from '@/lib/cafe/basket';

/**
 * Basket sheet contract (web-slice §2 / §6.2). Every total is computed by the
 * basket hook and passed in — the sheet does no money arithmetic beyond the
 * per-line `lineTotal` display.
 */
export type BasketSheetProps = {
  locale: Locale;
  open: boolean;
  lines: BasketLine[];
  /** order-level note for the waiter (≤ 200 chars) */
  note: string;
  subtotal: number;
  discountTotal: number;
  total: number;
  /** venue is in degraded mode — the server will refuse the order */
  degraded: boolean;
  sending: boolean;
  /** a table session is bound; when false the parent opens the QR sheet on submit */
  tableBound: boolean;
  onClose(): void;
  onSetQty(key: string, qty: number): void;
  onRemove(key: string): void;
  onSetNote(note: string): void;
  onSubmit(): void;
  onBrowse(): void;
};
