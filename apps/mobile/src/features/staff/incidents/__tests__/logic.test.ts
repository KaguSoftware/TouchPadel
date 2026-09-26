import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from '@touch/core';
import { staffKeys } from '../../keys';
import { staffIdemKey } from '../../../../lib/idempotency';
import {
  INCIDENT_KINDS,
  INCIDENT_PLACES,
  emptyIncidentDraft,
  incidentArgs,
  ownReportLine,
  reviewsIncidents,
  toReviewCount,
  validateIncident,
  validateReviewNote,
  withPlace,
  type IncidentDraft,
} from '../logic';

/**
 * Incident reports as rules (wave5-addendum-2026-09-25 §2.6, §5.3): the
 * checks mirror submit_incident's (0198), and the reviewers its review guard.
 */
// 2026-09-26 12:00 at the venue (+03:00).
const NOW = Date.parse('2026-09-26T09:00:00Z');

const ok: IncidentDraft = {
  kind: 'injury',
  when: '2026-09-26 11:30',
  place: 'court',
  courtId: 'c-2',
  placeDetail: '',
  description: 'A player twisted an ankle',
  people: '',
  photos: [],
};

describe('who reviews', () => {
  it('is management only; every role reports', () => {
    for (const role of STAFF_ROLES) {
      expect(reviewsIncidents(role), role).toBe(role === 'manager' || role === 'owner');
    }
  });

  it('offers the kinds and places of 0198, in order', () => {
    expect(INCIDENT_KINDS).toEqual(['accident', 'injury', 'fight', 'damage', 'other']);
    expect(INCIDENT_PLACES).toEqual(['court', 'cafe', 'shop', 'outside', 'other']);
  });
});

describe('a report', () => {
  it('starts with nothing chosen and "when" set to now at the venue', () => {
    const draft = emptyIncidentDraft(NOW);
    expect(draft.kind).toBeNull();
    expect(draft.place).toBeNull();
    expect(draft.when).toBe('2026-09-26 12:00');
  });

  it('passes when complete, and sends the venue time as an instant with its offset', () => {
    expect(validateIncident(ok, NOW)).toEqual([]);
    expect(
      incidentArgs(
        { ...ok, description: '  A player twisted an ankle  ', photos: ['p/1.jpg'] },
        'v-1',
      ),
    ).toEqual({
      p_kind: 'injury',
      p_occurred_at: '2026-09-26T11:30:00+03:00',
      p_place: 'court',
      p_description: 'A player twisted an ankle',
      p_court_id: 'c-2',
      p_place_detail: null,
      p_people_involved: null,
      p_photos: ['p/1.jpg'],
      p_venue_id: 'v-1',
    });
  });

  it('needs what happened, where, and words', () => {
    const issues = validateIncident({ ...emptyIncidentDraft(NOW), description: '   ' }, NOW);
    expect(issues).toEqual([
      { field: 'kind', code: 'required' },
      { field: 'place', code: 'required' },
      { field: 'description', code: 'required' },
    ]);
  });

  it('needs the court for a court, and drops it for any other place (INVALID_ARGUMENT hint court_id)', () => {
    expect(validateIncident({ ...ok, courtId: null }, NOW)).toEqual([
      { field: 'courtId', code: 'required' },
    ]);
    const moved = withPlace(ok, 'cafe');
    expect(moved.courtId).toBeNull();
    expect(incidentArgs(moved, 'v-1').p_court_id).toBeNull();
    expect(withPlace(ok, 'court').courtId).toBe('c-2');
  });

  it('dates it within the last 7 days and at most 10 minutes ahead (hint occurred_at)', () => {
    expect(validateIncident({ ...ok, when: '2026-09-26 12:09' }, NOW)).toEqual([]);
    expect(validateIncident({ ...ok, when: '2026-09-26 12:11' }, NOW)).toEqual([
      { field: 'when', code: 'future' },
    ]);
    expect(validateIncident({ ...ok, when: '2026-09-19 12:01' }, NOW)).toEqual([]);
    expect(validateIncident({ ...ok, when: '2026-09-19 11:59' }, NOW)).toEqual([
      { field: 'when', code: 'tooOld' },
    ]);
    expect(validateIncident({ ...ok, when: 'yesterday' }, NOW)).toEqual([
      { field: 'when', code: 'invalid' },
    ]);
    expect(validateIncident({ ...ok, when: '' }, NOW)).toEqual([
      { field: 'when', code: 'required' },
    ]);
  });

  it('keeps the text to the server caps', () => {
    expect(validateIncident({ ...ok, description: 'x'.repeat(2001) }, NOW)).toEqual([
      { field: 'description', code: 'tooLong' },
    ]);
    expect(validateIncident({ ...ok, people: 'x'.repeat(1001) }, NOW)).toEqual([
      { field: 'people', code: 'tooLong' },
    ]);
    expect(validateIncident({ ...ok, placeDetail: 'x'.repeat(121) }, NOW)).toEqual([
      { field: 'placeDetail', code: 'tooLong' },
    ]);
    expect(
      validateIncident({ ...ok, photos: Array.from({ length: 7 }, (_, i) => `p/${i}`) }, NOW),
    ).toEqual([{ field: 'photos', code: 'tooLong' }]);
  });

  it('sends optional text as null when left empty, trimmed when typed', () => {
    const args = incidentArgs(
      { ...ok, people: '  Two players  ', placeDetail: ' back line ' },
      'v-1',
    );
    expect(args.p_people_involved).toBe('Two players');
    expect(args.p_place_detail).toBe('back line');
  });
});

describe('a review note', () => {
  it('is required and at most 1,000 characters', () => {
    expect(validateReviewNote('  ')).toBe('required');
    expect(validateReviewNote('Called his family; no charge for the court.')).toBeNull();
    expect(validateReviewNote('x'.repeat(1001))).toBe('tooLong');
  });
});

describe('keys', () => {
  it('stay under the staff root', () => {
    expect(staffKeys.myIncidents('v')).toEqual(['staff', 'myIncidents', 'v']);
    expect(staffKeys.incidents('v', 'open')).toEqual(['staff', 'incidents', 'v', 'open']);
    expect(staffKeys.mutation('incident.review')).toEqual(['staff', 'mutation', 'incident.review']);
  });

  it('mint a report key as MOBILE:staff.incident:<ulid>', () => {
    expect(staffIdemKey('incident')).toMatch(/^MOBILE:staff\.incident:[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe('management’s count and the own-report line', () => {
  it('leaves the viewer’s own open reports out of the count to review', () => {
    const page = {
      open_count: 2,
      incidents: [
        { status: 'open' as const, can_review: true },
        { status: 'open' as const, can_review: false },
        { status: 'reviewed' as const, can_review: false },
      ],
    };
    expect(toReviewCount(page)).toBe(1);
    expect(
      toReviewCount({ open_count: 1, incidents: [{ status: 'open' as const, can_review: false }] }),
    ).toBe(0);
    expect(toReviewCount(undefined)).toBe(0);
  });

  it('says a manager reviews the owner’s own report', () => {
    expect(ownReportLine('owner')).toBe('ownOwner');
    expect(ownReportLine('manager')).toBe('own');
    expect(ownReportLine(null)).toBe('own');
  });
});
