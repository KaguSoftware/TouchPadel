/**
 * The pieces a result shows in more than one list (the results list, Results to check): a
 * pair's names with "Won", and the Void dialog (app.ranks_void, manager or owner, a reason of
 * at least 3 characters). A void re-reads every ranks query: the server replays the levels.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isolate } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { StatusBadge } from '../../components/kit';
import type { DeskPlayer } from './ranksLogic';
import { invalidateRanks, voidResult } from './useRanks';

const K = 'ws.ranks';

export function playerName(p: DeskPlayer | null, tr: (k: `${typeof K}.results.former`) => string): string | null {
  if (!p) return null;
  const name = p.name ?? (p.username ? `@${p.username}` : null);
  if (p.former) return name ? `${name} (${tr(`${K}.results.former`)})` : tr(`${K}.results.former`);
  return name;
}

export function Team({ players, won }: { players: readonly (DeskPlayer | null)[]; won: boolean }) {
  const { tr } = useLocale();
  const names = players
    .map((p) => playerName(p, tr))
    .filter((n): n is string => Boolean(n))
    .map(isolate);
  const text = names.length === 2 ? tr(`${K}.results.pair`, { a: names[0]!, b: names[1]! }) : (names[0] ?? '');
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', minInlineSize: 0, flexWrap: 'wrap' }}>
      <span style={{ fontWeight: won ? 700 : 500, color: won ? 'var(--tp-fg)' : undefined }}>{text}</span>
      {won && <StatusBadge size="sm" tone="success" icon="trophy" label={tr(`${K}.results.won`)} />}
    </span>
  );
}

export function VoidDialog({ result, onClose }: { result: { id: string }; onClose: () => void }) {
  const { tr } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const { reachable } = useStationReach();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ok = reason.trim().length >= 3;

  async function submit() {
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await voidResult(result.id, reason);
      invalidateRanks(qc);
      toast.ok(tr(`${K}.results.voided`));
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr(`${K}.results.voidTitle`)}
      size="sm"
      dismissible={!busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr(`${K}.cancel`)}
          </Button>
          <Button
            kind="danger"
            busy={busy}
            disabled={!ok || !reachable}
            onClick={() => void submit()}
            data-testid="ranks-void-confirm"
          >
            {tr(`${K}.results.voidConfirm`)}
          </Button>
        </>
      )}
    >
      <p style={{ marginBlockStart: 0 }}>{tr(`${K}.results.voidBody`)}</p>
      <Field label={tr(`${K}.results.reason`)} hint={tr(`${K}.results.reasonHint`)} style={{ marginBlockEnd: 0 }}>
        <input
          style={inputStyle}
          value={reason}
          maxLength={200}
          autoFocus
          onChange={(e) => setReason(e.target.value)}
          data-testid="ranks-void-reason"
        />
      </Field>
      <ErrorText error={error} />
    </Modal>
  );
}

