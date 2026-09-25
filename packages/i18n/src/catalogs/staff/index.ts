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

export const staffEn = {
  shell: staffShellEn,
  protocols: staffProtocolsEn,
  checklists: staffChecklistsEn,
  supplies: staffSuppliesEn,
  marketing: staffMarketingEn,
  notes: staffNotesEn,
  media: staffMediaEn,
} as const;

export const staffAr = {
  shell: staffShellAr,
  protocols: staffProtocolsAr,
  checklists: staffChecklistsAr,
  supplies: staffSuppliesAr,
  marketing: staffMarketingAr,
  notes: staffNotesAr,
  media: staffMediaAr,
} as const;
