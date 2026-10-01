/**
 * The workspace guides: what a new person on the court desk, the till, the
 * kitchen board or the Touch Shop desk needs to learn, in the order a shift
 * meets it. Pure data plus the role filter, so it is tested under node
 * (guideContent.test.ts) and the dialog only renders it.
 *
 * Every step was checked against the screen it describes. Button names in a
 * body are NOT typed into the catalog: they are `params` naming the key the
 * real button renders, so the guide reads whatever the button says. Numbers
 * come from the constants the code runs on (STALE_SECS and friends).
 *
 * Strings: `ws.guide.*` (packages/i18n/src/catalogs/ws/guide.{en,ar}.ts). A
 * step `<ws>.<section>.<step>` reads `ws.guide.<ws>.<section>.<step>.{title,body}`.
 */
import type { MessageKey } from '@touch/i18n';
import type { IconName } from '../../components/icons';
import { can, canAccess, type Capability, type StaffRole } from '../../lib/auth';
import type { WorkspaceKey } from '../../lib/workspaces';
import { STALE_REPEAT_MS, STALE_SECS } from '../kds/alarms';
import { BOARD_REFETCH_MS, COMPLETED_LINGER_MS } from '../kds/ticketView';

export type GuideWorkspace = Extract<WorkspaceKey, 'courtDesk' | 'cashier' | 'prep' | 'shop'>;
export type GuideBadge = 'managerPin' | 'ownPin' | 'managerJob' | 'online';

export interface GuideStep {
  /** `<workspace>.<section>.<step>`; also the progress id. */
  id: string;
  titleKey: MessageKey;
  bodyKey: MessageKey;
  icon?: IconName;
  /** "Go there": shown only when the viewer may open it (stepLink). */
  link?: string;
  /** {placeholder} → the key of the label the real control renders, or a number. */
  params?: Record<string, MessageKey | number>;
  /** Key chips, rendered left to right beside the body, never inside it. */
  keys?: readonly string[];
  badges?: readonly GuideBadge[];
  /** Shown only to a viewer who may open `route` / holds `capability`. */
  when?: { route?: string; capability?: Capability };
}

export interface GuideSection {
  id: string;
  titleKey: MessageKey;
  icon: IconName;
  steps: readonly GuideStep[];
}

export const GUIDE_WORKSPACES: readonly GuideWorkspace[] = ['courtDesk', 'cashier', 'prep', 'shop'];

/** The role each guide is written for: its links must all open for it. */
export const TRAINEE_ROLE: Record<GuideWorkspace, StaffRole> = {
  courtDesk: 'court_desk',
  cashier: 'cashier',
  prep: 'chef',
  shop: 'shop_staff',
};

type StepExtra = Omit<GuideStep, 'id' | 'titleKey' | 'bodyKey'>;

function step(id: string, extra: StepExtra = {}): GuideStep {
  return {
    id,
    titleKey: `ws.guide.${id}.title` as MessageKey,
    bodyKey: `ws.guide.${id}.body` as MessageKey,
    ...extra,
  };
}

function section(ws: GuideWorkspace, id: string, icon: IconName, steps: readonly [string, StepExtra?][]): GuideSection {
  return {
    id,
    titleKey: `ws.guide.${ws}.${id}.title` as MessageKey,
    icon,
    steps: steps.map(([name, extra]) => step(`${ws}.${id}.${name}`, extra)),
  };
}

const k = (key: MessageKey) => key;

// Shared by the desk, the till and the shop: the rail's shift and break rows.
const START_SHIFT = k('ws.tillShift.rail.start');
const END_SHIFT = k('ws.tillShift.rail.end');
const GO_ON_BREAK = k('ws.shell.break.goOnBreak');

