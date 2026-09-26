import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VENUE_ID,
  GUEST_VENUE_KEY,
  branchName,
  courtsTopic,
  parseStoredVenue,
  pickGuestVenueId,
  showsBranchPicker,
  toBranches,
  type Branch,
} from '../branch';
import { availabilityKeys } from '../keys';

const SECOND = '44444444-4444-4444-8444-444444444444';
const THIRD = '55555555-5555-4555-8555-555555555555';

const row = (venue_id: string, over: Record<string, unknown> = {}) => ({
  venue_id,
  venue_slug: venue_id === DEFAULT_VENUE_ID ? 'touch-padel' : `branch-${venue_id.slice(0, 4)}`,
  venue_name: 'Touch Padel',
  venue_name_en: 'Touch Padel',
  venue_name_ar: 'تاتش بادل',
  timezone: 'Asia/Baghdad',
  phone: '009647700000000',
  ...over,
});

describe('toBranches', () => {
  it('puts the default branch first whatever order the view returns', () => {
    const list = toBranches([row(THIRD), row(DEFAULT_VENUE_ID), row(SECOND)]);
    expect(list.map((b) => b.venue_id)).toEqual([DEFAULT_VENUE_ID, SECOND, THIRD]);
  });

  it('drops rows without an id and duplicate ids', () => {
    const list = toBranches([row(DEFAULT_VENUE_ID), { venue_id: null }, row(DEFAULT_VENUE_ID)]);
    expect(list).toHaveLength(1);
  });

  it('is empty for no rows', () => {
    expect(toBranches(null)).toEqual([]);
    expect(toBranches([])).toEqual([]);
  });
});

describe('pickGuestVenueId', () => {
  const two = toBranches([row(DEFAULT_VENUE_ID), row(SECOND)]);

  it('keeps the remembered branch while it is open', () => {
    expect(pickGuestVenueId(two, SECOND)).toBe(SECOND);
  });

  it('falls back to the default when the remembered branch closed', () => {
    expect(pickGuestVenueId(two, THIRD)).toBe(DEFAULT_VENUE_ID);
  });

  it('falls back to the default with nothing remembered', () => {
    expect(pickGuestVenueId(two, null)).toBe(DEFAULT_VENUE_ID);
  });

  it('uses the only open branch silently', () => {
    const one = toBranches([row(SECOND)]);
    expect(pickGuestVenueId(one, DEFAULT_VENUE_ID)).toBe(SECOND);
    expect(showsBranchPicker(one)).toBe(false);
  });

  it('is null while no branch is known', () => {
    expect(pickGuestVenueId([], SECOND)).toBeNull();
  });
});

describe('showsBranchPicker', () => {
  it('shows only with more than one open branch', () => {
    expect(showsBranchPicker([])).toBe(false);
    expect(showsBranchPicker(toBranches([row(DEFAULT_VENUE_ID)]))).toBe(false);
    expect(showsBranchPicker(toBranches([row(DEFAULT_VENUE_ID), row(SECOND)]))).toBe(true);
  });
});

describe('parseStoredVenue', () => {
  it('accepts a uuid and normalises its case', () => {
    expect(parseStoredVenue(SECOND.toUpperCase())).toBe(SECOND);
  });

  it('rejects anything else', () => {
    expect(parseStoredVenue(null)).toBeNull();
    expect(parseStoredVenue('')).toBeNull();
    expect(parseStoredVenue('touch-padel')).toBeNull();
  });
});

describe('branchName', () => {
  const b = toBranches([row(SECOND, { venue_name_en: 'Mansour', venue_name_ar: 'المنصور' })])[0]!;

  it('names the branch in the guest language', () => {
    expect(branchName(b, 'en')).toBe('Mansour');
    expect(branchName(b, 'ar')).toBe('المنصور');
  });

  it('falls back to the other language, then the settings name', () => {
    const noAr: Branch = { ...b, venue_name_ar: null };
    expect(branchName(noAr, 'ar')).toBe('Mansour');
    const none: Branch = { ...b, venue_name_en: null, venue_name_ar: null };
    expect(branchName(none, 'en')).toBe('Touch Padel');
  });
});

describe('keys and topics', () => {
  it('stores the choice under tp.venue', () => {
    expect(GUEST_VENUE_KEY).toBe('tp.venue');
  });

  it('carries the branch in every per-branch key', () => {
    expect(availabilityKeys.settings(SECOND)).toEqual(['venue-settings', SECOND]);
    expect(availabilityKeys.courts(SECOND)).toEqual(['courts', SECOND]);
    expect(availabilityKeys.rates(SECOND)).toEqual(['rate-rules', SECOND]);
    expect(availabilityKeys.degraded(SECOND)).toEqual(['is-degraded', SECOND]);
    expect(availabilityKeys.window(SECOND, '2026-09-26', '2026-10-02')).toEqual([
      'availability',
      'window',
      SECOND,
      '2026-09-26',
      '2026-10-02',
    ]);
  });

  it('keeps two branches apart and the invalidation prefixes intact', () => {
    expect(availabilityKeys.courts(SECOND)).not.toEqual(availabilityKeys.courts(DEFAULT_VENUE_ID));
    // Every mutation and the realtime broadcast invalidate ['availability'].
    expect(availabilityKeys.window(SECOND, 'a', 'b')[0]).toBe('availability');
    // The all-branch court list sits under the same 'courts' prefix.
    expect(availabilityKeys.allCourts[0]).toBe('courts');
  });

  it('listens on the branch topic', () => {
    expect(courtsTopic(SECOND)).toBe(`courts:${SECOND}`);
  });
});
