import { useEffect, useRef, useState } from 'react';
import { router, usePathname } from 'expo-router';
import { useAuth } from './context';
import {
  genderAskedThisSession,
  genderGateStep,
  markGenderAsked,
  signupGenderOf,
} from './genderGate';
import { hasPendingIntent, usePendingIntent } from '../booking/pendingIntent';
import { rpcErrorCode } from '../booking/errors';
import { useSetMyGender } from '../matches/hooks';
import { useOwnProfile } from '../profile/hooks';
import { calmDelayMs } from '../playProfile/prompt';
import { isStaffArea } from '../staff/status';
import { useStaffStatus } from '../staff/StaffStatusProvider';
import { addBreadcrumb, captureException } from '../../lib/telemetry';
import { errorMessageOf } from '../../lib/network';

/** When this JS launch began: the boot cover is measured from here (prompt.ts BOOT_SETTLE_MS). */
const BOOT_AT = Date.now();

/**
 * A gender for every account (0353; genderGate.ts has the whole rule).
 * Mounted once in the root stack, beside useTermsGate and the play survey's
 * prompt, so no sign-in path, continuation or screen has to know about it.
 *
 *   record  the sign-up form's answer, from the account's metadata, is saved
 *           through app.set_my_gender once the session lands. Silent.
 *   ask     a guest with none, on a calm landing on a tab, is sent to
 *           /complete-profile in back mode, once per launch.
 *
 * Nothing is read until the account's own staff row has answered: staff are
 * never asked here.
 */
export function useGenderGate(): void {
  const { session } = useAuth();
  const { status, answered } = useStaffStatus();
  const pending = usePendingIntent();
  const pathname = usePathname();
  const user = session?.user ?? null;
  const uid = user && !user.is_anonymous ? user.id : null;
  const staff = isStaffArea(status.kind);
  const profile = useOwnProfile(uid !== null && answered && !staff);
  const setGender = useSetMyGender();
  const [recordFailedFor, setRecordFailedFor] = useState<string | null>(null);
  const recording = useRef(false);

  const signupGender = signupGenderOf(user?.user_metadata);
  const gender = profile.isSuccess && profile.data ? (profile.data.gender ?? null) : undefined;
  const step = genderGateStep({
    hasSession: !!user,
    isAnonymous: !!user?.is_anonymous,
    staffAnswered: answered,
    staff,
    gender,
    signupGender,
    recordFailed: recordFailedFor === uid,
    pendingIntent: pending || hasPendingIntent(),
    pathname,
    askedThisSession: uid ? genderAskedThisSession(uid) : false,
  });

  useEffect(() => {
    if (step !== 'record' || !uid || !signupGender || recording.current) return;
    recording.current = true;
    addBreadcrumb('gender.record-from-signup');
    setGender.mutate(signupGender, {
      onError: (error) => {
        // Another device answered first: the profile re-read shows its value.
        if (rpcErrorCode(errorMessageOf(error)) === 'GENDER_ALREADY_SET') return;
        captureException(error, { scope: 'gender.record' });
        // Offline, say: fall through to the ask, which saves it by hand.
        setRecordFailedFor(uid);
      },
      onSettled: () => {
        recording.current = false;
      },
    });
    // `setGender` is a fresh object each render; the step decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, uid, signupGender]);

  useEffect(() => {
    if (step !== 'ask' || !uid) return;
    const timer = setTimeout(() => {
      // Re-read the live state: a tap in the wait may have set an intent.
      if (hasPendingIntent() || genderAskedThisSession(uid)) return;
      markGenderAsked(uid);
      addBreadcrumb('gender.ask');
      router.push({ pathname: '/complete-profile', params: { returnTo: 'back' } });
    }, calmDelayMs(Date.now(), BOOT_AT));
    return () => clearTimeout(timer);
    // The pathname restarts the wait: a tab switch mid-wait does not fire mid-gesture.
  }, [step, uid, pathname]);
}
