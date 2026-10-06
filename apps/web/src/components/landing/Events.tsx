import { makeT, type Locale } from '@touch/i18n';
import { CourtPattern } from '@/components/site/brand/CourtPattern';
import { WhatsAppButton } from '@/components/site/ContactButton';
import { whatsappUrl } from '@/lib/site/contact';
import {
  branchOf,
  feeLine,
  formatLine,
  localText,
  placesLine,
  registrationOpen,
  tournamentName,
  tournamentPath,
  tournamentWhen,
  upcomingTournaments,
  type PublicTournaments,
  type TournamentsRead,
} from '@/lib/tournaments';
import { EventsTicket } from './EventsTicket';
import { Photo } from './Photo';

/** How many tournaments the landing lists (T-8): the next few, not a calendar. */
const CARDS = 3;

type Crop = readonly [x: number, y: number, w: number, h: number];

/**
 * The poster's crops of the pattern, in panel units, one per layout and language (the
 * Arabic words stand taller, so the poster block is taller): `slice` keeps each crop's
 * centre and covers the block, so across a layout's widths the window only grows or
 * shrinks around it. Each was searched band by band against the rendered words (fix pass
 * 2026-09-24; phones, tablets, 960–1279 and 1280 up) so that no band crosses the green
 * SMASH line, while bands still cross the white words and the photo.
 */
const EVENTS_CROPS: Record<Locale, readonly { key: string; band: number; crop: Crop }[]> = {
  en: [
    { key: 'tall', band: 3.45, crop: [105, 144, 56, 97.9] },
    { key: 'mid', band: 2.53, crop: [63, 180, 76, 101.3] },
    { key: 'wide', band: 3.62, crop: [66, 174, 116, 70.3] },
    { key: 'xwide', band: 3.31, crop: [90, 45, 140, 77.6] },
  ],
  ar: [
    { key: 'tall', band: 3.94, crop: [102, 42, 64, 145.1] },
    { key: 'mid', band: 2.93, crop: [87, 42, 88, 144] },
    { key: 'wide', band: 5.62, crop: [54, 195, 180, 147.6] },
    { key: 'xwide', band: 3.02, crop: [99, 150, 128, 90.9] },
  ],
};

/**
 * The letters' knockout, one filter per type step (styles/site/events.css.ts picks one
 * per breakpoint): each glyph's own alpha dilated by the radius, which is black because
 * SourceAlpha carries no colour, and the poster ground IS black (`--tp-site-poster`,
 * #000000 in both modes), laid under the glyph. Straight edges, no mitre spikes.
 */
const KNOCKOUT_RADII = [
  ['tp-knockout-s', 8],
  ['tp-knockout-m', 11],
  ['tp-knockout-l', 16],
] as const;

/**
 * Events: the deck's PLAY / SMASH / WIN poster (full-brand2.pdf p13) as the club's
 * tournaments. The poster is a full-bleed block of the poster black: the three words
 * stacked, SMASH in green, a photo of players at the inline end, and the court-line
 * bands in full Padel Green running across the whole block and off all four of its edges
 * (brand §5.1: the crop does the framing). As in the deck, the bands cross behind the
 * white words and the athletes and leave the green word clear, and every letter still
 * carries a round ring of the black (a knockout), so wherever a band meets a glyph the
 * edge is clean. No band ever reads as olive.
 *
 * Under the poster, on the page's own band ground, the announcement itself: tournaments
 * are on, and an entry pass to fill in (EventsTicket). The visitor writes their name on
 * the stub, "Join a tournament" tears it off and then opens WhatsApp with the name in the
 * message. (It used to share the poster's black, and the bands had to stop short of it
 * along a flat line in open black.) Screen readers hear "Play. Smash. Win." once; the
 * giant words are its picture.
 *
 * Once a branch has tournaments on and one is coming up (`tournaments.status === 'ok'`, the
 * `tournaments`-tagged `tournaments_public` read; T-8, build contracts §1.11), the next three
 * sit under the green ticket as cards: when (in the branch's timezone), the name, the format and
 * category, the fee, the places left, "Register in the app" while registration is open, and
 * "Details" to the tournament's `/{locale}/events/<id>` page. Any other state (off, none coming
 * up, a failed read) leaves the section exactly as it was.
 */
