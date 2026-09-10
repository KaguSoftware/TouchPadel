/**
 * SEC-27 (0080) — control bytes and bidi overrides are stripped at write time.
 *
 * THE ATTACK. U+202E RIGHT-TO-LEFT OVERRIDE reverses the DISPLAY of everything
 * after it while leaving the stored bytes alone. A guest whose profile name is
 * `Ali<RLO>gnp.exe` is stored as exactly that and rendered, on the desk screen
 * and in customer search, as `Aliexe.png`. What staff read is not what the
 * database holds, and nothing at the reading end can fix that.
 *
 * The same text reaches the ESC/POS ticket printer, where C0 bytes are
 * printer COMMANDS — 0x1B 0x70 is the cash-drawer kick.
 *
 * `profiles.full_name` and `profiles.phone` are the ONLY text columns in
 * `public` a guest can write directly (column grants to `authenticated`), which
 * is why the trigger sits there rather than in an RPC: there is no RPC in that
 * path to sanitise in.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  guestClient,
  signedInClient,
  appRpc,
  createTestCourt,
  ensureTestRateRule,
  futureSlot,
  SEED_STAFF,
} from './helpers';

const up = await stackAvailable();

// Built from code points so this file stays readable and cannot be mangled by
// an editor that renders the very characters under test.
const C = String.fromCharCode;
const RLO = C(0x202e); // RIGHT-TO-LEFT OVERRIDE — the display-spoofing one
const PDF = C(0x202c); // POP DIRECTIONAL FORMATTING
const RLM = C(0x200f); // RIGHT-TO-LEFT MARK
const ZWSP = C(0x200b); // ZERO WIDTH SPACE
const BOM = C(0xfeff);
const ESC = C(0x1b); // ESC — 0x1B 0x70 is the ESC/POS drawer kick
const ARABIC = C(0x645, 0x62d, 0x645, 0x62f); // a real Arabic name

describe.skipIf(!up)('0080 guest text sanitising (SEC-27)', () => {
  let svc: SupabaseClient;

  beforeAll(async () => {
    svc = serviceClient();
  });

  describe('profiles — the only text a guest writes directly', () => {
    it('strips a bidi override from a name the guest sets on their own row', async () => {
      const guest = await guestClient(svc, 'bidi');
      const uid = (await guest.auth.getUser()).data.user!.id;

      const { error } = await guest
        .from('profiles')
        .update({ full_name: `Ali${RLO}gnp.exe${PDF}` })
        .eq('id', uid);
      expect(error).toBeNull();

      const { data } = await svc.from('profiles').select('full_name').eq('id', uid).single();
      const name = (data as { full_name: string }).full_name;
      expect(name).toBe('Alignp.exe');
      expect(name).not.toContain(RLO);
      expect(name).not.toContain(PDF);
    });

    it('strips ESC/POS control bytes — a name is not a printer command', async () => {
      const guest = await guestClient(svc, 'escpos');
      const uid = (await guest.auth.getUser()).data.user!.id;

      await guest
        .from('profiles')
        .update({ full_name: `Sam${ESC}pKick` })
        .eq('id', uid);

      const { data } = await svc.from('profiles').select('full_name').eq('id', uid).single();
      const name = (data as { full_name: string }).full_name;
      expect(name).toBe('SampKick');
      expect(name).not.toContain(ESC);
    });

    it('strips zero-width characters used to forge a duplicate name', async () => {
      const guest = await guestClient(svc, 'zwsp');
      const uid = (await guest.auth.getUser()).data.user!.id;

      await guest
        .from('profiles')
        .update({ full_name: `A${ZWSP}dm${BOM}in` })
        .eq('id', uid);

      const { data } = await svc.from('profiles').select('full_name').eq('id', uid).single();
      expect((data as { full_name: string }).full_name).toBe('Admin');
    });

    /**
     * The whole point of stripping FORMATTING controls rather than "non-Latin":
     * Arabic is the default locale here and must survive untouched.
     */
    it('leaves an Arabic name completely intact', async () => {
      const guest = await guestClient(svc, 'arabic');
      const uid = (await guest.auth.getUser()).data.user!.id;

      await guest.from('profiles').update({ full_name: ARABIC }).eq('id', uid);

      const { data } = await svc.from('profiles').select('full_name').eq('id', uid).single();
      expect((data as { full_name: string }).full_name).toBe(ARABIC);
    });

    it('collapses whitespace and trims, without emptying a real name', async () => {
      const guest = await guestClient(svc, 'ws');
      const uid = (await guest.auth.getUser()).data.user!.id;

      await guest.from('profiles').update({ full_name: '  Ali   Hassan  ' }).eq('id', uid);

      const { data } = await svc.from('profiles').select('full_name').eq('id', uid).single();
      expect((data as { full_name: string }).full_name).toBe('Ali Hassan');
    });

    it('sanitises the phone too, and keeps NULL as NULL', async () => {
      const guest = await guestClient(svc, 'phone');
      const uid = (await guest.auth.getUser()).data.user!.id;

      await guest
        .from('profiles')
        .update({ phone: `+964${RLM}770${ZWSP}0000000` })
        .eq('id', uid);
      let { data } = await svc.from('profiles').select('phone').eq('id', uid).single();
      expect((data as { phone: string }).phone).toBe('+9647700000000');

      await guest.from('profiles').update({ phone: null }).eq('id', uid);
      ({ data } = await svc.from('profiles').select('phone').eq('id', uid).single());
      expect((data as { phone: string | null }).phone).toBeNull();
    });

    /**
     * A name of nothing but control characters must not become a constraint
     * violation the guest cannot interpret — full_name is NOT NULL.
     */
    it('a name made only of control characters becomes empty, not an error', async () => {
      const guest = await guestClient(svc, 'allctrl');
      const uid = (await guest.auth.getUser()).data.user!.id;

      const { error } = await guest
        .from('profiles')
        .update({ full_name: `${RLO}${PDF}${ZWSP}${BOM}` })
        .eq('id', uid);
      expect(error).toBeNull();

      const { data } = await svc.from('profiles').select('full_name').eq('id', uid).single();
      expect((data as { full_name: string }).full_name).toBe('');
    });
  });

  describe('booking rows — staff-written today, argument-driven tomorrow', () => {
    let courtId: string;

    beforeAll(async () => {
      await ensureTestRateRule(svc);
      courtId = await createTestCourt(svc, `SAN${Date.now() % 100000}`);
    });

    afterAll(async () => {
      await svc.from('courts').delete().eq('id', courtId);
    });

    it('strips bidi from a reservation guest name, and keeps note line breaks', async () => {
      const desk = await signedInClient(SEED_STAFF.court_desk);
      const slot = futureSlot();
      const held = await appRpc(desk, 'hold_slot', {
        p_court_id: courtId,
        p_start_at: slot.start.toISOString(),
        p_duration_min: 60,
      });
      if (held.error) throw new Error(`hold_slot: ${held.error.message}`);
      const id = (held.data as { reservation_id: string }).reservation_id;

      await svc
        .from('reservations')
        .update({
          guest_name: `Omar${RLO}gnp.exe`,
          guest_phone: `+964${ZWSP}7701234567`,
          notes: `line one\nline two${RLO}`,
        })
        .eq('id', id);

      const { data } = await svc
        .from('reservations')
        .select('guest_name, guest_phone, notes')
        .eq('id', id)
        .single();
      const row = data as { guest_name: string; guest_phone: string; notes: string };

      expect(row.guest_name).toBe('Omargnp.exe');
      expect(row.guest_phone).toBe('+9647701234567');
      // A note keeps its shape — that is what safe_text is for — but not its
      // bidi override.
      expect(row.notes).toBe('line one\nline two');
      expect(row.notes).toContain('\n');

      await svc.from('reservations').delete().eq('id', id);
      await desk.auth.signOut();
    });
  });
});
