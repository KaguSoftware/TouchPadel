/**
 * Writes the age band the sign-up form asked for, once the session lands
 * (0368; ageBand.ts has the whole rule). Mounted once in the root stack,
 * beside useGenderGate, so no sign-up path or continuation has to know it
 * exists.
 *
 * It only ever writes. A guest with no band is asked by complete-profile, by
 * the play survey's age step and by Edit profile; nothing here presents a
 * screen, because no court hour depends on an age band the way one depends on
 * a gender.
 */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from './context';
import {
  ageBandRecordedThisSession,
  markAgeBandRecorded,
  shouldRecordAgeBand,
  signupAgeBandOf,
} from './ageBand';
import { parseAgeBand } from '../playProfile/logic';
import { useOwnProfile, useSetAgeBand } from '../profile/hooks';
import { isStaffArea } from '../staff/status';
import { useStaffStatus } from '../staff/StaffStatusProvider';
import { addBreadcrumb, captureException } from '../../lib/telemetry';

export function useAgeBandRecord(): void {
  const { session } = useAuth();
  const { status, answered } = useStaffStatus();
  const user = session?.user ?? null;
  const uid = user && !user.is_anonymous ? user.id : null;
  const staff = isStaffArea(status.kind);
  const profile = useOwnProfile(uid !== null && answered && !staff);
  const setBand = useSetAgeBand();
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const writing = useRef(false);

  const signupBand = signupAgeBandOf(user?.user_metadata);
  // A server or a cached row without the column reads as "not known", never as
  // "not answered": that is what keeps this from writing over nothing.
  const band =
    profile.isSuccess && profile.data
      ? 'age_band' in profile.data
        ? parseAgeBand(profile.data.age_band)
        : undefined
      : undefined;

  const ready = shouldRecordAgeBand({
    hasSession: !!user,
    isAnonymous: !!user?.is_anonymous,
    staffAnswered: answered,
    staff,
    band,
    signupBand,
    recordFailed: failedFor === uid,
    recordedThisSession: uid ? ageBandRecordedThisSession(uid) : false,
  });

  useEffect(() => {
    if (!ready || !uid || !signupBand || writing.current) return;
    writing.current = true;
    markAgeBandRecorded(uid);
    addBreadcrumb('ageBand.record-from-signup');
    setBand.mutate(signupBand, {
      onError: (error) => {
        captureException(error, { scope: 'ageBand.record' });
        // Offline, or a server without 0368: the ask in complete-profile, the
        // survey and Edit profile all still stand.
        setFailedFor(uid);
      },
      onSettled: () => {
        writing.current = false;
      },
    });
    // `setBand` is a fresh object each render; `ready` folds every input in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, uid, signupBand]);
}