const COURT_DESK: readonly GuideSection[] = [
  section('courtDesk', 'start', 'play', [
    ['shift', { icon: 'banknote', link: '/desk/today', params: { startShift: START_SHIFT }, badges: ['online'] }],
    [
      'board',
      {
        icon: 'today',
        link: '/desk/today',
        params: {
          arrivals: k('ws.courtDesk.board.arrivals'),
          courtsNow: k('ws.courtDesk.board.availability'),
          allBookings: k('ws.courtDesk.board.bookings'),
        },
      },
    ],
  ]),
  section('courtDesk', 'bookings', 'calendar', [
    ['newBooking', { icon: 'plus', link: '/desk/today', params: { newBooking: k('ws.courtDesk.board.newBooking') } }],
    ['walkIn', { icon: 'court', link: '/desk/today', params: { courtsNow: k('ws.courtDesk.board.availability') } }],
    ['calendar', { icon: 'calendar', link: '/desk', keys: ['←', '→', 'D', 'M'] }],
    [
      'change',
      {
        icon: 'grip',
        params: {
          move: k('ws.courtDesk.detail.move'),
          shorten: k('ws.courtDesk.detail.shorten'),
          extend: k('ws.courtDesk.detail.extend'),
        },
      },
    ],
    ['cancel', { icon: 'ban', params: { cancel: k('ws.courtDesk.detail.cancel') } }],
    ['series', { icon: 'repeat', link: '/desk/series/new', params: { newSeries: k('ws.courtDesk.calendar.series') } }],
    ['block', { icon: 'lock', link: '/desk/block', params: { blockCourt: k('ws.courtDesk.calendar.block') } }],
    ['offline', { icon: 'wifiOff' }],
  ]),
  section('courtDesk', 'arrivals', 'users', [
    [
      'arrived',
      {
        icon: 'checkCircle',
        link: '/desk/today',
        params: { markArrived: k('ws.courtDesk.board.markArrived'), late: k('ws.courtDesk.board.lateTitle') },
      },
    ],
    ['noShow', { icon: 'user', params: { noShow: k('ws.courtDesk.detail.noShow'), completed: k('ws.courtDesk.detail.completed') } }],
  ]),
  section('courtDesk', 'money', 'banknote', [
    ['fee', { icon: 'banknote', params: { cash: k('ws.courtDesk.payment.cash'), card: k('ws.courtDesk.payment.card') } }],
    ['cafe', { icon: 'receipt', params: { addCafeBill: k('ws.courtDesk.payment.addCafeBill') }, badges: ['online'] }],
    ['unpaid', { icon: 'alert', link: '/desk/today', params: { toSettle: k('ws.courtDesk.board.toSettleTitle') } }],
    ['closeBill', { icon: 'check', params: { closeBill: k('ws.courtDesk.payment.closeBillAction') } }],
    ['deposit', { icon: 'phone', params: { paidOnline: k('ws.courtDesk.payment.paidOnline') } }],
    ['overpaid', { icon: 'undo', badges: ['managerJob'] }],
  ]),
  section('courtDesk', 'customers', 'user', [
    ['find', { icon: 'search', link: '/desk/customers' }],
    ['create', { icon: 'userPlus', link: '/desk/customers/new' }],
    ['flags', { icon: 'tag' }],
  ]),
  section('courtDesk', 'matches', 'ticket', [
    [
      'start',
      {
        icon: 'link',
        when: { capability: 'runMatches' },
        params: {
          openMatch: k('ws.matches.common.openMatch'),
          startMatch: k('ws.matches.today.startMatch'),
          copyLink: k('ws.matches.detail.copyLink'),
        },
        badges: ['online'],
      },
    ],
    ['players', { icon: 'users', when: { capability: 'runMatches' }, params: { players: k('ws.matches.booking.players') }, badges: ['online'] }],
    [
      'writeOff',
      { icon: 'ticket', when: { capability: 'writeOffSeat' }, params: { writeOff: k('ws.matches.players.writeOff') }, badges: ['managerPin'] },
    ],
    ['callOff', { icon: 'ban', when: { capability: 'runMatches' }, badges: ['online'] }],
  ]),
  section('courtDesk', 'more', 'checkCircle', [
    ['tasks', { icon: 'checkCircle', link: '/tasks', when: { route: '/tasks' } }],
    ['incident', { icon: 'alert', link: '/incidents', when: { route: '/incidents' } }],
    ['break', { icon: 'clock', params: { goOnBreak: GO_ON_BREAK }, badges: ['ownPin'] }],
  ]),
  section('courtDesk', 'end', 'logOut', [
    ['shift', { icon: 'banknote', params: { endShift: END_SHIFT }, badges: ['ownPin', 'online'] }],
    ['signOut', { icon: 'logOut' }],
  ]),
];

