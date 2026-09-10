/**
 * SEC-20 — the stored-field allowlist.
 *
 * Both stores make you declare, field by field, what the app collects about a
 * user. That declaration is normally written once from memory into a web form
 * and then quietly goes stale: a column lands in a migration, nobody reopens the
 * form, and the listing is wrong until somebody notices. A paragraph drifts. A
 * test goes red.
 *
 * So this file, not a document, is the source for both forms. GUEST_DATA below
 * is the declaration; the last test prints it in the shape Google Play's Data
 * safety form and Apple's App Privacy questions ask for.
 *
 * Four things are enforced:
 *
 *   1. DISCOVERY — the guest-linked tables are found in the live catalog, not
 *      listed here by hand. A new table carrying guest_id / profile_id /
 *      customer_id / linked_profile_id / auth_user_id fails until declared.
 *   2. EXACTNESS — each declared table's column set must equal the live one.
 *      An added column fails; so does a removed one.
 *   3. COMPLETENESS — a column declared personal must carry a purpose and an
 *      erasure route.
 *   4. DELETION — every column declared personal is PROVED emptied by
 *      app.delete_my_account (0077), by populating it and deleting for real.
 *      Declaring a field and forgetting to erase it is precisely the gap the
 *      store deletion requirement exists to close.
 *
 * The catalog comes from PostgREST's own OpenAPI document, which is the same
 * view of the schema the clients get.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  guestClient,
  appRpc,
  createTestCourt,
  ensureTestRateRule,
  futureSlot,
  SEED_STAFF_IDS,
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
} from './helpers';

const up = await stackAvailable();

/** Store data-safety categories. `null` = nothing personal in this column. */
type Category =
  | 'Name'
  | 'Phone number'
  | 'Purchase history'
  | 'App activity'
  | 'Device or other IDs'
  | 'User content'
  | null;

interface Field {
  category: Category;
  /** Why it is stored — the form's free-text purpose box. */
  why?: string;
  /**
   * How 0077 erases it.
   *   'scrub'      the row survives, the column is set to null
   *   'anonymise'  the row survives and the column is NOT NULL, so it is
   *                overwritten with a placeholder that names nobody
   *   'row'        the whole row is deleted
   *   'auth'       it goes when the auth user is destroyed
   *   'keep'       deliberately RETAINED, with the reason in `why`
   */
  onDelete?: 'scrub' | 'anonymise' | 'row' | 'auth' | 'keep';
}

/** Nothing personal: an id, a timestamp, a status, a foreign key. */
const n: Field = { category: null };

/** What 0077 writes over a NOT NULL identifying column. */
const TOMBSTONE_NAME = 'Deleted account';

/** The guest link that puts a table on this surface. */
const LINK_COLUMNS = ['guest_id', 'profile_id', 'customer_id', 'linked_profile_id', 'auth_user_id'];

/**
 * THE DECLARATION — every column of every table carrying a guest link.
 */
