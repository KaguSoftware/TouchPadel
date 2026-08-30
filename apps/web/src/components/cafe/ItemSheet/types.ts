import type { Locale } from '@touch/i18n';
import type { BasketLine } from '@/lib/cafe/basket';
import type { CafeSettings, MenuItem } from '@/lib/menu';

/**
 * Item sheet contract (web-slice §2). The sheet owns its own selection,
 * quantity, note and lightbox state; the shell owns which item is open.
 */
export type ItemSheetProps = {
  locale: Locale;
  /** null → the sheet renders nothing (the shell keeps it mounted). */
  item: MenuItem | null;
  settings: CafeSettings;
  /** flat menu lookup — resolves `suggestedItemIds` for the "goes well with" rail */
  itemsById: Map<string, MenuItem>;
  /**
   * item id -> its category `name_en`. Resolves the section icon that stands in
   * for a missing photo, exactly as the menu row does.
   */
  categoryNames: Map<string, string>;
  onClose(): void;
  onAdd(line: BasketLine): void;
  onOpenSuggested(item: MenuItem): void;
  /** analytics: fired once per opened item */
  onViewed?(item: MenuItem): void;
  /** analytics: fired when the sheet closes without an add */
  onAbandon?(item: MenuItem, dwellMs: number): void;
};

/** One chosen modifier (the UI never picks a modifier more than once). */
export interface ChosenModifier {
  modifierId: string;
  qty: number;
}
