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

export const wsEn = {
  shell: shellEn,
  kit: kitEn,
  courtDesk: courtDeskEn,
  cashier: cashierEn,
  prep: prepEn,
  manager: managerEn,
  owner: ownerEn,
  reports: reportsEn,
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
} as const;
