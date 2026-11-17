import type { Deal, DealVoucher } from '@touch/core/loyalty';

export interface DealSheetProps {
  /** `<route>.deal-sheet`; the parts take `.scroll`, `.name`, `.fact.<key>`, `.redeem`, `.show`. */
  testID: string;
  /** The opened deal; null while the sheet is closed. */
  deal: Deal | null;
  /** The deal's live 15-minute code (redeem_deal), or null. */
  voucher: DealVoucher | null;
  /** The member's points in the last 12 months, for what a locked deal's card still needs. */
  points12m: number;
  tz: string;
  /** A Redeem is on its way. */
  busy: boolean;
  onRedeem: (promotionId: string) => void;
  onShowCode: (voucherId: string) => void;
  onClose: () => void;
}
