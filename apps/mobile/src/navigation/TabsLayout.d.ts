/**
 * Type surface for the platform-resolved tab layout. Metro picks
 * `TabsLayout.ios.tsx` or `TabsLayout.android.tsx` at bundle time, but
 * TypeScript does not follow platform extensions, so the shared shape is
 * declared here.
 */
declare const TabsLayout: () => JSX.Element;
export default TabsLayout;
