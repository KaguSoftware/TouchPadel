import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { ScanPage } from '../../src/features/staff/scan/ScanPage';
import { SLIP_ROLES } from '../../src/features/staff/scan/logic';

/**
 * Slips: the waiter's own order slips today (sent to the kitchen, at the till
 * or set aside), with a + in the bar that opens the camera page
 * (app/(staff)/staff-order-slip-new.tsx). The page is
 * src/features/staff/scan/ScanPage.tsx.
 */
export default function StaffOrderSlipRoute() {
  return (
    <RequireStaff page="staff-order-slip" roles={SLIP_ROLES}>
      <ScanPage kind="order_slip" part="log" />
    </RequireStaff>
  );
}
