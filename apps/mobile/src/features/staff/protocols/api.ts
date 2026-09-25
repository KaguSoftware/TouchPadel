/**
 * The protocol pages' calls (build-contracts-2026-09-23 §2.7-§2.13, §6.1).
 * Every RPC here is in `STAFF_RPCS` (../api.ts); the launch and the owner's
 * new account go through the two edge functions. Writes that the contract keys
 * take the caller's idempotency key, minted once per intent by the screen
 * (`staffIntentKey`), so a retry replays instead of recording twice.
 */
import type { DecisionChoice, MyProtocolWork, ProtocolKind, StaffRole, TournamentVariant } from '@touch/core';
import { supabase } from '../../../lib/supabase';
import { callStaffEdge, staffRpc } from '../api';
import type {
  CampaignDraft,
  HiringCandidates,
  IngredientOption,
  MarketingNote,
  NamedRow,
  PriceNumbers,
  PriceTargets,
  ReleaseCost,
  ReleaseReadiness,
  ReleaseReview,
  ReleaseTestContext,
  RunDetail,
  RunsPage,
  StartResult,
  StepDetail,
  SubmitResult,
  TournamentFeasibility,
} from './types';
import type { RunFilter } from './logic';

// ── Reads ───────────────────────────────────────────────────────────────────

export function fetchMyWork(venueId: string): Promise<MyProtocolWork> {
  return staffRpc<MyProtocolWork>('my_protocol_work', { p_venue_id: venueId });
}

export function fetchRuns(venueId: string, filter: RunFilter): Promise<RunsPage> {
  return staffRpc<RunsPage>('protocol_runs_page', { p_venue_id: venueId, p_filter: filter, p_limit: 50 });
}

export function fetchRunDetail(runId: string): Promise<RunDetail> {
  return staffRpc<RunDetail>('protocol_run_detail', { p_run_id: runId });
}

export function fetchStepDetail(runStepId: string): Promise<StepDetail> {
  return staffRpc<StepDetail>('protocol_step_detail', { p_run_step_id: runStepId });
}

/**
 * `staff_ingredient_options` kept as the RPC returns it, `{ingredients}`: the
 * shopping, purchase and recipe-change pages cache the same key in that
 * shape, so a reader here takes the list with `select: ingredientList`.
 */
export async function fetchIngredients(venueId: string): Promise<{ ingredients: IngredientOption[] }> {
  const data = await staffRpc<{ ingredients?: IngredientOption[] } | null>('staff_ingredient_options', {
    p_venue_id: venueId,
  });
  return { ingredients: data?.ingredients ?? [] };
}

export function ingredientList(data: { ingredients: IngredientOption[] }): IngredientOption[] {
  return data.ingredients;
}

export function fetchPriceTargets(venueId: string, change: string): Promise<PriceTargets> {
  return staffRpc<PriceTargets>('price_promo_targets', { p_change: change, p_venue_id: venueId });
}

export function fetchPriceNumbers(runId: string): Promise<PriceNumbers> {
  return staffRpc<PriceNumbers>('price_promo_numbers', { p_run_id: runId });
}

export function fetchReleaseTestContext(runId: string): Promise<ReleaseTestContext> {
  return staffRpc<ReleaseTestContext>('release_test_context', { p_run_id: runId });
}

export function fetchReleaseCost(runId: string): Promise<ReleaseCost> {
  return staffRpc<ReleaseCost>('release_cost', { p_run_id: runId });
}

export function fetchReleaseReadiness(runId: string): Promise<ReleaseReadiness> {
  return staffRpc<ReleaseReadiness>('release_readiness', { p_run_id: runId });
}

/** Management only (#54): the run page never asks for anyone else. */
export function fetchReleaseReview(runId: string): Promise<ReleaseReview | null> {
  return staffRpc<ReleaseReview | null>('release_review', { p_run_id: runId });
}

export function fetchTournamentContext(runStepId: string): Promise<unknown> {
  return staffRpc<unknown>('tournament_context', { p_run_step_id: runStepId });
}

export function fetchTournamentFeasibility(runId: string): Promise<TournamentFeasibility> {
  return staffRpc<TournamentFeasibility>('tournament_feasibility', { p_run_id: runId });
}

export function fetchHiringCandidates(runId: string): Promise<HiringCandidates> {
  return staffRpc<HiringCandidates>('hiring_candidates', { p_run_id: runId });
}

/** Marketing's own campaign drafts, for a marketing step's `campaign_id`. */
export async function fetchCampaignDrafts(venueId: string): Promise<CampaignDraft[]> {
  const data = await staffRpc<{ drafts?: CampaignDraft[] } | null>('my_campaign_drafts', { p_venue_id: venueId });
  return data?.drafts ?? [];
}

/** Management's read of marketing's notes on one run (§2.17). */
export async function fetchMarketingNotesForRun(runId: string): Promise<MarketingNote[]> {
  const data = await staffRpc<{ notes?: MarketingNote[] } | null>('marketing_notes_for', {
    p_subject_kind: 'run',
    p_subject_id: runId,
  });
  return data?.notes ?? [];
}

/**
 * The venue's active cafe categories, for the decider of a new item's
 * proposal. Menu categories are read by every signed-in session (the guest
 * menu reads the same rows).
 */
export async function fetchCafeCategories(venueId: string): Promise<NamedRow[]> {
  const { data, error } = await supabase
    .from('menu_categories')
    .select('id, name_en, name_ar')
    .eq('venue_id', venueId)
    .eq('kind', 'cafe')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as NamedRow[];
}

