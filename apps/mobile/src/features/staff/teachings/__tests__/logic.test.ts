import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from '@touch/core';
import {
  TEACHING_ROLES,
  canWriteTeaching,
  draftFrom,
  emptyTeaching,
  teachingArgs,
  teachingFilters,
  teachingIntent,
  teachingsKeyTeam,
  teachingsTeamArg,
  validateTeaching,
  type Teaching,
} from '../logic';

describe('who reads and writes teachings (#64)', () => {
  it('lets the two teams and management read, and nobody else', () => {
    const readers = STAFF_ROLES.filter((r) => TEACHING_ROLES.includes(r)).sort();
    expect(readers).toEqual(['barista', 'chef', 'head_barista', 'head_chef', 'manager', 'owner']);
  });

  it('lets the heads and management write', () => {
    expect(STAFF_ROLES.filter(canWriteTeaching).sort()).toEqual(['head_barista', 'head_chef', 'manager', 'owner']);
  });

  it('asks a team member’s own team and management’s chosen one', () => {
    expect(teachingsTeamArg('barista', 'kitchen')).toBe('bar');
    expect(teachingsTeamArg('chef', 'all')).toBe('kitchen');
    expect(teachingsTeamArg('manager', 'all')).toBeNull();
    expect(teachingsTeamArg('owner', 'kitchen')).toBe('kitchen');
    expect(teachingsKeyTeam('manager', 'all')).toBe('all');
    expect(teachingsKeyTeam('head_barista', 'all')).toBe('bar');
    expect(teachingFilters('head_chef')).toEqual([]);
    expect(teachingFilters('owner')).toEqual(['all', 'bar', 'kitchen']);
  });
});

describe('a teaching', () => {
  it('starts a head on their own team and management on none', () => {
    expect(emptyTeaching('head_chef').team).toBe('kitchen');
    expect(emptyTeaching('manager').team).toBeNull();
  });

  it('needs a title, a text, and management’s team pick for a new one', () => {
    const mgmt = { ...emptyTeaching('owner') };
    expect(validateTeaching(mgmt, 'owner')).toEqual([
      { field: 'team', code: 'required' },
      { field: 'title', code: 'required' },
      { field: 'body', code: 'required' },
    ]);
    const long = { ...emptyTeaching('head_barista'), title: 'x'.repeat(121), body: 'y'.repeat(4001) };
    expect(validateTeaching(long, 'head_barista')).toEqual([
      { field: 'title', code: 'tooLong' },
      { field: 'body', code: 'tooLong' },
    ]);
    expect(validateTeaching({ ...emptyTeaching('head_barista'), title: 'Milk', body: 'Steam to 65°' }, 'head_barista')).toEqual([]);
  });

  it('names a team only for management’s new one, and never on an edit', () => {
    const head = teachingArgs({ ...emptyTeaching('head_chef'), title: ' T ', body: ' B ', photos: ['p'] }, 'head_chef', 'v1');
    expect(head).toEqual({ p_title: 'T', p_body: 'B', p_photos: ['p'], p_venue_id: 'v1' });
    const mgmt = teachingArgs({ ...emptyTeaching('manager'), team: 'bar', title: 'T', body: 'B' }, 'manager', 'v1');
    expect(mgmt.p_team).toBe('bar');
    const stored: Teaching = {
      id: 't1',
      team: 'kitchen',
      title: 'T',
      body: 'B',
      photos: ['a', 'b'],
      author_name: 'Rusul',
      created_at: '2026-09-25T08:00:00Z',
      updated_at: '2026-09-25T08:00:00Z',
      mine: true,
      editable: true,
    };
    const edit = teachingArgs(draftFrom(stored), 'manager', 'v1');
    expect(edit.p_id).toBe('t1');
    expect(edit.p_team).toBeUndefined();
    expect(edit.p_photos).toEqual(['a', 'b']);
  });

  it('keeps one key per teaching as sent', () => {
    const a = teachingArgs({ ...emptyTeaching('head_chef'), title: 'T', body: 'B' }, 'head_chef', 'v1');
    const b = teachingArgs({ ...emptyTeaching('head_chef'), title: 'T', body: 'B2' }, 'head_chef', 'v1');
    expect(teachingIntent(a)).toBe(teachingIntent({ ...a }));
    expect(teachingIntent(a)).not.toBe(teachingIntent(b));
  });
});
