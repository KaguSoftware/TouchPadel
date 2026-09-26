/**
 * The reads a step page needs beside the step itself (build-contracts-2026-09-23
 * §6.1 `staff-step.tsx`): each step's context read, made only for the step and
 * the role its guard admits, so a page never asks for what it would be
 * refused (release_cost, price_promo_numbers and the rest are management's; a
 * test's recipe is its assignee's; a court's context its actors').
 *
 * Also the names a sent record's ids are shown by (RecordView).
 */
import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { PriceChangeKind, StaffRole } from '@touch/core';
import type { Locale } from '@touch/i18n';
import { staffKeys } from '../keys';
import { staffPhotoUrl } from '../photo';
import {
  fetchCafeCategories,
  fetchCampaignDrafts,
  fetchCourts,
  fetchHiringCandidates,
  fetchIngredients,
  fetchPriceNumbers,
  fetchPriceTargets,
  fetchReleaseCost,
  fetchReleaseReadiness,
  fetchReleaseTestContext,
  fetchTournamentContext,
  fetchTournamentFeasibility,
  ingredientList,
} from './api';
import { bilingual, isMgmt, numbersRenames, proposeRecord, readTournamentContext, runChange } from './logic';
import type { RunDetail, StepDetail } from './types';

const BAR_KITCHEN: readonly StaffRole[] = ['head_barista', 'barista', 'head_chef', 'chef'];

