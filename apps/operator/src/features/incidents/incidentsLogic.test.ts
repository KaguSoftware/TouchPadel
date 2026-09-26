import { describe, expect, it } from 'vitest';
import {
  AHEAD_MS,
  BACK_MS,
  incidentTone,
  incidentsOpenCount,
  onlyManagerReviews,
  placeText,
  readIncidentsPage,
  readMyIncidents,
  reportArgs,
  reportRefusalField,
  reviewIssue,
  validateReport,
  type ReportDraft,
} from './incidentsLogic';

// /incidents, pure (wave5-addendum-2026-09-25 §2.6, §5.2): the readers of
// app.my_incidents and app.incidents_page, and the report form, which states
// every rule of app.submit_incident before the server would refuse it.

const row = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  kind: 'injury',
  occurred_at: '2026-09-26T08:10:00Z',
  place: 'court',
  court_id: 'c3',
  court_name_en: 'Court 3',
  court_name_ar: 'الملعب 3',
  place_detail: 'By the net',
  description: 'A player twisted an ankle.',
  people_involved: 'Two guests',
  photos: ['v1/incidents/a.jpg', 7],
  status: 'open',
  reviewed_by_name: null,
  reviewed_at: null,
  review_note: null,
  redacted: false,
  reported_by_name: 'Hussein',
  reported_by_role: 'court_desk',
  reported_at: '2026-09-26T08:20:00Z',
  can_review: true,
  can_redact: false,
  ...over,
});

describe('the readers', () => {
  it('reads app.incidents_page as returned; its open count is management’s badge', () => {
    const payload = { incidents: [row()], open_count: 2, total: 5 };
    const page = readIncidentsPage(payload);
    expect(page.openCount).toBe(2);
    expect(page.total).toBe(5);
    expect(page.rows[0]).toMatchObject({
      id: 'i1',
      kind: 'injury',
      place: 'court',
      courtNameEn: 'Court 3',
      placeDetail: 'By the net',
      photos: ['v1/incidents/a.jpg'],
      status: 'open',
      reportedByRole: 'court_desk',
      canReview: true,
      canRedact: false,
      redacted: false,
    });
    expect(incidentsOpenCount(payload)).toBe(2);
    expect(incidentsOpenCount(undefined)).toBe(0);
  });

  it('says a manager reviews the owner’s own report', () => {
    expect(onlyManagerReviews('owner')).toBe(true);
    expect(onlyManagerReviews('manager')).toBe(false);
    expect(onlyManagerReviews(null)).toBe(false);
  });

  it('leaves the viewer’s own open reports out of the count to review', () => {
    const payload = { incidents: [row({ id: 'a' }), row({ id: 'own', can_review: false }), row({ id: 'r', status: 'reviewed', can_review: false })], open_count: 2, total: 3 };
    expect(incidentsOpenCount(payload)).toBe(1);
    expect(incidentsOpenCount({ incidents: [row({ can_review: false })], open_count: 1 })).toBe(0);
  });

  it('reads the reporter’s own list, and an unknown kind or place as Other', () => {
    const mine = readMyIncidents({ incidents: [row({ kind: 'flood', place: 'roof', status: 'reviewed', review_note: 'Spoke to both' }), { no: 'id' }] });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: 'other', place: 'other', status: 'reviewed', reviewNote: 'Spoke to both' });
    expect(readMyIncidents(null)).toEqual([]);
  });

  it('keeps the redaction flag, so the page never prints the stored marker', () => {
    expect(readMyIncidents({ incidents: [row({ redacted: true, description: '[deleted after 365 days]' })] })[0]!.redacted).toBe(true);
  });

  it('says where in one phrase: the court’s name in the reader’s language, then where exactly', () => {
    const word = (p: string) => `<${p}>`;
    const r = readIncidentsPage({ incidents: [row()] }).rows[0]!;
    // Both free parts are bidi-isolated (FSI … PDI), so a Latin court name and
    // Latin words cannot run together inside an Arabic line.
    expect(placeText(r, 'ar', word)).toBe('\u2068الملعب 3\u2069 · \u2068By the net\u2069');
    const plain = (s: string) => s.replace(/[\u2066-\u2069]/g, '');
    expect(plain(placeText(r, 'en', word))).toBe('Court 3 · By the net');
    expect(plain(placeText({ ...r, placeDetail: null }, 'en', word))).toBe('Court 3');
    expect(placeText({ ...r, place: 'cafe', courtNameEn: null, courtNameAr: null, placeDetail: null }, 'en', word)).toBe('<cafe>');
    // A court row whose court has no name falls back to the word.
    expect(placeText({ ...r, courtNameEn: null, courtNameAr: null, placeDetail: null }, 'en', word)).toBe('<court>');
  });

  it('marks an open report amber and a reviewed one green', () => {
    expect(incidentTone('open')).toBe('warn');
    expect(incidentTone('reviewed')).toBe('success');
  });
});

