import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import { toE164Iraq } from '@touch/core';
import type { LedgerKind, MemberCard, MyLoyalty } from '@touch/core/loyalty';
import type { Locale, MessageKey } from '@touch/i18n';
import { appRpc } from '@/lib/appRpc';

/**
 * The web account (loyalty build contracts §5, plan §5.2): sign-in, the member card and the
 * points, read through the account client (`accountBrowserSupabase`, its own `sb-tp-account`
 * cookie). Pure helpers, no React: the page, the café chip and their tests share them.
 */

type Client = SupabaseClient<Database>;

export type SignInMethod = 'phone' | 'email';

export type Credentials = { phone: string; password: string } | { email: string; password: string };

/**
 * The sign-in the app does (apps/mobile/src/features/auth/api.ts): a phone is any Iraqi mobile
 * spelling, sent as E.164 (`toE164Iraq`, what the app's phone field composes); an email is
 * trimmed. Returns the error key when the identifier is not one.
 */
export function credentialsOf(
  method: SignInMethod,
  identifier: string,
  password: string,
): Credentials | { error: MessageKey } {
  if (method === 'phone') {
    const phone = toE164Iraq(identifier);
    return phone ? { phone, password } : { error: 'loyalty.web.signIn.errors.phone' };
  }
  const email = identifier.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? { email, password }
    : { error: 'loyalty.web.signIn.errors.email' };
}

/**
 * Google and Apple on the web wait for the owner's web OAuth clients (plan §2): until then the
 * buttons are not drawn at all. A literal `process.env.NEXT_PUBLIC_*` so Next inlines it.
 */
export function webOAuthEnabled(): boolean {
  return process.env.NEXT_PUBLIC_WEB_OAUTH === '1';
}

/**
 * The `?return=` the café chip sends: a path on this site, or nothing. Never another origin
 * (`//evil`, `/\evil`, `https:`), so the page cannot be used to bounce a visitor elsewhere.
 */
export function safeReturnPath(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length > 512) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  if (/[\u0000-\u001f]/.test(value)) return null;
  return value;
}

/** `/{locale}/account`, with the way back when there is one. */
export function accountHref(locale: Locale, returnPath: string | null): string {
  const base = `/${locale}/account`;
  return returnPath ? `${base}?return=${encodeURIComponent(returnPath)}` : base;
}

/** The member card (`my_member_card`, created on first read), or null when the read failed. */
export async function readMemberCard(client: Client): Promise<MemberCard | null> {
  const { data, error } = await appRpc(client, 'my_member_card');
  if (error || !data) return null;
  const card = data as unknown as MemberCard;
  return typeof card.member_code === 'string' && typeof card.secret_b32 === 'string' ? card : null;
}

/** Balance, tier, history and rewards (`my_loyalty`), or null when the read failed. */
export async function readMyLoyalty(client: Client): Promise<MyLoyalty | null> {
  const { data, error } = await appRpc(client, 'my_loyalty');
  if (error || !data) return null;
  const loyalty = data as unknown as MyLoyalty;
  return {
    ...loyalty,
    history: Array.isArray(loyalty.history) ? loyalty.history : [],
    rewards: Array.isArray(loyalty.rewards) ? loyalty.rewards : [],
  };
}

/** A tier's or reward's name in the page's language. */
export function localName(locale: Locale, row: { name_en: string; name_ar: string }): string {
  return locale === 'ar' ? row.name_ar || row.name_en : row.name_en || row.name_ar;
}

/** Points still to earn in the rolling 12 months to reach the next tier (0 when there). */
export function pointsToNextTier(
  loyalty: Pick<MyLoyalty, 'points_12m' | 'next_tier'>,
): number | null {
  if (!loyalty.next_tier) return null;
  return Math.max(0, loyalty.next_tier.min_points_12m - loyalty.points_12m);
}

const HISTORY_KINDS: readonly LedgerKind[] = [
  'earn',
  'redeem',
  'redeem_void',
  'reward',
  'adjust',
  'clawback',
  'expire',
  'merge_in',
];

/** The line a ledger row reads as; an unknown kind (a later migration) reads as an adjustment. */
export function historyKindKey(kind: string): MessageKey {
  const known = (HISTORY_KINDS as readonly string[]).includes(kind)
    ? (kind as LedgerKind)
    : 'adjust';
  return `loyalty.web.account.history.kind.${known}` as MessageKey;
}

/** The name the account goes by: the profile metadata's, else nothing. */
export function accountName(
  user: { user_metadata?: Record<string, unknown> } | null | undefined,
): string {
  const meta = user?.user_metadata ?? {};
  const given = typeof meta.given_name === 'string' ? meta.given_name.trim() : '';
  const full = typeof meta.full_name === 'string' ? meta.full_name.trim() : '';
  return given || full;
}

/**
 * The account's phone in E.164, for "or say your number": GoTrue stores it without the '+'
 * (`gotruePhone`); an email account carries it in its sign-up metadata.
 */
export function accountPhone(
  user: { phone?: string | null; user_metadata?: Record<string, unknown> } | null | undefined,
): string | null {
  const authPhone = user?.phone ? toE164Iraq(`+${user.phone.replace(/^\+/, '')}`) : null;
  if (authPhone) return authPhone;
  const meta = user?.user_metadata?.phone;
  return typeof meta === 'string' ? toE164Iraq(meta) : null;
}
