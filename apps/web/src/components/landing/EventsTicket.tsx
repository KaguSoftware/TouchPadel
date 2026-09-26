'use client';

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ChatIcon } from '@/components/site/icons';
import { whatsappUrl } from '@/lib/site/contact';
import { leaveFor } from '@/lib/site/navigate';

export interface TicketText {
  brand: string;
  admit: string;
  titleOne: string;
  titleTwo: string;
  player1: string;
  player2: string;
  you: string;
  rival: string;
  category: string;
  level: string;
  venue: string;
  venueName: string;
  nameLabel: string;
  namePlaceholder: string;
  nameHint: string;
  nameLocked: string;
  tear: string;
  cta: string;
  /** ", on WhatsApp", read after the button by screen readers (`site.onWhatsApp`). */
  cue: string;
}

/** If the stub's transform never reports its end (a tab in the background), go anyway. */
const TEAR_FALLBACK_MS = 900;
const NAME_MAX = 40;

/**
 * The barcode on the stub: bars of uneven width, drawn once at module load from a fixed
 * seed, so the server and the browser draw the same code. Vector bars, because a
 * repeating gradient turns jagged on the tilted ticket.
 */
const BARS: readonly (readonly [x: number, w: number])[] = (() => {
  let seed = 7;
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const widths = [1.5, 1.5, 2, 3, 4];
  const gaps = [1.5, 2, 2, 3];
  const bars: [number, number][] = [];
  for (let x = 0; x < 216; ) {
    const w = widths[Math.floor(next() * widths.length)]!;
    bars.push([x, w]);
    x += w + gaps[Math.floor(next() * gaps.length)]!;
  }
  return bars;
})();

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * The events section's entry pass: a Padel Green ticket with a tear-off stub. The visitor
 * writes their name on the stub (it appears on the ticket as Player 1), presses "Join a
 * tournament", the stub tears off along the perforation, and once the tear has finished
 * WhatsApp opens in this tab with a message that carries the name
 * (`site.whatsapp.eventsNamed`). After the tear the name is locked; the button then goes
 * straight back to WhatsApp, in case the visitor closed it.
 *
 * Progressive: the server HTML is a working link to WhatsApp with the plain events
 * message, so with no JavaScript the button still gets the visitor to the club. Only once
 * hydrated does it wait for a name (dimmed, `aria-disabled`) and take over the click.
 * A modified click (new tab, new window) is left to the browser.
 *
 * With no dialable venue phone there is nothing to send a name to: the stub carries
 * `fallback` instead ("Plan your visit", from WhatsAppButton) and no name field.
 */
export function EventsTicket({
  phone,
  href,
  namedMessage,
  text,
  fallback,
}: {
  phone: string | null;
  /** WhatsApp with the plain events message, or null when the phone is not dialable. */
  href: string | null;
  /** `site.whatsapp.eventsNamed` in the page's language, `{name}` still in it. */
  namedMessage: string;
  text: TicketText;
  fallback: ReactNode;
}) {
  const [name, setName] = useState('');
  const [torn, setTorn] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [live, setLive] = useState(false);
  const stubRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tearing = useRef(false);
  const inputId = useId();
  const noteId = useId();

  useEffect(() => setLive(true), []);

  const clean = cleanName(name);
  const urlFor = (who: string) => whatsappUrl(phone, namedMessage.replace('{name}', who)) ?? href;
  const namedHref = clean ? urlFor(clean) : null;

  function remind() {
    setNudge(false);
    requestAnimationFrame(() => setNudge(true));
    inputRef.current?.focus();
  }

  function join() {
    if (!clean) return remind();
    const url = urlFor(clean);
    if (!url || tearing.current) return;
    if (torn) return leaveFor(url);

    tearing.current = true;
    setTorn(true);
    const stub = stubRef.current;
    let done = false;
    let timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      stub?.removeEventListener('transitionend', onEnd);
      window.clearTimeout(timer);
      tearing.current = false;
      leaveFor(url);
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.target === stub && event.propertyName === 'transform') finish();
    };
    if (!stub || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return finish();
    stub.addEventListener('transitionend', onEnd);
    timer = window.setTimeout(finish, TEAR_FALLBACK_MS);
  }

  function onJoinClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    join();
  }

  return (
    <div className="tp-ticket-box" data-reveal="">
      <div className="tp-ticket" data-torn={torn ? '' : undefined}>
        {/* The ticket face repeats what the stub asks for; the stub is the real form. */}
        <div className="tp-ticket__main" aria-hidden="true">
          <div className="tp-ticket__row">
            <span>{text.brand}</span>
            <span>{text.admit}</span>
          </div>
          <p className="tp-ticket__title">
            {text.titleOne}
            <br />
            {text.titleTwo}
          </p>
          <div className="tp-ticket__fields">
            <div className="tp-ticket__field">
              <span className="tp-ticket__label">{text.player1}</span>
              <span className="tp-ticket__value tp-ticket__value--hand">{clean || text.you}</span>
            </div>
            <div className="tp-ticket__field">
              <span className="tp-ticket__label">{text.player2}</span>
              <span className="tp-ticket__value tp-ticket__value--hand">{text.rival}</span>
            </div>
            <div className="tp-ticket__field">
              <span className="tp-ticket__label">{text.category}</span>
              <span className="tp-ticket__value tp-ticket__value--hand">{text.level}</span>
            </div>
            <div className="tp-ticket__field">
              <span className="tp-ticket__label">{text.venue}</span>
              <span className="tp-ticket__value">{text.venueName}</span>
            </div>
          </div>
        </div>

        <div className="tp-ticket__stub" ref={stubRef}>
          {href ? (
            <div className="tp-ticket__name" data-nudge={nudge ? '' : undefined}>
              <label className="tp-ticket__label" htmlFor={inputId}>
                {text.nameLabel}
              </label>
              <input
                ref={inputRef}
                id={inputId}
                className="tp-ticket__input"
                type="text"
                autoComplete="name"
                enterKeyHint="send"
                maxLength={NAME_MAX}
                placeholder={text.namePlaceholder}
                value={name}
                readOnly={torn}
                aria-describedby={noteId}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  join();
                }}
                onAnimationEnd={() => setNudge(false)}
              />
              <p className="tp-ticket__note" id={noteId} aria-live="polite">
                {torn ? text.nameLocked : text.nameHint}
              </p>
            </div>
          ) : null}
          <div className="tp-ticket__send">
            {href ? (
              <a
                className="tp-site-btn tp-ticket__go"
                href={namedHref ?? href}
                data-contact="whatsapp"
                aria-disabled={live && !clean ? 'true' : undefined}
                onClick={onJoinClick}
              >
                <ChatIcon />
                {text.cta}
                <span className="tp-site-sr">{text.cue}</span>
              </a>
            ) : (
              fallback
            )}
            <p className="tp-ticket__tear" aria-hidden="true">
              {text.tear}
            </p>
            <svg className="tp-ticket__barcode" viewBox="0 0 220 44" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              {BARS.map(([x, w]) => (
                <rect key={x} x={x} width={w} height={44} />
              ))}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
