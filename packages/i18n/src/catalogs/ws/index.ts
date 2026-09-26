/**
 * `ws.*` — the operator workspace catalogs, one file pair per lane so parallel
 * workstreams never edit the same file. Assembled here and mounted under the
 * `ws` key of the main catalogs (en.ts / ar.ts). Arabic parity is enforced by
 * `DeepMessages<typeof xEn>` on each Arabic fragment.
 */
import { shellEn } from './shell.en';
import { shellAr } from './shell.ar';
import { kitEn } from './kit.en';
import { kitAr } from './kit.ar';
import { courtDeskEn } from './courtDesk.en';
import { courtDeskAr } from './courtDesk.ar';
import { cashierEn } from './cashier.en';
import { cashierAr } from './cashier.ar';
import { prepEn } from './prep.en';
import { prepAr } from './prep.ar';
import { managerEn } from './manager.en';
import { managerAr } from './manager.ar';
import { ownerEn } from './owner.en';
import { ownerAr } from './owner.ar';
import { reportsEn } from './reports.en';
import { reportsAr } from './reports.ar';
import { analyticsEn } from './analytics.en';
import { analyticsAr } from './analytics.ar';
import { teamEn } from './team.en';
import { teamAr } from './team.ar';
// Protocols and the staff phone (build-contracts-2026-09-23 §4).
import { protocolsEn } from './protocols.en';
import { protocolsAr } from './protocols.ar';
import { releaseEn } from './release.en';
import { releaseAr } from './release.ar';
import { eventsEn } from './events.en';
import { eventsAr } from './events.ar';
import { suppliesEn } from './supplies.en';
import { suppliesAr } from './supplies.ar';
import { pricingEn } from './pricing.en';
import { pricingAr } from './pricing.ar';
// The role spec (build-contracts-2026-09-23 §4, plan #61–#74).
import { rolePagesEn } from './rolePages.en';
import { rolePagesAr } from './rolePages.ar';
// Wave 5 (wave5-addendum-2026-09-25 §4.1): P fills deductions, incidents and
// content; S fills stores; T fills tillShift.
import { deductionsEn } from './deductions.en';
import { deductionsAr } from './deductions.ar';
import { incidentsEn } from './incidents.en';
import { incidentsAr } from './incidents.ar';
import { contentEn } from './content.en';
import { contentAr } from './content.ar';
import { storesEn } from './stores.en';
import { storesAr } from './stores.ar';
import { tillShiftEn } from './tillShift.en';
import { tillShiftAr } from './tillShift.ar';
// Multi-venue slice 4: the owner's branches, stations, staff branches, report scope.
import { branchesEn } from './branches.en';
import { branchesAr } from './branches.ar';

export const wsEn = {
  shell: shellEn,
  kit: kitEn,
  courtDesk: courtDeskEn,
  cashier: cashierEn,
  prep: prepEn,
  manager: managerEn,
  owner: ownerEn,
  reports: reportsEn,
  analytics: analyticsEn,
  team: teamEn,
  protocols: protocolsEn,
  release: releaseEn,
  events: eventsEn,
  supplies: suppliesEn,
  pricing: pricingEn,
  rolePages: rolePagesEn,
  deductions: deductionsEn,
  incidents: incidentsEn,
  content: contentEn,
  stores: storesEn,
  tillShift: tillShiftEn,
  branches: branchesEn,
} as const;

export const wsAr = {
  shell: shellAr,
  kit: kitAr,
  courtDesk: courtDeskAr,
  cashier: cashierAr,
  prep: prepAr,
  manager: managerAr,
  owner: ownerAr,
  reports: reportsAr,
  analytics: analyticsAr,
  team: teamAr,
  protocols: protocolsAr,
  release: releaseAr,
  events: eventsAr,
  supplies: suppliesAr,
  pricing: pricingAr,
  rolePages: rolePagesAr,
  deductions: deductionsAr,
  incidents: incidentsAr,
  content: contentAr,
  stores: storesAr,
  tillShift: tillShiftAr,
  branches: branchesAr,
} as const;
