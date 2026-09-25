import { describe, expect, it } from 'vitest';
import { isPastWanted, readRequests, readSuggestions } from './marketingStaffLogic';

// The pure half of /marketing's "From marketing" marks and "Requests to
// marketing" list (MarketingPanel.tsx).

const request = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  title: 'A post about the pistachio cake',
  body: 'It launches on Friday. A photo of it on the counter would be good.',
  want_by: '2026-10-02',
  menu_item_id: 'm1',
  item_name_en: 'Pistachio cake',
  item_name_ar: 'كيكة الفستق',
  photos: ['v1/requests/s1/cake.jpg', 'v1/requests/s1/counter.jpg'],
  status: 'open',
  answer: null,
  answered_by_name: null,
  answered_at: null,
  created_at: '2026-09-25T07:00:00Z',
  requested_by_name: 'Maha',
  requested_by_role: 'cashier',
  ...over,
});

describe('readSuggestions', () => {
  it('maps the drafts marketing suggested by campaign id', () => {
    const m = readSuggestions({
      drafts: [
        { campaign_id: 'c1', suggested_by_name: 'Dev Marketing', suggestion_note: 'For the weekend', images: ['a.jpg', 7, 'b.jpg'] },
        { campaign_id: 'c2', suggested_by_name: null, suggestion_note: '   ', images: 'none' },
      ],
    });
    expect([...m.keys()]).toEqual(['c1', 'c2']);
    expect(m.get('c1')).toEqual({ campaign_id: 'c1', suggested_by_name: 'Dev Marketing', suggestion_note: 'For the weekend', images: ['a.jpg', 'b.jpg'] });
    // A blank note is no note; images that are not a list are none.
    expect(m.get('c2')).toEqual({ campaign_id: 'c2', suggested_by_name: null, suggestion_note: null, images: [] });
  });

  it('reads anything that is not the RPC payload as no suggestions', () => {
    for (const bad of [null, undefined, 'x', [], { drafts: 'no' }, { drafts: [null, 3, { suggested_by: 'no id' }] }]) {
      expect(readSuggestions(bad).size).toBe(0);
    }
  });
});

describe('readRequests', () => {
  it('reads the page as it comes', () => {
    const r = readRequests({
      requests: [request(), request({ id: 'r2', status: 'done', answer: 'Posted on Instagram this morning.', requested_by_role: 'court_desk', want_by: null })],
      open_count: 1,
      total: 2,
    });
    expect(r.open_count).toBe(1);
    expect(r.total).toBe(2);
    expect(r.requests.map((x) => x.status)).toEqual(['open', 'done']);
    expect(r.requests[0]!.requested_by_role).toBe('cashier');
    expect(r.requests[0]!.photos).toHaveLength(2);
    expect(r.requests[1]!.answer).toBe('Posted on Instagram this morning.');
  });

  it('reads anything else as an empty page, and a missing total as the rows it has', () => {
    for (const bad of [null, 'x', [], { requests: 'no' }, { requests: [{ title: 'no id' }] }]) {
      expect(readRequests(bad)).toEqual({ requests: [], open_count: 0, total: 0 });
    }
    expect(readRequests({ requests: [request()] }).total).toBe(1);
  });

  it('never lets an unknown role, status or date through as a key', () => {
    const odd = readRequests({ requests: [request({ status: 'lost', requested_by_role: 'waiter', want_by: 'soon', answer: '  ', photos: ['', 'p.jpg', 4] })] }).requests[0]!;
    expect([odd.status, odd.requested_by_role, odd.want_by, odd.answer]).toEqual(['open', null, null, null]);
    expect(odd.photos).toEqual(['p.jpg']);
  });
});

describe('isPastWanted', () => {
  it('flags a waiting request past the day it was wanted by, and only that', () => {
    expect(isPastWanted({ status: 'open', want_by: '2026-09-24' }, '2026-09-25')).toBe(true);
    expect(isPastWanted({ status: 'open', want_by: '2026-09-25' }, '2026-09-25')).toBe(false);
    expect(isPastWanted({ status: 'done', want_by: '2026-09-24' }, '2026-09-25')).toBe(false);
    expect(isPastWanted({ status: 'open', want_by: null }, '2026-09-25')).toBe(false);
  });
});