describe('the report form', () => {
  const now = new Date('2026-09-26T09:00:00Z');
  const draft = (over: Partial<ReportDraft> = {}): ReportDraft => ({
    kind: 'fight',
    when: '2026-09-26T11:50',
    place: 'cafe',
    courtId: '',
    placeDetail: '',
    description: 'Two guests argued at the counter.',
    people: '',
    photos: [],
    ...over,
  });
  const at = new Date('2026-09-26T08:50:00Z');

  it('passes a good report', () => {
    expect(validateReport(draft(), at, now)).toEqual([]);
  });

  it('asks for the kind, the time, the place, the court on a court, and what happened', () => {
    expect(validateReport(draft({ kind: '', place: '', description: '  ' }), null, now)).toEqual([
      { field: 'kind', code: 'required' },
      { field: 'when', code: 'required' },
      { field: 'place', code: 'required' },
      { field: 'description', code: 'required' },
    ]);
    expect(validateReport(draft({ place: 'court' }), at, now)).toEqual([{ field: 'courtId', code: 'required' }]);
    expect(validateReport(draft({ place: 'court', courtId: 'c3' }), at, now)).toEqual([]);
  });

  it('takes a time from 7 days back to 10 minutes ahead', () => {
    const t = (ms: number) => new Date(now.getTime() + ms);
    expect(validateReport(draft(), t(-BACK_MS), now)).toEqual([]);
    expect(validateReport(draft(), t(-BACK_MS - 60_000), now)).toEqual([{ field: 'when', code: 'whenRange' }]);
    expect(validateReport(draft(), t(AHEAD_MS), now)).toEqual([]);
    expect(validateReport(draft(), t(AHEAD_MS + 60_000), now)).toEqual([{ field: 'when', code: 'whenRange' }]);
  });

  it('holds each text to the server’s length, in characters', () => {
    expect(validateReport(draft({ description: 'ك'.repeat(2000) }), at, now)).toEqual([]);
    expect(validateReport(draft({ description: 'ك'.repeat(2001) }), at, now)).toEqual([{ field: 'description', code: 'tooLong' }]);
    expect(validateReport(draft({ people: 'x'.repeat(1001) }), at, now)).toEqual([{ field: 'people', code: 'tooLong' }]);
    expect(validateReport(draft({ placeDetail: 'x'.repeat(121) }), at, now)).toEqual([{ field: 'placeDetail', code: 'tooLong' }]);
    expect(validateReport(draft({ photos: ['1', '2', '3', '4', '5', '6', '7'] }), at, now)).toEqual([{ field: 'photos', code: 'tooMany' }]);
  });

  it('sends a court only for a court, blanks as NULL, trimmed, with the form’s key', () => {
    expect(reportArgs(draft({ placeDetail: '  ', people: ' Omar ', courtId: 'stale' }), at, 'incident.submit:k1')).toEqual({
      p_kind: 'fight',
      p_occurred_at: '2026-09-26T08:50:00.000Z',
      p_place: 'cafe',
      p_description: 'Two guests argued at the counter.',
      p_court_id: null,
      p_place_detail: null,
      p_people_involved: 'Omar',
      p_photos: [],
      p_idempotency_key: 'incident.submit:k1',
    });
    expect(reportArgs(draft({ place: 'court', courtId: 'c3' }), at, 'k').p_court_id).toBe('c3');
  });

  it('marks the field a server refusal names', () => {
    expect(reportRefusalField('INVALID_ARGUMENT', 'occurred_at')).toBe('when');
    expect(reportRefusalField('INVALID_ARGUMENT', 'court_id')).toBe('courtId');
    expect(reportRefusalField('REF_NOT_FOUND', 'court_id')).toBe('courtId');
    expect(reportRefusalField('TEXT_TOO_LONG', 'people_involved')).toBe('people');
    expect(reportRefusalField('TEXT_TOO_LONG', 'place_detail')).toBe('placeDetail');
    expect(reportRefusalField('TEXT_REQUIRED', 'description')).toBe('description');
    expect(reportRefusalField('PHOTO_PATH_INVALID', null)).toBe('photos');
    expect(reportRefusalField('FORBIDDEN', null)).toBeNull();
  });
});

describe('the review note', () => {
  it('is required, because the reporter reads it, and at most 1000 characters', () => {
    expect(reviewIssue('')).toBe('required');
    expect(reviewIssue('Spoke to both guests.')).toBeNull();
    expect(reviewIssue('x'.repeat(1001))).toBe('tooLong');
  });
});