export function useStepReads(
  detail: StepDetail | undefined,
  runDetail: RunDetail | undefined,
  role: StaffRole | null,
  venueId: string | null,
  locale: Locale,
) {
  const kind = detail?.run.kind;
  const key = detail?.step.step_key ?? null;
  const runId = detail?.run.id ?? '';
  const stepId = detail?.step.id ?? '';
  const can = detail?.can;
  const mgmt = isMgmt(role);
  const acting = !!can?.submit;
  const venue = venueId ?? '';
  const steps = runDetail?.steps;
  const change: PriceChangeKind | null = kind === 'price_promo' && steps ? runChange(steps) : null;
  const is = (k: string, s: string) => kind === k && key === s;

  const ingredients = useQuery({
    queryKey: staffKeys.ingredients(venue),
    queryFn: () => fetchIngredients(venue),
    select: ingredientList,
    enabled: !!venue && is('product_release', 'propose') && (mgmt || (!!role && BAR_KITCHEN.includes(role))),
  });
  const categories = useQuery({
    queryKey: staffKeys.cafeCategories(venue),
    queryFn: () => fetchCafeCategories(venue),
    enabled: !!venue && is('product_release', 'propose') && mgmt,
  });
  const testContext = useQuery({
    queryKey: staffKeys.context('test', runId),
    queryFn: () => fetchReleaseTestContext(runId),
    enabled: !!runId && is('product_release', 'test') && (mgmt || acting),
  });
  const cost = useQuery({
    queryKey: staffKeys.context('analysis', runId),
    queryFn: () => fetchReleaseCost(runId),
    enabled: !!runId && is('product_release', 'analysis') && mgmt,
  });
  const readiness = useQuery({
    queryKey: staffKeys.context('launch', runId),
    queryFn: () => fetchReleaseReadiness(runId),
    enabled: !!runId && is('product_release', 'launch') && mgmt,
  });
  const numbers = useQuery({
    queryKey: staffKeys.context('numbers', runId),
    queryFn: () => fetchPriceNumbers(runId),
    enabled: !!runId && kind === 'price_promo' && (key === 'numbers' || key === 'apply') && mgmt,
  });
  // A proposal sent back: its targets, so the form reads as it did at the start.
  const targets = useQuery({
    queryKey: staffKeys.priceTargets(venue, change ?? ''),
    queryFn: () => fetchPriceTargets(venue, change as string),
    enabled:
      !!venue &&
      is('price_promo', 'propose') &&
      acting &&
      change !== null &&
      change !== 'promotion' &&
      (mgmt || role === 'marketing') &&
      (change !== 'shop_launch' || mgmt),
  });
  const tournament = useQuery({
    queryKey: staffKeys.context(`tournament:${key ?? ''}`, stepId),
    queryFn: () => fetchTournamentContext(stepId),
    select: readTournamentContext,
    enabled: !!stepId && kind === 'tournament' && (key === 'courts' || key === 'marketing') && (mgmt || acting),
  });
  const feasibility = useQuery({
    queryKey: staffKeys.context('feasibility', runId),
    queryFn: () => fetchTournamentFeasibility(runId),
    enabled: !!runId && is('tournament', 'feasibility') && mgmt,
  });
  const candidates = useQuery({
    queryKey: staffKeys.candidates(runId),
    queryFn: () => fetchHiringCandidates(runId),
    enabled: !!runId && is('hiring', 'interviews') && mgmt,
  });
  const courts = useQuery({
    queryKey: staffKeys.courts(venue),
    queryFn: () => fetchCourts(venue),
    enabled:
      !!venue &&
      ((is('tournament', 'plan') && (mgmt || acting)) ||
        (is('price_promo', 'propose') && acting && (change === 'rate' || change === 'promotion' || change === 'promotion_edit'))),
  });
  const campaigns = useQuery({
    queryKey: staffKeys.campaignDrafts(venue),
    queryFn: () => fetchCampaignDrafts(venue),
    enabled: !!venue && role === 'marketing' && acting && (key === 'marketing' || key === 'announce'),
  });

  // Ids a record may name, by what the page has read.
  const names = useMemo(() => {
    const out: Record<string, string> = {};
    const put = (id: string | null | undefined, en: string | null | undefined, ar: string | null | undefined) => {
      const n = bilingual(locale, en, ar);
      if (id && n) out[id] = n;
    };
    for (const i of ingredients.data ?? []) put(i.id, i.name_en, i.name_ar);
    for (const c of categories.data ?? []) put(c.id, c.name_en, c.name_ar);
    for (const c of courts.data ?? []) put(c.id, c.name_en, c.name_ar);
    for (const s of testContext.data?.sizes ?? []) put(s.variant_id, s.name_en, s.name_ar);
    for (const s of cost.data?.sizes ?? []) put(s.variant_id, s.name_en, s.name_ar);
    for (const s of numbers.data?.sizes ?? []) put(s.variant_id, s.name_en, s.name_ar);
    for (const a of numbers.data?.addons ?? []) put(a.modifier_id, a.name_en, a.name_ar);
    // Wave 5 (§2.2, #9): a renamed size or option reads by the name it had (an
    // add-on renamed with no new price is in no other list).
    for (const r of numbersRenames(numbers.data)) if (!out[r.id]) put(r.id, r.from_en, r.from_ar);
    for (const it of targets.data?.items ?? []) {
      put(it.menu_item_id, it.name_en, it.name_ar);
      for (const s of it.sizes) put(s.variant_id, s.name_en, s.name_ar);
    }
    for (const a of targets.data?.addons ?? []) put(a.modifier_id, a.name_en, a.name_ar);
    for (const p of targets.data?.promotions ?? []) put(p.promotion_id, p.name_en, p.name_ar);
    for (const r of targets.data?.rules ?? []) put(r.rule_id, r.name, r.name);
    for (const c of candidates.data?.candidates ?? []) put(c.id, c.candidate_name, c.candidate_name);
    for (const d of campaigns.data ?? []) put(d.id, d.name_en, d.name_ar);
    return out;
  }, [
    locale,
    ingredients.data,
    categories.data,
    courts.data,
    testContext.data,
    cost.data,
    numbers.data,
    targets.data,
    candidates.data,
    campaigns.data,
  ]);

  return {
    change,
    propose: steps ? proposeRecord(steps) : null,
    ingredients,
    categories,
    testContext,
    cost,
    readiness,
    numbers,
    targets,
    tournament,
    feasibility,
    candidates,
    courts,
    campaigns,
    names,
  };
}

export type StepReads = ReturnType<typeof useStepReads>;

/**
 * Stored photos as the photo field shows them: each path with its signed URL,
 * once every URL has come back (a failed one shows an empty tile). Undefined
 * while they load, so a form that starts from them waits one beat.
 */
export function useAttachedPhotos(paths: readonly string[]): { path: string; uri: string }[] | undefined {
  const results = useQueries({
    queries: paths.map((path) => ({
      queryKey: staffKeys.photoUrl(path),
      queryFn: () => staffPhotoUrl(path),
      staleTime: 8 * 60_000,
    })),
  });
  if (results.some((r) => r.isPending)) return undefined;
  return paths.map((path, i) => ({ path, uri: results[i]?.data ?? '' }));
}
