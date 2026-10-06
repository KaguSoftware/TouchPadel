import { describe, expect, it } from 'vitest';
import type { AdminCoach } from '../../coaching/lessonPayloads';
import {
  acceptanceOf,
  branchSet,
  coachName,
  coachPatch,
  hoursCoaches,
  newPromoteDraft,
  orderAfterMove,
  orderWrites,
  ownPriceOf,
  profileDraftOf,
  profileProblems,
  promoteArgs,
  promoteProblems,
  refusedBranchIds,
  replacedPhoto,
  retireFacts,
  retireNoteOk,
  sameSet,
  splitRetired,
  teachingHere,
  toggleId,
  typeChange,
} from './coachesLogic';

// operator.md §5.13.1: Make a coach, the editor's patches and diffs, the
// list's acceptance and retired fold, and the retire confirm (C-25, R45).

const PHOTO =
  'coaches/0f8fad5b-d9cb-469f-a165-70867728950e/7c9e6679-7425-40de-944b-e07fc1f90ae7.webp';

function coach(over: Partial<AdminCoach> = {}): AdminCoach {
  return {
    coach_id: 'c1',
    profile_id: 'p1',
    full_name: 'Sara Karim',
    phone: '+9647700000000',
    account_deleted: false,
    display_name_en: 'Coach Sara',
    display_name_ar: 'المدرّبة سارة',
    bio_en: '',
    bio_ar: '',
    photo_path: null,
    status: 'active',
    public_accepted_at: '2026-09-30T10:00:00Z',
    sort_order: 0,
    venue_ids: ['v1'],
    active_here: true,
    lesson_type_ids: ['t1', 't2'],
    prices: [{ lesson_type_id: 't2', price_iqd: 40000 }],
    hours: [],
    hours_set_by: null,
    hours_set_by_name: null,
    hours_updated_at: null,
    hours_elsewhere: [],
    time_off: [],
    upcoming_lessons: 0,
    open_courses: 0,
    ...over,
  };
}

