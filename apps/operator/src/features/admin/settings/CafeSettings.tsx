/**
 * `/admin/settings` mounts `VenueDetailsScreen` (routes/admin/settings.tsx).
 * "Venue settings" was split into pages by the management rebuild
 * (2026-10-17, SettingsPages.tsx); this name stays for anything that still
 * imports it.
 */
export { VenueDetailsScreen as CafeSettings } from './SettingsPages';
