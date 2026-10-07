/**
 * `staff.*` — the staff phone's catalogs (apps/mobile app/staff*.tsx), one file
 * pair per lane so parallel lanes never edit the same file
 * (docs/design/protocols/build-contracts-2026-09-23.md §4). Assembled here and
 * mounted under the `staff` key of the main catalogs (en.ts / ar.ts). Arabic
 * parity is enforced by `DeepMessages<typeof xEn>` on each Arabic fragment.
 */
import { staffShellEn } from './shell.en';
import { staffShellAr } from './shell.ar';
import { staffProtocolsEn } from './protocols.en';
import { staffProtocolsAr } from './protocols.ar';
import { staffChecklistsEn } from './checklists.en';
import { staffChecklistsAr } from './checklists.ar';
import { staffSuppliesEn } from './supplies.en';
import { staffSuppliesAr } from './supplies.ar';
import { staffMarketingEn } from './marketing.en';
import { staffMarketingAr } from './marketing.ar';
import { staffNotesEn } from './notes.en';
import { staffNotesAr } from './notes.ar';
import { staffMediaEn } from './media.en';
import { staffMediaAr } from './media.ar';
// Wave 5 (wave5-addendum-2026-09-25 §4.1): P fills deductions, incidents and
// content; S fills stores.
import { staffDeductionsEn } from './deductions.en';
import { staffDeductionsAr } from './deductions.ar';
import { staffIncidentsEn } from './incidents.en';
import { staffIncidentsAr } from './incidents.ar';
import { staffContentEn } from './content.en';
import { staffContentAr } from './content.ar';
import { staffStoresEn } from './stores.en';
import { staffStoresAr } from './stores.ar';
// Wave 5, lane R (§2.1.8): the waiter's guest calls.
import { staffCallsEn } from './calls.en';
import { staffCallsAr } from './calls.ar';
// Phase 2 Milestone 4b: the camera pages (order slips, supplier receipts).
import { staffScanEn } from './scan.en';
import { staffScanAr } from './scan.ar';
// Place an order (0251): the waiter's tables, menu and review.
import { staffFloorEn } from './floor.en';
import { staffFloorAr } from './floor.ar';

// The owner's assistant on the phone (app/staff-assistant*.tsx).
import { staffAssistantEn } from './assistant.en';
import { staffAssistantAr } from './assistant.ar';

// Staff screenshots reported to the owner (app/staff-screenshots.tsx).
import { staffScreenshotsEn } from './screenshots.en';
import { staffScreenshotsAr } from './screenshots.ar';

export const staffEn = {
  shell: staffShellEn,
  protocols: staffProtocolsEn,
  checklists: staffChecklistsEn,
  supplies: staffSuppliesEn,
  marketing: staffMarketingEn,
  notes: staffNotesEn,
  media: staffMediaEn,
  deductions: staffDeductionsEn,
  incidents: staffIncidentsEn,
  content: staffContentEn,
  stores: staffStoresEn,
  calls: staffCallsEn,
  scan: staffScanEn,
  floor: staffFloorEn,
  assistant: staffAssistantEn,
  screenshots: staffScreenshotsEn,
} as const;

export const staffAr = {
  shell: staffShellAr,
  protocols: staffProtocolsAr,
  checklists: staffChecklistsAr,
  supplies: staffSuppliesAr,
  marketing: staffMarketingAr,
  notes: staffNotesAr,
  media: staffMediaAr,
  deductions: staffDeductionsAr,
  incidents: staffIncidentsAr,
  content: staffContentAr,
  stores: staffStoresAr,
  calls: staffCallsAr,
  scan: staffScanAr,
  floor: staffFloorAr,
  assistant: staffAssistantAr,
  screenshots: staffScreenshotsAr,
} as const;
