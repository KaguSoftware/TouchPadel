import { isolate, isolateLtr } from './bidi';
import { countPhrase } from './plural';
import { makeT, type Locale, type MessageKey, type TParams } from './t';

/**
 * The Terms of Service and Privacy Policy as data: ordered sections whose
 * blocks point at `legal.*` catalog keys. ONE list, read by the public pages
 * (apps/web/app/[locale]/{terms,privacy}) and by the app's accept-terms gate,
 * which shows the same text in full before the guest can agree, so what a
 * guest scrolls through in the app is what the site publishes.
 *
 * Bump CURRENT_TERMS_VERSION (@touch/core) when a change needs a guest to
 * agree again.
 */
export type LegalPageName = 'privacy' | 'terms' | 'support' | 'delete-account';

export type LegalListItem = MessageKey | { lead: MessageKey; text: MessageKey };

export type LegalBlock =
  | { kind: 'p'; key: MessageKey }
  | { kind: 'list'; items: LegalListItem[] }
  /** The venue phone as a tel: link, or the front-desk fallback when unset. */
  | { kind: 'phone' }
  /** The week's opening hours; omitted when the venue has none published. */
  | { kind: 'hours' }
  /** The company's contact email (a mailto: once it is filled in) and address. */
  | { kind: 'entity' }
  | { kind: 'link'; to: LegalPageName; hash?: string; label: MessageKey };

export interface LegalSection {
  id: string;
  title: MessageKey;
  blocks: LegalBlock[];
}

/** A `legal.entity.*` value the partner has not filled in yet. */
export function isPlaceholder(value: string): boolean {
  return value.startsWith('[FILL');
}

/**
 * The {company}, {email}, … values every legal string can interpolate, each
 * bidi-isolated: a Latin company name or an email inside an Arabic sentence
 * must not reorder the words around it.
 */
export function entityParams(locale: Locale): TParams {
  const tr = makeT(locale);
  return {
    company: isolate(tr('legal.entity.company')),
    tradingName: isolate(tr('legal.entity.tradingName')),
    registration: isolateLtr(tr('legal.entity.registration')),
    address: isolate(tr('legal.entity.address')),
    email: isolateLtr(tr('legal.entity.email')),
    city: isolate(tr('legal.entity.city')),
    minPlayAge: isolateLtr(tr('legal.entity.minPlayAge')),
  };
}

/**
 * Every value a legal string can interpolate. {cancelHours} is the window
 * app.cancel_reservation enforces, as a whole counted phrase ("4 hours",
 * «ساعتين»); 4 is what 0056 configured, the fallback when the venue read fails.
 */
export function legalParams(locale: Locale, cancellationWindowHours: number | null | undefined): TParams {
  return {
    ...entityParams(locale),
    cancelHours: countPhrase('site.hoursCount', cancellationWindowHours ?? 4, locale),
  };
}

