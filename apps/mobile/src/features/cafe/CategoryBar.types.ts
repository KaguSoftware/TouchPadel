/**
 * The café menu's category bar (`CafeMenuView`), drawn per platform:
 * `CategoryBar.tsx` (one bar for every platform: real Liquid Glass on iOS 26, the tab bar's
 * fill elsewhere).
 */
export interface CategoryChip {
  id: string;
  label: string;
}

export interface CategoryBarProps {
  chips: readonly CategoryChip[];
  /** The category under the menu's reading line, or the one just tapped. */
  active: string | null;
  onPick: (id: string) => void;
  /** `<route>.<element>`; each chip is `${testID}.category.<id>`. */
  testID: string;
}
