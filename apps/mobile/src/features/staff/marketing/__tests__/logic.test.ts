import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from '@touch/core';
import type { CampaignDraftRow, MarketingRequest } from '../api';
import {
  CAPS,
  MARKETING_CHANNELS,
  campaignArgs,
  canAnswer,
  canWithdraw,
  dayEndIso,
  dayStartIso,
  draftFromRow,
  emptyCampaignDraft,
  emptyNoteDraft,
  emptyRequestDraft,
  localName,
  namedFirst,
  noteArgs,
  requestArgs,
  requestsView,
  typedInArabic,
  validateAnswer,
  validateCampaign,
  validateNote,
  validateRequest,
  venueDay,
  type CampaignDraft,
} from '../logic';

const VENUE = 'c0000000-0000-4000-8000-000000000001';
const ITEM = '00000000-0000-4000-8000-000000000011';
const RUN = '00000000-0000-4000-8000-000000000022';

function request(patch: Partial<MarketingRequest>): MarketingRequest {
  return {
    id: 'r1',
    title: 'Photo of the new latte',
    body: 'For the Friday post',
    want_by: null,
    menu_item_id: null,
    item_name_en: null,
    item_name_ar: null,
    photos: [],
    status: 'open',
    answer: null,
    answered_by_name: null,
    answered_at: null,
    created_at: '2026-09-25T08:00:00Z',
    ...patch,
  };
}

