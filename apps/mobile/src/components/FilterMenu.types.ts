/**
 * The Join tab's one filter button (Sait, 2026-10-20), round, in the title bar
 * beside the account avatar: a pull-down of choices with a tick on the current one. iOS draws SwiftUI's
 * own `Menu` (`FilterMenu.ios.tsx`), Android Compose's `DropdownMenu`
 * (`FilterMenu.tsx`).
 *
 * `testID` is REQUIRED: the button's wrapper carries it.
 */
export interface FilterMenuOption<T extends string> {
  value: T;
  label: string;
}

export interface FilterMenuProps<T extends string> {
  testID: string;
  /** The button's spoken name while the first option is chosen: "Filter". */
  label: string;
  options: readonly FilterMenuOption<T>[];
  value: T;
  onChange: (next: T) => void;
}
