/**
 * Every /desk child route. Owned by the desk lane; add screens here.
 * The customers routes are shared with the cashier (ROUTE_ROLES) so the guard
 * path is passed explicitly per child. Search params are validated at the
 * route so screens read typed values (attach mode on the customer screens,
 * the handed-back customer id on the booking screen).
 */
import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { deskRoute } from '../desk';
import { RoutePending, guarded } from '../admin/_shared';

const DeskCalendar = lazyRouteComponent(() => import('../../features/desk/DeskCalendar'), 'DeskCalendar');
const TodaysBoard = lazyRouteComponent(() => import('../../features/desk/TodaysBoard'), 'TodaysBoardScreen');
const BookingDetail = lazyRouteComponent(() => import('../../features/desk/BookingDetail'), 'BookingDetailScreen');
const CourtBlock = lazyRouteComponent(() => import('../../features/desk/CourtBlock'), 'CourtBlockScreen');
const SeriesCreate = lazyRouteComponent(() => import('../../features/desk/series/SeriesCreate'), 'RecurringSeriesCreateScreen');
const SeriesDetail = lazyRouteComponent(() => import('../../features/desk/series/SeriesDetail'), 'SeriesDetailScreen');
const CustomerSearch = lazyRouteComponent(() => import('../../features/desk/customers/CustomerSearch'), 'CustomerSearchScreen');
const CustomerCreate = lazyRouteComponent(() => import('../../features/desk/customers/CustomerCreate'), 'CustomerCreateScreen');
const CustomerRecord = lazyRouteComponent(() => import('../../features/desk/customers/CustomerRecord'), 'CustomerRecordScreen');

// Kept here (not imported from the feature) so the route module stays a thin
// shell that does not pull the lazy chunk in eagerly.
interface CustomerSearchParams {
  attach?: 'booking' | 'tab';
  reservation?: string;
  tab?: string;
}
function validateCustomerSearch(raw: Record<string, unknown>): CustomerSearchParams {
  const attach = raw.attach === 'booking' || raw.attach === 'tab' ? raw.attach : undefined;
  return {
    ...(attach ? { attach } : {}),
    ...(typeof raw.reservation === 'string' ? { reservation: raw.reservation } : {}),
    ...(typeof raw.tab === 'string' ? { tab: raw.tab } : {}),
  };
}
function validateBookingSearch(raw: Record<string, unknown>): { customer?: string } {
  return typeof raw.customer === 'string' ? { customer: raw.customer } : {};
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** `/desk?date=YYYY-MM-DD&customer=<id>`: open on a day, and/or book for a customer. */
function validateCalendarSearch(raw: Record<string, unknown>): { date?: string; customer?: string } {
  return {
    ...(typeof raw.date === 'string' && ISO_DATE.test(raw.date) ? { date: raw.date } : {}),
    ...(typeof raw.customer === 'string' ? { customer: raw.customer } : {}),
  };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * `/desk/block?date=YYYY-MM-DD`: the day the calendar was showing.
 * `/desk/block?run=<uuid>&step=<uuid>`: a tournament's courts step, opened
 * from Protocols or My tasks (event mode, build-contracts §5.1); both or neither.
 */
function validateBlockSearch(raw: Record<string, unknown>): { date?: string; run?: string; step?: string } {
  const run = typeof raw.run === 'string' && UUID.test(raw.run) ? raw.run.toLowerCase() : undefined;
  const step = typeof raw.step === 'string' && UUID.test(raw.step) ? raw.step.toLowerCase() : undefined;
  return {
    ...(typeof raw.date === 'string' && ISO_DATE.test(raw.date) ? { date: raw.date } : {}),
    ...(run && step ? { run, step } : {}),
  };
}

const child = <P extends string>(path: P, guardRoute: string, Component: Parameters<typeof guarded>[1]) =>
  createRoute({
    getParentRoute: () => deskRoute,
    path,
    component: guarded(guardRoute, Component),
    pendingComponent: RoutePending,
    wrapInSuspense: true,
  });

export const deskIndexRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: '/',
  component: guarded('/desk', DeskCalendar),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
  validateSearch: validateCalendarSearch,
});

export const courtBlockRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: 'block',
  component: guarded('/desk', CourtBlock),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
  validateSearch: validateBlockSearch,
});

export const bookingDetailRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: 'bookings/$id',
  component: guarded('/desk', BookingDetail),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
  validateSearch: validateBookingSearch,
});

export const customerSearchRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: 'customers',
  component: guarded('/desk/customers', CustomerSearch),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
  validateSearch: validateCustomerSearch,
});

export const customerRecordRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: 'customers/$id',
  component: guarded('/desk/customers', CustomerRecord),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
  validateSearch: validateCustomerSearch,
});

export const deskChildren = [
  deskIndexRoute,
  child('today', '/desk', TodaysBoard),
  bookingDetailRoute,
  courtBlockRoute,
  child('series/new', '/desk', SeriesCreate),
  child('series/$id', '/desk', SeriesDetail),
  customerSearchRoute,
  child('customers/new', '/desk/customers/new', CustomerCreate),
  customerRecordRoute,
] as const;
