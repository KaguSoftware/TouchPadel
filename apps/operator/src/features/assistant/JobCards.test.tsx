/**
 * The estimate card and a job's card in the owner's words (2026-11-12): no
 * tokens, rows-in-chunks or per-token prices on the face of the estimate, the
 * server's English never inside the Arabic UI, and a job that ended while the
 * owner was away says so.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { ToastProvider } from '../../components/toast';
import { ConfirmProvider } from '../../components/ConfirmDialog';
import type { JobEstimate, JobRow } from './api';

const resumeCalls: string[] = [];
let resumeAnswer: () => Promise<unknown> = async () => ({ job_id: 'j1', status: 'running', mode: 'batch' });
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchJob: async () => {
    throw new Error('not in this test');
  },
  resumeJob: async (id: string) => {
    resumeCalls.push(id);
    return resumeAnswer();
  },
}));

import { JobEstimateCard } from './JobEstimateCard';
import { JobProgress } from './JobProgress';

const t = (input: number, cache_read: number, output: number) => ({ input, cache_read, output, total: input + cache_read + output });
const estimate: JobEstimate = {
  job_id: 'j1',
  rows: 12_400,
  chunks: 31,
  per_tool: [{ tool: 'tabs_list', rows: 12_400, chunk_rows: 400, tokens_per_row: 30, measured: true }],
  tokens: t(400_000, 0, 20_000),
  tokens_high: t(460_000, 0, 23_000),
  modes: { aggregate: { calls: [{ tool: 'report_cafe', args: {} }], tokens_est: 3_000 }, live: { allowed: false, reason: 'live jobs run at most 40 chunks; choose batch' }, batch: { allowed: true } },
  assumptions: [],
  first_chunk_exact: 11_000,
};

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <ConfirmProvider>{ui}</ConfirmProvider>
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const job = (patch: Partial<JobRow>): JobRow =>
  ({
    id: 'j1',
    conversation_id: 'c1',
    message_id: 'a1',
    status: 'failed',
    plan: {},
    estimate,
    mode: 'live',
    chunks_total: 31,
    chunks_done: 12,
    tokens: {},
    result: null,
    error: null,
    batch_id: null,
    created_at: '2026-11-12T10:00:00Z',
    started_at: '2026-11-12T10:00:01Z',
    finished_at: '2026-11-12T10:01:00Z',
    ...patch,
  }) as JobRow;

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the estimate card, for a club owner', () => {
  function card() {
    wrap(<JobEstimateCard estimate={estimate} model="claude-opus-5-5" pricing={null} fallbackMicrosPerMtok={10_000_000} onAccept={() => {}} onAggregate={() => {}} onDismiss={() => {}} />);
    const face = document.querySelector('[data-job-estimate]')!;
    // What the owner reads without opening "How this was estimated".
    const details = face.querySelector('details');
    return (face.textContent ?? '').replace(details?.textContent ?? '', '');
  }

  it('says what each choice does, how long it takes and where the answer lands; no engineering words', () => {
    const text = card();
    expect(text).toMatch(/Answer from the totals/);
    expect(text).toMatch(/Read everything now/);
    expect(text).toMatch(/Run in the background/);
    expect(text).toMatch(/You can close the app: the answer appears in this chat/);
    expect(text).not.toMatch(/token|chunk|aggregate|per-token|batch/i);
    // Each way keeps its price on its button.
    expect(screen.getAllByRole('button').filter((b) => /\$/.test(b.textContent ?? ''))).toHaveLength(3);
  });

  it('a job too big to read now gets the catalog’s sentence, not the server’s English reason', () => {
    card();
    expect(document.body.textContent).not.toContain('live jobs run at most');
  });

  it('reads in Arabic with no English left on its face', () => {
    localStorage.setItem('touch-operator-locale', 'ar');
    const text = card();
    expect(text).toMatch(/شغّله في الخلفية/);
    expect(text).not.toMatch(/[A-Za-z]{3,}/);
  });
});

describe('a job’s card', () => {
  it('words a failure from its code: no server English, in either language', () => {
    wrap(<JobProgress jobId="j1" initial={job({ error: 'TIMEOUT: 12 of 31 chunks done inside the wall clock; re-run as batch' })} model="claude-opus-5-5" pricing={null} fallbackMicrosPerMtok={0} />);
    expect(screen.getByRole('alert').textContent).toMatch(/ran out of time with part of the work done/);
    expect(document.body.textContent).not.toContain('wall clock');
    cleanup();
    localStorage.setItem('touch-operator-locale', 'ar');
    wrap(<JobProgress jobId="j1" initial={job({ error: 'LLM_MONTHLY_CAP: the monthly assistant budget is used up' })} model="claude-opus-5-5" pricing={null} fallbackMicrosPerMtok={0} />);
    expect(screen.getByRole('alert').textContent).toMatch(/سقفه الشهري/);
    expect(document.body.textContent).not.toContain('budget');
  });

  it('a job that finished while the owner was away says so', () => {
    wrap(<JobProgress jobId="j1" initial={job({ status: 'done', error: null })} endedAway model="claude-opus-5-5" pricing={null} fallbackMicrosPerMtok={0} />);
    expect(document.querySelector('[data-job-ended="away"]')!.textContent).toBe('Finished since you last looked. Its answer is in this chat.');
  });

  it('a job paused over its estimate says what is true now: part done, nothing more spent, how to finish', () => {
    wrap(<JobProgress jobId="j1" initial={job({ status: 'over_estimate', finished_at: null })} model="claude-opus-5-5" pricing={null} fallbackMicrosPerMtok={0} />);
    expect(document.body.textContent).toMatch(/so it paused\. Parts read: ⁨12⁩ of ⁨31⁩\. Nothing more is spent while it waits\./);
    expect(document.body.textContent).not.toMatch(/later version/);
    // 0423: the button makes "cancel it and ask again" untrue: it is gone
    expect(document.body.textContent).not.toMatch(/ask the question again/i);
  });
});

describe('a paused job continues from what it paid for (0423)', () => {
  const tk = (input: number, output: number) => ({ input, cache_read: 0, output, total: input + output });
  const paused = (reason: string, patch: Partial<JobRow> = {}) =>
    job({
      status: 'over_estimate',
      finished_at: null,
      chunks_done: 2,
      chunks_total: 3,
      tokens: { input: 4000, output: 600, cost_micros: 4_600_000, model: 'claude-opus-5-5' },
      result: { objects: [{ chunk: 1 }, { chunk: 2 }], calls: [], pause: { reason, at: '2026-11-12T10:00:00Z', chunks_left: [3], rest: { chunks: 1, extract: tk(1_000_000, 0), extract_high: tk(1_150_000, 0), reduce: tk(0, 1_000_000), reduce_high: tk(0, 1_150_000) } } },
      ...patch,
    });

  it.each([
    ['time', 'It ran out of time before it finished. Parts read: ⁨2⁩ of ⁨3⁩. They are kept.'],
    ['cap', 'The assistant budget or today’s limit ran out before it finished. Parts read: ⁨2⁩ of ⁨3⁩. They are kept; continue once there is budget.'],
    ['stopped', 'It stopped unexpectedly before it finished. Parts read: ⁨2⁩ of ⁨3⁩. They are kept.'],
  ])('says why it paused (%s), what it cost, what the rest costs, and offers one Continue', (reason, sentence) => {
    // $1 a million tokens flat: the rest is 1M extraction (half in the background) + 1M of answer
    wrap(<JobProgress jobId="j1" initial={paused(reason)} model="claude-opus-5-5" pricing={null} fallbackMicrosPerMtok={1_000_000} />);
    expect(document.body.textContent).toContain(sentence);
    expect(document.body.textContent).toContain('Spent so far: ⁨$4.60⁩. To finish: about ⁨$1.50⁩, at most ⁨$1.73⁩. The parts already read are not paid for again.');
    expect(screen.getAllByRole('button', { name: /Continue/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Continue in the background' })).toBeTruthy();
    expect(document.body.textContent).toContain('Reads only the parts left, for less.');
  });

  it('on a vendor without batch the one button continues now, at the full price', () => {
    const noBatch = { ...estimate, modes: { ...estimate.modes, batch: { allowed: false } } } as unknown as JobEstimate;
    wrap(<JobProgress jobId="j1" initial={paused('time', { estimate: noBatch })} model="claude-opus-5-5" pricing={null} fallbackMicrosPerMtok={1_000_000} />);
    expect(screen.getByRole('button', { name: 'Continue now' })).toBeTruthy();
    expect(document.body.textContent).toContain('about ⁨$2.00⁩');
  });

  it('the press resumes this job once; a refusal the owner must read is shown', async () => {
    resumeCalls.length = 0;
    resumeAnswer = async () => ({ job_id: 'j1', status: 'running', mode: 'batch' });
    wrap(<JobProgress jobId="j1" initial={paused('over_estimate')} model="claude-opus-5-5" pricing={null} fallbackMicrosPerMtok={1_000_000} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue in the background' }));
    await waitFor(() => expect(resumeCalls).toEqual(['j1']));
    await waitFor(() => expect(document.body.textContent).toContain('The job continues.'));

    cleanup();
    const { EdgeError } = await import('../../lib/edge');
    resumeAnswer = async () => {
      throw new EdgeError(409, 'UNKNOWN', 'changed', 'JOB_DATA_CHANGED', { code: 'JOB_DATA_CHANGED' });
    };
    wrap(<JobProgress jobId="j1" initial={paused('time')} model="claude-opus-5-5" pricing={null} fallbackMicrosPerMtok={1_000_000} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue in the background' }));
    await waitFor(() => expect(document.body.textContent).toContain('The records changed since the job paused'));
  });

  it('a paused job the server closed after 7 days says so', () => {
    wrap(<JobProgress jobId="j1" initial={job({ status: 'cancelled', mode: 'live', error: 'EXPIRED: it waited paused for 7 days' })} model="claude-opus-5-5" pricing={null} fallbackMicrosPerMtok={0} />);
    expect(document.body.textContent).toContain('It waited 7 days without a choice, so it was closed.');
    expect(screen.queryByRole('button', { name: /Continue/ })).toBeNull();
  });
});