const TILL: readonly GuideSection[] = [
  section('cashier', 'start', 'play', [
    ['day', { icon: 'calendar' }],
    [
      'shift',
      {
        icon: 'banknote',
        link: '/till',
        params: { confirm: k('ws.tillShift.start.confirm'), different: k('ws.tillShift.start.different') },
        badges: ['online'],
      },
    ],
    ['others', { icon: 'users', link: '/till', badges: ['managerPin', 'online'] }],
    ['sound', { icon: 'bell', params: { turnOnSound: k('op.kds.startShift') } }],
  ]),
  section('cashier', 'orders', 'receipt', [
    ['floor', { icon: 'grid', link: '/till' }],
    ['courts', { icon: 'court', params: { courts: k('ws.cashier.floor.courts') } }],
    ['newTab', { icon: 'plus', params: { newTab: k('ws.cashier.till.rail.newTab') }, keys: ['F6'] }],
    ['items', { icon: 'search', keys: ['1–9', '/'] }],
    ['notes', { icon: 'note' }],
    ['send', { icon: 'flame', params: { send: k('op.till.sendOrder') }, keys: ['F2'] }],
    ['calls', { icon: 'bell', params: { ack: k('op.floor.ack'), done: k('op.floor.resolve') } }],
    ['slips', { icon: 'image', params: { send: k('ws.slips.review.send'), setAside: k('ws.slips.review.reject') } }],
  ]),
  section('cashier', 'pay', 'banknote', [
    ['cash', { icon: 'banknote', params: { cash: k('op.till.payCash') }, keys: ['F4'] }],
    ['card', { icon: 'card', params: { card: k('op.till.payCard') }, keys: ['F5'] }],
    ['split', { icon: 'split', params: { partial: k('ws.cashier.payment.partial'), split: k('ws.cashier.detail.split') } }],
    ['promo', { icon: 'tag', params: { applyPromo: k('ws.cashier.detail.promoApply') }, badges: ['online'] }],
    ['charge', { icon: 'court', params: { chargeBooking: k('ws.cashier.detail.chargeBooking') }, badges: ['online'] }],
    ['bill', { icon: 'printer', params: { bill: k('op.till.bill') } }],
  ]),
  section('cashier', 'fix', 'undo', [
    ['discount', { icon: 'tag', params: { discount: k('ws.cashier.detail.discount') }, badges: ['managerPin'] }],
    ['price', { icon: 'note', params: { override: k('op.till.override') }, badges: ['managerPin'] }],
    ['void', { icon: 'trash', params: { void: k('ws.cashier.detail.voidLine') }, badges: ['managerPin'] }],
    ['refund', { icon: 'undo', badges: ['managerJob'] }],
    [
      'merge',
      {
        icon: 'merge',
        link: '/till/tabs',
        params: { openTabs: k('ws.shell.nav.openTabs'), merge: k('ws.cashier.tabs.merge') },
        badges: ['online'],
      },
    ],
    ['remove', { icon: 'trash', link: '/till/tabs', params: { openTabs: k('ws.shell.nav.openTabs') } }],
    [
      'drawer',
      {
        icon: 'drawer',
        link: '/till/drawer',
        params: { cashDrawer: k('ws.shell.nav.cashDrawer'), openDrawer: k('ws.cashier.drawer.openDrawer') },
        badges: ['online'],
      },
    ],
    ['offline', { icon: 'wifiOff' }],
  ]),
  section('cashier', 'more', 'checkCircle', [
    ['tasks', { icon: 'checkCircle', link: '/tasks', when: { route: '/tasks' } }],
    ['incident', { icon: 'alert', link: '/incidents', when: { route: '/incidents' } }],
    ['break', { icon: 'clock', params: { goOnBreak: GO_ON_BREAK }, badges: ['ownPin'] }],
  ]),
  section('cashier', 'end', 'logOut', [
    ['openTabs', { icon: 'receipt', link: '/till/tabs', params: { openTabs: k('ws.shell.nav.openTabs') } }],
    [
      'shift',
      {
        icon: 'banknote',
        link: '/till/drawer',
        params: { cashDrawer: k('ws.shell.nav.cashDrawer'), endShift: END_SHIFT },
        badges: ['ownPin', 'online'],
      },
    ],
    ['signOut', { icon: 'logOut' }],
  ]),
];