describe('who asks and who answers (#73)', () => {
  it('lets every role but marketing ask, and only marketing answer', () => {
    for (const role of STAFF_ROLES) {
      const view = requestsView(role);
      expect(view.asks, role).toBe(role !== 'marketing');
      expect(view.answers, role).toBe(role === 'marketing');
    }
  });

  it('shows the whole venue’s requests to marketing and MGMT only', () => {
    const readers = STAFF_ROLES.filter((r) => requestsView(r).readsAll);
    expect([...readers].sort()).toEqual(['manager', 'marketing', 'owner']);
  });

  it('answers and withdraws only an open request', () => {
    const marketing = requestsView('marketing');
    expect(canAnswer(marketing, request({}))).toBe(true);
    expect(canAnswer(marketing, request({ status: 'done' }))).toBe(false);
    expect(canAnswer(requestsView('manager'), request({}))).toBe(false);
    expect(canWithdraw(request({}))).toBe(true);
    expect(canWithdraw(request({ status: 'declined' }))).toBe(false);
  });

  it('lists a named request first and keeps the rest in order', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(namedFirst(rows, 'b').map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(namedFirst(rows, undefined).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('my take', () => {
  it('needs a subject and some text, within the caps', () => {
    expect(validateNote(emptyNoteDraft()).map((i) => i.field)).toEqual(['subject', 'body']);
    expect(
      validateNote({ subjectKind: 'run', subjectId: RUN, body: 'x'.repeat(CAPS.noteBody + 1), photos: [] }),
    ).toEqual([{ field: 'body', code: 'tooLong' }]);
    expect(validateNote({ subjectKind: 'item', subjectId: ITEM, body: 'Sells itself', photos: Array(7).fill('p') })).toEqual([
      { field: 'photos', code: 'tooLong' },
    ]);
  });

  it('sends the subject, the text trimmed and the photo paths', () => {
    expect(noteArgs({ subjectKind: 'item', subjectId: ITEM, body: ' Great ', photos: ['a/marketing/1.jpg'] }, VENUE)).toEqual({
      p_venue_id: VENUE,
      p_subject_kind: 'item',
      p_subject_id: ITEM,
      p_body: 'Great',
      p_photos: ['a/marketing/1.jpg'],
    });
  });
});

describe('campaign drafts', () => {
  const draft = (patch: Partial<CampaignDraft>): CampaignDraft => ({ ...emptyCampaignDraft(), ...patch });

  it('starts a new draft on the first channel, which the control shows chosen', () => {
    expect(emptyCampaignDraft().channel).toBe(MARKETING_CHANNELS[0]);
  });

  it('needs a name and a channel, and a last day not before the first', () => {
    expect(validateCampaign(draft({ channel: null }))).toEqual([
      { field: 'name', code: 'required' },
      { field: 'channel', code: 'required' },
    ]);
    expect(validateCampaign(draft({ name: 'Autumn', starts: '2026-10-05', ends: '2026-10-01' }))).toEqual([
      { field: 'ends', code: 'order' },
    ]);
    expect(validateCampaign(draft({ name: 'Autumn', starts: '2026-13-01' }))).toEqual([
      { field: 'starts', code: 'invalid' },
    ]);
    expect(validateCampaign(draft({ name: 'Autumn', linkKind: 'item' }))).toEqual([{ field: 'link', code: 'required' }]);
    expect(validateCampaign(draft({ name: 'Autumn', starts: '2026-10-01', ends: '2026-10-01' }))).toEqual([]);
  });

  it('sends the typed name in the language it was typed in, and the other empty for the server to fill', () => {
    expect(typedInArabic('عرض الخريف')).toBe(true);
    expect(typedInArabic('Autumn')).toBe(false);
    expect(campaignArgs(draft({ name: ' Autumn ' }), VENUE)).toMatchObject({ p_name_en: 'Autumn', p_name_ar: null });
    expect(campaignArgs(draft({ name: 'عرض الخريف' }), VENUE)).toMatchObject({ p_name_en: null, p_name_ar: 'عرض الخريف' });
  });

  it('turns days into the venue’s first and last minute, and reads them back as the same days', () => {
    // Asia/Baghdad is UTC+3 all year.
    expect(dayStartIso('2026-10-01')).toBe('2026-09-30T21:00:00.000Z');
    expect(dayEndIso('2026-10-03')).toBe('2026-10-03T20:59:00.000Z');
    expect(venueDay(dayStartIso('2026-10-01'))).toBe('2026-10-01');
    expect(venueDay(dayEndIso('2026-10-03'))).toBe('2026-10-03');
    const args = campaignArgs(draft({ name: 'A', starts: '2026-10-01', ends: '2026-10-03' }), VENUE);
    expect(args.p_starts_at).toBe('2026-09-30T21:00:00.000Z');
    expect(args.p_ends_at).toBe('2026-10-03T20:59:00.000Z');
  });

  it('links a draft to one item or one run, never both', () => {
    expect(campaignArgs(draft({ name: 'A', linkKind: 'item', linkId: ITEM }), VENUE)).toMatchObject({
      p_menu_item_id: ITEM,
      p_run_id: null,
    });
    expect(campaignArgs(draft({ name: 'A', linkKind: 'run', linkId: RUN }), VENUE)).toMatchObject({
      p_menu_item_id: null,
      p_run_id: RUN,
    });
    expect(campaignArgs(draft({ name: 'A' }), VENUE)).toMatchObject({ p_menu_item_id: null, p_run_id: null, p_id: null });
  });

  it('brings one’s own saved draft back into the form as it was saved', () => {
    const row: CampaignDraftRow = {
      id: 'd1',
      name_en: 'Autumn',
      name_ar: 'الخريف',
      channel: 'in_venue',
      status: 'draft',
      starts_at: '2026-09-30T21:00:00Z',
      ends_at: null,
      body_en: 'Hi',
      body_ar: '',
      note: null,
      images: ['v/campaigns/1.jpg'],
      run_id: RUN,
      menu_item_id: null,
      suggested_at: '2026-09-25T08:00:00Z',
      editable: true,
    };
    expect(draftFromRow(row, 'ar')).toEqual({
      id: 'd1',
      name: 'الخريف',
      channel: 'in_venue',
      starts: '2026-10-01',
      ends: '',
      bodyEn: 'Hi',
      bodyAr: '',
      note: '',
      images: ['v/campaigns/1.jpg'],
      linkKind: 'run',
      linkId: RUN,
    });
    expect(campaignArgs(draftFromRow(row, 'en'), VENUE).p_id).toBe('d1');
  });
});

describe('requests to marketing', () => {
  const today = '2026-09-25';

  it('needs a title and details; a day, when given, is not in the past', () => {
    expect(validateRequest(emptyRequestDraft(), today).map((i) => i.field)).toEqual(['title', 'body']);
    const base = { ...emptyRequestDraft(), title: 'Post', body: 'Please' };
    expect(validateRequest({ ...base, wantBy: '2026-09-24' }, today)).toEqual([{ field: 'wantBy', code: 'past' }]);
    expect(validateRequest({ ...base, wantBy: '25/09/2026' }, today)).toEqual([{ field: 'wantBy', code: 'invalid' }]);
    expect(validateRequest({ ...base, wantBy: '٢٠٢٦-٠٩-٢٥' }, today)).toEqual([]);
    expect(validateRequest({ ...base, title: 't'.repeat(121) }, today)).toEqual([{ field: 'title', code: 'tooLong' }]);
    expect(validateRequest({ ...base, photos: Array(5).fill('p') }, today)).toEqual([{ field: 'photos', code: 'tooLong' }]);
  });

  it('sends the day as YYYY-MM-DD, or none', () => {
    const base = { ...emptyRequestDraft(), title: ' Post ', body: ' Please ', menuItemId: ITEM };
    expect(requestArgs({ ...base, wantBy: '2026/10/2' }, VENUE)).toEqual({
      p_title: 'Post',
      p_body: 'Please',
      p_want_by: '2026-10-02',
      p_menu_item_id: ITEM,
      p_photos: [],
      p_venue_id: VENUE,
    });
    expect(requestArgs(base, VENUE).p_want_by).toBeNull();
  });

  it('needs an answer within the cap', () => {
    expect(validateAnswer('  ')).toBe('required');
    expect(validateAnswer('x'.repeat(CAPS.answer + 1))).toBe('tooLong');
    expect(validateAnswer('Posted on Friday')).toBeNull();
  });
});

describe('names', () => {
  it('shows a name in the reader’s language, falling back to the other', () => {
    expect(localName('Latte', 'لاتيه', 'ar')).toBe('لاتيه');
    expect(localName('Latte', null, 'ar')).toBe('Latte');
    expect(localName(' ', 'لاتيه', 'en')).toBe('لاتيه');
    expect(localName(null, undefined, 'en')).toBe('');
  });
});