describe('Make a coach', () => {
  it("ticks the rail's branch and blocks until an account, both names and a branch are there", () => {
    const d = newPromoteDraft('v1');
    expect(d.venueIds).toEqual(['v1']);
    expect(promoteProblems(d)).toEqual(['account', 'names']);
    expect(promoteProblems({ ...d, venueIds: [] })).toEqual(['account', 'names', 'branches']);
    const ready = {
      ...d,
      customer: { id: 'p9', name: 'Ali', phone: null },
      nameEn: 'Coach Ali',
      nameAr: 'المدرّب علي',
    };
    expect(promoteProblems(ready)).toEqual([]);
    expect(promoteProblems({ ...ready, nameEn: 'x'.repeat(61) })).toEqual(['names']);
  });

  it('sends the random-folder photo path and the ticked branches (R43)', () => {
    const d = {
      ...newPromoteDraft('v1', { id: 'p9', name: 'Ali', phone: null }),
      nameEn: ' Coach Ali ',
      nameAr: 'المدرّب علي',
      bioEn: 'Ten years on court.',
      photo: PHOTO,
      venueIds: ['v1', 'v2'],
    };
    expect(promoteArgs(d, ['v1', 'v2'])).toEqual({
      p_profile_id: 'p9',
      p_display_name_en: 'Coach Ali',
      p_display_name_ar: 'المدرّب علي',
      p_bio_en: 'Ten years on court.',
      p_bio_ar: '',
      p_photo_path: PHOTO,
      p_venue_ids: ['v1', 'v2'],
    });
  });

  it('Make a coach again brings back the names, bios and branches, never the photo', () => {
    const retired = coach({
      status: 'retired',
      photo_path: PHOTO,
      bio_en: 'Back',
      venue_ids: ['v2'],
    });
    const d = newPromoteDraft('v1', { id: 'p1', name: 'Sara Karim', phone: null }, retired, [
      'v1',
      'v2',
    ]);
    expect(d).toMatchObject({ nameEn: 'Coach Sara', bioEn: 'Back', photo: null });
    expect(d.venueIds.sort()).toEqual(['v1', 'v2']);
  });

  it("Make a coach again keeps only the branches the screen shows: another manager's is never sent (OP-03)", () => {
    const retired = coach({ status: 'retired', venue_ids: ['A', 'B'] });
    const d = newPromoteDraft('A', { id: 'p1', name: 'Sara Karim', phone: null }, retired, ['A']);
    expect(d.venueIds).toEqual(['A']);
    expect(promoteArgs(d, ['A']).p_venue_ids).toEqual(['A']);
    // A draft that somehow holds B still sends only what is shown.
    expect(promoteArgs({ ...d, venueIds: ['A', 'B'] }, ['A']).p_venue_ids).toEqual(['A']);
  });

  it('toggles ids like a checkbox', () => {
    expect(toggleId(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(toggleId(['a'], 'a', true)).toEqual(['a']);
  });
});

describe('the profile patch', () => {
  it('sends only the changed keys', () => {
    const c = coach();
    const d = { ...profileDraftOf(c), nameEn: 'Coach Sara K', photo: PHOTO };
    expect(coachPatch(c, d)).toEqual({
      display_name_en: 'Coach Sara K',
      photo_path: PHOTO,
    });
    expect(coachPatch(c, profileDraftOf(c))).toEqual({});
  });

  it('removing a photo sends null; the replaced object is removed after the save', () => {
    const c = coach({ photo_path: PHOTO });
    expect(coachPatch(c, { ...profileDraftOf(c), photo: null })).toEqual({ photo_path: null });
    expect(replacedPhoto(c, { photo: null })).toBe(PHOTO);
    expect(replacedPhoto(c, { photo: PHOTO })).toBeNull();
    expect(replacedPhoto(coach(), { photo: PHOTO })).toBeNull();
  });

  it('needs both names; bios up to 1000', () => {
    const d = profileDraftOf(coach());
    expect(profileProblems({ ...d, nameAr: '' })).toEqual(['names']);
    expect(profileProblems({ ...d, bioEn: 'x'.repeat(1001) })).toEqual(['bio']);
  });
});

describe('branches and lesson types', () => {
  it('keeps saved branches the screen cannot show', () => {
    expect(branchSet(['v1', 'vClosed'], ['v2'], ['v1', 'v2'])).toEqual(['v2', 'vClosed']);
    expect(sameSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameSet(['a'], ['a', 'b'])).toBe(false);
  });

  it('unticking a type the coach has an own price for is a price loss (R46)', () => {
    const c = coach();
    expect(typeChange(c, ['t1', 't3'])).toEqual({
      added: ['t3'],
      removed: ['t2'],
      priceLosses: ['t2'],
    });
    expect(typeChange(c, ['t2'])).toEqual({ added: [], removed: ['t1'], priceLosses: [] });
    expect(ownPriceOf(c, 't2')).toBe(40000);
    expect(ownPriceOf(c, 't1')).toBeNull();
  });

  it('names the refused branch: an id in the hint, or the removed ones for coach_lessons', () => {
    expect(refusedBranchIds('6F9619FF-8B86-D011-B42D-00C04FC964FF', ['v2'])).toEqual([
      '6f9619ff-8b86-d011-b42d-00c04fc964ff',
    ]);
    expect(refusedBranchIds('coach_lessons', ['v2'])).toEqual(['v2']);
  });

  it('two branches removed and the hint naming v2: only v2 is named (OP-07)', () => {
    const v1 = '11111111-1111-4111-8111-111111111111';
    const v2 = '22222222-2222-4222-8222-222222222222';
    // The editor passes error.hint before error.details (the detail is coach_lessons).
    const err = { hint: v2, details: 'coach_lessons' };
    expect(refusedBranchIds(err.hint || err.details, [v1, v2])).toEqual([v2]);
  });
});

describe('the list', () => {
  it('acceptance: waiting until the coach accepts; a deleted account outranks it (C-22, R61, R63)', () => {
    expect(acceptanceOf(coach())).toBe('accepted');
    expect(acceptanceOf(coach({ public_accepted_at: null }))).toBe('waiting');
    expect(acceptanceOf(coach({ public_accepted_at: null, account_deleted: true }))).toBe(
      'deleted',
    );
  });

  it('folds retired coaches away and keeps them out of the Hours tab', () => {
    const list = [
      coach({ coach_id: 'r', status: 'retired' }),
      coach({ coach_id: 'b', display_name_en: 'B', sort_order: 1 }),
      coach({ coach_id: 'p', display_name_en: 'A', status: 'paused', sort_order: 1 }),
    ];
    const { current, retired } = splitRetired(list);
    expect(current.map((c) => c.coach_id)).toEqual(['p', 'b']);
    expect(retired.map((c) => c.coach_id)).toEqual(['r']);
    expect(hoursCoaches(list).map((c) => c.coach_id)).toEqual(['p', 'b']);
  });

  it('a coach not active at this branch is not offered in the Hours tab nor counted (OP-06)', () => {
    const list = [
      coach({ coach_id: 'a', display_name_en: 'A' }),
      coach({ coach_id: 'off', display_name_en: 'B', active_here: false }),
    ];
    expect(hoursCoaches(list).map((c) => c.coach_id)).toEqual(['a']);
    expect(teachingHere(list).map((c) => c.coach_id)).toEqual(['a']);
  });

  it('the order arrows swap one coach with its neighbour and renumber in tens (OP-01)', () => {
    const list = [
      coach({ coach_id: 'a', display_name_en: 'A', sort_order: 0 }),
      coach({ coach_id: 'b', display_name_en: 'B', sort_order: 5 }),
      coach({ coach_id: 'c', display_name_en: 'C', sort_order: 9 }),
    ];
    expect(orderAfterMove(list, 'b', -1)).toEqual([
      { id: 'b', sort_order: 0 },
      { id: 'a', sort_order: 10 },
      { id: 'c', sort_order: 20 },
    ]);
    expect(orderAfterMove(list, 'b', 1)).toEqual([
      { id: 'c', sort_order: 10 },
      { id: 'b', sort_order: 20 },
    ]);
    expect(orderAfterMove(list, 'a', -1)).toBeNull();
    expect(orderAfterMove(list, 'c', 1)).toBeNull();
  });

  it('three coaches tied at 0: up and down each move exactly one place, never below 0 (OP-01)', () => {
    const list = [
      coach({ coach_id: 'a', display_name_en: 'A', sort_order: 0 }),
      coach({ coach_id: 'b', display_name_en: 'B', sort_order: 0 }),
      coach({ coach_id: 'c', display_name_en: 'C', sort_order: 0 }),
    ];
    const after = (writes: { id: string; sort_order: number }[] | null) =>
      list
        .map((c) => ({
          ...c,
          sort_order: writes?.find((w) => w.id === c.coach_id)?.sort_order ?? c.sort_order,
        }))
        .sort(
          (x, y) =>
            (x.sort_order ?? 0) - (y.sort_order ?? 0) ||
            x.display_name_en.localeCompare(y.display_name_en),
        )
        .map((c) => c.coach_id);
    const up = orderAfterMove(list, 'b', -1);
    expect(after(up)).toEqual(['b', 'a', 'c']);
    expect(up!.every((w) => w.sort_order >= 0)).toBe(true);
    const down = orderAfterMove(list, 'b', 1);
    expect(after(down)).toEqual(['a', 'c', 'b']);
    expect(down!.every((w) => w.sort_order >= 0)).toBe(true);
    // Only the rows that changed are written: a, already at 0, is not.
    expect(down!.map((w) => w.id)).toEqual(['c', 'b']);
  });

  it('orderWrites: null for an id not in the list', () => {
    expect(orderWrites([{ id: 'x', sort_order: 0 }], 'z', 1)).toBeNull();
  });

  it('the retire confirm names the lessons to come and the course clause (C-25, R45)', () => {
    expect(retireFacts(coach({ upcoming_lessons: 5, open_courses: 1 }))).toEqual({
      lessons: 5,
      courses: true,
    });
    expect(retireFacts(coach({ upcoming_lessons: null, open_courses: null }))).toEqual({
      lessons: 0,
      courses: false,
    });
    expect(retireNoteOk('')).toBe(false);
    expect(retireNoteOk('  Moved abroad ')).toBe(true);
    expect(retireNoteOk('x'.repeat(201))).toBe(false);
  });

  it('names the coach in the screen language', () => {
    expect(coachName(coach(), 'en')).toBe('Coach Sara');
    expect(coachName(coach(), 'ar')).toBe('المدرّبة سارة');
    expect(coachName(coach({ display_name_ar: '' }), 'ar')).toBe('Coach Sara');
  });
});
