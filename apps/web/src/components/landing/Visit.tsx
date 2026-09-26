import { makeT, type Locale } from '@touch/i18n';
import type { VenueBranch, VenueOpeningHours } from '@/lib/menu';
import {
  branchAddress,
  branchMapUrl,
  branchOwnMapUrl,
  branchName,
  displayPhone,
  telUrl,
  whatsappUrl,
} from '@/lib/site/contact';
import { HoursList, hasPublishedHours } from '@/components/site/HoursList';
import { CallIcon, ChatIcon, ExternalIcon } from '@/components/site/icons';

/**
 * `#visit`, "FIND US / IN KARBALA." on a full-bleed Touch Blue block: the address the
 * owner gave (Durrat Karbala, Karbala) with "Open in Google Maps" (a link out, never an
 * iframe: the CSP has no frame-src), the live hours, and how to reach the desk: WhatsApp,
 * a call, or just walking in.
 *
 * With no usable venue phone the WhatsApp and call buttons are simply not drawn: this IS
 * the section every other button falls back to, and walking in still works. The call
 * button carries the number itself: on a computer a tel: link opens a dialler prompt at
 * best, so the number has to be readable where the button is.
 *
 * BRANCHES (multi-venue slice 4). The address and the map link are the branch's own
 * (venues.address_*, map_url) when stored, and the confirmed Karbala address and Maps
 * search when not, so with one branch and nothing stored the block reads exactly as it
 * did. With several open branches every branch gets its own block: its name, address,
 * map link, hours and desk buttons, then one walk-in line for all of them.
 */
export function Visit({
  locale,
  venue,
  branches = [],
}: {
  locale: Locale;
  venue: VenueOpeningHours | null;
  /** every open branch, oldest first; more than one switches to the per-branch blocks */
  branches?: readonly VenueBranch[];
}) {
  const tr = makeT(locale);
  return (
    <section id="visit" className="tp-visit tp-on-blue" aria-labelledby="visit-title">
      <div className="tp-visit__inner">
        <div className="tp-visit__head tp-fit" data-reveal="">
          <h2 id="visit-title" className="tp-display tp-display--section">
            <span className="tp-display__l1">{tr('site.visit.titleOne')}</span>{' '}
            <span className="tp-display__l2">{tr('site.visit.titleTwo')}</span>
          </h2>
        </div>
        {branches.length > 1 ? (
          <div className="tp-visit__facts" data-reveal="">
            {branches.map((branch, i) => (
              <BranchBlock key={branch.id} locale={locale} branch={branch} primary={i === 0} />
            ))}
            <div className="tp-visit__block">
              <p className="tp-visit__walkin">{tr('site.visit.walkIn')}</p>
            </div>
          </div>
        ) : (
          <OneVenue locale={locale} venue={branches[0] ?? venue} />
        )}
      </div>
    </section>
  );
}

/** The desk's WhatsApp + call pair for one phone, or null when it cannot be dialled. */
function DeskButtons({
  locale,
  phone,
  callLabel,
}: {
  locale: Locale;
  phone: string | null;
  callLabel: string;
}) {
  const tr = makeT(locale);
  const chat = whatsappUrl(phone, tr('site.whatsapp.general'));
  const call = telUrl(phone);
  const number = displayPhone(phone);
  if (!chat || !call || !number) return null;
  return (
    <div className="tp-visit__ctas">
      <a className="tp-site-btn tp-site-btn--go" href={chat} data-contact="whatsapp">
        <ChatIcon />
        {tr('site.visit.whatsapp')}
      </a>
      <a className="tp-site-btn tp-site-btn--ghost tp-visit__call" href={call} data-contact="call">
        <CallIcon />
        <span>{callLabel}</span>
        <span className="tp-visit__number tp-num" dir="ltr">
          {number}
        </span>
      </a>
    </div>
  );
}

/** The single-venue layout: address, hours, talk to us (today's page). */
function OneVenue({ locale, venue }: { locale: Locale; venue: VenueOpeningHours | null }) {
  const tr = makeT(locale);
  return (
    <div className="tp-visit__facts" data-reveal="">
      <div className="tp-visit__block">
        <h3 className="tp-visit__label">{tr('site.visit.addressTitle')}</h3>
        <p className="tp-visit__address">{branchAddress(locale, venue)}</p>
        <a className="tp-site-btn tp-site-btn--primary" href={branchMapUrl(venue)}>
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
        <DeskButtons
          locale={locale}
          phone={venue?.phone ?? null}
          callLabel={tr('site.visit.call')}
        />
        <p className="tp-visit__walkin">{tr('site.visit.walkIn')}</p>
      </div>
    </div>
  );
}

/**
 * One branch of several: its name, address + map, hours and desk buttons. Only
 * the first (the original club) falls back to the contract's Durrat Karbala
 * address and Maps search; a later branch with none stored shows none rather
 * than send guests to another branch's door.
 */
function BranchBlock({ locale, branch, primary }: { locale: Locale; branch: VenueBranch; primary: boolean }) {
  const tr = makeT(locale);
  const name = branchName(locale, branch);
  const address = branchAddress(locale, branch, { fallback: primary });
  const mapUrl = primary ? branchMapUrl(branch) : branchOwnMapUrl(branch);
  return (
    <div className="tp-visit__block tp-visit__branch" data-branch={branch.slug}>
      <h3 className="tp-visit__label">{name}</h3>
      {address && <p className="tp-visit__address">{address}</p>}
      {mapUrl && (
        <a className="tp-site-btn tp-site-btn--primary" href={mapUrl}>
          {tr('site.visit.maps')}
          <ExternalIcon />
        </a>
      )}
      <HoursList locale={locale} venue={branch} className="tp-visit__hours" />
      <DeskButtons
        locale={locale}
        phone={branch.phone}
        callLabel={tr('branches.common.call', { name })}
      />
    </div>
  );
}
