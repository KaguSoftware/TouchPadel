import type { Metadata, Viewport } from 'next';
import { formatIQD, isolateLtr, makeT, type Locale, type MessageKey } from '@touch/i18n';
import { requireLocale } from '@/lib/locales';
import { getCachedTournament } from '@/lib/tournaments.server';
import {
  appTournamentHref,
  categoryLine,
  localText,
  parseTournamentId,
  playerLabel,
  registrationOpen,
  signedDiff,
  teamLabel,
  tournamentName,
  tournamentPrize,
  tournamentClosing,
  tournamentSlot,
  type PublicTournament,
  type TournamentPageRead,
  type TourPublicRound,
  type TourPublicStanding,
} from '@/lib/tournaments';
import { getCachedVenue } from '@/lib/menu.server';
import { getRequestNonce, getSiteMode } from '@/lib/site/mode.server';
import { SITE_THEME_COLOR } from '@/lib/site/themeColor';
import { siteOgImage } from '@/lib/site/ogImage';
import { siteTournamentPageCss } from '@/styles/site/tournamentPage.css';
import { SiteShell } from '@/components/site/SiteShell';
import { RefreshWhileRunning } from '@/components/tournaments/RefreshWhileRunning';
import { TournamentTabs } from '@/components/tournaments/TournamentTabs';

