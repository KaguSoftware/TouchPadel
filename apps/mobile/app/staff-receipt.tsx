import { RequireStaff } from '../src/features/staff/RequireStaff';
import { ScanPage } from '../src/features/staff/scan/ScanPage';
import { RECEIPT_ROLES } from '../src/features/staff/scan/logic';

/**
 * Scan a receipt (Phase 2 Milestone 4b, 0236/0237): the driver or a manager
 * photographs a supplier's receipt; a manager checks it in Goods in and puts
 * it into stock. The page is src/features/staff/scan/ScanPage.tsx.
 */
export default function StaffReceiptRoute() {
  return (
    <RequireStaff roles={RECEIPT_ROLES}>
      <ScanPage kind="receipt" />
    </RequireStaff>
  );
}
