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
} as const;
