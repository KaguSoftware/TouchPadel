import type { ReactNode } from 'react';
import {
  isolate,
  isolateLtr,
  makeT,
  type Locale,
  type MessageKey,
  type TParams,
} from '@touch/i18n';
import type { VenueOpeningHours } from '@/lib/menu';
import { DAY_LABEL, weekHours } from '@/lib/cafe/hours';
import { hrefForLocale, otherLocale } from '@/lib/locales';
import { displayPhone, telUrl } from '@/lib/site/contact';
import { formatWindows } from '@/lib/site/hours';
import { hoursPhrase } from '@/lib/site/plural';
import { TitleSquiggle } from '@/components/site/brand/TitleSquiggle';

/**
 * Shared document for the public legal pages (/privacy, /terms, /support,
 * /delete-account) — the App Store Connect Privacy Policy URL and Support URL,
 * and the Google Play account-deletion URL. A Server Component: the stores fetch
 * these, so every word has to be in the server-rendered HTML.
 *
 * Since 2026-09-23 it renders INSIDE the site's `SiteShell` (header, footer, night or
 * light mode) as an `<article>` in the shell's `<main>`, styled by the site family
 * (src/styles/site/legal.css.ts). Its related-pages nav stays inside the document, so
 * the page-to-page links the stores and the tests rely on are unchanged.
 *
 * Content is data: each page passes an ordered list of sections whose blocks
 * point at catalog keys (@touch/i18n `legal.*`). Nothing venue-specific is
 * typed here — the phone and hours come from venue_settings_public, and the
 * operating company's details from `legal.entity.*`, which every lookup
 * receives as {company}, {tradingName}, {registration}, {address}, {email},
 * {city} and {minPlayAge}.
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
  /** Interactive content rendered after the blocks (the delete-account form). */
  extra?: ReactNode;
}

const NAV_PAGES: [LegalPageName, MessageKey][] = [
  ['privacy', 'legal.nav.privacy'],
  ['terms', 'legal.nav.terms'],
  ['support', 'legal.nav.support'],
  ['delete-account', 'legal.nav.deleteAccount'],
];

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

function pageHref(locale: Locale, page: LegalPageName): string {
  return `/${locale}/${page}`;
}

function LegalNav({ locale, current }: { locale: Locale; current: LegalPageName }) {
  const tr = makeT(locale);
  const other = otherLocale(locale);
  return (
    <nav className="tp-legal__nav" aria-label={tr('legal.nav.label')}>
      {NAV_PAGES.map(([page, label]) => (
        <a
          key={page}
          href={pageHref(locale, page)}
          aria-current={page === current ? 'page' : undefined}
        >
          {tr(label)}
        </a>
      ))}
      <a href={hrefForLocale(pageHref(locale, current), '', other)} lang={other} hrefLang={other}>
        {tr('legal.nav.otherLanguage')}
      </a>
    </nav>
  );
}

function VenuePhone({ locale, venue }: { locale: Locale; venue: VenueOpeningHours | null }) {
  const tr = makeT(locale);
  // The site's one phone helper (lib/site/contact.ts), so this page and the footer under
  // it print and dial the same number the same way. Undialable is treated as unset.
  const phone = displayPhone(venue?.phone);
  const tel = telUrl(venue?.phone);
  if (!phone || !tel) return <p>{tr('legal.contact.noPhone')}</p>;
  return (
    <p>
      {tr('legal.contact.phoneLead')}{' '}
      {/* dir="ltr": an Iraqi number inside Arabic text otherwise puts its + at the wrong end. */}
      <a className="tp-legal__phone" href={tel} dir="ltr">
        {phone}
      </a>
    </p>
  );
}

