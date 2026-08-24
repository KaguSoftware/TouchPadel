import Image from 'next/image';
import Link from 'next/link';
import { makeT } from '@touch/i18n';
import { asLocale } from '@/lib/locales';
import { createStaticSupabase } from '@/lib/supabase/static';
import { fetchVenuePublic } from '@/lib/menu';

// Venue landing — hero, opening hours (venue_settings_public), contact
// placeholders (FIXTURE until Touch supplies real details), store badges.
// ISR: hours change rarely; 5 minutes is plenty.
export const revalidate = 300;

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export default async function VenuePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  const tr = makeT(locale);

  let venue = null;
  try {
    venue = await fetchVenuePublic(createStaticSupabase());
  } catch {
    // Landing must render even if Supabase is unreachable — hours simply hide.
  }

  return (
    <main>
      <section className="tp-hero">
        <Image
          src="/brand/touch_padel_logo_transparent.png"
          alt={tr('common.appName')}
          width={512}
          height={512}
          className="tp-hero__logo"
          priority
        />
        <h1>{tr('landing.heroTagline')}</h1>
        <p>{tr('landing.heroSub')}</p>
        <div className="tp-hero__cta">
          <Link className="tp-btn tp-btn--primary" href={`/${locale}/menu`}>
            {tr('landing.viewMenu')}
          </Link>
          <a className="tp-btn tp-btn--ghost" href="#get-the-app">
            {tr('landing.bookInApp')}
          </a>
        </div>
      </section>

      {venue && (
        <section className="tp-section">
          <h2>{tr('landing.openingHours')}</h2>
          <div className="tp-card">
            <dl className="tp-hours">
              {DAY_KEYS.map((day) => {
                const ranges = venue.opening_hours[day] ?? [];
                return (
                  <FragmentRow
                    key={day}
                    label={tr(`landing.days.${day}`)}
                    value={
                      ranges.length === 0
                        ? tr('landing.closed')
                        : ranges.map(([from, to]) => `${from}–${to}`).join(' · ')
                    }
                  />
                );
              })}
            </dl>
          </div>
        </section>
      )}

      <section className="tp-section">
        <h2>{tr('landing.visitUs')}</h2>
        <div className="tp-card">
          {/* FIXTURE: address/phone/map arrive with the week-1 client pack. */}
          <p className="tp-fixture">{tr('landing.addressPlaceholder')}</p>
          <p className="tp-fixture" dir="ltr" style={{ textAlign: 'start' }}>
            {tr('landing.phonePlaceholder')}
          </p>
          <p style={{ marginBlockStart: '0.5rem' }}>
            <a className="tp-btn tp-btn--ghost" href="#" aria-disabled="true">
              {tr('landing.mapLink')}
            </a>
          </p>
        </div>
      </section>

      <section className="tp-section" id="get-the-app">
        <h2>{tr('landing.getTheApp')}</h2>
        <div className="tp-card">
          <p style={{ marginBlockEnd: '0.75rem' }}>{tr('landing.storeBadgeSoon')}</p>
          <div className="tp-badges">
            {/* Placeholder store links — swapped for real store URLs at submission (W4). */}
            <a className="tp-badge" href="#" aria-disabled="true">
               {tr('landing.appStore')}
            </a>
            <a className="tp-badge" href="#" aria-disabled="true">
              ▷ {tr('landing.googlePlay')}
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
