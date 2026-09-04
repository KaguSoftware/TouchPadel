/**
 * `/admin/settings` mounts `CafeSettings` (routes/admin/settings.tsx, shell
 * lane). Since 06.49 that name resolves to the merged VenueSettingsScreen —
 * hours & closed days, trading, cafe, contact — so the route file needs no
 * edit. The cafe-only body lives in CafeSettingsTab.tsx.
 */
export { VenueSettingsScreen as CafeSettings, VenueSettingsScreen } from './VenueSettings';
