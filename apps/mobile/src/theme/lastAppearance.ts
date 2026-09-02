/**
 * The appearance the app last resolved — readable from OUTSIDE the React tree,
 * for the two fallback screens in app/_layout.tsx (a crash on a dark-mode
 * install must not come up light and flip the OS scheme). Set by the boot
 * hook and by every change in Settings.
 */
export type AppearanceName = 'light' | 'dark';

let current: AppearanceName = 'light';

export function rememberAppearance(appearance: AppearanceName): void {
  current = appearance;
}

export function lastKnownAppearance(): AppearanceName {
  return current;
}