export const TERMS_SECTIONS: readonly LegalSection[] = [
  { id: 'who', title: 'legal.terms.who.title', blocks: [{ kind: 'p', key: 'legal.terms.who.body' }] },
  {
    id: 'accounts',
    title: 'legal.terms.accounts.title',
    blocks: [
      {
        kind: 'list',
        items: [
          'legal.terms.accounts.age',
          'legal.terms.accounts.accurate',
          'legal.terms.accounts.secure',
          'legal.terms.accounts.desk',
        ],
      },
    ],
  },
  {
    id: 'bookings',
    title: 'legal.terms.bookings.title',
    blocks: [
      {
        kind: 'list',
        items: [
          'legal.terms.bookings.confirm',
          'legal.terms.bookings.price',
          'legal.terms.bookings.cancel',
          'legal.terms.bookings.noShow',
          'legal.terms.bookings.time',
          'legal.terms.bookings.venueCancel',
        ],
      },
    ],
  },
  {
    id: 'open-matches',
    title: 'legal.terms.openMatches.title',
    blocks: [
      {
        kind: 'list',
        items: [
          { lead: 'legal.terms.openMatches.startLead', text: 'legal.terms.openMatches.start' },
          { lead: 'legal.terms.openMatches.ticketsLead', text: 'legal.terms.openMatches.tickets' },
          { lead: 'legal.terms.openMatches.refundLead', text: 'legal.terms.openMatches.refund' },
          { lead: 'legal.terms.openMatches.shareLead', text: 'legal.terms.openMatches.share' },
          { lead: 'legal.terms.openMatches.venueLead', text: 'legal.terms.openMatches.venue' },
          { lead: 'legal.terms.openMatches.genderLead', text: 'legal.terms.openMatches.gender' },
          { lead: 'legal.terms.openMatches.conductLead', text: 'legal.terms.openMatches.conduct' },
          { lead: 'legal.terms.openMatches.deleteLead', text: 'legal.terms.openMatches.delete' },
        ],
      },
    ],
  },
  {
    id: 'cafe',
    title: 'legal.terms.cafe.title',
    blocks: [{ kind: 'list', items: ['legal.terms.cafe.order', 'legal.terms.cafe.allergens', 'legal.terms.cafe.pay'] }],
  },
  {
    id: 'venue',
    title: 'legal.terms.venue.title',
    blocks: [
      { kind: 'p', key: 'legal.terms.venue.risk' },
      {
        kind: 'list',
        items: [
          'legal.terms.venue.rules',
          'legal.terms.venue.minors',
          'legal.terms.venue.damage',
          'legal.terms.venue.belongings',
          'legal.terms.venue.conduct',
        ],
      },
    ],
  },
  {
    id: 'app',
    title: 'legal.terms.app.title',
    blocks: [{ kind: 'list', items: ['legal.terms.app.use', 'legal.terms.app.availability', 'legal.terms.app.ip'] }],
  },
  { id: 'messages', title: 'legal.terms.messages.title', blocks: [{ kind: 'p', key: 'legal.terms.messages.body' }] },
  {
    id: 'liability',
    title: 'legal.terms.liability.title',
    blocks: [
      { kind: 'p', key: 'legal.terms.liability.care' },
      { kind: 'p', key: 'legal.terms.liability.limit' },
      { kind: 'p', key: 'legal.terms.liability.notExcluded' },
    ],
  },
  { id: 'ending', title: 'legal.terms.ending.title', blocks: [{ kind: 'p', key: 'legal.terms.ending.body' }] },
  { id: 'changes', title: 'legal.terms.changes.title', blocks: [{ kind: 'p', key: 'legal.terms.changes.body' }] },
  {
    id: 'law',
    title: 'legal.terms.law.title',
    blocks: [
      { kind: 'p', key: 'legal.terms.law.body' },
      { kind: 'p', key: 'legal.terms.law.language' },
    ],
  },
  {
    id: 'contact',
    title: 'legal.terms.contactSection.title',
    blocks: [{ kind: 'p', key: 'legal.terms.contactSection.body' }, { kind: 'entity' }, { kind: 'phone' }],
  },
];

