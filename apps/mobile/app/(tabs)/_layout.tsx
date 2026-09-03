/**
 * The tab navigator differs by platform: iOS uses the native `UITabBar`
 * (system material, Liquid Glass on iOS 26) and Android keeps the custom
 * design bar with Archivo labels and the green active dot.
 *
 * Both live in `src/navigation/` rather than beside this file because
 * expo-router globs the routes directory and would otherwise register
 * `_layout.ios` and `_layout.android` as two separate routes. Importing a
 * single specifier instead lets Metro's platform resolution pick the variant,
 * so exactly one navigator ends up in each bundle.
 */

/**
 * Book sits in the middle of the bar but is still the tab the app opens on, so
 * it has to be named explicitly — a navigator otherwise starts on whichever
 * screen is declared first, which is now Bookings.
 */
export const unstable_settings = { initialRouteName: 'index' };

export { default } from '../../src/navigation/TabsLayout';