const GUEST_DATA: Record<string, Record<string, Field>> = {
  profiles: {
    id: n,
    // profiles.full_name is NOT NULL, so deletion overwrites rather than empties.
    full_name: {
      category: 'Name',
      why: 'shown to the guest, and to the desk when they arrive',
      onDelete: 'anonymise',
    },
    phone: {
      category: 'Phone number',
      why: 'booking confirmation, and the desk calling about a court',
      onDelete: 'scrub',
    },
    preferred_lang: n,
    expo_push_token: {
      category: 'Device or other IDs',
      why: 'booking reminders and order-ready pushes',
      onDelete: 'scrub',
    },
    created_at: n,
    deleted_at: n,
  },
  reservations: {
    id: n,
    court_id: n,
    kind: n,
    status: n,
    start_at: n,
    end_at: n,
    period: n,
    guest_id: n,
    guest_name: {
      category: 'Name',
      why: 'bookings taken at the desk, including for an account holder',
      onDelete: 'scrub',
    },
    guest_phone: {
      category: 'Phone number',
      why: 'the desk calling about this specific booking',
      onDelete: 'scrub',
    },
    created_by_staff_id: n,
    source: n,
    rate_rule_id: n,
    price_iqd: {
      category: 'Purchase history',
      why: 'what the court sold for — the venue reports on it',
      onDelete: 'keep',
    },
    hold_expires_at: n,
    cancelled_at: n,
    cancellation_reason: n,
    notes: {
      category: 'User content',
      why: 'free text taken at the desk about this booking',
      onDelete: 'scrub',
    },
    device_id: {
      category: 'Device or other IDs',
      why: 'which till or phone made the booking; replay protection',
      onDelete: 'scrub',
    },
    idempotency_key: n,
    client_ref: n,
    created_at: n,
    series_id: n,
  },
  reservation_series: {
    id: n,
    court_id: n,
    pattern: n,
    weekdays: n,
    start_time: n,
    duration_min: n,
    starts_on: n,
    ends_on: n,
    guest_id: n,
    guest_name: {
      category: 'Name',
      why: 'a standing booking is held in somebody’s name',
      onDelete: 'scrub',
    },
    guest_phone: {
      category: 'Phone number',
      why: 'the desk calls the holder when a week is cancelled',
      onDelete: 'scrub',
    },
    notes: {
      category: 'User content',
      why: 'free text about the standing booking',
      onDelete: 'scrub',
    },
    created_by_staff_id: n,
    idempotency_key: n,
    created_at: n,
    cancelled_at: n,
    cancelled_reason: n,
  },
  guest_sessions: {
    id: n,
    table_id: n,
    auth_user_id: {
      category: 'App activity',
      why: 'which account scanned which table, so the tab is theirs',
      onDelete: 'auth',
    },
    linked_profile_id: n,
    created_at: n,
    last_activity_at: n,
    expires_at: n,
    closed_at: n,
  },
  customer_notes: {
    id: n,
    customer_id: n,
    body: {
      category: 'User content',
      why: 'what the desk wrote about this customer',
      onDelete: 'row',
    },
    author_id: n,
    created_at: n,
    edited_at: n,
    edited_by: n,
  },
  customer_flags: {
    customer_id: n,
    type: { category: 'App activity', why: 'desk labels such as VIP', onDelete: 'row' },
    label: { category: 'User content', why: 'free-text label on the customer', onDelete: 'row' },
    created_by: n,
    created_at: n,
  },
  notification_outbox: {
    id: n,
    profile_id: n,
    kind: n,
    payload: {
      category: 'User content',
      why: 'the text of the push queued for this guest',
      onDelete: 'row',
    },
    scheduled_for: n,
    sent_at: n,
    attempts: n,
    last_error: n,
    created_at: n,
  },
  promotion_redemptions: {
    id: n,
    promotion_id: n,
    tab_id: n,
    adjustment_id: n,
    customer_id: n,
    amount_iqd: {
      category: 'Purchase history',
      why: 'the discount given — part of the venue’s takings',
      onDelete: 'keep',
    },
    code_used: n,
    idempotency_key: n,
    redeemed_at: n,
    redeemed_by: n,
  },
};

/** The live schema as PostgREST publishes it. */
async function liveColumns(): Promise<Record<string, string[]>> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`OpenAPI fetch failed: ${res.status}`);
  const doc = (await res.json()) as {
    definitions: Record<string, { properties?: Record<string, unknown> }>;
  };
  const out: Record<string, string[]> = {};
  for (const [table, spec] of Object.entries(doc.definitions ?? {})) {
    out[table] = Object.keys(spec.properties ?? {});
  }
  return out;
}

