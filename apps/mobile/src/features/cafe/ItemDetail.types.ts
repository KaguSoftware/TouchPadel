import type { MenuViewItem } from './logic';

export interface ItemDetailProps {
  /** The opened item; null while the sheet is closed. */
  item: MenuViewItem | null;
  /** The item's category (English name), whose drawing stands in for a missing photo. */
  categoryEn: string;
  /** `<route>.detail`; the parts take `.scroll`, `.photo`, `.name`, `.description`, `.zoom`, `.zoomClose`. */
  testID: string;
  onClose(): void;
}