const KITCHEN: readonly GuideSection[] = [
  section('prep', 'start', 'play', [
    ['sound', { icon: 'bell', params: { turnOnSound: k('op.kds.startShift') } }],
    ['connection', { icon: 'globe', params: { live: k('op.common.live') } }],
  ]),
  section('prep', 'tickets', 'receipt', [
    ['source', { icon: 'receipt', params: { till: k('ws.kit.source.till'), web: k('ws.kit.source.web') } }],
    ['card', { icon: 'fileText' }],
    [
      'band',
      { icon: 'clock', params: { onTime: k('ws.prep.age.fresh'), gettingLate: k('ws.prep.age.warm'), late: k('ws.prep.age.late') } },
    ],
  ]),
  section('prep', 'work', 'flame', [
    ['start', { icon: 'play', params: { start: k('op.kds.start') }, keys: ['S'] }],
    ['tick', { icon: 'check', keys: ['Space'] }],
    ['ready', { icon: 'checkCircle', params: { ready: k('op.kds.ready') }, keys: ['R'] }],
    [
      'complete',
      { icon: 'check', params: { complete: k('op.kds.complete'), minutes: COMPLETED_LINGER_MS / 60_000 }, keys: ['C'] },
    ],
  ]),
  section('prep', 'alerts', 'alert', [
    ['stale', { icon: 'alert', params: { seconds: STALE_SECS, repeat: STALE_REPEAT_MS / 1000, stale: k('op.kds.stale') } }],
    ['voided', { icon: 'trash' }],
  ]),
  section('prep', 'keys', 'keyboard', [
    ['tickets', { icon: 'keyboard', keys: ['1–9', '←', '→'] }],
    ['items', { icon: 'keyboard', keys: ['↑', '↓', 'Space', 'Esc', '?'] }],
    ['layout', { icon: 'globe' }],
  ]),
  section('prep', 'problems', 'wifiOff', [
    ['offline', { icon: 'wifiOff' }],
    ['error', { icon: 'refresh', params: { seconds: BOARD_REFETCH_MS / 1000 } }],
  ]),
  section('prep', 'tasks', 'checkCircle', [
    [
      'open',
      {
        icon: 'checkCircle',
        link: '/tasks',
        when: { route: '/tasks' },
        params: { myTasks: k('ws.team.tasks.kds.button'), backToBoard: k('ws.team.tasks.backToBoard') },
      },
    ],
  ]),
];