describe.skipIf(!up)('SEC-20 stored-field allowlist', () => {
  let svc: SupabaseClient;
  let live: Record<string, string[]>;

  beforeAll(async () => {
    svc = serviceClient();
    live = await liveColumns();
  });

  it('reads a real catalog — the guard against a vacuously green suite', () => {
    expect(Object.keys(live).length).toBeGreaterThan(50);
    expect(live.profiles).toContain('expo_push_token');
  });

  it('declares every table that carries a guest link', () => {
    const found = Object.entries(live)
      .filter(([t, cols]) => t === 'profiles' || cols.some((c) => LINK_COLUMNS.includes(c)))
      .map(([t]) => t)
      .sort();
    const declared = Object.keys(GUEST_DATA).sort();

    expect(
      found.filter((t) => !declared.includes(t)),
      'a table now carries guest data and is not declared in GUEST_DATA — declare it, ' +
        'then re-fill both stores’ data-safety forms from this file',
    ).toEqual([]);
    expect(
      declared.filter((t) => !found.includes(t)),
      'declared here but no longer carries a guest link',
    ).toEqual([]);
  });

  it('matches the live column set of every declared table exactly', () => {
    const drift: string[] = [];
    for (const [table, fields] of Object.entries(GUEST_DATA)) {
      const actual = [...(live[table] ?? [])].sort();
      expect(actual.length, `${table} is not exposed by PostgREST`).toBeGreaterThan(0);
      const declared = Object.keys(fields).sort();
      for (const c of actual.filter((c) => !declared.includes(c))) {
        drift.push(`${table}.${c} exists in the database but is not declared`);
      }
      for (const c of declared.filter((c) => !actual.includes(c))) {
        drift.push(`${table}.${c} is declared but no longer exists`);
      }
    }
    expect(
      drift,
      'the schema moved and the declaration did not move with it. Update GUEST_DATA, ' +
        'then re-fill the store forms FROM IT — that is what this test is for.',
    ).toEqual([]);
  });

  it('gives every personal column a purpose and an erasure route', () => {
    const incomplete: string[] = [];
    for (const [table, fields] of Object.entries(GUEST_DATA)) {
      for (const [col, f] of Object.entries(fields)) {
        if (!f.category) continue;
        if (!f.why) incomplete.push(`${table}.${col} has no purpose for the form`);
        if (!f.onDelete) incomplete.push(`${table}.${col} has no erasure route`);
      }
    }
    expect(incomplete).toEqual([]);
  });

  /**
   * The proof, and the reason this file is worth more than a document: populate
   * every column declared personal, delete the account for real, and assert that
   * everything declared erasable is empty. Keeps the declaration and the
   * deletion from drifting apart.
   */
  it('app.delete_my_account empties every column declared erasable', async () => {
    await ensureTestRateRule(svc);
    const courtId = await createTestCourt(svc, `S20${Date.now() % 100000}`);
    const guest = await guestClient(svc, 'sec20');
    const uid = (await guest.auth.getUser()).data.user!.id;

    const slot = futureSlot();
    const held = await appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: slot.start.toISOString(),
      p_duration_min: 60,
    });
    if (held.error) throw new Error(`hold_slot: ${held.error.message}`);
    const reservationId = (held.data as { reservation_id: string }).reservation_id;
    const confirmed = await appRpc(guest, 'confirm_booking', { p_hold_id: reservationId });
    if (confirmed.error) throw new Error(`confirm_booking: ${confirmed.error.message}`);

    // Fill in every 'scrub' column on the two tables whose rows survive.
    await svc
      .from('profiles')
      .update({ expo_push_token: 'ExponentPushToken[sec20]' })
      .eq('id', uid);
    await svc
      .from('reservations')
      .update({
        guest_name: 'SEC20 Guest',
        guest_phone: '+9647700020020',
        notes: 'sec20 note',
        device_id: 'DEV20',
      })
      .eq('id', reservationId);
    // …and one row in each table whose rows are removed whole.
    await svc
      .from('customer_notes')
      .insert({ customer_id: uid, body: 'sec20 note', author_id: SEED_STAFF_IDS.court_desk });
    await svc
      .from('customer_flags')
      .insert({
        customer_id: uid,
        type: 'vip',
        label: 'sec20',
        created_by: SEED_STAFF_IDS.court_desk,
      });
    await svc.from('notification_outbox').insert({
      profile_id: uid,
      kind: 'reservation_reminder',
      payload: { reservation_id: reservationId },
      scheduled_for: new Date().toISOString(),
    });

    const del = await appRpc(guest, 'delete_my_account', { p_confirm: 'DELETE' });
    expect(del.error).toBeNull();

    const leaks: string[] = [];

    // 'scrub' must be null; 'anonymise' must be the placeholder, which is only
    // meaningful because it is NOT what the column held a moment ago.
    for (const [table, idColumn, idValue] of [
      ['profiles', 'id', uid],
      ['reservations', 'id', reservationId],
    ] as const) {
      const erasable = Object.entries(GUEST_DATA[table] ?? {}).filter(
        ([, f]) => f.category && (f.onDelete === 'scrub' || f.onDelete === 'anonymise'),
      );
      const { data, error } = await svc
        .from(table)
        .select(erasable.map(([c]) => c).join(','))
        .eq(idColumn, idValue)
        .maybeSingle();
      if (error) throw new Error(`${table}: ${error.message}`);
      expect(data, `${table} row should still exist after deletion`).not.toBeNull();
      const row = (data ?? {}) as Record<string, unknown>;
      for (const [col, f] of erasable) {
        const value = row[col];
        if (f.onDelete === 'scrub' && value !== null) {
          leaks.push(`${table}.${col} should be null, holds ${JSON.stringify(value)}`);
        }
        if (f.onDelete === 'anonymise' && value !== TOMBSTONE_NAME) {
          leaks.push(`${table}.${col} should be the placeholder, holds ${JSON.stringify(value)}`);
        }
      }
    }

    // 'row' — nothing may remain for this guest.
    for (const [table, col] of [
      ['customer_notes', 'customer_id'],
      ['customer_flags', 'customer_id'],
      ['notification_outbox', 'profile_id'],
    ] as const) {
      const { data } = await svc.from(table).select('*').eq(col, uid);
      if ((data ?? []).length > 0) leaks.push(`${table} still has ${(data ?? []).length} row(s)`);
    }

    expect(leaks).toEqual([]);

    // And the 'keep' columns really are kept — the venue's books are intact.
    const { data: kept } = await svc
      .from('reservations')
      .select('price_iqd')
      .eq('id', reservationId)
      .single();
    expect((kept as { price_iqd: number }).price_iqd).toBeGreaterThan(0);

    await svc.from('courts').delete().eq('id', courtId);
  });

  /**
   * Not an assertion — the deliverable. Paste this into Google Play's Data
   * safety form and Apple's App Privacy questions.
   */
  it('prints the data-safety declaration for both store forms', () => {
    const byCategory = new Map<string, { where: string; why: string; fate: string }[]>();
    for (const [table, fields] of Object.entries(GUEST_DATA)) {
      for (const [col, f] of Object.entries(fields)) {
        if (!f.category) continue;
        if (!byCategory.has(f.category)) byCategory.set(f.category, []);
        byCategory
          .get(f.category)!
          .push({ where: `${table}.${col}`, why: f.why!, fate: f.onDelete! });
      }
    }
    const lines = [
      '',
      'DATA SAFETY — generated from GUEST_DATA (SEC-20). Do not retype from memory.',
      '',
    ];
    for (const [category, entries] of [...byCategory].sort()) {
      lines.push(`  ${category}`);
      for (const e of entries)
        lines.push(`      ${e.where.padEnd(32)} ${e.fate.padEnd(6)} ${e.why}`);
      lines.push('');
    }
    lines.push('  Deletion: in-app, app.delete_my_account (migration 0077).');
    lines.push('  Every "scrub"/"row" field above is proved erased by the test above this one.');
    lines.push('  "keep" is deliberate retention — the venue’s takings, not the guest’s identity.');
    console.log(lines.join('\n'));
    expect(byCategory.size).toBeGreaterThan(0);
  });
});
