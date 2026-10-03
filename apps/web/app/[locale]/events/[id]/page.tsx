import type { Metadata, Viewport } from 'next';
import { isolateLtr, makeT, type Locale } from '@touch/i18n';
import { otherLocale, requireLocale } from '@/lib/locales';
import { getCachedTournament } from '@/lib/tournaments.server';
import {
  appTournamentHref,
  feeLine,
  formatLine,
  localText,
  parseTournamentId,
  placesLine,
  playerLabel,
  registrationOpen,
  signedDiff,
  teamLabel,
  tournamentName,
  tournamentPath,
  tournamentPrize,
  tournamentWhen,
  type PublicTournament,
  type TournamentPageRead,
  type TourPublicRound,
  type TourPublicStanding,
} from '@/lib/tournaments';
import { getRequestNonce, getSiteMode } from '@/lib/site/mode.server';
import { SITE_THEME_COLOR } from '@/lib/site/themeColor';
import { siteOgImage } from '@/lib/site/ogImage';
import { siteTokensBridgeCss } from '@/styles/site/tokens-bridge.css';
import { siteTournamentPageCss } from '@/styles/site/tournamentPage.css';
import { BrandLockup } from '@/components/site/brand/BrandLockup';
import { RefreshWhileRunning } from '@/components/tournaments/RefreshWhileRunning';

/**
 * `/{locale}/events/<tournamentId>`: a tournament's public page (T-8; build contracts §1.6,
 * §1.8, §1.11). The landing's event cards link here, and the club shares it on WhatsApp: when and
 * where, the format, the fee and the places, then the schedule round by round and the standings
 * once play starts. It never registers anyone: "Register in the app" (while registration is open)
 * or "Open in the app" carries `touchpadel://tournament/<id>`, and "Don't have the app?" goes to
 * the home page's app band. No automatic jump to the app (an unprompted scheme jump strands Safari
 * on an error page when the app is absent).
 *
 * Built like the coach link (`c/[id]/page.tsx`): the lockup bar, a plain language link (no cookie
 * is set here), its own small sheet. The read is `app.tournament_public`, cached per id for 30 s
 * (`tournaments.server.ts`); while the tournament is in play the page refreshes itself every 30 s
 * (`RefreshWhileRunning`), so a score shows within a minute. Players are "First I." only, a
 * deleted account "Former player", a desk-added profile without accepted terms "Player <no>";
 * names only once a schedule exists, never the waitlist (§1.8, the server's rule), never a phone,
 * guest id or court id (courts are "Court 1, 2…" in the tournament's own order).
 *
 * An id that is no uuid, an unknown tournament, a branch switched off or closed, and one cancelled
 * more than 7 days ago all read the same "not available", so the page never says which; one
 * cancelled within the week shows its name and a cancelled notice. A failed read says so.
 *
 * Never indexed and not followed (the names are on it), no referrer (the address names the
 * tournament), the site's share image. Not in sitemap.ts; not disallowed in robots.ts either,
 * since a crawler has to fetch the page to read its `noindex`. A locale-less `/events/<id>` gets
 * the proxy's 307. Rendered per request (C11: no ISR claim).
 */
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; id: string }>;

/** The tournament, read only for an id that is one (the server is never asked about anything else). */
async function readTournament(id: string | null): Promise<TournamentPageRead> {
  if (!id) return { status: 'missing', tournament: null };
  return getCachedTournament(id);
}