const SHOP: readonly GuideSection[] = [
  section('shop', 'start', 'play', [['shift', { icon: 'banknote', link: '/shop', badges: ['online'] }]]),
  section('shop', 'sell', 'receipt', [
    ['find', { icon: 'search', link: '/shop' }],
    ['basket', { icon: 'receipt', params: { clear: k('ws.shop.till.clear') } }],
    ['pay', { icon: 'card', params: { cash: k('ws.shop.till.cash'), card: k('ws.shop.till.card') } }],
    ['unfinished', { icon: 'hourglass', params: { unfinished: k('ws.shop.till.unfinished'), resume: k('ws.shop.till.resume') } }],
    ['offline', { icon: 'wifiOff' }],
  ]),
  section('shop', 'stock', 'box', [
    ['onHand', { icon: 'box', link: '/shop/stock', params: { shopStock: k('ws.shell.nav.shopStock') } }],
    ['receive', { icon: 'package', link: '/shop/receive' }],
    ['counts', { icon: 'layers', link: '/shop/counts' }],
    ['waste', { icon: 'trash', link: '/shop/waste' }],
  ]),
  section('shop', 'products', 'tag', [
    ['products', { icon: 'tag', link: '/shop/products' }],
    ['prices', { icon: 'banknote', link: '/shop/products', when: { capability: 'editLaunchedPrices' } }],
    ['suppliers', { icon: 'users', link: '/shop/suppliers' }],
  ]),
  section('shop', 'end', 'logOut', [
    [
      'drawer',
      {
        icon: 'drawer',
        link: '/shop/drawer',
        params: { cashDrawer: k('ws.shell.nav.cashDrawer'), openDrawer: k('ws.cashier.drawer.openDrawer') },
        badges: ['online'],
      },
    ],
    ['break', { icon: 'clock', params: { goOnBreak: GO_ON_BREAK }, badges: ['ownPin'] }],
    ['unpaid', { icon: 'alert', link: '/shop', params: { unfinished: k('ws.shop.till.unfinished') } }],
    ['shift', { icon: 'banknote', params: { endShift: END_SHIFT }, badges: ['ownPin', 'online'] }],
    ['signOut', { icon: 'logOut' }],
  ]),
];

export const GUIDES: Readonly<Record<GuideWorkspace, readonly GuideSection[]>> = {
  courtDesk: COURT_DESK,
  cashier: TILL,
  prep: KITCHEN,
  shop: SHOP,
};

/** Every step id of every guide: what guideProgress keeps, and nothing else. */
export const ALL_STEP_IDS: ReadonlySet<string> = new Set(
  GUIDE_WORKSPACES.flatMap((ws) => GUIDES[ws].flatMap((s) => s.steps.map((st) => st.id))),
);

export function isGuideWorkspace(ws: WorkspaceKey): ws is GuideWorkspace {
  return (GUIDE_WORKSPACES as readonly string[]).includes(ws);
}

/** The workspace's guide, or null for one that has none (manager, owner, team). */
export function guideFor(ws: WorkspaceKey): readonly GuideSection[] | null {
  return isGuideWorkspace(ws) ? GUIDES[ws] : null;
}

function stepShows(st: GuideStep, viewer: StaffRole): boolean {
  if (st.when?.route && !canAccess(viewer, st.when.route)) return false;
  if (st.when?.capability && !can(viewer, st.when.capability)) return false;
  return true;
}

/** The guide as `viewer` sees it: steps whose `when` fails are dropped, then empty sections. */
export function visibleGuide(ws: GuideWorkspace, viewer: StaffRole): readonly GuideSection[] {
  return GUIDES[ws]
    .map((s) => ({ ...s, steps: s.steps.filter((st) => stepShows(st, viewer)) }))
    .filter((s) => s.steps.length > 0);
}

/** "Go there" for this viewer: null when the step has no link or the viewer cannot open it. */
export function stepLink(st: GuideStep, viewer: StaffRole): string | null {
  if (!st.link) return null;
  return canAccess(viewer, st.link) ? st.link : null;
}

export interface GuideProgress {
  done: number;
  total: number;
  bySection: Record<string, { done: number; total: number }>;
}

/** Ticked steps over the steps shown; an id that is not a step here counts for nothing. */
export function progressOf(sections: readonly GuideSection[], learned: ReadonlySet<string>): GuideProgress {
  const bySection: GuideProgress['bySection'] = {};
  let done = 0;
  let total = 0;
  for (const s of sections) {
    const d = s.steps.filter((st) => learned.has(st.id)).length;
    bySection[s.id] = { done: d, total: s.steps.length };
    done += d;
    total += s.steps.length;
  }
  return { done, total, bySection };
}
