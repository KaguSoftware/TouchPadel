/**
 * Should the play survey open now? (docs/design/play-coaches/contracts-2026-10-11.md §8)
 * PURE, apart from the one in-memory "shown this session" set below.
 *
 * Once, right after a NEW account finishes signing up and lands on the tabs:
 *
 *   - a signed-in account, not an anonymous cafe session;
 *   - not a staff session, and not before the staff row has answered (an
 *     unread staff account looks like a guest);
 *   - a new account: created within NEW_ACCOUNT_WINDOW_MS. An account from
 *     before the survey existed is never interrupted; it meets the gentle
 *     "Tell us your level" card on the Play tab instead;
 *   - the play profile is known and the survey was never answered or skipped
 *     (`play_survey_at` null). Unknown (still loading, a row cached by an older
 *     build, a failed read) never opens it;
 *   - no slot, open-match or lesson intent is pending: the continuation that
 *     intent is waiting on comes first, and the survey waits for the next calm
 *     landing;
 *   - the guest is ON a tab, so nothing else (Review, complete-profile, the
 *     terms gate, a match) is in front of them;
 *   - not already shown on this phone in this app session, whatever happened
 *     to the save.
 *
 * The window is generous because an emailed confirmation link can be opened
 * days after the form was sent, and the account is created when it is sent.
 */

export const NEW_ACCOUNT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** How long a tab must stay in front before the sheet rises: a landing, not a pass-through. */
export const CALM_MS = 1100;
/**
 * The boot cover (features/boot/BootOverlay.tsx) holds for about a second after
 * the native splash goes; a native sheet would present ABOVE it. A cold start
 * waits until it is surely gone.
 */
export const BOOT_SETTLE_MS = 4500;

/** The tab routes as `usePathname()` reports them (Profile left the bar 2026-10-17, Club joined 2026-10-19). */
const TAB_PATHS = new Set(['/', '/bookings', '/play', '/club', '/coaches']);

export function isTabPath(pathname: string | null | undefined): boolean {
  return !!pathname && TAB_PATHS.has(pathname);
}

/** Created within the window (and not in the future by more than a clock's drift). */
export function isNewAccount(createdAt: string | null | undefined, now: number): boolean {
  if (!createdAt) return false;
  const at = Date.parse(createdAt);
  if (Number.isNaN(at)) return false;
  return now - at <= NEW_ACCOUNT_WINDOW_MS && at - now <= 60 * 60 * 1000;
}

export interface SurveyPromptInput {
  hasSession: boolean;
  isAnonymous: boolean;
  /** The staff row has been read for this session. */
  staffAnswered: boolean;
  /** A staff session (any staff role, or the guest preview of one). */
  staff: boolean;
  /** The auth user's `created_at`. */
  accountCreatedAt: string | null | undefined;
  now: number;
  /**
   * `undefined`: not known yet. `null`: known, never asked. A string: answered
   * or skipped at that time.
   */
  answeredAt: string | null | undefined;
  pendingIntent: boolean;
  pathname: string | null | undefined;
  shownThisSession: boolean;
}

export function shouldOpenSurvey(i: SurveyPromptInput): boolean {
  if (!i.hasSession || i.isAnonymous) return false;
  if (!i.staffAnswered || i.staff) return false;
  if (i.shownThisSession) return false;
  if (i.answeredAt !== null) return false;
  if (i.pendingIntent) return false;
  if (!isTabPath(i.pathname)) return false;
  return isNewAccount(i.accountCreatedAt, i.now);
}

/** The wait before the sheet rises, from when the conditions first held. */
export function calmDelayMs(now: number, bootAt: number): number {
  return Math.max(CALM_MS, BOOT_SETTLE_MS - (now - bootAt));
}

// ── Shown this session ──────────────────────────────────────────────────────
// Per account, in memory: a new JS launch may ask again only if the last one's
// save never reached the server (`play_survey_at` is still null).

const shown = new Set<string>();

export function markSurveyShown(uid: string): void {
  shown.add(uid);
}

export function surveyShownThisSession(uid: string): boolean {
  return shown.has(uid);
}

/** Tests only. */
export function __resetSurveyShown(): void {
  shown.clear();
}
