import { describe, expect, it } from 'vitest';
import type { AdminLessonType } from '../../coaching/lessonPayloads';
import {
  DURATIONS,
  NEW_GROUP_CUTOFF_HOURS,
  draftCopyOf,
  draftFromType,
  groupTypes,
  launchBlock,
  lessonTypeDraftErrors,
  lessonTypeFieldOf,
  lessonTypePatch,
  maxPlacesLocked,
  newLessonTypeDraft,
  onSaleCount,
  priceLock,
  typeOrderAfterMove,
  typeState,
  withKind,
} from './lessonTypeLogic';

// operator.md §5.13.2: the draft, the §1.2 CHECKs and R26, R46's lock table,
// the patch of changed keys, Make a new lesson type…, and the launch path.

const OWNER = { editLaunchedPrices: true, launchDirectly: true };
const MANAGER = { editLaunchedPrices: false, launchDirectly: false };

function type(over: Partial<AdminLessonType> = {}): AdminLessonType {
  return {
    lesson_type_id: 't1',
    kind: 'private',
    name_en: 'Private 60',
    name_ar: 'حصة خاصة 60',
    description_en: '',
    description_ar: '',
    duration_min: 60,
    price_iqd: 30000,
    court_share_iqd: 5000,
    max_places: 4,
    min_places: 1,
    cutoff_hours: 0,
    sessions_count: null,
    is_active: true,
    launched_at: '2026-09-01T00:00:00Z',
    sort_order: 0,
    coach_ids: [],
    pending_run: null,
    ...over,
  };
}

describe('the draft', () => {
  it('a new group or course type starts at a 2-hour cut-off (R26); a private one at none', () => {
    expect(newLessonTypeDraft('group').cutoffHours).toBe(String(NEW_GROUP_CUTOFF_HOURS));
    expect(newLessonTypeDraft('course').cutoffHours).toBe('2');
    expect(newLessonTypeDraft('course').sessions).toBe('8');
    expect(newLessonTypeDraft('private').cutoffHours).toBe('0');
    expect(newLessonTypeDraft().price).toBeNull();
  });

  it('switching kind keeps the names and price and starts the places over', () => {
    const d = withKind(
      { ...newLessonTypeDraft('private'), nameEn: 'Clinic', price: 15000 },
      'group',
    );
    expect(d).toMatchObject({
      kind: 'group',
      nameEn: 'Clinic',
      price: 15000,
      maxPlaces: '8',
      minPlaces: '2',
      cutoffHours: '2',
    });
  });

  it('offers 30..240 minutes by 30', () => {
    expect(DURATIONS).toEqual([30, 60, 90, 120, 150, 180, 210, 240]);
  });
});

describe('lessonTypeDraftErrors (§1.2 CHECKs, R26)', () => {
  const ok = { ...newLessonTypeDraft('group'), nameEn: 'Clinic', nameAr: 'تدريب جماعي' };

  it('a complete draft passes', () => {
    expect(lessonTypeDraftErrors(ok)).toEqual({});
  });

  it('refuses a 0-hour cut-off with a minimum above 1', () => {
    expect(lessonTypeDraftErrors({ ...ok, minPlaces: '2', cutoffHours: '0' })).toEqual({
      cutoffHours: 'cutoffMin',
    });
    // A minimum of 1 needs no cut-off.
    expect(lessonTypeDraftErrors({ ...ok, minPlaces: '1', cutoffHours: '0' })).toEqual({});
  });

  it('needs both names, up to 60 characters', () => {
    expect(lessonTypeDraftErrors({ ...ok, nameAr: ' ' })).toEqual({ names: 'names' });
    expect(lessonTypeDraftErrors({ ...ok, nameEn: 'x'.repeat(61) })).toEqual({ names: 'names' });
  });

  it('holds places, minimum, cut-off and sessions to their bounds', () => {
    expect(lessonTypeDraftErrors({ ...ok, maxPlaces: '17' })).toEqual({ maxPlaces: 'range' });
    expect(lessonTypeDraftErrors({ ...ok, maxPlaces: '1' })).toEqual({
      maxPlaces: 'range',
      minPlaces: 'minAboveMax',
    });
    expect(lessonTypeDraftErrors({ ...ok, minPlaces: '9' })).toEqual({ minPlaces: 'minAboveMax' });
    expect(lessonTypeDraftErrors({ ...ok, cutoffHours: '169' })).toEqual({ cutoffHours: 'range' });
    expect(lessonTypeDraftErrors({ ...ok, kind: 'course', sessions: '1' })).toEqual({
      sessions: 'range',
    });
    expect(lessonTypeDraftErrors({ ...ok, kind: 'course', sessions: '53' })).toEqual({
      sessions: 'range',
    });
    expect(lessonTypeDraftErrors({ ...ok, maxPlaces: '' })).toEqual({ maxPlaces: 'wholeNumber' });
  });

  it("a private type's party is 1..4 and needs no minimum or cut-off", () => {
    const p = { ...newLessonTypeDraft('private'), nameEn: 'Private', nameAr: 'خاصة' };
    expect(lessonTypeDraftErrors(p)).toEqual({});
    expect(lessonTypeDraftErrors({ ...p, maxPlaces: '5' })).toEqual({ maxPlaces: 'range' });
    expect(lessonTypeDraftErrors({ ...p, durationMin: 45 })).toEqual({ durationMin: 'duration' });
  });
});

