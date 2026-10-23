/**
 * Setup's settings pages (management rebuild, 2026-10-17). "Venue settings"
 * was one screen with four tabs, the last of which held fourteen unrelated
 * panels: the owner looking for the deposit rules or the kitchen screen's
 * pairing had to know to open "Venue details" and scroll. Each panel is now a
 * page with its own address, in the family it belongs to
 * (lib/workspaces.ts):
 *
 *   Venue    › Details · Opening hours (/admin/hours) · Business day · Analytics
 *   Courts   › Courts · Booking rules · Online deposit · Open matches · Tournaments
 *   Devices  › Devices · Stations · Kitchen screens · Offline mode
 *   Coaches  › … · Lesson rules (features/admin/coaches/CoachesAdmin.tsx)
 *
 * Nothing about a panel changed: the same component, the same read, the same
 * write, the same owner-only edit with a manager's read-only view. The page's
 * heading comes from its family (PageHeader in a family); its own title is the
 * tab's name, for anyone who reaches it outside the Setup rail.
 */
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MessageKey } from '@touch/i18n';
import { can, useAuth } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { Skeleton } from '../../../components/ui';
import { AsyncStateWrapper, EmptyState, MessagePresenter, PageHeader, asyncStatus } from '../../../components/kit';
import { BranchDetails } from '../branches/BranchesAdmin';
import { DepositSettingsPanel } from '../../deposits/DepositSettingsPanel';
import { useOnlinePaymentsLive } from '../../deposits/useOnlinePaymentsLive';
import { KitchenPairingPanel } from '../KitchenPairing';
import { AnalyticsTab } from './AnalyticsTab';
import { DayServiceTab } from './DayServiceTab';
import { DevicesPanel } from './DevicesPanel';
import { MatchSettingsPanel } from './MatchSettingsPanel';
import { StationsPanel } from './StationsPanel';
import { TournamentsSettingsPanel } from './TournamentsSettingsPanel';
import { VENUE_ADMIN_KEY, fetchVenueAdmin, type VenueAdminRow } from './venueQueries';
import { FixedAtSetupPanel, TaxGroupsPanel, VenuePartFacts, VenuePartForm, type VenuePart } from './venueParts';

/** One settings page: its heading, then its panels at a readable width. */
function SettingsPage({ title, children }: { title: MessageKey; children: ReactNode }) {
  const { tr } = useLocale();
  return (
    <div>
      <PageHeader title={tr(title)} />
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', maxInlineSize: 'var(--tp-measure-wide)' }}>{children}</div>
    </div>
  );
}

/** The venue row every venue page reads (app.venue_admin through venueQueries). */
function WithVenue({ children }: { children: (venue: VenueAdminRow) => ReactNode }) {
  const venueQ = useQuery({ queryKey: VENUE_ADMIN_KEY, queryFn: fetchVenueAdmin, staleTime: 60_000 });
  return (
    <AsyncStateWrapper status={asyncStatus(venueQ, () => false)} error={venueQ.error} onRetry={() => void venueQ.refetch()} skeleton={<Skeleton lines={6} />}>
      {venueQ.data ? children(venueQ.data) : null}
    </AsyncStateWrapper>
  );
}

/** One part of the venue form: the owner edits it, a manager reads it with the reason. */
function VenuePart({ part, lockNote }: { part: VenuePart; lockNote: boolean }) {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const canEdit = can(staff, 'editVenueDetails');
  return (
    <>
      {!canEdit && lockNote && <MessagePresenter tone="info" icon="lock" message={tr('ws.owner.settings.details.ownerOnly')} />}
      {/* Booking rules and offline mode are the whole page, so their panel needs no second title; the
          venue's name sits beside what was fixed at setup, so it keeps its own. */}
      <WithVenue>
        {(venue) =>
          canEdit ? (
            <VenuePartForm saved={venue} part={part} untitled={part !== 'venue'} />
          ) : (
            <VenuePartFacts venue={venue} part={part} untitled={part !== 'venue'} />
          )
        }
      </WithVenue>
    </>
  );
}