export function Events({
  locale,
  phone,
  tournaments,
}: {
  locale: Locale;
  phone: string | null;
  tournaments: TournamentsRead;
}) {
  const tr = makeT(locale);
  const list = tournaments.status === 'ok' ? tournaments.tournaments : null;
  return (
    <section id="events" className="tp-events" aria-labelledby="events-title">
      <div className="tp-events__stage tp-on-dark">
        <svg className="tp-events__defs" width="0" height="0" aria-hidden="true" focusable="false">
          <defs>
            {KNOCKOUT_RADII.map(([id, radius]) => (
              <filter key={id} id={id} x="-15%" y="-30%" width="130%" height="160%">
                <feMorphology in="SourceAlpha" operator="dilate" radius={radius} result="ring" />
                <feMerge>
                  <feMergeNode in="ring" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            ))}
          </defs>
        </svg>
        {EVENTS_CROPS[locale].map(({ key, band, crop }) => (
          <CourtPattern
            key={key}
            band={band}
            crop={crop}
            className={`tp-events__pattern tp-events__pattern--${key}`}
          />
        ))}
        <div className="tp-events__poster">
          <Photo
            name="events"
            alt={tr('site.photos.eventsAlt')}
            sizes="(min-width: 60rem) 34vw, 88vw"
            className="tp-events__photo"
          />
          <p className="tp-events__words" data-reveal="">
            <span className="tp-site-sr">{tr('site.events.label')}</span>
            <span className="tp-events__word tp-events__word--play" aria-hidden="true">
              {tr('site.events.play')}
            </span>
            <span className="tp-events__word tp-events__word--hit" aria-hidden="true">
              {tr('site.events.smash')}
            </span>
            <span className="tp-events__word tp-events__word--win" aria-hidden="true">
              {tr('site.events.win')}
            </span>
          </p>
        </div>
      </div>
      <div className="tp-events__note">
        <div className="tp-events__intro" data-reveal="">
          <p className="tp-events__eyebrow">{tr('site.events.eyebrow')}</p>
          <h2 id="events-title" className="tp-events__title">
            {tr('site.events.title')}
          </h2>
        </div>
        <EventsTicket
          phone={phone}
          href={whatsappUrl(phone, tr('site.whatsapp.events'))}
          namedMessage={tr('site.whatsapp.eventsNamed')}
          text={{
            brand: tr('site.events.ticket.brand'),
            admit: tr('site.events.ticket.admit'),
            titleOne: tr('site.events.ticket.titleOne'),
            titleTwo: tr('site.events.ticket.titleTwo'),
            player1: tr('site.events.ticket.player1'),
            player2: tr('site.events.ticket.player2'),
            you: tr('site.events.ticket.you'),
            rival: tr('site.events.ticket.rival'),
            category: tr('site.events.ticket.category'),
            level: tr('site.events.ticket.level'),
            venue: tr('site.events.ticket.venue'),
            venueName: tr('site.events.ticket.venueName'),
            nameLabel: tr('site.events.ticket.nameLabel'),
            namePlaceholder: tr('site.events.ticket.namePlaceholder'),
            nameHint: tr('site.events.ticket.nameHint'),
            nameLocked: tr('site.events.ticket.nameLocked'),
            tear: tr('site.events.ticket.tear'),
            cta: tr('site.events.cta'),
            cue: tr('site.onWhatsApp'),
          }}
          fallback={
            <WhatsAppButton
              locale={locale}
              phone={phone}
              message={tr('site.whatsapp.events')}
              label={tr('site.events.cta')}
              cue={tr('site.onWhatsApp')}
              onHome
              className="tp-site-btn tp-ticket__go"
            />
          }
        />
        <p className="tp-events__body" data-reveal="">
          {tr('site.events.body')}
        </p>
      </div>
      {list ? <EventsCards locale={locale} list={list} /> : null}
    </section>
  );
}

/** The next tournaments, as cards under the green ticket (no names, no court: §1.8). */
function EventsCards({ locale, list }: { locale: Locale; list: PublicTournaments }) {
  const tr = makeT(locale);
  const cards = upcomingTournaments(list).slice(0, CARDS);
  const manyBranches = list.branches.length > 1;
  return (
    <div className="tp-events__cards" data-reveal="">
      <h2 id="events-cards-title" className="tp-events__cards-title">
        {tr('tournaments.web.eventsCards.title')}
      </h2>
      <ul className="tp-tour-cards" aria-labelledby="events-cards-title">
        {cards.map((card) => {
          const branch = branchOf(list, card.venue_id);
          const when = tournamentWhen(card, branch?.timezone ?? '', locale);
          const what = formatLine(card, locale);
          return (
            <li key={card.id} className="tp-tour-card" data-tournament={card.id}>
              {when ? <p className="tp-tour-card__when tp-num">{when}</p> : null}
              <h3 className="tp-tour-card__name">{tournamentName(card, locale)}</h3>
              <p className="tp-tour-card__what">
                {manyBranches && branch
                  ? `${what} · ${localText(locale, branch.name_en, branch.name_ar)}`
                  : what}
              </p>
              <p className="tp-tour-card__fee tp-num">{feeLine(card.entry_fee_iqd, locale)}</p>
              <p className="tp-tour-card__places tp-num" data-status={card.status}>
                {placesLine(card, locale)}
              </p>
              <div className="tp-tour-card__ctas">
                {registrationOpen(card, list.server_now) ? (
                  <a
                    className="tp-site-btn tp-site-btn--primary tp-site-btn--sm"
                    href={`/${locale}#app`}
                  >
                    {tr('tournaments.web.eventsCards.registerInApp')}
                  </a>
                ) : null}
                <a
                  className="tp-site-btn tp-site-btn--ghost tp-site-btn--sm"
                  href={tournamentPath(locale, card.id)}
                >
                  {tr('tournaments.web.eventsCards.details')}
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
