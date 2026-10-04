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
const LessonDetail = lazyRouteComponent(() => import('../../features/coaching/LessonDetail'), 'LessonDetailScreen');
const TournamentsList = lazyRouteComponent(() => import('../../features/tournaments/TournamentsList'), 'TournamentsListScreen');
const TournamentDetail = lazyRouteComponent(() => import('../../features/tournaments/TournamentDetail'), 'TournamentDetailScreen');

// Kept here (not imported from the feature) so the route module stays a thin
// shell that does not pull the lazy chunk in eagerly.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A uuid search param, lower-cased, or undefined. */
function uuidParam(v: unknown): string | undefined {
  return typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : undefined;
}

/**
 * Attach mode: a customer picked here goes back to a booking, a tab, an open
 * match (`attach=match&match=<id>` returns to `/desk/matches/$id?customer=<id>`,
 * open matches operator.md §5.3), or a lesson (`attach=lesson&lesson=<id>`
 * returns to `/desk/lessons/$id?customer=<id>`, coaching operator.md §5.3.2),
 * or a tournament (`attach=tournament&tournament=<id>` returns to
 * `/desk/tournaments/$id?customer=<id>`, a walk-in). Attach to a match, a lesson
 * or a tournament needs its id; without it the screen is plain search.
 */
export interface CustomerSearchParams {
  attach?: 'booking' | 'tab' | 'match' | 'lesson' | 'tournament';
  reservation?: string;
  tab?: string;
  match?: string;
  lesson?: string;
  tournament?: string;
}
export function validateCustomerSearch(raw: Record<string, unknown>): CustomerSearchParams {
  const match = uuidParam(raw.match);
  const lesson = uuidParam(raw.lesson);
  const tournament = uuidParam(raw.tournament);
  const attach =
    raw.attach === 'booking' || raw.attach === 'tab'
      ? raw.attach
      : raw.attach === 'match' && match
        ? ('match' as const)
        : raw.attach === 'lesson' && lesson
          ? ('lesson' as const)
          : raw.attach === 'tournament' && tournament
            ? ('tournament' as const)
            : undefined;
  return {
    ...(attach ? { attach } : {}),
    ...(typeof raw.reservation === 'string' ? { reservation: raw.reservation } : {}),
    ...(typeof raw.tab === 'string' ? { tab: raw.tab } : {}),
    ...(attach === 'match' ? { match } : {}),
    ...(attach === 'lesson' ? { lesson } : {}),
    ...(attach === 'tournament' ? { tournament } : {}),
  };
}
/**
 * `/desk/customers/new?attach=match&match=<id>`: a new customer goes back to the
 * open match; `attach=lesson&lesson=<id>`: back to the lesson's Add student.
 */
export function validateCustomerCreateSearch(raw: Record<string, unknown>): {
  attach?: 'match' | 'lesson' | 'tournament';
  match?: string;
  lesson?: string;
  tournament?: string;
} {
  const match = uuidParam(raw.match);
  const lesson = uuidParam(raw.lesson);
  const tournament = uuidParam(raw.tournament);
  if (raw.attach === 'match' && match) return { attach: 'match', match };
  if (raw.attach === 'lesson' && lesson) return { attach: 'lesson', lesson };
  if (raw.attach === 'tournament' && tournament) return { attach: 'tournament', tournament };
  return {};
}
function validateBookingSearch(raw: Record<string, unknown>): { customer?: string } {
  return typeof raw.customer === 'string' ? { customer: raw.customer } : {};
}
/** `/desk/matches/$id?customer=<id>`: a customer handed back opens Add player with them picked. */
function validateMatchSearch(raw: Record<string, unknown>): { customer?: string } {
  const customer = uuidParam(raw.customer);
  return customer ? { customer } : {};
}
/**
 * `/desk/lessons/$id?customer=<id>&pay=<enrolment>` (coaching operator.md
 * §5.3.2): `customer` (handed back from search or create) opens Add student
 * with that customer picked; `pay` (from the Today group or the record) opens
 * Take payment on that enrolment once the detail has loaded.
 */
export function validateLessonSearch(raw: Record<string, unknown>): { customer?: string; pay?: string } {
  const customer = uuidParam(raw.customer);
  const pay = uuidParam(raw.pay);
  return { ...(customer ? { customer } : {}), ...(pay ? { pay } : {}) };
}
/** `/desk/tournaments/$id?customer=<id>`: a customer handed back from search or create is added as a walk-in. */
export function validateTournamentSearch(raw: Record<string, unknown>): { customer?: string } {
  const customer = uuidParam(raw.customer);
  return customer ? { customer } : {};
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * `/desk?date=YYYY-MM-DD&customer=<id>`: open on a day, and/or book for a
 * customer. `kind=match` (the record's "Start an open match"): a free slot
 * opens the Start dialog with that customer as organiser. `kind=lesson` (the
 * record's "Book a lesson", coaching operator.md §5.9): a free slot opens New
 * lesson with the court, time and customer.
 */
export function validateCalendarSearch(raw: Record<string, unknown>): {
  date?: string;
  customer?: string;
  kind?: 'match' | 'lesson';
} {
  return {
    ...(typeof raw.date === 'string' && ISO_DATE.test(raw.date) ? { date: raw.date } : {}),
    ...(typeof raw.customer === 'string' ? { customer: raw.customer } : {}),
    ...(raw.kind === 'match' ? { kind: 'match' as const } : raw.kind === 'lesson' ? { kind: 'lesson' as const } : {}),
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

/**
 * One lesson, group session or course session (coaching operator.md §5.10).
 * No ROUTE_ROLES key: it inherits `/desk` by longest prefix, as
 * `/desk/matches/$id` does, so it needs no WORKSPACES, SUB_ROUTES or
 * assistant-coverage entry. The cashier cannot open it (R20): lesson money
 * from the till side is taken on the customer record.
 */
export const lessonDetailRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: 'lessons/$id',
  component: guarded('/desk', LessonDetail),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
  validateSearch: validateLessonSearch,
});

/**
 * Tournaments (docs/design/tournaments/build-contracts-2026-10-03.md §1.11).
 * The list has its own ROUTE_ROLES key (`/desk/tournaments`, the desk's roles);
 * one tournament inherits it by longest prefix.
 */
export const tournamentsListRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: 'tournaments',
  component: guarded('/desk/tournaments', TournamentsList),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
});

export const tournamentDetailRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: 'tournaments/$id',
  component: guarded('/desk/tournaments', TournamentDetail),
  pendingComponent: RoutePending,
  wrapInSuspense: true,
  validateSearch: validateTournamentSearch,
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
  lessonDetailRoute,
  tournamentsListRoute,
  tournamentDetailRoute,
] as const;