function VenueHours({ locale, venue }: { locale: Locale; venue: VenueOpeningHours | null }) {
  if (!venue) return null;
  const week = weekHours(venue);
  // A venue with no windows at all has not published hours — "Closed" seven
  // times would be a false statement, so say nothing.
  if (week.every(({ windows }) => windows.length === 0)) return null;
  const tr = makeT(locale);
  return (
    <>
      <h3 className="tp-legal__subtitle">{tr('legal.contact.hours')}</h3>
      <dl className="tp-hours tp-legal__hours">
        {week.map(({ dayKey, windows }) => (
          <div key={dayKey} style={{ display: 'contents' }}>
            <dt>{tr(DAY_LABEL[dayKey])}</dt>
            <dd>
              {windows.length === 0 ? tr('cafe.footer.closed') : formatWindows(windows, locale)}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** Company email and address. The email is only a link once it is a real address. */
function EntityContact({ locale }: { locale: Locale }) {
  const tr = makeT(locale);
  const email = tr('legal.entity.email');
  return (
    <>
      <p>
        {tr('legal.contact.emailLead')}{' '}
        {isPlaceholder(email) ? (
          email
        ) : (
          <a className="tp-legal__email" href={`mailto:${email}`} dir="ltr">
            {email}
          </a>
        )}
      </p>
      <p>
        {tr('legal.contact.addressLead')} {tr('legal.entity.address')}
      </p>
    </>
  );
}

function renderBlock(
  block: LegalBlock,
  index: number,
  locale: Locale,
  venue: VenueOpeningHours | null,
  params: TParams,
): ReactNode {
  const tr = makeT(locale);
  switch (block.kind) {
    case 'p':
      return <p key={index}>{tr(block.key, params)}</p>;
    case 'list':
      return (
        <ul key={index}>
          {block.items.map((item) =>
            typeof item === 'string' ? (
              <li key={item}>{tr(item, params)}</li>
            ) : (
              <li key={item.text}>
                <strong>{tr(item.lead, params)}</strong> {tr(item.text, params)}
              </li>
            ),
          )}
        </ul>
      );
    case 'phone':
      return <VenuePhone key={index} locale={locale} venue={venue} />;
    case 'hours':
      return <VenueHours key={index} locale={locale} venue={venue} />;
    case 'entity':
      return <EntityContact key={index} locale={locale} />;
    case 'link':
      return (
        <p key={index}>
          <a href={`${pageHref(locale, block.to)}${block.hash ? `#${block.hash}` : ''}`}>
            {tr(block.label)}
          </a>
        </p>
      );
  }
}

export function LegalDocument({
  locale,
  page,
  title,
  intro,
  sections,
  venue,
  version,
}: {
  locale: Locale;
  page: LegalPageName;
  title: MessageKey;
  intro: MessageKey;
  sections: LegalSection[];
  venue: VenueOpeningHours | null;
  /** The Terms/Privacy version a guest accepts in the app (CURRENT_TERMS_VERSION). */
  version?: string;
}) {
  const tr = makeT(locale);
  // {cancelHours} is the window app.cancel_reservation enforces, read live so
  // the terms never contradict the app; 4 is what 0056 configured, the
  // fallback when the venue read fails. It is a whole counted phrase ("4 hours",
  // «12 ساعة», «ساعتين»), because Arabic picks the noun's form by the number and
  // the operator can set any number (lib/site/plural.ts).
  const params: TParams = {
    ...entityParams(locale),
    cancelHours: hoursPhrase(venue?.cancellation_window_hours ?? 4, locale),
  };
  return (
    <article className="tp-legal">
      <header className="tp-legal__header">
        <LegalNav locale={locale} current={page} />
        <p className="tp-legal__eyebrow">{tr('common.appName')}</p>
        <h1 className="tp-legal__title">{tr(title)}</h1>
        <TitleSquiggle className="tp-legal__squiggle" />
        <p className="tp-legal__updated">
          <span>{tr('legal.lastUpdated')}</span>
          {version ? (
            <>
              {' · '}
              <span>{tr('legal.version', { version: isolateLtr(version) })}</span>
            </>
          ) : null}
        </p>
        <p className="tp-legal__intro">{tr(intro, params)}</p>
      </header>

      {sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          className="tp-legal__section"
          aria-labelledby={`${section.id}-title`}
        >
          <h2 id={`${section.id}-title`} className="tp-legal__heading">
            {tr(section.title, params)}
          </h2>
          {section.blocks.map((block, i) => renderBlock(block, i, locale, venue, params))}
          {section.extra}
        </section>
      ))}
    </article>
  );
}
