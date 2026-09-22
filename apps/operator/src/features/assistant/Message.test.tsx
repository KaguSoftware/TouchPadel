import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider } from '../../lib/i18n';
import { Message, parseBlocks } from './Message';

// Sources rows link to the page the numbers live on; the router is not
// mounted in a unit test, so Link is a plain anchor here. The Go to buttons
// ask the router which paths are pages and navigate through it.
const router = vi.hoisted(() => ({
  current: undefined as undefined | { routesByPath: Record<string, unknown>; navigate: (opts: { to: string }) => Promise<void> },
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, search, ...rest }: { to: string; children: ReactNode; search?: unknown }) => (
    <a href={to} data-search={JSON.stringify(search ?? null)} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => router.current,
}));

function renderIn(ui: ReactNode) {
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}

describe('Message', () => {
  it('wraps each unverified figure in a labelled mark and counts them in a footnote', () => {
    renderIn(
      <Message
        role="assistant"
        text="Revenue was 1,250,000 IQD from 300 orders; last week it was 1,250."
        gate={{ status: 'unverified', checked: 3, unverified: [{ raw: '1,250,000', value: 1_250_000 }], retried: false }}
      />,
    );
    const marks = document.querySelectorAll('mark[data-unverified]');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('1,250,000');
    expect(marks[0]!.getAttribute('title')).toBe('This figure could not be checked against the data read this turn.');
    // `1,250` is verified: the mark did not swallow the shorter figure.
    expect(screen.getByText(/last week it was 1,250\./)).toBeTruthy();
    expect(document.querySelector('[data-unverified-footnote]')!.textContent).toBe('1 figure could not be checked against the data read this turn.');
  });

  it('pluralises the footnote and mentions the retry', () => {
    renderIn(
      <Message
        role="assistant"
        text="Cash 800, card 900."
        gate={{ status: 'unverified', checked: 2, unverified: [{ raw: '800', value: 800 }, { raw: '900', value: 900 }], retried: true }}
      />,
    );
    expect(document.querySelectorAll('mark[data-unverified]')).toHaveLength(2);
    const note = document.querySelector('[data-unverified-footnote]')!.textContent!;
    expect(note).toContain('2');
    expect(note).toContain('figures could not be checked');
    expect(note).toContain('restated answer');
  });

  it('renders no mark and no footnote when the gate passed', () => {
    renderIn(<Message role="assistant" text="Cash 800." gate={{ status: 'ok', checked: 1, unverified: [] }} />);
    expect(document.querySelector('mark[data-unverified]')).toBeNull();
    expect(document.querySelector('[data-unverified-footnote]')).toBeNull();
  });

  it('renders paragraphs, lists and pipe tables without a markdown library', () => {
    renderIn(
      <Message
        role="assistant"
        text={['Top items:', '', '- Latte', '- Water', '', '| Court | Hours |', '|---|---|', '| Court 1 | 12 |', '| Court 2 | **9** |'].join('\n')}
      />,
    );
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Latte', 'Water']);
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Court', 'Hours']);
    expect(screen.getAllByRole('cell').map((td) => td.textContent)).toEqual(['Court 1', '12', 'Court 2', '9']);
    expect(document.querySelector('strong')!.textContent).toBe('9');
  });

  it('shows the owner text as typed', () => {
    renderIn(<Message role="user" text={'- not a list\n| not | a table |'} />);
    expect(screen.getByText('- not a list | not | a table |')).toBeTruthy();
    expect(document.querySelector('table')).toBeNull();
  });

  it('turns a refused scope into a one-tap Turn on button', () => {
    const onTurnOn = vi.fn();
    renderIn(<Message role="assistant" text="Cafe context is off for this chat." turnOn={['cafe']} onTurnOn={onTurnOn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Cafe' }));
    expect(onTurnOn).toHaveBeenCalledWith('cafe');
  });

  it('lists what was read with a link carrying the range', () => {
    renderIn(
      <Message
        role="assistant"
        text="Done."
        tools={[
          { call_id: 'c1', name: 'panel_headline', args: { from: '2026-09-01', to: '2026-09-07' }, row_count: 14, ms: 120, route: '/panel' },
          { call_id: 'c2', name: 'report_cafe', args: {}, row_count: null, ms: 40, route: null, error: 'Scope "cafe" is off for this chat' },
        ]}
      />,
    );
    const rows = document.querySelectorAll('[data-source-row]');
    expect(rows).toHaveLength(2);
    const link = rows[0]!.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/panel');
    expect(link.getAttribute('data-search')).toBe(JSON.stringify({ from: '2026-09-01', to: '2026-09-07' }));
    expect(rows[1]!.textContent).toContain('could not be read');
  });

  it('shows the error sentence for a failed turn', () => {
    renderIn(<Message role="assistant" text="" error={{ code: 'LLM_MONTHLY_CAP', message: 'cap' }} />);
    expect(screen.getByRole('alert').textContent).toMatch(/spending cap is reached/);
  });
});

describe('Message page links', () => {
  afterEach(() => {
    router.current = undefined;
  });

  function mountRouter() {
    const navigate = vi.fn(async () => {});
    // '/desk/' is how the router keys an index route.
    router.current = { routesByPath: { '/admin/day-close': {}, '/stock/waste': {}, '/desk/': {}, '/desk/customers/$id': {} }, navigate };
    return navigate;
  }

  it('turns each page route the answer names into a Go to button that navigates and closes the drawer', () => {
    const navigate = mountRouter();
    const onNavigate = vi.fn();
    renderIn(<Message role="assistant" text="Close the day on /admin/day-close. Waste is logged at `/stock/waste`, and /admin/day-close again." onNavigate={onNavigate} />);
    const buttons = [...document.querySelectorAll('[data-page-links] button')];
    expect(buttons.map((b) => b.getAttribute('title'))).toEqual(['/admin/day-close', '/stock/waste']);
    // A page with a rail row is named by its row.
    expect(buttons[0]!.textContent).toBe('Go to Day close');
    fireEvent.click(buttons[1]!);
    expect(navigate).toHaveBeenCalledWith({ to: '/stock/waste' });
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it('skips paths that are not pages, URLs, dates and dynamic routes', () => {
    mountRouter();
    renderIn(<Message role="assistant" text="See /made/up, https://example.com/stock/waste, 2026/09/22 and /desk/customers/$id. The desk is /desk." />);
    const buttons = [...document.querySelectorAll('[data-page-links] button')];
    expect(buttons.map((b) => b.getAttribute('title'))).toEqual(['/desk']);
  });

  it('shows no buttons while the answer streams or outside a router', () => {
    mountRouter();
    renderIn(<Message role="assistant" text="Open /stock/waste." streaming />);
    expect(document.querySelector('[data-page-links]')).toBeNull();
    cleanup();
    router.current = undefined;
    renderIn(<Message role="assistant" text="Open /stock/waste." />);
    expect(document.querySelector('[data-page-links]')).toBeNull();
  });
});

describe('parseBlocks', () => {
  it('separates paragraphs, lists, numbered lists and tables', () => {
    const blocks = parseBlocks('One\ntwo\n\n1. a\n2. b\n- c\n| h |\n| 1 |');
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'ol', 'ul', 'table']);
  });
});