export async function generateViewport(): Promise<Viewport> {
  return { themeColor: SITE_THEME_COLOR[await getSiteMode()] };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const segments = await params;
  const locale = requireLocale(segments.locale);
  const tr = makeT(locale);
  const read = await readTournament(parseTournamentId(segments.id));
  // "Friday Americano · Touch Padel" (the layout's title template); "Tournament" otherwise.
  const title = read.tournament
    ? tournamentName(read.tournament, locale)
    : tr('tournaments.web.page.title');
  const description = tr('tournaments.web.page.metaDescription');
  const siteName = tr('seo.siteTitle');
  const image = siteOgImage(locale);
  return {
    title,
    description,
    robots: { index: false, follow: false },
    // The address names the tournament; nothing on this page needs to pass it on.
    referrer: 'no-referrer',
    // Replaced whole (the layout's would otherwise describe the landing page).
    openGraph: {
      title: `${title} · ${siteName}`,
      description,
      type: 'website',
      locale: locale === 'ar' ? 'ar_IQ' : 'en_US',
      siteName,
      images: [{ url: image, width: 1200, height: 630, alt: tr('site.seo.ogAlt') }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} · ${siteName}`,
      description,
      images: [image],
    },
  };
}

/** A list of players as one line, in the page's language. */
function namesLine(names: string[], locale: Locale): string {
  return names.join(locale === 'ar' ? '، ' : ', ');
}

function Schedule({ locale, rounds }: { locale: Locale; rounds: TourPublicRound[] }) {
  const tr = makeT(locale);
  return (
    <section className="tp-tpage__section" aria-labelledby="tpage-schedule">
      <h2 id="tpage-schedule" className="tp-tpage__h2">
        {tr('tournaments.web.page.schedule')}
      </h2>
      {rounds.length === 0 ? (
        <p className="tp-tpage__empty">{tr('tournaments.web.page.noSchedule')}</p>
      ) : (
        <ol className="tp-tpage__rounds">
          {rounds.map((round) => (
            <li key={round.round_no} className="tp-tpage__round" data-round={round.round_no}>
              <h3 className="tp-tpage__round-title">
                {tr('tournaments.common.round', { round: isolateLtr(String(round.round_no)) })}
              </h3>
              <ul>
                {round.matches.map((match) => {
                  const played = match.points_a !== null && match.points_b !== null;
                  return (
                    <li key={match.court_no} className="tp-tpage__match">
                      <span className="tp-tpage__court">
                        {tr('tournaments.web.page.court', {
                          court: isolateLtr(String(match.court_no)),
                        })}
                      </span>
                      <span className="tp-tpage__team tp-tpage__team--a">
                        {teamLabel(match.a, locale)}
                      </span>
                      <span className="tp-tpage__team tp-tpage__team--b">
                        <span className="tp-tpage__vs">{tr('tournaments.web.page.vs')} </span>
                        {teamLabel(match.b, locale)}
                      </span>
                      <span className="tp-tpage__score tp-num" data-played={String(played)}>
                        {played
                          ? isolateLtr(`${match.points_a}–${match.points_b}`)
                          : tr('tournaments.web.page.notPlayed')}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {round.sit_out.length > 0 ? (
                <p className="tp-tpage__sitout">
                  {tr('tournaments.web.page.sitOut', {
                    players: namesLine(
                      round.sit_out.map((p) => playerLabel(p, locale)),
                      locale,
                    ),
                  })}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Standings({ locale, standings }: { locale: Locale; standings: TourPublicStanding[] }) {
  const tr = makeT(locale);
  return (
    <section className="tp-tpage__section" aria-labelledby="tpage-standings">
      <h2 id="tpage-standings" className="tp-tpage__h2">
        {tr('tournaments.web.page.standings')}
      </h2>
      <div className="tp-tpage__table-box">
        <table className="tp-tpage__table" aria-labelledby="tpage-standings">
          <thead>
            <tr>
              <th scope="col">{tr('tournaments.web.page.col.rank')}</th>
              <th scope="col">{tr('tournaments.web.page.col.player')}</th>
              <th scope="col" className="tp-tpage__num">
                {tr('tournaments.web.page.col.points')}
              </th>
              <th scope="col" className="tp-tpage__num">
                {tr('tournaments.web.page.col.diff')}
              </th>
              <th scope="col" className="tp-tpage__num">
                {tr('tournaments.web.page.col.played')}
              </th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, i) => (
              <tr key={`${row.rank}-${i}`} className="tp-tpage__standing">
                <td className="tp-tpage__rank tp-num">{isolateLtr(String(row.rank))}</td>
                <td>{playerLabel(row.player, locale)}</td>
                <td className="tp-tpage__num tp-num">{isolateLtr(String(row.points_won))}</td>
                <td className="tp-tpage__num tp-num">{signedDiff(row.diff)}</td>
                <td className="tp-tpage__num tp-num">{isolateLtr(String(row.played))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The tournament: what, when, where, the facts, the app, the schedule and the standings. */
function TournamentView({ locale, t: tour }: { locale: Locale; t: PublicTournament }) {
  const tr = makeT(locale);
  const cancelled = tour.status === 'cancelled';
  const when = tournamentWhen(tour, tour.branch?.timezone ?? '', locale);
  const prize = tournamentPrize(tour, locale);
  const facts: [string, string][] = [
    [tr('tournaments.common.entryFee'), feeLine(tour.entry_fee_iqd, locale)],
  ];
  if (tour.points_target) {
    facts.push([
      tr('tournaments.web.page.scoring'),
      tr('tournaments.common.pointsTarget', { points: isolateLtr(String(tour.points_target)) }),
    ]);
  }
  if (!cancelled) facts.push([tr('tournaments.web.page.places'), placesLine(tour, locale)]);
  if (prize) facts.push([tr('tournaments.common.prize'), prize]);
  return (
    <>
      <div className="tp-tpage__head">
        <p className="tp-tpage__eyebrow">{formatLine(tour, locale)}</p>
        <h1 className="tp-tpage__title">{tournamentName(tour, locale)}</h1>
        {tour.branch ? (
          <p className="tp-tpage__at">
            {localText(locale, tour.branch.name_en, tour.branch.name_ar)}
          </p>
        ) : null}
        {when ? <p className="tp-tpage__when tp-num">{when}</p> : null}
      </div>
      {cancelled ? (
        <p className="tp-tpage__notice" role="status">
          {tr('tournaments.web.page.cancelled')}
        </p>
      ) : null}
      <dl className="tp-tpage__facts">
        {facts.map(([label, value]) => (
          <div key={label} className="tp-tpage__fact">
            <dt>{label}</dt>
            <dd className="tp-num">{value}</dd>
          </div>
        ))}
      </dl>
      {tour.entries_count > 0 && !cancelled ? (
        <p className="tp-tpage__entries tp-num">
          {tr('tournaments.web.page.entries', { count: isolateLtr(String(tour.entries_count)) })}
        </p>
      ) : null}
      {cancelled ? null : (
        <div className="tp-tpage__ctas">
          <a className="tp-tpage__open" href={appTournamentHref(tour.id)}>
            {registrationOpen(tour, tour.server_now)
              ? tr('tournaments.web.page.registerInApp')
              : tr('tournaments.web.page.openInApp')}
          </a>
          <a className="tp-tpage__get" href={`/${locale}#app`}>
            {tr('tournaments.web.page.noApp')}
          </a>
        </div>
      )}
      {tour.status === 'running' ? (
        <>
          <p className="tp-tpage__live">{tr('tournaments.web.page.live')}</p>
          <RefreshWhileRunning />
        </>
      ) : null}
      {cancelled ? null : <Schedule locale={locale} rounds={tour.rounds} />}
      {tour.standings.length > 0 ? <Standings locale={locale} standings={tour.standings} /> : null}
    </>
  );
}

