import { useEffect, useState } from 'react';
import { router, usePathname } from 'expo-router';
import { useAuth } from '../auth/context';
import { hasPendingIntent, usePendingIntent } from '../booking/pendingIntent';
import { isStaffArea } from '../staff/status';
import { useStaffStatus } from '../staff/StaffStatusProvider';
import { addBreadcrumb } from '../../lib/telemetry';
import { usePlayProfile } from './hooks';
import {
  calmDelayMs,
  markSurveyShown,
  shouldOpenSurvey,
  surveyShownThisSession,
  type SurveyPromptInput,
} from './prompt';

/** When this JS launch began: the boot cover is measured from here (prompt.ts BOOT_SETTLE_MS). */
const BOOT_AT = Date.now();

/**
 * Opens the play survey once, on the first calm landing on the tabs after a
 * new account signs up (prompt.ts has the whole rule). Mounted once in the
 * root stack, beside useTermsGate, so no sign-up path, continuation or gate
 * has to know it exists: every one of them ends on a tab, and this watches
 * for that.
 *
 * The rule is checked when it first holds, and again when the calm wait ends,
 * from the LIVE state: an intent set, a screen pushed or a staff answer that
 * landed in between cancels the sheet. Nothing here writes; the sheet saves.
 */
export function usePlaySurveyPrompt(): void {
  const { session } = useAuth();
  const { status, answered } = useStaffStatus();
  const pending = usePendingIntent();
  const pathname = usePathname();
  const play = usePlayProfile();
  const user = session?.user ?? null;
  const uid = user?.id ?? null;
  // The account's age is judged against when the root mounted: a launch is
  // short next to the seven-day window, and render stays pure.
  const [mountedAt] = useState(() => Date.now());

  const input = (now: number): SurveyPromptInput => ({
    hasSession: !!user,
    isAnonymous: !!user?.is_anonymous,
    staffAnswered: answered,
    staff: isStaffArea(status.kind),
    accountCreatedAt: user?.created_at,
    now,
    answeredAt: play ? play.answeredAt : undefined,
    pendingIntent: pending || hasPendingIntent(),
    pathname,
    shownThisSession: uid ? surveyShownThisSession(uid) : false,
  });

  const ready = shouldOpenSurvey(input(mountedAt));

  useEffect(() => {
    if (!ready || !uid) return;
    const timer = setTimeout(() => {
      // Re-read the intent stores directly: a tap in the wait may have set one.
      if (hasPendingIntent() || surveyShownThisSession(uid)) return;
      markSurveyShown(uid);
      addBreadcrumb('playSurvey.open');
      router.push('/play-survey');
    }, calmDelayMs(Date.now(), BOOT_AT));
    return () => clearTimeout(timer);
    // `ready` already folds every input in; the pathname is listed so a tab
    // switch during the wait restarts it rather than firing mid-gesture.
  }, [ready, uid, pathname]);
}
