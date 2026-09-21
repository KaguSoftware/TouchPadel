/**
 * The root layout, mounted for real.
 *
 * This is the ONE file that is not rendered through `renderRoute`: the helper
 * exists to reproduce this layout's provider tree, so putting the layout
 * inside it would nest the providers in themselves — two LocaleProviders, two
 * DirectionRoots, and an `app.direction-root` that matches twice.
 *
 * What it is worth asserting here is what no screen test can: that the file
 * mounts at all. `app/_layout.tsx` does more work at module scope than the
 * rest of the app put together — it asks the splash not to hide, sets the
 * system background, installs a notification handler, starts the auth refresh
 * and focus lifecycles, loads the brand faces — and until today nothing
 * exercised any of it outside a device.
 *
 * It also renders `app.direction-root`, the node every other suite reads its
 * direction from. If that node ever moves or is renamed, this fails first and
 * says so, instead of twenty cases failing with "unable to find".
 */
import { describe, expect, it } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SMOKE_ROUTES } from './routes';
import RootLayout from '../../app/_layout';

// Not through `runSmokeCases` (see above), but still the table's row: the
// coverage test looks for `route: 'app'` in exactly one suite, and the id
// asserted below is the one the table names, not a second copy of it.
const ROOT = SMOKE_ROUTES.find((r) => r.route === 'app')!;

describe('the root layout', () => {
  // ASYNC, unlike every screen case. The layout renders `null` twice on
  // purpose — once while the boot prefs are read off disk, once while the
  // brand faces register — because that is the window the splash is still
  // covering and anything painted in it would flash the wrong language or the
  // wrong theme. `findByTestId` waits for the tree the second of those
  // produces; a synchronous `getBy` here finds an empty render and nothing
  // else, which is the layout working, not failing.
  it('mounts and puts the direction root on screen', async () => {
    const screen = render(<RootLayout />);
    try {
      const root = await screen.findByTestId(ROOT.primary);
      expect(root).toBeTruthy();
      // It carries a resolved Yoga direction, which is the property the smoke
      // helper's `direction()` reads. Seeded from the boot prefs, so with none
      // stored it is the device's — pinned to en-AE in jest.setup.ts.
      const flat = StyleSheet.flatten(root.props.style) as { direction?: string } | undefined;
      expect(flat?.direction).toBe('ltr');
    } finally {
      screen.unmount();
    }
  });
});
