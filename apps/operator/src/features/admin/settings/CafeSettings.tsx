/**
 * `/admin/settings` mounts `CafeSettings` (routes/admin/settings.tsx, shell
 * lane). Since 06.49 that name resolves to the merged VenueSettingsScreen —
 * opening hours, day & service, analytics, venue details — so the route file
 * needs no edit. The tabs live in DayServiceTab, AnalyticsTab and
 * VenueDetailsTab.
 */
export { VenueSettingsScreen as CafeSettings, VenueSettingsScreen } from './VenueSettings';
