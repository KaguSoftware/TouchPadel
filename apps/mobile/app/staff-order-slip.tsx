import { RequireStaff } from '../src/features/staff/RequireStaff';
import { ScanPage } from '../src/features/staff/scan/ScanPage';
import { SLIP_ROLES } from '../src/features/staff/scan/logic';

/**
 * Scan an order (Phase 2 Milestone 4b, 0238/0239): the waiter photographs a
 * handwritten order slip; the till checks it and sends it to the kitchen.
 * The page is src/features/staff/scan/ScanPage.tsx.
 */
export default function StaffOrderSlipRoute() {
  return (
    <RequireStaff roles={SLIP_ROLES}>
      <ScanPage kind="order_slip" />
    </RequireStaff>
  );
}
