/**
 * The + a screen puts in its native bar (`src/navigation/headerAdd.tsx`), read
 * off the `<Stack.Screen options>` it rendered.
 *
 * `Stack.Screen` renders null in the smoke tests (jest.setup.ts), so the bar's
 * button is never on screen to find by testID. Its options are still props on
 * the rendered tree, and the preset is iOS, so the + is the first of
 * `unstable_headerRightItems`. Pressing it means calling its `onPress` inside
 * `act`.
 *
 * TEST-ONLY.
 */
import type { RenderResult } from '@testing-library/react-native';

type HeaderItem = { label: string; onPress: () => void };

export function headerAdd(screen: RenderResult): HeaderItem | null {
  const screens = screen.UNSAFE_root.findAll(
    (n) => (n.type as { displayName?: string }).displayName === 'Stack.Screen',
  );
  for (const node of screens.reverse()) {
    const items = (node.props as { options?: { unstable_headerRightItems?: () => HeaderItem[] } })
      .options?.unstable_headerRightItems?.();
    if (items && items.length > 0) return items[0] ?? null;
  }
  return null;
}
