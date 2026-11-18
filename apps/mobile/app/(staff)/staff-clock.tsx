import { Redirect, useLocalSearchParams } from 'expo-router';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { useStaffStatus } from '../../src/features/staff/StaffStatusProvider';
import { ClockPage } from '../../src/features/staff/clock/ClockPage';
import { clocksIn, kindParam } from '../../src/features/staff/clock/logic';

/**
 * Start or finish work (0442; docs/design/clock-in/contracts-2026-11-15.md),
 * opened from Today's work card with `kind` in or out. Never a blocked page
 * (contract §3), and never the owner's: the owner logs no hours. The location
 * prompt lives behind this screen alone (src/features/staff/clock/location.ts).
 */
function StaffClock() {
  const { kind: raw } = useLocalSearchParams<{ kind?: string }>();
  const { status } = useStaffStatus();
  const kind = kindParam(raw);
  if (status.kind !== 'staff') return null;
  if (!kind || !clocksIn(status.staff.role)) return <Redirect href="/staff" />;
  return <ClockPage kind={kind} />;
}

export default function StaffClockRoute() {
  return (
    <RequireStaff page="staff-clock">
      <StaffClock />
    </RequireStaff>
  );
}
