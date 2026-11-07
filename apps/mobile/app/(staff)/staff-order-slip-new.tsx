import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { ScanPage } from '../../src/features/staff/scan/ScanPage';
import { SLIP_ROLES } from '../../src/features/staff/scan/logic';

/**
 * Scan an order (Phase 2 Milestone 4b, 0238/0239): the waiter photographs a
 * handwritten order slip; the till checks it and sends it to the kitchen.
 * Only the photo card is here; the list of slips is the page behind it
 * (app/(staff)/staff-order-slip.tsx), which this page returns to after a send.
 */
export default function StaffOrderSlipNewRoute() {
  return (
    <RequireStaff page="staff-order-slip-new" roles={SLIP_ROLES}>
      <ScanPage kind="order_slip" part="capture" />
    </RequireStaff>
  );
}
