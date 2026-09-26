/**
 * The guest tabs, or the staff area (build-contracts-2026-09-23 §6.8 item 2).
 *
 * app/(tabs)/_layout.tsx re-exports this in place of the platform tab layout.
 * A guest (and a signed-out phone) gets exactly the layout it always had; a
 * staff session is sent to Today before the tab navigator, or the 3D court
 * under the Book tab, ever mounts. Every hard-coded `/(tabs)` target in the
 * app lands here, so this one gate catches all of them.
 */
import { Redirect } from 'expo-router';
import TabsLayout from '../../navigation/TabsLayout';
import { guestTabsGate } from './gate';
import { StaffPending } from './RequireStaff';
import { useStaffStatus } from './StaffStatusProvider';

export default function GuestTabsGate() {
  const { status } = useStaffStatus();
  switch (guestTabsGate(status)) {
    case 'loading':
      return <StaffPending />;
    case 'redirect-staff':
      return <Redirect href="/staff" />;
    default:
      return <TabsLayout />;
  }
}