export default async function TournamentPage({ params }: { params: Params }) {
  const segments = await params;
  const locale = requireLocale(segments.locale);
  const id = parseTournamentId(segments.id);
  const [read, mode, nonce] = await Promise.all([
    readTournament(id),
    getSiteMode(),
    getRequestNonce(),
  ]);
  const tr = makeT(locale);
  const other = otherLocale(locale);
  const tour = read.status === 'ok' ? read.tournament : null;

  return (
    <div
      className="tp-site tp-tpage"
      data-theme="padel"
      data-mode={mode}
      data-state={read.status}
      data-status={tour?.status}
    >
      <style
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: `${siteTokensBridgeCss}\n${siteTournamentPageCss}` }}
      />
      <header className="tp-tpage__bar">
        <a className="tp-tpage__home" href={`/${locale}`} aria-label={tr('site.brandHome')}>
          <BrandLockup />
        </a>
        {/* A plain link, not the site's LanguageLink: that one remembers the choice in a
            cookie, and this page sets none. Same accessible name, visible word first. */}
        <a
          className="tp-tpage__lang"
          href={id ? tournamentPath(other, id) : `/${other}#events`}
          hrefLang={other}
        >
          <span lang={other}>{tr('site.nav.language')}</span>
          <span className="tp-tpage__sr"> ({tr('site.nav.languageLabel')})</span>
        </a>
      </header>
      <main className="tp-tpage__main">
        {tour ? (
          <TournamentView locale={locale} t={tour} />
        ) : (
          <div className="tp-tpage__head">
            <p className="tp-tpage__eyebrow">{tr('tournaments.web.page.title')}</p>
            <h1 className="tp-tpage__title">
              {read.status === 'error'
                ? tr('tournaments.web.page.error')
                : tr('tournaments.web.page.missing')}
            </h1>
          </div>
        )}
        <a className="tp-tpage__all" href={`/${locale}#events`}>
          {tr('tournaments.web.page.allEvents')}
        </a>
      </main>
      <footer className="tp-tpage__foot">
        <a href={`/${locale}/support`}>{tr('site.footer.support')}</a>
      </footer>
    </div>
  );
}
