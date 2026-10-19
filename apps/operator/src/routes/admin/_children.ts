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
import { adminCoachesRoute } from './coaches';
import { adminRatesRoute } from './rates';
import { adminGenderHoursRoute } from './gender-hours';
import { adminPromotionsRoute, adminPromotionEditorRoute } from './promotions';
import { adminHoursRoute } from './hours';
import { adminDayCloseRoute } from './day-close';
import { adminTelegramRoute } from './telegram';
import {
  adminSettingsAnalyticsRoute,
  adminSettingsBookingRoute,
  adminSettingsDayRoute,
  adminSettingsDepositRoute,
  adminSettingsDevicesRoute,
  adminSettingsKitchenRoute,
  adminSettingsMatchesRoute,
  adminSettingsOfflineRoute,
  adminSettingsRoute,
  adminSettingsStationsRoute,
  adminSettingsTournamentsRoute,
} from './settings';
import { adminStaffRoute } from './staff';
import { adminAuditRoute } from './audit';
import { adminBranchesRoute } from './branches';
import { adminLoyaltyRoute } from './loyalty';

export const adminChildren = [
  adminIndexRoute,
  adminMenuRoute,
  adminCategoriesRoute,
  adminAddonsRoute,
  adminSuggestedRoute,
  adminHeroRoute,
  adminQrRoute,
  adminCourtsRoute,
  adminCoachesRoute,
  adminRatesRoute,
  adminGenderHoursRoute,
  adminPromotionsRoute,
  adminPromotionEditorRoute,
  adminHoursRoute,
  adminDayCloseRoute,
  adminTelegramRoute,
  adminSettingsRoute,
  adminSettingsDayRoute,
  adminSettingsAnalyticsRoute,
  adminSettingsBookingRoute,
  adminSettingsDepositRoute,
  adminSettingsMatchesRoute,
  adminSettingsTournamentsRoute,
  adminSettingsDevicesRoute,
  adminSettingsStationsRoute,
  adminSettingsKitchenRoute,
  adminSettingsOfflineRoute,
  adminStaffRoute,
  adminAuditRoute,
  adminBranchesRoute,
  adminLoyaltyRoute,
] as const;