/** The venue's active courts, for a tournament plan's ranges and a court rate. */
export async function fetchCourts(venueId: string): Promise<NamedRow[]> {
  const { data, error } = await supabase
    .from('courts')
    .select('id, name_en, name_ar')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as NamedRow[];
}

/**
 * The accounts a hiring's add_staff step may send (§2.12,
 * `protocol_check_hiring_add_staff`): active, in the position's role, made
 * after the run started, newest first. The owner's staff read (0004
 * `staff_select`), so the form can take an account already made when the
 * create's answer was lost or the step was left before Send.
 */
export async function fetchNewHires(
  role: StaffRole,
  since: string,
): Promise<{ id: string; display_name: string; created_at: string }[]> {
  const { data, error } = await supabase
    .from('staff')
    .select('id, display_name, created_at')
    .eq('role', role)
    .eq('is_active', true)
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return data ?? [];
}

// ── Writes ──────────────────────────────────────────────────────────────────

export interface StartArgs {
  kind: ProtocolKind;
  variant: TournamentVariant | null;
  titleEn: string | null;
  titleAr: string | null;
  data: Record<string, unknown>;
  record: Record<string, unknown>;
  photos: string[];
  venueId: string;
  idempotencyKey: string;
}

export function startProtocol(a: StartArgs): Promise<StartResult> {
  return staffRpc<StartResult>('start_protocol', {
    p_kind: a.kind,
    p_variant: a.variant,
    p_title_en: a.titleEn,
    p_title_ar: a.titleAr,
    p_data: a.data,
    p_first_record: a.record,
    p_photos: a.photos,
    p_venue_id: a.venueId,
    p_idempotency_key: a.idempotencyKey,
  });
}

export function submitStep(
  runStepId: string,
  record: Record<string, unknown>,
  photos: string[],
  idempotencyKey: string,
): Promise<SubmitResult> {
  return staffRpc<SubmitResult>('submit_step', {
    p_run_step_id: runStepId,
    p_record: record,
    p_photos: photos,
    p_idempotency_key: idempotencyKey,
  });
}

export function withdrawStep(submissionId: string): Promise<unknown> {
  return staffRpc('withdraw_step', { p_submission_id: submissionId });
}

export interface DecideArgs {
  submissionId: string;
  decision: DecisionChoice;
  note: string | null;
  sendBackTo: string | null;
  data: Record<string, unknown>;
}

export function decideStep(a: DecideArgs): Promise<unknown> {
  return staffRpc('decide_step', {
    p_submission_id: a.submissionId,
    p_decision: a.decision,
    p_note: a.note,
    p_send_back_to: a.sendBackTo,
    p_data: a.data,
  });
}

export function skipStep(runStepId: string, note: string): Promise<unknown> {
  return staffRpc('skip_step', { p_run_step_id: runStepId, p_note: note });
}

export function tickRunItem(itemId: string, done: boolean): Promise<unknown> {
  return staffRpc('tick_run_item', { p_item_id: itemId, p_done: done });
}

export function stopProtocol(runId: string, note: string): Promise<unknown> {
  return staffRpc('stop_protocol', { p_run_id: runId, p_note: note });
}

export function withdrawProtocol(runId: string): Promise<unknown> {
  return staffRpc('withdraw_protocol', { p_run_id: runId });
}

export function cancelSchedule(runId: string): Promise<unknown> {
  return staffRpc('cancel_schedule', { p_run_id: runId });
}

export function blockCourtsForEvent(
  runId: string,
  blocks: { court_id: string; start_at: string; end_at: string }[],
  idempotencyKey: string,
): Promise<unknown> {
  return staffRpc('block_courts_for_event', {
    p_run_id: runId,
    p_blocks: blocks,
    p_idempotency_key: idempotencyKey,
  });
}

export interface CandidateInput {
  candidate_name: string;
  candidate_phone: string;
  brief?: string;
  interview_at?: string | null;
  picked?: boolean;
  pick_reason?: string | null;
}

export function saveHiringCandidate(
  runId: string,
  candidate: CandidateInput,
  id: string | null,
  idempotencyKey: string,
): Promise<{ id: string }> {
  return staffRpc<{ id: string }>('save_hiring_candidate', {
    p_run_id: runId,
    p_candidate: candidate,
    p_id: id,
    p_idempotency_key: idempotencyKey,
  });
}

export function deleteHiringCandidate(id: string): Promise<unknown> {
  return staffRpc('delete_hiring_candidate', { p_id: id });
}

/**
 * The owner's launch (§2.20): `protocol-action` copies the chosen photo onto
 * the menu, then sends the launch step as the owner. It answers with the
 * step's submit result.
 */
export function launchRelease(args: {
  runStepId: string;
  when: 'now' | 'date';
  at: string | null;
  photoPath: string;
  idempotencyKey: string;
}): Promise<SubmitResult> {
  return callStaffEdge<SubmitResult>('protocol-action', {
    action: 'launch',
    run_step_id: args.runStepId,
    when: args.when,
    at: args.when === 'date' ? args.at : null,
    photo_path: args.photoPath,
    idempotency_key: args.idempotencyKey,
  });
}

/** The owner's add-staff form (`staff-admin`, as on the operator's Staff page). */
export async function createStaffAccount(args: {
  email: string;
  password: string;
  displayName: string;
  role: StaffRole;
}): Promise<{ id: string; display_name: string }> {
  const data = await callStaffEdge<{ staff?: { id?: string; display_name?: string } }>('staff-admin', {
    action: 'create',
    email: args.email,
    password: args.password,
    display_name: args.displayName,
    role: args.role,
  });
  const id = data?.staff?.id;
  if (typeof id !== 'string') throw new Error('staff-admin returned no account');
  return { id, display_name: data.staff?.display_name ?? args.displayName };
}
