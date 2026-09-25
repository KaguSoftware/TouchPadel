/**
 * `/admin/staff?hire=<run step>` (build-contracts-2026-09-23 §5.5): the owner
 * adds the account a hiring run picked. What to fill in comes from three reads
 * the owner already has: the add_staff step (app.protocol_step_detail), the
 * run's records (app.protocol_run_detail: the approved position's role, the
 * approved pick) and the run's candidates (app.hiring_candidates: the pick's
 * name). Once the account exists, the step is sent with its id.
 *
 * Pure: the screen renders these and calls the RPCs.
 */
import type { StaffRole } from '../../../lib/auth';
import { ASSIGNABLE_ROLES } from './staffModel';

type Raw = Record<string, unknown>;

function obj(v: unknown): Raw {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {};
}
function list(v: unknown): Raw[] {
  return Array.isArray(v) ? v.map(obj) : [];
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

export interface HireStep {
  runId: string | null;
  isHireStep: boolean;
  /** Open and the caller may send it (the owner; add_staff is the owner's step). */
  canSubmit: boolean;
  status: string | null;
}

/** `app.protocol_step_detail` for the `hire` link. */
export function readHireStep(payload: unknown): HireStep {
  const p = obj(payload);
  const run = obj(p.run);
  const step = obj(p.step);
  return {
    runId: str(run.id),
    isHireStep: run.kind === 'hiring' && step.step_key === 'add_staff',
    canSubmit: obj(p.can).submit === true && step.status === 'open',
    status: str(step.status),
  };
}

/** The approved (or automatically passed) record of one step of the run. */
function approvedRecord(runDetail: Raw, stepKey: string): Raw | null {
  const step = list(runDetail.steps).find((s) => s.step_key === stepKey);
  if (!step) return null;
  const decided = list(step.submissions).filter((s) => s.decision === 'approve' || s.decision === 'auto');
  const last = decided[decided.length - 1];
  return last ? obj(last.record) : null;
}

export interface HirePrefill {
  /** The role the position named; null when it is not one an account can be given. */
  role: StaffRole | null;
  /** The picked candidate's name as the manager typed it; null when it is gone (deleted, purged). */
  name: string | null;
}

/**
 * The role from the approved position, the name from the approved pick (or,
 * failing that, the candidate marked picked).
 */
export function hirePrefill(runDetail: unknown, candidates: unknown): HirePrefill {
  const detail = obj(runDetail);
  const position = approvedRecord(detail, 'open_position');
  const pick = approvedRecord(detail, 'interviews');
  const role = str(position?.role);
  const rows = list(obj(candidates).candidates);
  const pickedId = str(pick?.picked_id);
  const picked = (pickedId ? rows.find((c) => c.id === pickedId) : undefined) ?? rows.find((c) => c.picked === true);
  return {
    role: role && (ASSIGNABLE_ROLES as readonly string[]).includes(role) && role !== 'owner' ? (role as StaffRole) : null,
    name: str(picked?.candidate_name),
  };
}

/** The staff id in the `staff-admin` create answer (`{result, staff: {id, …}}`). */
export function createdStaffId(answer: unknown): string | null {
  return str(obj(obj(answer).staff).id);
}
