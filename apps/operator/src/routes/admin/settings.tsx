import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { RoutePending, guarded } from './_shared';

// Setup's settings pages (management rebuild, 2026-10-17;
// features/admin/settings/SettingsPages.tsx). `/admin/settings` stays the
// venue's address (Venue › Details); each panel that sat inside "Venue
// settings" is now a page of its own under it, in the family it belongs to
// (lib/workspaces.ts VENUE_TABS, COURTS_TABS, DEVICES_TABS). Written out one
// by one: the router's path types come from each literal `path`.
const load = () => import('../../features/admin/settings/SettingsPages');

/** Venue › Details: the name, phone and what was fixed at setup. */
export const adminSettingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'settings',
  component: guarded('/admin/settings', lazyRouteComponent(load, 'VenueDetailsScreen')),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});

/** Venue › Business day. */
export const adminSettingsDayRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'settings/day',
  component: guarded('/admin/settings/day', lazyRouteComponent(load, 'BusinessDayScreen')),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});

/** Venue › Analytics (owner only). */
export const adminSettingsAnalyticsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'settings/analytics',
  component: guarded('/admin/settings/analytics', lazyRouteComponent(load, 'AnalyticsSettingsScreen')),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});

/** Courts › Booking rules. */
export const adminSettingsBookingRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'settings/booking',
  component: guarded('/admin/settings/booking', lazyRouteComponent(load, 'BookingRulesScreen')),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});

/** Courts › Online deposit. */
export const adminSettingsDepositRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'settings/deposit',
  component: guarded('/admin/settings/deposit', lazyRouteComponent(load, 'OnlineDepositScreen')),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});

/** Courts › Open matches. */
export const adminSettingsMatchesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'settings/matches',
  component: guarded('/admin/settings/matches', lazyRouteComponent(load, 'OpenMatchesSettingsScreen')),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});

/** Courts › Tournaments. */
export const adminSettingsTournamentsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'settings/tournaments',
  component: guarded('/admin/settings/tournaments', lazyRouteComponent(load, 'TournamentsSettingsScreen')),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});

/** Devices › Devices. */
export const adminSettingsDevicesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'settings/devices',
  component: guarded('/admin/settings/devices', lazyRouteComponent(load, 'DevicesScreen')),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});

/** Devices › Stations. */
export const adminSettingsStationsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'settings/stations',
  component: guarded('/admin/settings/stations', lazyRouteComponent(load, 'StationsScreen')),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});

/** Devices › Kitchen screens (owner only). */
export const adminSettingsKitchenRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'settings/kitchen',
  component: guarded('/admin/settings/kitchen', lazyRouteComponent(load, 'KitchenScreensScreen')),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});

/** Devices › Offline mode. */
export const adminSettingsOfflineRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'settings/offline',
  component: guarded('/admin/settings/offline', lazyRouteComponent(load, 'OfflineModeScreen')),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});
