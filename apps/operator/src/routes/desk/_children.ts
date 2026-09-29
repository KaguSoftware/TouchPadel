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
const MatchDetail = lazyRouteComponent(() => import('../../features/matches/MatchDetail'), 'MatchDetailScreen');

// Kept here (not imported from the feature) so the route module stays a thin
// shell that does not pull the lazy chunk in eagerly.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A uuid search param, lower-cased, or undefined. */
function uuidParam(v: unknown): string | undefined {
  return typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : undefined;
}

/**
 * Attach mode: a customer picked here goes back to a booking, a tab, or an
 * open match (`attach=match&match=<id>` returns to
 * `/desk/matches/$id?customer=<id>`, open matches operator.md §5.3). Attach to
 * a match needs the match's id; without it the screen is plain search.
 */
interface CustomerSearchParams {
  attach?: 'booking' | 'tab' | 'match';
  reservation?: string;
  tab?: string;
  match?: string;
}
function validateCustomerSearch(raw: Record<string, unknown>): CustomerSearchParams {
  const match = uuidParam(raw.match);
  const attach =
    raw.attach === 'booking' || raw.attach === 'tab' ? raw.attach : raw.attach === 'match' && match ? ('match' as const) : undefined;
  return {
    ...(attach ? { attach } : {}),
    ...(typeof raw.reservation === 'string' ? { reservation: raw.reservation } : {}),
    ...(typeof raw.tab === 'string' ? { tab: raw.tab } : {}),
    ...(attach === 'match' ? { match } : {}),
  };
}
/** `/desk/customers/new?attach=match&match=<id>`: a new customer goes back to the open match. */
function validateCustomerCreateSearch(raw: Record<string, unknown>): { attach?: 'match'; match?: string } {
  const match = uuidParam(raw.match);
  return raw.attach === 'match' && match ? { attach: 'match', match } : {};
}
function validateBookingSearch(raw: Record<string, unknown>): { customer?: string } {
  return typeof raw.customer === 'string' ? { customer: raw.customer } : {};
}
/** `/desk/matches/$id?customer=<id>`: a customer handed back opens Add player with them picked. */
function validateMatchSearch(raw: Record<string, unknown>): { customer?: string } {
  const customer = uuidParam(raw.customer);
  return customer ? { customer } : {};
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * `/desk?date=YYYY-MM-DD&customer=<id>`: open on a day, and/or book for a
 * customer. `kind=match` (the record's "Start an open match"): a free slot
 * opens the Start dialog with that customer as organiser.
 */
function validateCalendarSearch(raw: Record<string, unknown>): { date?: string; customer?: string; kind?: 'match' } {
  return {
    ...(typeof raw.date === 'string' && ISO_DATE.test(raw.date) ? { date: raw.date } : {}),
    ...(typeof raw.customer === 'string' ? { customer: raw.customer } : {}),
    ...(raw.kind === 'match' ? { kind: 'match' as const } : {}),
  };
}
/**
 * `/desk/block?date=YYYY-MM-DD`: the day the calendar was showing.
 * `/desk/block?run=<uuid>&step=<uuid>`: a tournament's courts step, opened
 * from Protocols or My tasks (event mode, build-contracts §5.1); both or neither.
 */
function validateBlockSearch(raw: Record<string, unknown>): { date?: string; run?: string; step?: string } {
  const run = uuidParam(raw.run);
  const step = uuidParam(raw.step);
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

export const customerCreateRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: 'customers/new',
  component: guarded('/desk/customers/new', CustomerCreate),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
  validateSearch: validateCustomerCreateSearch,
});

/**
 * One open match (operator.md §5.3). No ROUTE_ROLES key: it inherits `/desk`
 * by longest prefix, as `/desk/bookings/$id` does, so it needs no WORKSPACES,
 * SUB_ROUTES or assistant-coverage entry (the written exception, G8d).
 */
export const matchDetailRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: 'matches/$id',
  component: guarded('/desk', MatchDetail),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
  validateSearch: validateMatchSearch,
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
  customerCreateRoute,
  customerRecordRoute,
  matchDetailRoute,
] as const;
