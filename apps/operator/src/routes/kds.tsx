import { createRoute } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';
import { KdsBoard } from '../features/kds/KdsBoard';
import { StationKindGate } from '../components/StationKindGate';

// F-29: the kitchen board opens on a kitchen screen or the café till it is
// paired with, never on the court desk or the shop station (lib/stationKind.ts).
export const kdsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/kds',
  component: () => (
    <RequireRole route="/kds">
      <StationKindGate screen="kds">
        <KdsBoard />
      </StationKindGate>
    </RequireRole>
  ),
});
