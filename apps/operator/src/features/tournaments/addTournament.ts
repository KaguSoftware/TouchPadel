/**
 * "Add tournament" on the court desk: a tournament starts as a protocol run
 * ("Start a tournament"), so the button opens that start form. The desk works
 * its steps on /tasks; a manager or owner works theirs on /protocols. A role
 * that may not start one gets no button.
 */
import { can, canAccess, type StaffRole } from '../../lib/auth';

export type AddTournamentTarget =
  | { to: '/tasks'; search: { start: 'tournament' } }
  | { to: '/protocols'; search: { start: 'tournament' } };

export function addTournamentTarget(role: StaffRole | undefined): AddTournamentTarget | null {
  if (!can(role, 'startProtocolTournament')) return null;
  if (canAccess(role, '/tasks')) return { to: '/tasks', search: { start: 'tournament' } };
  if (canAccess(role, '/protocols')) return { to: '/protocols', search: { start: 'tournament' } };
  return null;
}
