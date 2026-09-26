/**
 * The candidates of a hiring run's interviews step (build-contracts-2026-09-23
 * §2.12): management keeps the list while the step is open
 * (app.save_hiring_candidate, app.delete_hiring_candidate) and marks the one
 * picked. The step's record then carries only ids (`{candidate_ids,
 * picked_id}`), never a name: names and phones stay in `hiring_candidates`,
 * which is deleted 90 days after the decision.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Field, inputStyle } from '../../components/ui';
import { StatusBadge } from '../../components/kit';
import { PK } from './keys';
import { invalidateProtocols } from './api';
import { fromLocalInput, mintKey, toLocalInput } from './formModel';
import { isObj } from './protocolLogic';

export interface Candidate {
  id: string;
  candidate_name: string;
  candidate_phone: string;
  brief: string;
  interview_at: string | null;
  picked: boolean;
  pick_reason: string | null;
}

export function readCandidates(raw: unknown): { candidates: Candidate[]; purged: boolean } {
  if (!isObj(raw)) return { candidates: [], purged: false };
  const list = Array.isArray(raw.candidates) ? raw.candidates.filter(isObj) : [];
  return {
    purged: raw.purged === true,
    candidates: list
      .filter((c) => typeof c.id === 'string')
      .map((c) => ({
        id: c.id as string,
        candidate_name: typeof c.candidate_name === 'string' ? c.candidate_name : '',
        candidate_phone: typeof c.candidate_phone === 'string' ? c.candidate_phone : '',
        brief: typeof c.brief === 'string' ? c.brief : '',
        interview_at: typeof c.interview_at === 'string' ? c.interview_at : null,
        picked: c.picked === true,
        pick_reason: typeof c.pick_reason === 'string' ? c.pick_reason : null,
      })),
  };
}

export function useCandidates(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: PK.context('interviews', runId),
    enabled,
    retry: false,
    queryFn: async () => readCandidates(await appRpc<unknown>('hiring_candidates', { p_run_id: runId })),
  });
}

interface Draft {
  name: string;
  phone: string;
  brief: string;
  at: string;
}
const EMPTY: Draft = { name: '', phone: '', brief: '', at: '' };

export function CandidatesPanel({ runId, editable }: { runId: string; editable: boolean }) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const q = useCandidates(runId, true);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [key, setKey] = useState(() => mintKey('hiring.candidate'));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tried, setTried] = useState(false);
  const list = q.data?.candidates ?? [];

  async function run(tag: string, fn: () => Promise<unknown>) {
    setBusy(tag);
    setError(null);
    try {
      await fn();
      await invalidateProtocols(qc);
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const save = (c: Candidate, patch: Partial<Candidate>) =>
    run(c.id, () =>
      appRpc('save_hiring_candidate', {
        p_run_id: runId,
        p_id: c.id,
        p_idempotency_key: mintKey('hiring.candidate'),
        p_candidate: {
          candidate_name: c.candidate_name,
          candidate_phone: c.candidate_phone,
          brief: c.brief,
          interview_at: c.interview_at,
          picked: patch.picked ?? c.picked,
          pick_reason: patch.pick_reason ?? c.pick_reason,
        },
      }),
    );

  const missing = draft.name.trim() === '' || draft.phone.trim() === '';

  if (q.data?.purged) return <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr('ws.protocols.candidates.purged')}</p>;

  return (
    <section style={{ display: 'grid', gap: 'var(--tp-sp-2)' }} data-testid="candidates">
      <h4 style={{ margin: 0 }}>{tr('ws.protocols.candidates.title')}</h4>
      <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.protocols.candidates.privacy')}</p>
      {list.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr('ws.protocols.candidates.none')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          {list.map((c) => (
            <li key={c.id} style={{ display: 'grid', gap: 'var(--tp-sp-0)', padding: 'var(--tp-sp-2)', borderRadius: 'var(--tp-radius-ctl)', border: `1px solid ${c.picked ? 'var(--tp-accent)' : 'var(--tp-border)'}` }}>
              <span style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                <bdi style={{ fontWeight: 600 }}>{c.candidate_name}</bdi>
                <span dir="ltr" style={{ color: 'var(--tp-muted-fg)' }}>
                  {c.candidate_phone}
                </span>
                {c.picked && <StatusBadge tone="success" label={tr('ws.protocols.candidates.picked')} />}
                {c.interview_at && <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{formatDateTime(new Date(c.interview_at), locale)}</span>}
              </span>
              {c.brief && (
                <bdi dir="auto" style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--tp-fs-sm)' }}>
                  {c.brief}
                </bdi>
              )}
              {editable && (
                <span style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
                  {!c.picked && (
                    <Button size="sm" icon="check" busy={busy === c.id} onClick={() => void save(c, { picked: true })}>
                      {tr('ws.protocols.candidates.pick')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    kind="ghost"
                    icon="trash"
                    busy={busy === `del:${c.id}`}
                    onClick={() => void run(`del:${c.id}`, () => appRpc('delete_hiring_candidate', { p_id: c.id }))}
                  >
                    {tr('ws.protocols.candidates.remove')}
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', padding: 'var(--tp-sp-2-5)', borderRadius: 'var(--tp-radius-ctl)', background: 'var(--tp-surface-2)' }}>
          <strong>{tr('ws.protocols.candidates.add')}</strong>
          <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))' }}>
            <Field label={tr('ws.protocols.candidates.name')} required error={tried && draft.name.trim() === '' ? tr('ws.protocols.form.fieldInvalid') : undefined}>
              <input style={inputStyle} dir="auto" maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label={tr('ws.protocols.candidates.phone')} required error={tried && draft.phone.trim() === '' ? tr('ws.protocols.form.fieldInvalid') : undefined}>
              <input style={inputStyle} dir="ltr" inputMode="tel" maxLength={32} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            </Field>
            <Field label={tr('ws.protocols.candidates.at')} optional>
              <input type="datetime-local" style={inputStyle} dir="ltr" value={toLocalInput(draft.at)} onChange={(e) => setDraft({ ...draft, at: fromLocalInput(e.target.value) })} />
            </Field>
          </div>
          <Field label={tr('ws.protocols.candidates.brief')} optional hint={tr('ws.protocols.candidates.briefHint')}>
            <textarea style={{ ...inputStyle, minBlockSize: '3.5rem', fontFamily: 'inherit' }} dir="auto" maxLength={1020} value={draft.brief} onChange={(e) => setDraft({ ...draft, brief: e.target.value })} />
          </Field>
          <div>
            <Button
              size="sm"
              icon="plus"
              busy={busy === 'add'}
              onClick={async () => {
                setTried(true);
                if (missing) return;
                const ok = await run('add', () =>
                  appRpc('save_hiring_candidate', {
                    p_run_id: runId,
                    p_id: null,
                    p_idempotency_key: key,
                    p_candidate: {
                      candidate_name: draft.name.trim(),
                      candidate_phone: draft.phone.trim(),
                      brief: draft.brief.trim(),
                      interview_at: draft.at === '' ? null : draft.at,
                    },
                  }),
                );
                if (ok) {
                  setDraft(EMPTY);
                  setTried(false);
                  setKey(mintKey('hiring.candidate'));
                }
              }}
            >
              {tr('ws.protocols.candidates.addButton')}
            </Button>
          </div>
        </div>
      )}
      {error != null && <ErrorText error={error} />}
    </section>
  );
}