/** Online deposits and open matches stay closed while online payments are paused; a direct link says so. */
function WhenPaymentsLive({ children }: { children: ReactNode }) {
  const { tr } = useLocale();
  const live = useOnlinePaymentsLive();
  if (live) return <>{children}</>;
  return <EmptyState icon="card" title={tr('ws.owner.settings.paused.title')} body={tr('ws.owner.settings.paused.body')} />;
}

// --- Venue ------------------------------------------------------------------

/**
 * Settings › Branches › a branch's Branch details (`/admin/settings`): the
 * branch in scope, reached by its card in the branch list. Its name heads the
 * page in the branch's colour (Sait, 2026-10-22); the owner also sees where it
 * stands, its checklist, Open and Close.
 */
export function VenueDetailsScreen() {
  return (
    <BranchDetails>
      <VenuePart part="venue" lockNote />
      <WithVenue>{(venue) => <FixedAtSetupPanel venue={venue} />}</WithVenue>
      <TaxGroupsPanel />
    </BranchDetails>
  );
}

/** Venue › Business day (`/admin/settings/day`): when a day starts, and the waiter-call wait. */
export function BusinessDayScreen() {
  return (
    <SettingsPage title="ws.shell.nav.businessDay">
      <DayServiceTab />
    </SettingsPage>
  );
}

/** Settings › Branches › Analytics settings (`/admin/settings/analytics`): what analytics leaves out. Owner only. */
export function AnalyticsSettingsScreen() {
  return (
    <SettingsPage title="ws.shell.nav.analyticsSettings">
      <AnalyticsTab />
    </SettingsPage>
  );
}

// --- Courts -----------------------------------------------------------------

/** Courts › Booking rules (`/admin/settings/booking`). */
export function BookingRulesScreen() {
  return (
    <SettingsPage title="ws.shell.nav.bookingRules">
      <VenuePart part="booking" lockNote />
    </SettingsPage>
  );
}

/** Courts › Online deposit (`/admin/settings/deposit`). */
export function OnlineDepositScreen() {
  const { staff } = useAuth();
  return (
    <SettingsPage title="ws.shell.nav.onlineDeposit">
      <WhenPaymentsLive>
        <DepositSettingsPanel canEdit={can(staff, 'editVenueDetails')} />
      </WhenPaymentsLive>
    </SettingsPage>
  );
}

/** Courts › Open matches (`/admin/settings/matches`). */
export function OpenMatchesSettingsScreen() {
  const { staff } = useAuth();
  return (
    <SettingsPage title="ws.shell.nav.openMatches">
      <WhenPaymentsLive>
        <MatchSettingsPanel canEdit={can(staff, 'editVenueDetails')} />
      </WhenPaymentsLive>
    </SettingsPage>
  );
}

/** Courts › Tournaments (`/admin/settings/tournaments`). */
export function TournamentsSettingsScreen() {
  const { staff } = useAuth();
  return (
    <SettingsPage title="ws.shell.nav.tournamentRules">
      <TournamentsSettingsPanel canEdit={can(staff, 'editVenueDetails')} />
    </SettingsPage>
  );
}

// --- Devices ----------------------------------------------------------------

/** Devices › Devices (`/admin/settings/devices`): every till, desk and kitchen screen that reported in. */
export function DevicesScreen() {
  return (
    <SettingsPage title="ws.shell.nav.devices">
      <WithVenue>{(venue) => <DevicesPanel staleSeconds={venue.heartbeat_stale_seconds} />}</WithVenue>
    </SettingsPage>
  );
}

/** Devices › Stations (`/admin/settings/stations`): register this machine at the branch, retire a gone one. */
export function StationsScreen() {
  return (
    <SettingsPage title="ws.shell.nav.stations">
      <StationsPanel />
    </SettingsPage>
  );
}

/** Devices › Kitchen screens (`/admin/settings/kitchen`): pair a kitchen screen to this till. Owner only. */
export function KitchenScreensScreen() {
  return (
    <SettingsPage title="ws.shell.nav.kitchenScreens">
      <KitchenPairingPanel />
    </SettingsPage>
  );
}

/** Devices › Offline mode (`/admin/settings/offline`). */
export function OfflineModeScreen() {
  return (
    <SettingsPage title="ws.shell.nav.offlineMode">
      <VenuePart part="offline" lockNote={false} />
    </SettingsPage>
  );
}