export const PRIVACY_SECTIONS: readonly LegalSection[] = [
  { id: 'who', title: 'legal.privacy.who.title', blocks: [{ kind: 'p', key: 'legal.privacy.who.body' }] },
  {
    id: 'collect',
    title: 'legal.privacy.collect.title',
    blocks: [
      {
        kind: 'list',
        items: [
          { lead: 'legal.privacy.collect.accountLead', text: 'legal.privacy.collect.account' },
          { lead: 'legal.privacy.collect.codesLead', text: 'legal.privacy.collect.codes' },
          { lead: 'legal.privacy.collect.bookingsLead', text: 'legal.privacy.collect.bookings' },
          { lead: 'legal.privacy.collect.matchesLead', text: 'legal.privacy.collect.matches' },
          { lead: 'legal.privacy.collect.cafeLead', text: 'legal.privacy.collect.cafe' },
          { lead: 'legal.privacy.collect.pushLead', text: 'legal.privacy.collect.push' },
          { lead: 'legal.privacy.collect.providersLead', text: 'legal.privacy.collect.providers' },
          { lead: 'legal.privacy.collect.notesLead', text: 'legal.privacy.collect.notes' },
          { lead: 'legal.privacy.collect.consentLead', text: 'legal.privacy.collect.consent' },
          { lead: 'legal.privacy.collect.technicalLead', text: 'legal.privacy.collect.technical' },
        ],
      },
      { kind: 'p', key: 'legal.privacy.collect.notCollected' },
      { kind: 'p', key: 'legal.privacy.collect.website' },
    ],
  },
  {
    id: 'use',
    title: 'legal.privacy.use.title',
    blocks: [
      { kind: 'p', key: 'legal.privacy.use.lead' },
      {
        kind: 'list',
        items: [
          'legal.privacy.use.account',
          'legal.privacy.use.bookings',
          'legal.privacy.use.matches',
          'legal.privacy.use.notify',
          'legal.privacy.use.rules',
          'legal.privacy.use.security',
          'legal.privacy.use.legal',
        ],
      },
      { kind: 'p', key: 'legal.privacy.use.never' },
    ],
  },
  {
    id: 'share',
    title: 'legal.privacy.share.title',
    blocks: [
      { kind: 'p', key: 'legal.privacy.share.staff' },
      { kind: 'p', key: 'legal.privacy.share.players' },
      { kind: 'p', key: 'legal.privacy.share.processorsLead' },
      {
        kind: 'list',
        items: [
          'legal.privacy.share.supabase',
          'legal.privacy.share.push',
          'legal.privacy.share.signIn',
          'legal.privacy.share.qi',
          'legal.privacy.share.whatsapp',
          'legal.privacy.share.telegram',
          'legal.privacy.share.ai',
          'legal.privacy.share.vercel',
          'legal.privacy.share.posthog',
          'legal.privacy.share.kagu',
        ],
      },
      { kind: 'p', key: 'legal.privacy.share.authorities' },
      { kind: 'p', key: 'legal.privacy.share.noSale' },
    ],
  },
  { id: 'transfers', title: 'legal.privacy.transfers.title', blocks: [{ kind: 'p', key: 'legal.privacy.transfers.body' }] },
  {
    id: 'retention',
    title: 'legal.privacy.retention.title',
    blocks: [
      { kind: 'p', key: 'legal.privacy.retention.active' },
      { kind: 'p', key: 'legal.privacy.retention.deleted' },
      { kind: 'p', key: 'legal.privacy.retention.bookings' },
      { kind: 'p', key: 'legal.privacy.retention.matches' },
      { kind: 'p', key: 'legal.privacy.retention.cafe' },
      { kind: 'p', key: 'legal.privacy.retention.logs' },
      { kind: 'p', key: 'legal.privacy.retention.apple' },
    ],
  },
  {
    id: 'choices',
    title: 'legal.privacy.rights.title',
    blocks: [
      { kind: 'p', key: 'legal.privacy.rights.lead' },
      {
        kind: 'list',
        items: [
          'legal.privacy.rights.access',
          'legal.privacy.rights.edit',
          'legal.privacy.rights.delete',
          'legal.privacy.rights.object',
          'legal.privacy.rights.notifications',
          'legal.privacy.rights.language',
        ],
      },
      { kind: 'p', key: 'legal.privacy.rights.how' },
      { kind: 'link', to: 'delete-account', label: 'legal.privacy.rights.deleteLink' },
    ],
  },
  { id: 'cookies', title: 'legal.privacy.cookies.title', blocks: [{ kind: 'p', key: 'legal.privacy.cookies.body' }] },
  { id: 'security', title: 'legal.privacy.security.title', blocks: [{ kind: 'p', key: 'legal.privacy.security.body' }] },
  { id: 'children', title: 'legal.privacy.children.title', blocks: [{ kind: 'p', key: 'legal.privacy.children.body' }] },
  { id: 'changes', title: 'legal.privacy.changes.title', blocks: [{ kind: 'p', key: 'legal.privacy.changes.body' }] },
  {
    id: 'contact',
    title: 'legal.privacy.contactSection.title',
    blocks: [{ kind: 'p', key: 'legal.privacy.contactSection.body' }, { kind: 'entity' }, { kind: 'phone' }],
  },
];
