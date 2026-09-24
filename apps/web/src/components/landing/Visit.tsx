import { makeT, type Locale } from '@touch/i18n';
import type { VenueOpeningHours } from '@/lib/menu';
import { displayPhone, instagramUrl, mapsUrl, telUrl, whatsappUrl } from '@/lib/site/contact';
import { BrandBall } from '@/components/site/brand/BrandLockup';
import { CourtPattern } from '@/components/site/brand/CourtPattern';
import { HoursList, hasPublishedHours } from '@/components/site/HoursList';
import { CallIcon, ChatIcon, ExternalIcon } from '@/components/site/icons';

/**
 * `#visit`, "FIND US / IN KARBALA." on a full-bleed Touch Blue block: the address the
 * owner gave (Durrat Karbala, Karbala) with "Open in Google Maps" (a link out, never an
 * iframe: the CSP has no frame-src; `NEXT_PUBLIC_MAPS_URL` when set, else a search), the
 * live hours, and how to reach the desk: WhatsApp, a call, or just walking in. Instagram
 * appears only when `NEXT_PUBLIC_INSTAGRAM_URL` holds a real profile link.
 *
 * With no usable venue phone the WhatsApp and call buttons are simply not drawn: this IS
 * the section every other button falls back to, and walking in still works. The call
 * button carries the number itself: on a computer a tel: link opens a dialler prompt at
 * best, so the number has to be readable where the button is.
 *
 * The picture at the inline end is the brand's court-line bands with the brand's ball
 * set on a crossing: "the ball marks the spot". Decorative, and not a map.
 */
export function Visit({ locale, venue }: { locale: Locale; venue: VenueOpeningHours | null }) {
  const tr = makeT(locale);
  const phone = venue?.phone ?? null;
  const chat = whatsappUrl(phone, tr('site.whatsapp.general'));
  const call = telUrl(phone);
  const number = displayPhone(phone);
  const instagram = instagramUrl();
  return (
    <section id="visit" className="tp-visit tp-on-blue" aria-labelledby="visit-title">
      <div className="tp-visit__art" aria-hidden="true">
        {/* The crop is centred on where bands 3 and 4 of the board cross, (133.8,
            129.6) in panel units, and `slice` keeps a crop's centre at the box's centre
            at any aspect: so the pin, centred in the box, always sits on the crossing. */}
        <CourtPattern weight="poster" band={10} crop={[33.8, 29.6, 200, 200]} />
        <span className="tp-visit__pin">
          <BrandBall />
        </span>
      </div>
      <div className="tp-visit__inner">
        <div className="tp-visit__head tp-fit" data-reveal="">
          <h2 id="visit-title" className="tp-display tp-display--section">
            <span className="tp-display__l1">{tr('site.visit.titleOne')}</span>{' '}
            <span className="tp-display__l2">{tr('site.visit.titleTwo')}</span>
          </h2>
        </div>
        <div className="tp-visit__facts" data-reveal="">
          <div className="tp-visit__block">
            <h3 className="tp-visit__label">{tr('site.visit.addressTitle')}</h3>
            <p className="tp-visit__address">{tr('site.visit.address')}</p>
            <a className="tp-site-btn tp-site-btn--primary" href={mapsUrl()}>
              {tr('site.visit.maps')}
              <ExternalIcon />
            </a>
          </div>
          {hasPublishedHours(venue) ? (
            <div className="tp-visit__block">
              <h3 className="tp-visit__label">{tr('site.visit.hoursTitle')}</h3>
              <HoursList locale={locale} venue={venue} className="tp-visit__hours" />
            </div>
          ) : null}
          <div className="tp-visit__block">
            <h3 className="tp-visit__label">{tr('site.visit.contactTitle')}</h3>
            {chat && call && number ? (
              <div className="tp-visit__ctas">
                <a className="tp-site-btn tp-site-btn--go" href={chat} data-contact="whatsapp">
                  <ChatIcon />
                  {tr('site.visit.whatsapp')}
                </a>
                <a
                  className="tp-site-btn tp-site-btn--ghost tp-visit__call"
                  href={call}
                  data-contact="call"
                >
                  <CallIcon />
                  <span>{tr('site.visit.call')}</span>
                  <span className="tp-visit__number tp-num" dir="ltr">
                    {number}
                  </span>
                </a>
              </div>
            ) : null}
            <p className="tp-visit__walkin">{tr('site.visit.walkIn')}</p>
            {instagram ? (
              <a className="tp-visit__social" href={instagram}>
                {tr('site.visit.instagram')}
                <ExternalIcon />
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