describe('priceLock (R46)', () => {
  it('a draft: everything editable for both; the owner launches directly, a manager through the protocol', () => {
    const draft = type({ launched_at: null, is_active: false, price_iqd: null });
    expect(priceLock(draft, OWNER)).toEqual({
      kind: false,
      price: false,
      shape: false,
      launch: 'direct',
      activeSwitch: false,
    });
    expect(priceLock(draft, MANAGER)).toEqual({
      kind: false,
      price: false,
      shape: false,
      launch: 'protocol',
      activeSwitch: false,
    });
    expect(priceLock(null, MANAGER).launch).toBe('protocol');
  });

  it('launched, owner: every field but the kind, and the Active switch', () => {
    expect(priceLock(type(), OWNER)).toEqual({
      kind: true,
      price: false,
      shape: false,
      launch: null,
      activeSwitch: true,
    });
  });

  it("launched, manager: price and shape read-only, a private type's party size locked, a group type's places editable, the Active switch direct", () => {
    const lock = priceLock(type(), MANAGER);
    expect(lock).toEqual({
      kind: true,
      price: true,
      shape: true,
      launch: null,
      activeSwitch: true,
    });
    expect(maxPlacesLocked('private', lock)).toBe(true);
    expect(maxPlacesLocked('group', lock)).toBe(false);
    expect(maxPlacesLocked('private', priceLock(type(), OWNER))).toBe(false);
  });

  it('a launched type that is off still has the Active switch', () => {
    expect(priceLock(type({ is_active: false }), MANAGER).activeSwitch).toBe(true);
  });
});

