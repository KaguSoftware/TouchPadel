import type { ReactNode } from 'react';
import { isolate, makeT, type Locale, type MessageKey } from '@touch/i18n';
import type { VenueOpeningHours } from '@/lib/menu';
import { DAY_LABEL, weekHours } from '@/lib/cafe/hours';
import { hrefForLocale, otherLocale } from '@/lib/locales';

/**
 * Shared shell for the public legal pages (/privacy, /support) — the App Store
 * Connect Privacy Policy URL and Support URL. A Server Component: Apple fetches
 * these, so every word has to be in the server-rendered HTML.
 *
 * Content is data: each page passes an ordered list of sections whose blocks
 * point at catalog keys (@touch/i18n `legal.*`). Nothing venue-specific is
 * typed here — the phone and hours come from venue_settings_public.
 */
export type LegalPageName = 'privacy' | 'support';

export type LegalListItem = MessageKey | { lead: MessageKey; text: MessageKey };

export type LegalBlock =
  | { kind: 'p'; key: MessageKey }
  | { kind: 'list'; items: LegalListItem[] }
  /** The venue phone as a tel: link, or the front-desk fallback when unset. */
  | { kind: 'phone' }
  /** The week's opening hours; omitted when the venue has none published. */
  | { kind: 'hours' }
  | { kind: 'link'; to: LegalPageName; hash?: string; label: MessageKey };

export interface LegalSection {
  id: string;
  title: MessageKey;
  blocks: LegalBlock[];
}

function pageHref(locale: Locale, page: LegalPageName): string {
  return `/${locale}/${page}`;
}

function LegalNav({ locale, current }: { locale: Locale; current: LegalPageName }) {
  const tr = makeT(locale);
  const other = otherLocale(locale);
  const pages: [LegalPageName, MessageKey][] = [
    ['privacy', 'legal.nav.privacy'],
    ['support', 'legal.nav.support'],
  ];
  return (
    <nav className="tp-legal__nav" aria-label={tr('legal.nav.label')}>
      {pages.map(([page, label]) => (
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
  const phone = venue?.phone?.trim() ?? '';
  if (!phone) return <p>{tr('legal.contact.noPhone')}</p>;
  return (
    <p>
      {tr('legal.contact.phoneLead')}{' '}
      {/* dir="ltr": an Iraqi number inside Arabic text otherwise puts its + at the wrong end. */}
      <a className="tp-legal__phone" href={`tel:${phone.replace(/\s+/g, '')}`} dir="ltr">
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
              {windows.length === 0
                ? tr('cafe.footer.closed')
                : windows
                    .map(([from, to]) => `${isolate(from)}-${isolate(to)}`)
                    .join(locale === 'ar' ? '، ' : ', ')}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function renderBlock(
  block: LegalBlock,
  index: number,
  locale: Locale,
  venue: VenueOpeningHours | null,
): ReactNode {
  const tr = makeT(locale);
  switch (block.kind) {
    case 'p':
      return <p key={index}>{tr(block.key)}</p>;
    case 'list':
      return (
        <ul key={index}>
          {block.items.map((item) =>
            typeof item === 'string' ? (
              <li key={item}>{tr(item)}</li>
            ) : (
              <li key={item.text}>
                <strong>{tr(item.lead)}</strong> {tr(item.text)}
              </li>
            ),
          )}
        </ul>
      );
    case 'phone':
      return <VenuePhone key={index} locale={locale} venue={venue} />;
    case 'hours':
      return <VenueHours key={index} locale={locale} venue={venue} />;
    case 'link':
      return (
        <p key={index}>
          <a href={`${pageHref(locale, block.to)}${block.hash ? `#${block.hash}` : ''}`}>{tr(block.label)}</a>
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
}: {
  locale: Locale;
  page: LegalPageName;
  title: MessageKey;
  intro: MessageKey;
  sections: LegalSection[];
  venue: VenueOpeningHours | null;
}) {
  const tr = makeT(locale);
  return (
    <div className="tp-cafe" data-theme="cafe">
      <main className="tp-legal">
        <header className="tp-legal__header">
          <LegalNav locale={locale} current={page} />
          <p className="tp-eyebrow">{tr('common.appName')}</p>
          <h1 className="tp-legal__title">{tr(title)}</h1>
          <p className="tp-legal__updated">{tr('legal.lastUpdated')}</p>
          <p className="tp-legal__intro">{tr(intro)}</p>
        </header>

        {sections.map((section) => (
          <section key={section.id} id={section.id} className="tp-legal__section" aria-labelledby={`${section.id}-title`}>
            <h2 id={`${section.id}-title`} className="tp-legal__heading">
              {tr(section.title)}
            </h2>
            {section.blocks.map((block, i) => renderBlock(block, i, locale, venue))}
          </section>
        ))}
      </main>
    </div>
  );
}
