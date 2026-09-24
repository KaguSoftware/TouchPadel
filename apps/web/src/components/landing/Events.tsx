import { makeT, type Locale } from '@touch/i18n';
import { CourtPattern } from '@/components/site/brand/CourtPattern';
import { WhatsAppButton } from '@/components/site/ContactButton';
import { Photo } from './Photo';

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
 * "coming soon". The poster is a full-bleed block of the poster black: the three words
 * stacked, SMASH in green, a photo of players at the inline end, and the court-line
 * bands in full Padel Green running across the whole block and off all four of its edges
 * (brand §5.1: the crop does the framing). As in the deck, the bands cross behind the
 * white words and the athletes and leave the green word clear, and every letter still
 * carries a round ring of the black (a knockout), so wherever a band meets a glyph the
 * edge is clean. No band ever reads as olive.
 *
 * Under the poster, on the page's own band ground, the announcement itself: tournaments
 * and events are coming, and "Join the list" opens WhatsApp with the events message
 * pre-filled. (It used to share the poster's black, and the bands had to stop short of
 * it along a flat line in open black.) Screen readers hear "Play. Smash. Win." once; the
 * giant words are its picture.
 */
export function Events({ locale, phone }: { locale: Locale; phone: string | null }) {
  const tr = makeT(locale);
  return (
    <section className="tp-events" aria-labelledby="events-title">
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
            weight="poster"
            band={band}
            crop={crop}
            className={`tp-events__pattern tp-events__pattern--${key}`}
          />
        ))}
        <div className="tp-events__poster">
          <Photo
            name="events"
            alt={tr('site.photos.eventsAlt')}
            sizes="(min-width: 60rem) 34vw, 62vw"
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
      <div className="tp-events__note" data-reveal="">
        <p className="tp-events__soon">{tr('site.events.comingSoon')}</p>
        <h2 id="events-title" className="tp-events__title">
          {tr('site.events.title')}
        </h2>
        <p className="tp-events__body">{tr('site.events.body')}</p>
        <WhatsAppButton
          locale={locale}
          phone={phone}
          message={tr('site.whatsapp.events')}
          label={tr('site.events.cta')}
          cue={tr('site.onWhatsApp')}
          onHome
          className="tp-site-btn tp-site-btn--go tp-site-btn--lg"
        />
      </div>
    </section>
  );
}
