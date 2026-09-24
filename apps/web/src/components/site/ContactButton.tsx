import { makeT, type Locale } from '@touch/i18n';
import { telUrl, whatsappUrl } from '@/lib/site/contact';
import { ArrowIcon, CallIcon, ChatIcon } from './icons';

/**
 * The club's ways in, as buttons: a WhatsApp chat with the message pre-filled in the
 * page's language, or a call to the desk. Both come from the ONE venue phone
 * (lib/site/contact.ts), so fixing that setting fixes every button on the site.
 *
 * With no usable phone neither button can exist, and a dead button is worse than none:
 * the WhatsApp slot becomes "Plan your visit", which lands on #visit (address, map,
 * hours, "or just walk in"), and the call button is not drawn at all.
 *
 * Plain `<a>` in every case: wa.me and tel: leave the site, and #visit is on the page.
 */

/** Where "Plan your visit" goes: the section itself on the home page, else home#visit. */
export function visitHref(locale: Locale, onHome: boolean): string {
  return onHome ? '#visit' : `/${locale}#visit`;
}

export function WhatsAppButton({
  locale,
  phone,
  message,
  label,
  onHome,
  className,
  icon = true,
  cue,
}: {
  locale: Locale;
  phone: string | null | undefined;
  /** The pre-filled message, already in the page's language (`site.whatsapp.*`). */
  message: string;
  label: string;
  onHome: boolean;
  className: string;
  icon?: boolean;
  /**
   * For a label that does not say WhatsApp itself ("Book a court", "Ask about lessons"):
   * read after it by screen readers only (`site.onWhatsApp`, ", on WhatsApp"), so a
   * keyboard or screen-reader user knows the button leaves for another app. The chat
   * glyph says the same to the eye.
   */
  cue?: string;
}) {
  const href = whatsappUrl(phone, message);
  if (href) {
    return (
      <a className={className} href={href} data-contact="whatsapp">
        {icon ? <ChatIcon /> : null}
        {label}
        {cue ? <span className="tp-site-sr">{cue}</span> : null}
      </a>
    );
  }
  return (
    <a className={className} href={visitHref(locale, onHome)} data-contact="visit">
      {makeT(locale)('site.hero.ctaVisit')}
      {icon ? <ArrowIcon /> : null}
    </a>
  );
}

/** "Call the desk", or nothing when there is no dialable number. */
export function CallButton({
  phone,
  label,
  className,
}: {
  phone: string | null | undefined;
  label: string;
  className: string;
}) {
  const href = telUrl(phone);
  if (!href) return null;
  return (
    <a className={className} href={href} data-contact="call">
      <CallIcon />
      {label}
    </a>
  );
}