describe('lessonTypePatch', () => {
  it('sends every key for a new type', () => {
    const d = {
      ...newLessonTypeDraft('course'),
      nameEn: ' Beginners ',
      nameAr: 'مبتدئون',
      price: 120000,
    };
    expect(lessonTypePatch(null, d, priceLock(null, MANAGER))).toEqual({
      kind: 'course',
      name_en: 'Beginners',
      name_ar: 'مبتدئون',
      description_en: '',
      description_ar: '',
      duration_min: 60,
      price_iqd: 120000,
      court_share_iqd: 0,
      max_places: 8,
      min_places: 2,
      cutoff_hours: 2,
      sessions_count: 8,
      sort_order: 0,
    });
  });

  it('sends only the changed keys', () => {
    const t = type({
      kind: 'group',
      max_places: 8,
      min_places: 2,
      cutoff_hours: 2,
      launched_at: null,
      is_active: false,
    });
    const d = { ...draftFromType(t), nameEn: 'Clinic+', cutoffHours: '3', price: 20000 };
    expect(lessonTypePatch(t, d, priceLock(t, MANAGER))).toEqual({
      name_en: 'Clinic+',
      cutoff_hours: 3,
      price_iqd: 20000,
    });
  });

  it('never sends a locked field: a manager on a launched private type', () => {
    const t = type();
    const d = {
      ...draftFromType(t),
      nameEn: 'Private hour',
      price: 1,
      courtShare: 2,
      durationMin: 90,
      maxPlaces: '2',
    };
    expect(lessonTypePatch(t, d, priceLock(t, MANAGER))).toEqual({ name_en: 'Private hour' });
    // The owner sends them all.
    expect(lessonTypePatch(t, d, priceLock(t, OWNER))).toEqual({
      name_en: 'Private hour',
      price_iqd: 1,
      court_share_iqd: 2,
      duration_min: 90,
      max_places: 2,
    });
  });

  it("a manager changes a launched group type's places and minimum directly", () => {
    const t = type({ kind: 'group', max_places: 8, min_places: 2, cutoff_hours: 2 });
    const d = { ...draftFromType(t), maxPlaces: '10', minPlaces: '3' };
    expect(lessonTypePatch(t, d, priceLock(t, MANAGER))).toEqual({ max_places: 10, min_places: 3 });
  });

  it('the order arrows move a type past its neighbour of the same kind, a direct edit (R46)', () => {
    const types = [
      type({ lesson_type_id: 'a', name_en: 'A', sort_order: 0 }),
      type({ lesson_type_id: 'b', name_en: 'B', sort_order: 5 }),
      type({ lesson_type_id: 'g', name_en: 'G', kind: 'group', sort_order: 1 }),
    ];
    expect(typeOrderAfterMove(types, 'b', 'private', 5, -1)).toBe(-1);
    expect(typeOrderAfterMove(types, 'a', 'private', 0, 1)).toBe(6);
    expect(typeOrderAfterMove(types, 'a', 'private', 0, -1)).toBeNull();
    expect(typeOrderAfterMove(types, 'g', 'group', 1, 1)).toBeNull();
    const t = types[1]!;
    const d = { ...draftFromType(t), sortOrder: -1 };
    expect(lessonTypePatch(t, d, priceLock(t, MANAGER))).toEqual({ sort_order: -1 });
  });
});

describe('Make a new lesson type… and the launch path', () => {
  it('a copy is a new draft prefilled from the type', () => {
    const t = type({
      kind: 'course',
      sessions_count: 8,
      max_places: 6,
      min_places: 3,
      cutoff_hours: 24,
    });
    const copy = draftCopyOf(t);
    expect(copy).toMatchObject({
      kind: 'course',
      nameEn: 'Private 60',
      sessions: '8',
      maxPlaces: '6',
      minPlaces: '3',
      cutoffHours: '24',
      price: 30000,
      courtShare: 5000,
    });
    expect(lessonTypePatch(null, copy, priceLock(null, MANAGER))).toMatchObject({
      kind: 'course',
      sessions_count: 8,
    });
  });

  it('Put on sale waits for a saved draft with a price', () => {
    const draft = type({ launched_at: null, is_active: false, price_iqd: null });
    expect(launchBlock(null, false)).toBe('saveFirst');
    expect(launchBlock(draft, true)).toBe('saveFirst');
    expect(launchBlock(draft, false)).toBe('setPriceFirst');
    expect(launchBlock({ ...draft, price_iqd: 30000 }, false)).toBeNull();
  });
});

describe('the list', () => {
  it('states: draft, on sale, off', () => {
    expect(typeState(type({ launched_at: null, is_active: false }))).toBe('draft');
    expect(typeState(type())).toBe('onSale');
    expect(typeState(type({ is_active: false }))).toBe('off');
  });

  it('groups by kind in sort order and counts what is on sale', () => {
    const types = [
      type({ lesson_type_id: 'b', name_en: 'B', sort_order: 2 }),
      type({ lesson_type_id: 'a', name_en: 'A', sort_order: 1 }),
      type({ lesson_type_id: 'g', kind: 'group', is_active: false }),
      type({ lesson_type_id: 'c', kind: 'course', launched_at: null, is_active: false }),
    ];
    const g = groupTypes(types);
    expect(g.private.map((t) => t.lesson_type_id)).toEqual(['a', 'b']);
    expect(g.group).toHaveLength(1);
    expect(g.course).toHaveLength(1);
    expect(onSaleCount(types)).toBe(2);
  });

  it('maps INVALID_ARGUMENT keys to fields', () => {
    expect(lessonTypeFieldOf('cutoff_hours')).toBe('cutoffHours');
    expect(lessonTypeFieldOf('name_ar')).toBe('names');
    expect(lessonTypeFieldOf('nope')).toBeNull();
  });
});
