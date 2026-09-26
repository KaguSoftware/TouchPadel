import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { t, type Locale } from '@touch/i18n';
import { whatsappUrl } from '@/lib/site/contact';
import { leaveFor } from '@/lib/site/navigate';
import { EventsTicket, type TicketText } from './EventsTicket';

vi.mock('@/lib/site/navigate', () => ({ leaveFor: vi.fn() }));
const leave = vi.mocked(leaveFor);

/**
 * The events ticket: a name written on the stub reaches the WhatsApp message, the stub
 * tears first and the page leaves only once the tear has ended, and the name is locked
 * after. The tear's look, the notches and the Arabic mirror are proven in a browser.
 */
const PHONE = '+964 770 123 4567';

function textFor(locale: Locale): TicketText {
  const k = (key: string) => t(locale, `site.events.ticket.${key}` as Parameters<typeof t>[1]);
  return {
    brand: k('brand'),
    admit: k('admit'),
    titleOne: k('titleOne'),
    titleTwo: k('titleTwo'),
    player1: k('player1'),
    player2: k('player2'),
    you: k('you'),
    rival: k('rival'),
    category: k('category'),
    level: k('level'),
    venue: k('venue'),
    venueName: k('venueName'),
    nameLabel: k('nameLabel'),
    namePlaceholder: k('namePlaceholder'),
    nameHint: k('nameHint'),
    nameLocked: k('nameLocked'),
    tear: k('tear'),
    cta: t(locale, 'site.events.cta'),
    cue: t(locale, 'site.onWhatsApp'),
  };
}

function renderTicket(locale: Locale = 'en', phone: string | null = PHONE) {
  return render(
    <EventsTicket
      phone={phone}
      href={whatsappUrl(phone, t(locale, 'site.whatsapp.events'))}
      namedMessage={t(locale, 'site.whatsapp.eventsNamed')}
      text={textFor(locale)}
      fallback={<a href="#visit">{t(locale, 'site.hero.ctaVisit')}</a>}
    />,
  );
}

const join = () => screen.getByRole('link', { name: new RegExp(t('en', 'site.events.cta')) });
const nameField = () => screen.getByLabelText(t('en', 'site.events.ticket.nameLabel')) as HTMLInputElement;
const stub = () => document.querySelector('.tp-ticket__stub')!;
const endTear = () =>
  act(() => {
    const event = new Event('transitionend') as Event & { propertyName: string };
    Object.defineProperty(event, 'propertyName', { value: 'transform' });
    stub().dispatchEvent(event);
  });

let reduceMotion = false;
beforeEach(() => {
  reduceMotion = false;
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: query.includes('reduce') && reduceMotion, media: query })),
  );
});
afterEach(() => {
  leave.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('EventsTicket', () => {
  it('is a working WhatsApp link with the plain message, waiting for a name', () => {
    renderTicket();
    expect(join().getAttribute('href')).toBe(whatsappUrl(PHONE, t('en', 'site.whatsapp.events')));
    expect(join().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(t('en', 'site.events.ticket.you'))).toBeTruthy();
  });

  it('asks for the name instead of leaving when it is empty', async () => {
    renderTicket();
    await userEvent.click(join());
    expect(leave).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(nameField());
    expect(document.querySelector('.tp-ticket[data-torn]')).toBeNull();
  });

  it('writes the name on the ticket and into the message', async () => {
    renderTicket();
    await userEvent.type(nameField(), '  Sara   Ahmed ');
    expect(join().getAttribute('aria-disabled')).toBeNull();
    expect(document.querySelector('.tp-ticket__main')?.textContent).toContain('Sara Ahmed');
    const named = t('en', 'site.whatsapp.eventsNamed', { name: 'Sara Ahmed' });
    expect(join().getAttribute('href')).toBe(whatsappUrl(PHONE, named));
  });

  it('tears first, leaves when the tear has ended, then locks the name', async () => {
    renderTicket();
    await userEvent.type(nameField(), 'Sara');
    await userEvent.click(join());

    expect(document.querySelector('.tp-ticket[data-torn]')).not.toBeNull();
    expect(nameField().readOnly).toBe(true);
    expect(screen.getByText(t('en', 'site.events.ticket.nameLocked'))).toBeTruthy();
    expect(leave).not.toHaveBeenCalled();

    // A second press mid-tear does not leave early.
    await userEvent.click(join());
    expect(leave).not.toHaveBeenCalled();

    endTear();
    const url = whatsappUrl(PHONE, t('en', 'site.whatsapp.eventsNamed', { name: 'Sara' }));
    expect(leave).toHaveBeenCalledOnce();
    expect(leave).toHaveBeenCalledWith(url);

    // Torn already: the button goes straight back to WhatsApp.
    await userEvent.click(join());
    expect(leave).toHaveBeenCalledTimes(2);
  });

  it('leaves anyway if the tear never reports its end', async () => {
    renderTicket();
    await userEvent.type(nameField(), 'Sara');
    vi.useFakeTimers();
    fireEvent.click(join());
    expect(leave).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(leave).toHaveBeenCalledOnce();
  });

  it('leaves at once under reduced motion, with no tear to wait for', async () => {
    reduceMotion = true;
    renderTicket();
    await userEvent.type(nameField(), 'Sara{Enter}');
    expect(leave).toHaveBeenCalledOnce();
  });

  it('sends the Arabic message on the Arabic page', async () => {
    renderTicket('ar');
    await userEvent.type(screen.getByLabelText(t('ar', 'site.events.ticket.nameLabel')), 'سارة{Enter}');
    endTear();
    expect(leave).toHaveBeenCalledOnce();
    expect(leave).toHaveBeenCalledWith(
      whatsappUrl(PHONE, t('ar', 'site.whatsapp.eventsNamed', { name: 'سارة' })),
    );
  });

  it('with no dialable phone, offers the visit fallback and no name field', () => {
    renderTicket('en', null);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('link', { name: t('en', 'site.hero.ctaVisit') }).getAttribute('href')).toBe('#visit');
  });
});
