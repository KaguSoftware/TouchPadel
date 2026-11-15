import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { catalogs } from '@touch/i18n';
import { LocaleProvider } from '../../lib/i18n';
import { Sources } from './Sources';
import { Message, parseBlocks, plainInline } from './Message';
import { noteFor, type FeedbackView, type RateOutcome } from './feedbackLogic';
import type { Rating } from '@touch/core/assistant/feedback';

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

  it('opens what was read in a box from "Read n" at the end of the answer, each row with its Open link', () => {
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
    expect(document.querySelectorAll('[data-source-row]')).toHaveLength(0);
    const toggle = screen.getByTestId('assistant-details').querySelector('button')!;
    expect(toggle.textContent).toContain('Read ⁨2⁩');
    fireEvent.click(toggle);
    const rows = document.querySelectorAll('[data-answer-details] [data-source-row]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('a')!.getAttribute('href')).toBe('/panel');
    expect(rows[1]!.textContent).toContain('could not be read');
  });

  it('keeps the range on a source link', () => {
    renderIn(<Sources items={[{ call_id: 'c1', name: 'panel_headline', args: { from: '2026-09-01', to: '2026-09-07' }, row_count: 14, ms: 120, route: '/panel' }]} />);
    const link = document.querySelector('[data-source-row] a')!;
    expect(link.getAttribute('href')).toBe('/panel');
    expect(link.getAttribute('data-search')).toBe(JSON.stringify({ from: '2026-09-01', to: '2026-09-07' }));
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
    expect(buttons[0]!.textContent).toBe('Go to End of day count');
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

  // Parity with the phone (apps/mobile/src/features/assistant/blocks.ts), 2026-11-12.
  it('a # heading is a bold line without its hashes', () => {
    expect(parseBlocks('## Cafe this week ##\nSales held.')).toEqual([
      { kind: 'h', text: 'Cafe this week' },
      { kind: 'p', lines: ['Sales held.'] },
    ]);
  });

  it('a numbered list keeps counting across blank lines between its items', () => {
    expect(parseBlocks('1. Open the day\n\n2. Count the drawer\n\n3. Start the shift\n\nDone.')).toEqual([
      { kind: 'ol', items: ['Open the day', 'Count the drawer', 'Start the shift'], start: 1 },
      { kind: 'p', lines: ['Done.'] },
    ]);
    expect(parseBlocks('3. Third')[0]).toMatchObject({ kind: 'ol', start: 3 });
  });

  it('only the row under the header is a separator: a data row of dashes stays', () => {
    expect(parseBlocks('| Court | Coach |\n|---|---|\n| 1 | Sara |\n| - | - |')).toEqual([{ kind: 'table', header: ['Court', 'Coach'], rows: [['1', 'Sara'], ['-', '-']] }]);
  });
});

describe('plainInline: no link and no picture from the model', () => {
  it('a link or an image is its words only; backticks are dropped', () => {
    expect(plainInline('See [the report](https://evil.example/x?d=1) or `/stock/waste`.')).toBe('See the report or /stock/waste.');
    expect(plainInline('![chart](https://evil.example/p.png "t")')).toBe('chart');
    expect(plainInline('Keep [brackets] and (parens).')).toBe('Keep [brackets] and (parens).');
  });

  it('an answer renders a link as plain text: no anchor, no image, no address', () => {
    renderIn(<Message role="assistant" text={'## Next steps\nOpen [the sales page](https://evil.example/leak?q=1) and run `report`.\n\n![x](https://evil.example/i.png)'} />);
    const bubble = document.querySelector('[data-answer-bubble]')!;
    expect(bubble.querySelector('a')).toBeNull();
    expect(bubble.querySelector('img')).toBeNull();
    expect(bubble.textContent).not.toContain('evil.example');
    expect(bubble.textContent).toContain('Open the sales page and run report.');
    expect(bubble.querySelector('[data-answer-heading]')!.textContent).toBe('Next steps');
    expect(bubble.textContent).not.toContain('##');
  });

  it('a numbered list split by blank lines counts on in one list', () => {
    renderIn(<Message role="assistant" text={'1. One\n\n2. Two\n\n3. Three'} />);
    expect(document.querySelectorAll('ol')).toHaveLength(1);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['One', 'Two', 'Three']);
  });
});

