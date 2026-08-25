/**
 * Every /admin child route, in sub-nav order. Attached to the layout in
 * main.tsx (`adminRoute.addChildren(adminChildren)`) so routes/admin.tsx never
 * imports its own children (no module cycle).
 */
import { adminIndexRoute } from './index';
import { adminMenuRoute } from './menu';
import { adminCategoriesRoute } from './categories';
import { adminAddonsRoute } from './addons';
import { adminSuggestedRoute } from './suggested';
import { adminHeroRoute } from './hero';
import { adminQrRoute } from './qr';
import { adminRatesRoute } from './rates';
import { adminHoursRoute } from './hours';
import { adminDayCloseRoute } from './day-close';
import { adminTelegramRoute } from './telegram';
import { adminSettingsRoute } from './settings';
import { adminStaffRoute } from './staff';

export const adminChildren = [
  adminIndexRoute,
  adminMenuRoute,
  adminCategoriesRoute,
  adminAddonsRoute,
  adminSuggestedRoute,
  adminHeroRoute,
  adminQrRoute,
  adminRatesRoute,
  adminHoursRoute,
  adminDayCloseRoute,
  adminTelegramRoute,
  adminSettingsRoute,
  adminStaffRoute,
] as const;
