/**
 * The guest tabs, or the staff area (build-contracts-2026-09-23 §6.8 item 2).
 *
 * app/(tabs)/_layout.tsx re-exports this in place of the platform tab layout.
 * A guest (and a signed-out phone) gets exactly the layout it always had; a
 * staff session is sent to Today before the tab navigator, or the 3D court
 * under the Book tab, ever mounts. Every hard-coded `/(tabs)` target in the
 * app lands here, so this one gate catches all of them.
 *
 * The one exception is "Show guest view" (guestPreview.ts, owner 2026-09-28):
 * a staff session that asked for it gets the tabs, and the account page (no
 * longer a tab since 2026-10-17, app/profile.tsx) carries the "Back to staff
 * view" pill. Anything but an active staff account drops the preview.
 */
import { useEffect } from 'react';
import { useResetTo } from '../../navigation/back';
import TabsLayout from '../../navigation/TabsLayout';
import { guestTabsGate } from './gate';
import { setGuestPreview, useGuestPreview } from './guestPreview';
import { StaffPending } from './RequireStaff';
import { useStaffStatus } from './StaffStatusProvider';

export default function GuestTabsGate() {
  const { status } = useStaffStatus();
  const previewing = useGuestPreview();
  const staff = status.kind === 'staff';

  useEffect(() => {
    if (!staff && status.kind !== 'pending' && previewing) setGuestPreview(false);
  }, [staff, status.kind, previewing]);

  switch (guestTabsGate(status, previewing)) {
    case 'loading':
      return <StaffPending />;
    case 'redirect-staff':
      return <ToStaff />;
    default:
      return <TabsLayout />;
  }
}

/**
 * Today as the only screen. A `<Redirect>` replaced just the tabs, so "Back to
 * staff view" left the Today the guest view started from underneath, and every
 * round trip stacked another one.
 */
function ToStaff() {
  const resetTo = useResetTo();
  useEffect(() => resetTo('/staff'), [resetTo]);
  return <StaffPending />;
}