describe('the progress line while tools run', () => {
  it('names the area being read, never the tool, one line per area', () => {
    renderIn(
      <Message
        role="assistant"
        text=""
        streaming
        tools={[
          { call_id: 'c1', name: 'report_cafe', args: {}, row_count: null, ms: null, route: null, pending: true },
          { call_id: 'c2', name: 'report_cafe', args: {}, row_count: null, ms: null, route: null, pending: true },
          { call_id: 'c3', name: 'web_search', args: {}, row_count: null, ms: null, route: null, pending: true },
        ]}
      />,
    );
    const lines = [...document.querySelectorAll('[data-message-role="assistant"] li')].map((li) => li.textContent);
    expect(lines).toEqual(['Reading the club’s data: Cafe…', 'Looking it up…']);
    expect(document.body.textContent).not.toContain('report_cafe');
  });
});

describe('Message: how a turn ended', () => {
  const tools = [{ call_id: 't1', name: 'panel_headline', args: {}, row_count: 3, ms: 10, route: null }];
  const saved = { messageId: 'm1', question: 'How much today?', tools };

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('a finished answer keeps Pin and Re-check', () => {
    renderIn(<Message role="assistant" text="Sales were 10." {...saved} outcome={{ kind: 'ok' }} />);
    expect(screen.getByTestId('assistant-pin')).toBeTruthy();
    expect(document.querySelector('[data-recheck]')).toBeTruthy();
    expect(document.querySelector('[data-turn-outcome]')).toBeNull();
  });

  for (const [kind, words] of [
    ['stopped', /Stopped\./],
    ['cut_short', /This answer was cut short\. Ask for the rest\./],
    ['refused', /The assistant declined to answer this\./],
  ] as const) {
    it(`${kind}: a quiet note, Copy stays, Pin and Re-check go`, () => {
      renderIn(<Message role="assistant" text="Sales were" {...saved} outcome={{ kind }} />);
      expect(document.querySelector(`[data-turn-outcome="${kind}"]`)!.textContent).toMatch(words);
      expect(screen.getByText('Copy')).toBeTruthy();
      expect(screen.queryByTestId('assistant-pin')).toBeNull();
      expect(document.querySelector('[data-recheck]')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  }

  it('error: the sentence in the reader’s words, and Ask again sends only when pressed', () => {
    const onAskAgain = vi.fn();
    renderIn(<Message role="assistant" text="" {...saved} outcome={{ kind: 'error', code: 'TIMEOUT' }} onAskAgain={onAskAgain} />);
    expect(screen.getByRole('alert').textContent).toMatch(/longer than 50 seconds/);
    expect(onAskAgain).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Ask again'));
    expect(onAskAgain).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('assistant-pin')).toBeNull();
  });

  it('a dropped connection has its own sentence', () => {
    renderIn(<Message role="assistant" text="Half" outcome={{ kind: 'error', code: 'CONNECTION' }} onAskAgain={() => {}} />);
    expect(screen.getByRole('alert').textContent).toBe('The connection dropped before the answer finished.');
    expect(screen.getByText('Ask again')).toBeTruthy();
  });

  it('no Ask again where asking again cannot help (the monthly cap)', () => {
    renderIn(<Message role="assistant" text="" outcome={{ kind: 'error', code: 'LLM_MONTHLY_CAP' }} onAskAgain={() => {}} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Usage and limits/);
    expect(screen.queryByText('Ask again')).toBeNull();
  });

  it('an answer written but not saved says so and offers Ask again', () => {
    const onAskAgain = vi.fn();
    renderIn(<Message role="assistant" text="Sales were 10." outcome={{ kind: 'error', code: 'NOT_SAVED' }} onAskAgain={onAskAgain} />);
    expect(screen.getByRole('alert').textContent).toBe('This answer was written but could not be saved, so it will not be in the chat later. Ask again to keep it.');
    fireEvent.click(screen.getByText('Ask again'));
    expect(onAskAgain).toHaveBeenCalledOnce();
  });

  it('a job’s failed message speaks of the job: its time-out is not the chat’s 50 seconds', () => {
    renderIn(<Message role="assistant" text="" fromJob outcome={{ kind: 'error', code: 'TIMEOUT' }} onAskAgain={() => {}} />);
    expect(screen.getByRole('alert').textContent).toMatch(/ran out of time with part of the work done/);
    cleanup();
    renderIn(<Message role="assistant" text="" fromJob outcome={{ kind: 'error', code: 'LLM_MONTHLY_CAP' }} onAskAgain={() => {}} />);
    expect(screen.getByRole('alert').textContent).toMatch(/spending cap is reached/);
    expect(screen.queryByText('Ask again')).toBeNull();
  });

  it('says the same in Arabic', () => {
    localStorage.setItem('touch-operator-locale', 'ar');
    renderIn(<Message role="assistant" text="" {...saved} outcome={{ kind: 'error', code: 'CONNECTION' }} onAskAgain={() => {}} />);
    expect(screen.getByRole('alert').textContent).toBe('انقطع الاتصال قبل أن تكتمل الإجابة.');
    expect(screen.getByText('اسأل مرة أخرى')).toBeTruthy();
    cleanup();
    renderIn(<Message role="assistant" text="نصف" {...saved} outcome={{ kind: 'cut_short' }} />);
    expect(document.querySelector('[data-turn-outcome="cut_short"]')!.textContent).toBe('توقفت هذه الإجابة قبل أن تكتمل. اطلب البقية.');
  });

  it('every outcome key exists in both catalogs', () => {
    const keys = [
      'message.outcome.cutShort',
      'message.outcome.refused',
      'message.askAgain',
      'message.askAgainHint',
      'message.errors.CONNECTION',
      'job.fromPrice',
      'job.fromPriceHint',
      'job.perTool',
      'job.perToolEstimated',
    ];
    const at = (root: unknown, path: string) => path.split('.').reduce<unknown>((n, k) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[k] : undefined), root);
    for (const locale of ['en', 'ar'] as const) {
      for (const key of keys) expect(typeof at(catalogs[locale], `ws.owner.assistant.${key}`), `${locale} ${key}`).toBe('string');
    }
    expect(at(catalogs.en, 'ws.owner.assistant.message.errors.LLM_MONTHLY_CAP')).not.toMatch(/Venue settings/);
    expect(at(catalogs.ar, 'ws.owner.assistant.message.errors.LLM_MONTHLY_CAP')).not.toMatch(/إعدادات المكان/);
  });
});

describe('Message thumbs (0422)', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  /** A stored answer whose thumb lives in local state, as the thread's cache would hold it. */
  function Rated({ initial = { rating: 0, note: null }, onRate, outcome = 'saved' }: { initial?: FeedbackView; onRate?: (r: Rating, n: string | null) => void; outcome?: RateOutcome }) {
    const [fb, setFb] = useState<FeedbackView>(initial);
    return (
      <Message
        role="assistant"
        messageId="m1"
        text="Courts held up."
        feedback={fb}
        onRate={async (rating, note) => {
          onRate?.(rating, note);
          if (outcome !== 'saved') return outcome;
          setFb({ rating, note: noteFor(rating, note) });
          return 'saved';
        }}
      />
    );
  }

  const up = () => screen.getByTestId('assistant-thumbs-up');
  const down = () => screen.getByTestId('assistant-thumbs-down');

  it('shows on a rateable stored answer, after Copy', () => {
    renderIn(<Rated />);
    const row = document.querySelector('[data-answer-actions]')!;
    const labels = [...row.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(labels.indexOf('Good answer')).toBeGreaterThan(labels.indexOf('Copy'));
    expect(labels.indexOf('Wrong or not useful')).toBe(labels.indexOf('Good answer') + 1);
  });

  it('is absent without the thread\'s say-so, on a streaming, failed, stopped or job answer', () => {
    const onRate = async () => 'saved' as const;
    const fb = { rating: 0 as const, note: null };
    const cases = [
      <Message key="a" role="assistant" messageId="m1" text="x" />,
      <Message key="b" role="assistant" messageId="m1" text="x" feedback={fb} />,
      <Message key="c" role="assistant" messageId="m1" text="x" feedback={fb} onRate={onRate} streaming />,
      <Message key="d" role="assistant" messageId="m1" text="x" feedback={fb} onRate={onRate} outcome={{ kind: 'error', code: 'UPSTREAM' }} />,
      <Message key="e" role="assistant" messageId="m1" text="x" feedback={fb} onRate={onRate} outcome={{ kind: 'stopped' }} />,
      <Message key="f" role="assistant" messageId="m1" text="x" feedback={fb} onRate={onRate} outcome={{ kind: 'cut_short' }} />,
      <Message key="g" role="assistant" messageId="m1" text="x" feedback={fb} onRate={onRate} fromJob />,
      <Message key="h" role="assistant" text="x" feedback={fb} onRate={onRate} />,
    ];
    for (const ui of cases) {
      renderIn(ui);
      expect(screen.queryByTestId('assistant-thumbs-up')).toBeNull();
      expect(screen.queryByTestId('assistant-thumbs-down')).toBeNull();
      cleanup();
    }
  });

  it('names both thumbs in English and Arabic, with the same words as the tooltip', () => {
    renderIn(<Rated />);
    expect(up().getAttribute('aria-label')).toBe('Good answer');
    expect(up().getAttribute('title')).toBe('Good answer');
    expect(down().getAttribute('aria-label')).toBe('Wrong or not useful');
    cleanup();
    localStorage.setItem('touch-operator-locale', 'ar');
    renderIn(<Rated />);
    expect(screen.getByRole('button', { name: 'إجابة جيدة' })).toBe(up());
    expect(screen.getByRole('button', { name: 'خاطئة أو غير مفيدة' })).toBe(down());
    expect(down().getAttribute('title')).toBe('خاطئة أو غير مفيدة');
  });

  it('aria-pressed and the filled glyph reflect a stored rating', () => {
    renderIn(<Rated initial={{ rating: 1, note: null }} />);
    expect(up().getAttribute('aria-pressed')).toBe('true');
    expect(down().getAttribute('aria-pressed')).toBe('false');
    expect(up().querySelector('svg')!.getAttribute('fill')).toBe('currentColor');
    expect(down().querySelector('svg')!.getAttribute('fill')).toBe('none');
    expect(up().style.color).toBe('var(--tp-accent)');
    expect(down().style.color).toBe('var(--tp-muted-fg)');
  });

  it('thumbs-down opens the note field; Enter sends the note with -1 and shows it as kept', async () => {
    const onRate = vi.fn();
    renderIn(<Rated onRate={onRate} />);
    fireEvent.click(down());
    expect(onRate).toHaveBeenLastCalledWith(-1, null);
    const note = (await screen.findByTestId('assistant-feedback-note')) as HTMLInputElement;
    expect(note.placeholder).toBe('What was wrong? (optional)');
    expect(note.maxLength).toBe(280);
    fireEvent.change(note, { target: { value: 'the total is wrong' } });
    fireEvent.keyDown(note, { key: 'Enter' });
    expect(onRate).toHaveBeenLastCalledWith(-1, 'the total is wrong');
    expect(await screen.findByText('Noted: \u2068the total is wrong\u2069')).toBeTruthy();
    expect(screen.queryByTestId('assistant-feedback-note')).toBeNull();
    expect(down().getAttribute('aria-pressed')).toBe('true');
  });

  it('Escape closes the field and keeps the rating; it does not reach the drawer', async () => {
    const outer = vi.fn();
    const onRate = vi.fn();
    render(
      <LocaleProvider>
        <div onKeyDown={outer}>
          <Rated onRate={onRate} />
        </div>
      </LocaleProvider>,
    );
    fireEvent.click(down());
    const note = await screen.findByTestId('assistant-feedback-note');
    fireEvent.blur(note);
    expect(screen.getByTestId('assistant-feedback-note')).toBeTruthy();
    fireEvent.keyDown(note, { key: 'Escape' });
    expect(screen.queryByTestId('assistant-feedback-note')).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    expect(onRate).toHaveBeenCalledTimes(1);
    expect(down().getAttribute('aria-pressed')).toBe('true');
  });

  it('pressing the chosen thumb again clears the rating and the note', async () => {
    const onRate = vi.fn();
    renderIn(<Rated initial={{ rating: -1, note: 'wrong week' }} onRate={onRate} />);
    expect(screen.getByText('Noted: \u2068wrong week\u2069')).toBeTruthy();
    fireEvent.click(down());
    expect(onRate).toHaveBeenLastCalledWith(0, null);
    await vi.waitFor(() => expect(down().getAttribute('aria-pressed')).toBe('false'));
    expect(screen.queryByText(/Noted:/)).toBeNull();
    expect(screen.queryByTestId('assistant-feedback-note')).toBeNull();
  });

  it('a failed save says so in one quiet line', async () => {
    renderIn(<Rated outcome="failed" />);
    fireEvent.click(up());
    expect(await screen.findByText('Not saved. Try again.')).toBeTruthy();
    expect(up().getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('nothing in the thumbs animates or transitions', async () => {
    renderIn(<Rated />);
    fireEvent.click(down());
    await screen.findByTestId('assistant-feedback-note');
    const els = [up(), down(), screen.getByTestId('assistant-feedback-note'), ...document.querySelectorAll('[data-answer-thumbs] *, [data-answer-feedback] *')] as HTMLElement[];
    for (const el of els) {
      expect(['', 'none']).toContain(el.style.transition);
      expect(el.style.animation).toBe('');
      expect(el.getAttribute('class') ?? '').not.toMatch(/tp-(rise|fade|spin|attention|ball-spin)/);
      expect(el.getAttribute('aria-busy')).toBeNull();
    }
    expect(up().style.transition).toBe('none');
    expect(down().style.transition).toBe('none');
  });
});
