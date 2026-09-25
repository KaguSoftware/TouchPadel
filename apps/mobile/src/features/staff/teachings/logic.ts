/**
 * Teachings on the staff phone (build-contracts-2026-09-23 §2.24.3, plan #64):
 * what the head barista teaches the bar and the head chef the kitchen. The team
 * reads its own team's; the manager and the owner read and write both. Staff
 * text in one language, shown as typed; nothing records who opened one.
 *
 * PURE (vitest): no react-native, no supabase.
 */
import { STAFF_TEAMS, teamOf, type StaffRole, type StaffTeam } from '@touch/core';

/** Who reads teachings: the two teams and MGMT. */
export const TEACHING_ROLES: readonly StaffRole[] = [
  'head_barista',
  'barista',
  'head_chef',
  'chef',
  'manager',
  'owner',
];

const MGMT: readonly StaffRole[] = ['manager', 'owner'];
const HEADS: readonly StaffRole[] = ['head_barista', 'head_chef'];

export const TITLE_MAX = 120;
export const BODY_MAX = 4000;
export const PHOTOS_MAX = 6;

export type TeachingsFilter = 'all' | StaffTeam;

export function isMgmt(role: StaffRole): boolean {
  return MGMT.includes(role);
}

/** A head writes for their own team; MGMT for either. */
export function canWriteTeaching(role: StaffRole): boolean {
  return isMgmt(role) || HEADS.includes(role);
}

/** The team filters a role gets: both teams and each for MGMT, none for a team member. */
export function teachingFilters(role: StaffRole): TeachingsFilter[] {
  return isMgmt(role) ? ['all', ...STAFF_TEAMS] : [];
}

/**
 * The list a role asks for: MGMT the filter it picked, a team member their own
 * team (the server would refuse another), anyone else nothing.
 */
export function teachingsTeamArg(role: StaffRole, filter: TeachingsFilter): StaffTeam | null {
  if (isMgmt(role)) return filter === 'all' ? null : filter;
  return teamOf(role);
}

/** The query key's team segment for a role and filter (`all` for MGMT's both-teams list). */
export function teachingsKeyTeam(role: StaffRole, filter: TeachingsFilter): string {
  return teachingsTeamArg(role, filter) ?? 'all';
}

/** One row of `teachings_for_me`. */
export interface Teaching {
  id: string;
  team: StaffTeam;
  title: string;
  body: string;
  photos: string[];
  author_name: string | null;
  created_at: string;
  updated_at: string;
  mine: boolean;
  editable: boolean;
}

export interface TeachingsPage {
  teachings: Teaching[];
  total: number;
}

export interface TeachingDraft {
  /** Set when editing; null for a new teaching. */
  id: string | null;
  /** MGMT picks it for a new teaching; a head's is their own; an edit keeps it. */
  team: StaffTeam | null;
  title: string;
  body: string;
  photos: string[];
}

export type TeachingField = 'team' | 'title' | 'body';
export interface TeachingIssue {
  field: TeachingField;
  code: 'required' | 'tooLong';
}

/** Check a teaching before it is saved; an empty list means it can go. */
export function validateTeaching(draft: TeachingDraft, role: StaffRole): TeachingIssue[] {
  const issues: TeachingIssue[] = [];
  if (draft.id === null && isMgmt(role) && !draft.team) issues.push({ field: 'team', code: 'required' });
  const title = draft.title.trim();
  if (!title) issues.push({ field: 'title', code: 'required' });
  else if (title.length > TITLE_MAX) issues.push({ field: 'title', code: 'tooLong' });
  const body = draft.body.trim();
  if (!body) issues.push({ field: 'body', code: 'required' });
  else if (body.length > BODY_MAX) issues.push({ field: 'body', code: 'tooLong' });
  return issues;
}

export interface TeachingArgs {
  p_title: string;
  p_body: string;
  p_photos: string[];
  p_venue_id: string;
  p_id?: string;
  p_team?: StaffTeam;
}

/**
 * The `save_teaching` arguments. A head's new teaching names no team (the
 * server takes theirs); MGMT names the one picked; an edit names none (the
 * team never changes).
 */
export function teachingArgs(draft: TeachingDraft, role: StaffRole, venueId: string): TeachingArgs {
  const args: TeachingArgs = {
    p_title: draft.title.trim(),
    p_body: draft.body.trim(),
    p_photos: draft.photos.slice(0, PHOTOS_MAX),
    p_venue_id: venueId,
  };
  if (draft.id) args.p_id = draft.id;
  else if (isMgmt(role) && draft.team) args.p_team = draft.team;
  return args;
}

/** The intent a new teaching's key is kept under: the teaching as sent. */
export function teachingIntent(args: TeachingArgs): string {
  return `teaching:${args.p_venue_id}:${args.p_team ?? ''}:${JSON.stringify([args.p_title, args.p_body, args.p_photos])}`;
}

export function emptyTeaching(role: StaffRole): TeachingDraft {
  return { id: null, team: isMgmt(role) ? null : teamOf(role), title: '', body: '', photos: [] };
}

export function draftFrom(teaching: Teaching): TeachingDraft {
  return {
    id: teaching.id,
    team: teaching.team,
    title: teaching.title,
    body: teaching.body,
    photos: [...teaching.photos],
  };
}
