/**
 * A student's level in coach mode (Majed, 2026-11-01, finding F-70; migration 0401).
 *
 * A coach sees and sets the level of a student whose account link is CONFIRMED, and only that
 * student: `app.coach_lesson` sends `level` on such a roster place and null on every other one
 * (a typed phone still says nothing about whether it matched an account, R44), and never a
 * profile id. The write is `app.coach_set_student_level(p_enrolment_id, p_level, p_note)`,
 * keyed on the place, with staff_set_customer_level's rules: the four levels, a one-line note of
 * at most 120 characters, and NULL clears the judgment and takes no note.
 *
 * PURE (vitest).
 */
import { PLAY_LEVELS, type PlayLevel } from '../playProfile/logic';

/** The level block of a linked roster place. */
export interface StudentLevel {
  /** What the player said at sign-up or in the survey (`play_level`), or null. */
  claimed: PlayLevel | null;
  /** The club's judgment (`level_confirmed`), or null when nobody has confirmed one. */
  confirmed: PlayLevel | null;
  /** Who judged: 'coach' | 'court_desk' | 'manager' | 'owner', or null. */
  confirmedRole: string | null;
  confirmedAt: string | null;
  note: string | null;
}

/** The note's cap, the server's (left(…, 120)). */
export const LEVEL_NOTE_MAX = 120;

/** The roles a confirmation names, in the words `coaching.coach.level.by.*` has. */
export const LEVEL_ROLES = ['coach', 'court_desk', 'manager', 'owner'] as const;
export type LevelRole = (typeof LEVEL_ROLES)[number];

export function isPlayLevel(value: unknown): value is PlayLevel {
  return typeof value === 'string' && (PLAY_LEVELS as readonly string[]).includes(value);
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** The roster place's `level`: a block for a linked student, null for anything else. */
export function parseStudentLevel(raw: unknown): StudentLevel | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  return {
    claimed: isPlayLevel(o.claimed) ? o.claimed : null,
    confirmed: isPlayLevel(o.confirmed) ? o.confirmed : null,
    confirmedRole: strOrNull(o.confirmed_role),
    confirmedAt: strOrNull(o.confirmed_at),
    note: strOrNull(o.note),
  };
}

/** A role the copy has words for, or null (an unknown role reads without "by whom"). */
export function levelRole(role: string | null): LevelRole | null {
  return role !== null && (LEVEL_ROLES as readonly string[]).includes(role) ? (role as LevelRole) : null;
}

/** The note as it will be sent: trimmed, one line, null when empty. */
export function cleanLevelNote(note: string): string | null {
  const one = note.replace(/\s+/g, ' ').trim();
  return one.length > 0 ? one : null;
}

export type LevelIssue = 'NO_LEVEL' | 'NOTE_TOO_LONG' | null;

/** What stops Save: no level picked, or a note past the cap. */
export function levelIssue(level: PlayLevel | null, note: string): LevelIssue {
  if (level === null) return 'NO_LEVEL';
  const clean = cleanLevelNote(note);
  if (clean !== null && [...clean].length > LEVEL_NOTE_MAX) return 'NOTE_TOO_LONG';
  return null;
}

/** The RPC's arguments. Clearing (`level` null) never sends a note: the server refuses one. */
export function levelArgs(
  enrolmentId: string,
  level: PlayLevel | null,
  note: string,
): { p_enrolment_id: string; p_level: PlayLevel | null; p_note: string | null } {
  return {
    p_enrolment_id: enrolmentId,
    p_level: level,
    p_note: level === null ? null : cleanLevelNote(note),
  };
}

/** The level the editor starts on: the confirmed one, else what the player said, else none. */
export function startingLevel(level: StudentLevel): PlayLevel | null {
  return level.confirmed ?? level.claimed;
}

/** `coach_set_student_level`'s answer. */
export interface LevelSetResult {
  enrolmentId: string;
  confirmed: PlayLevel | null;
  confirmedAt: string | null;
  confirmedRole: string | null;
  note: string | null;
  duplicate: boolean;
}

export function parseLevelSetResult(raw: unknown): LevelSetResult {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    enrolmentId: strOrNull(o.enrolment_id) ?? '',
    confirmed: isPlayLevel(o.level_confirmed) ? o.level_confirmed : null,
    confirmedAt: strOrNull(o.level_confirmed_at),
    confirmedRole: strOrNull(o.level_confirmed_role),
    note: strOrNull(o.level_note),
    duplicate: o.duplicate === true,
  };
}
