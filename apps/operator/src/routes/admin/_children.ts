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
import { adminCourtsRoute } from './courts';
import { adminRatesRoute } from './rates';
import { adminPromotionsRoute, adminPromotionEditorRoute } from './promotions';
import { adminHoursRoute } from './hours';
import { adminDayCloseRoute } from './day-close';
import { adminTelegramRoute } from './telegram';
import { adminSettingsRoute } from './settings';
import { adminStaffRoute } from './staff';
import { adminAuditRoute } from './audit';

export const adminChildren = [
  adminIndexRoute,
  adminMenuRoute,
  adminCategoriesRoute,
  adminAddonsRoute,
  adminSuggestedRoute,
  adminHeroRoute,
  adminQrRoute,
  adminCourtsRoute,
  adminRatesRoute,
  adminPromotionsRoute,
  adminPromotionEditorRoute,
  adminHoursRoute,
  adminDayCloseRoute,
  adminTelegramRoute,
  adminSettingsRoute,
  adminStaffRoute,
  adminAuditRoute,
] as const;
