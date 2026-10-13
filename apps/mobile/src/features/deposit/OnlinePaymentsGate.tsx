import type { ComponentType, ReactElement } from 'react';
import { Redirect } from 'expo-router';
import { onlinePaymentsShipped } from './enabled';

/**
 * Store-build guard for the screens behind online payment and open matches
 * (see ./enabled.ts). A deep link or a push can still reach the route, so the
 * route redirects to Home when the build does not ship the feature.
 *
 * The guard wraps the screen instead of sitting inside it: the screen's own
 * hooks never run in a build that does not ship it (no query, no write).
 */
export function withOnlinePaymentsGate(Screen: () => ReactElement | null): ComponentType<Record<string, never>> {
  function Gated() {
    if (!onlinePaymentsShipped()) return <Redirect href="/(tabs)" />;
    return <Screen />;
  }
  Gated.displayName = `OnlinePaymentsGate(${Screen.name || 'Screen'})`;
  return Gated;
}
