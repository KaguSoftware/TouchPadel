import * as Linking from 'expo-linking';
import { RESET_REDIRECT, VERIFY_REDIRECT } from './api';

/**
 * Where GoTrue should send the browser after it has processed an auth email.
 *
 * These CANNOT be the hardcoded `touchpadel://` constants alone: that scheme is
 * only owned by a real build. Under Expo Go the app lives at
 * `exp://<lan-ip>:8081/--/verify-email`, so a hardcoded scheme link dead-ends
 * on a phone that has no standalone build installed — which makes the whole
 * flow untestable during development.
 *
 * Linking.createURL() resolves per environment:
 *   Expo Go      exp://192.168.x.x:8081/--/verify-email
 *   dev / prod   touchpadel://verify-email
 *
 * EVERY form that can be produced must be in the project's redirect allow-list
 * or GoTrue silently substitutes the Site URL. For local dev that means a
 * wildcard entry (`exp://*`); the constants below cover the built app.
 */
export function verifyRedirect(): string {
  return Linking.createURL('verify-email');
}

export function resetRedirect(): string {
  return Linking.createURL('reset-password');
}

/** Re-exported so the built-app targets stay discoverable from one place. */
export { RESET_REDIRECT, VERIFY_REDIRECT };
