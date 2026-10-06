/**
 * PHONE_TAKEN on the phone (build contracts L-3, §2). PURE.
 *
 * After the one-time merge a live profile's phone is unique (`profiles_phone_key_live`), and a
 * guest's own edit that collides is refused with PHONE_TAKEN by the profile trigger. Two screens
 * write `profiles.phone`: Edit profile's number form (directly, when no code is needed) and
 * verify-otp's link mode (after the code proved the number). Both read the refusal here, through
 * the one shared resolver (`mapErrorToKey`, the catalogue's `op.errors.PHONE_TAKEN`), and put it
 * where the number is, not as a generic failure.
 *
 * GoTrue's own `phone_exists` (another AUTH user holds the number) is not this: it is raised
 * before any profile write and is read by `isPhoneTaken` (auth/phoneOtp.ts).
 */
import { errorCode, type MessageKey } from '@touch/i18n';
import { mapErrorToKey } from '../booking/errors';

/** The line for a PHONE_TAKEN refusal, or null when the error is something else. */
export function phoneTakenKey(err: unknown): MessageKey | null {
  return errorCode(err) === 'PHONE_TAKEN' ? mapErrorToKey(err) : null;
}