/**
 * `/{locale}/events/<tournamentId>`: a tournament's public page (T-8; build contracts §1.6,
 * §1.8, §1.11). The landing's event cards link here, and the club shares it on WhatsApp: when and
 * where, the format, the fee and the places, then the schedule round by round and the standings
 * once play starts. It never registers anyone: "Register in the app" (while registration is open)
 * or "Open in the app" carries `touchpadel://tournament/<id>`, and "Don't have the app?" goes to
 * the home page's app band. No automatic jump to the app (an unprompted scheme jump strands Safari
 * on an error page when the app is absent).
 *
 * Framed by `SiteShell` like the site's other pages (the header with its nav, the footer and the
 * theme), with the page's own small sheet beside the site's. The read is `app.tournament_public`, cached per id for 30 s
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

/** The rounds, a card each; a line saying why when there are none. */
function Schedule({
  locale,
  rounds,
  cancelled,
}: {
  locale: Locale;
  rounds: TourPublicRound[];
  cancelled: boolean;
}) {
  const tr = makeT(locale);
  return (
    <section className="tp-tpage__section" aria-label={tr('tournaments.web.page.schedule')}>
      {rounds.length === 0 ? (
        <p className="tp-tpage__empty">
          {tr(cancelled ? 'tournaments.web.page.notAvailable' : 'tournaments.web.page.noSchedule')}
        </p>
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

/** A column head: the short word on screen, the full word for a screen reader. */
function Head({ locale, short, full }: { locale: Locale; short: MessageKey; full: MessageKey }) {
  const tr = makeT(locale);
  return (
    <>
      <span aria-hidden="true">{tr(short)}</span>
      <span className="tp-tpage__sr">{tr(full)}</span>
    </>
  );
}

function Standings({
  locale,
  standings,
  cancelled,
}: {
  locale: Locale;
  standings: TourPublicStanding[];
  cancelled: boolean;
}) {
  const tr = makeT(locale);
  if (standings.length === 0) {
    return (
      <section className="tp-tpage__section" aria-label={tr('tournaments.web.page.standings')}>
        <p className="tp-tpage__empty">
          {tr(cancelled ? 'tournaments.web.page.notAvailable' : 'tournaments.web.page.noStandings')}
        </p>
      </section>
    );
  }
  return (
    <section className="tp-tpage__section" aria-label={tr('tournaments.web.page.standings')}>
      <div className="tp-tpage__table-box">
        <table className="tp-tpage__table" aria-label={tr('tournaments.web.page.standings')}>
          <thead>
            <tr>
              <th scope="col">
                <Head
                  locale={locale}
                  short="tournaments.web.page.colShort.rank"
                  full="tournaments.web.page.col.rank"
                />
              </th>
              <th scope="col">{tr('tournaments.web.page.col.player')}</th>
              <th scope="col" className="tp-tpage__num">
                <Head
                  locale={locale}
                  short="tournaments.web.page.colShort.points"
                  full="tournaments.web.page.col.points"
                />
              </th>
              <th scope="col" className="tp-tpage__num">
                <Head
                  locale={locale}
                  short="tournaments.web.page.colShort.diff"
                  full="tournaments.web.page.col.diff"
                />
              </th>
              <th scope="col" className="tp-tpage__num">
                <Head
                  locale={locale}
                  short="tournaments.web.page.colShort.played"
                  full="tournaments.web.page.col.played"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, i) => (
              <tr key={`${row.rank}-${i}`} className="tp-tpage__standing">
                <td className="tp-tpage__rank tp-num">
                  <span className="tp-tpage__badge" data-first={String(row.rank === 1)}>
                    {isolateLtr(String(row.rank))}
                  </span>
                </td>
                <td>
                  {row.withdrawn
                    ? tr('tournaments.web.page.withdrawn', {
                        player: playerLabel(row.player, locale),
                      })
                    : playerLabel(row.player, locale)}
                </td>
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

/** One cell of the ticket: a small label over its value. */
function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="tp-tpage__cell">
      <dt>{label}</dt>
      <dd className="tp-num">{value}</dd>
    </div>
  );
}

/**
 * The tournament, laid out as the app's ticket (owner pick "D", 2026-11-01): on a wide screen the
 * ticket and the app buttons stay in a left column while standings and schedule sit in a
 * segmented switch on the right; on a phone it is one column, the ticket first, the switch next
 * and the buttons last. The buttons are written once, after the body, and the CSS grid moves
 * them under the ticket on a wide screen.
 */
function TournamentView({ locale, t: tour }: { locale: Locale; t: PublicTournament }) {
  const tr = makeT(locale);
  const cancelled = tour.status === 'cancelled';
  const open = tour.status === 'open';
  const slot = tournamentSlot(tour, tour.branch?.timezone ?? '', locale);
  const prize = tournamentPrize(tour, locale);
  const branchName = tour.branch ? localText(locale, tour.branch.name_en, tour.branch.name_ar) : '';
  const subtitle = [
    tr(`tournaments.common.format.${tour.format}`),
    tour.points_target
      ? tr('tournaments.common.pointsTarget', { points: isolateLtr(String(tour.points_target)) })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const closes =
    open && tour.registration_closes_at
      ? tournamentClosing(tour.registration_closes_at, tour.branch?.timezone ?? '', locale)
      : null;
  const fillPct =
    tour.max_entries > 0
      ? Math.min(100, Math.round((tour.entries_count / tour.max_entries) * 100))
      : 0;
  // Both segments are always there; one with nothing to show says why (not started, cancelled).
  const tabs = [
    {
      id: 'standings',
      label: tr('tournaments.web.page.standings'),
      content: <Standings locale={locale} standings={tour.standings} cancelled={cancelled} />,
    },
    {
      id: 'schedule',
      label: tr('tournaments.web.page.schedule'),
      content: <Schedule locale={locale} rounds={tour.rounds} cancelled={cancelled} />,
    },
  ];
  const initial = tour.standings.length === 0 && tour.rounds.length > 0 ? 'schedule' : 'standings';
  return (
    <>
      {cancelled ? (
        <p className="tp-tpage__notice" role="status">
          {tr('tournaments.web.page.cancelled')}
        </p>
      ) : null}
      <div className="tp-tpage__split">
        <div className="tp-tpage__side">
          <div className="tp-tpage__ticket">
            <div className="tp-tpage__ticket-head">
              <h1 className="tp-tpage__title">{tournamentName(tour, locale)}</h1>
              <p className="tp-tpage__sub">{subtitle}</p>
            </div>
            <div className="tp-tpage__ticket-top">
              <span className="tp-tpage__pill tp-tpage__pill--ghost">
                {categoryLine(tour, locale)}
              </span>
              <span className="tp-tpage__pill" data-status={tour.status}>
                {tr(`tournaments.common.status.${tour.status}`)}
              </span>
            </div>
            <dl className="tp-tpage__cells">
              {slot ? (
                <>
                  <Cell label={tr('tournaments.web.page.date')} value={slot.date} />
                  <Cell label={tr('tournaments.web.page.time')} value={slot.time} />
                </>
              ) : null}
              {branchName ? (
                <Cell label={tr('tournaments.web.page.branch')} value={branchName} />
              ) : null}
              {prize ? <Cell label={tr('tournaments.common.prize')} value={prize} /> : null}
            </dl>
            <dl className="tp-tpage__perf">
              <div>
                <dt>{tr('tournaments.common.entryFee')}</dt>
                <dd className="tp-num">
                  {tour.entry_fee_iqd > 0
                    ? formatIQD(tour.entry_fee_iqd, locale)
                    : tr('tournaments.common.free')}
                </dd>
              </div>
              {cancelled ? null : (
                <div className="tp-tpage__perf-end">
                  <dt>{tr('tournaments.web.page.players')}</dt>
                  <dd className="tp-num">
                    {isolateLtr(`${tour.entries_count}/${tour.max_entries}`)}
                  </dd>
                </div>
              )}
            </dl>
            {cancelled || tour.max_entries <= 0 ? null : (
              <div className="tp-tpage__fill">
                <div className="tp-tpage__meter" aria-hidden="true">
                  <i style={{ inlineSize: `${fillPct}%` }} />
                </div>
                {closes ? (
                  <p className="tp-tpage__fill-note tp-num">
                    {tr('tournaments.web.page.closes', { time: closes })}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </div>
        <div className="tp-tpage__body">
          <TournamentTabs tabs={tabs} initial={initial} label={tr('tournaments.web.page.title')} />
          {tour.status === 'running' ? (
            <>
              <p className="tp-tpage__live">{tr('tournaments.web.page.live')}</p>
              <RefreshWhileRunning />
            </>
          ) : null}
        </div>
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
      </div>
    </>
  );
}

export default async function TournamentPage({ params }: { params: Params }) {
  const segments = await params;
  const locale = requireLocale(segments.locale);
  const id = parseTournamentId(segments.id);
  const [read, venue, mode, nonce] = await Promise.all([
    readTournament(id),
    getCachedVenue(),
    getSiteMode(),
    getRequestNonce(),
  ]);
  const tr = makeT(locale);
  const tour = read.status === 'ok' ? read.tournament : null;

  // The site's own frame (header, footer, theme), as on every other page.
  return (
    <SiteShell
      locale={locale}
      mode={mode}
      nonce={nonce}
      venue={venue}
      path={id ? `/events/${id}` : null}
    >
      <style nonce={nonce} dangerouslySetInnerHTML={{ __html: siteTournamentPageCss }} />
      <div className="tp-tpage" data-state={read.status} data-status={tour?.status}>
        <div className="tp-tpage__main">
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
        </div>
      </div>
    </SiteShell>
  );
}
