/**
 * Goods in ▸ "Scanned receipts" (Phase 2 Milestone 4b; 0236/0237). A driver or
 * a manager photographs a supplier's receipt (here, from a file on this
 * computer, or on the staff phone); the receipt-scan edge function reads it
 * with the connected model and matches the lines to stock. The list shows every
 * receipt still to check, newest first, and opening one
 * (/stock/receive?receipt=<id>) shows it beside its photo (ReceiptReview.tsx).
 *
 * Scanning here: the file is uploaded the way every desktop photo is
 * (uploadStaffPhoto, the receipts folder), filed with app.create_receipt, and
 * the review opens at once while receipt-scan reads it; the review polls until
 * the reading lands. With no model connected the receipt waits as "Waiting"
 * and the manager types its lines from the photo.
 *
 * Always rendered: it carries the Scan button. The pure half is
 * receiptLogic.ts.
 */
import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDateTime, formatNumber, isolate } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { requestReading } from '../../../lib/scanReading';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { Button, ErrorText } from '../../../components/ui';
import { Money, Panel, StatusBadge, type Tone } from '../../../components/kit';
import { CardTitle } from '../../ops/OpsVisuals';
import { PhotoRejected, uploadStaffPhoto } from '../../tasks/PhotoField';
import { SK } from '../stockKeys';
import { readReceipts, type ReceiptStatus } from './receiptLogic';

export const STATUS_TONE: Record<ReceiptStatus, Tone> = {
  uploaded: 'neutral',
  reading: 'info',
  read: 'accent',
  failed: 'danger',
  confirmed: 'success',
  rejected: 'neutral',
};

/** Under the bucket's 5 MB with room to spare; the phone sends 2048 px JPEGs. */
const RECEIPT_PHOTO_SIZE = { maxPx: 2560, maxBytes: 2_500_000 };

export function fetchReceipts(): Promise<unknown> {
  return appRpc<unknown>('receipts_to_review', { p_venue_id: null });
}

/**
 * Ask receipt-scan to read a receipt just filed. Its outcome is stored on the
 * receipt (the review shows it); a refusal it cannot store has nobody to show
 * it to here, and the review's Read again says it if it happens again.
 */
async function readReceipt(id: string): Promise<void> {
  await requestReading({ receipt_id: id });
}

export function ReceiptsPanel() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<'type' | 'size' | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  const q = useQuery({
    queryKey: SK.receipts,
    queryFn: fetchReceipts,
    refetchInterval: (query) => (readReceipts(query.state.data).some((r) => r.status === 'reading') ? 4_000 : 60_000),
  });
  const receipts = useMemo(() => readReceipts(q.data), [q.data]);

  async function scan(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setRejected(null);
    setFailure(null);
    try {
      // Receipts are mostly handwritten: keep enough detail for the model to read them.
      const path = await uploadStaffPhoto('receipts', file, RECEIPT_PHOTO_SIZE);
      const { id } = await appRpc<{ id: string }>('create_receipt', {
        p_venue_id: null,
        p_storage_path: path,
        p_source: 'operator',
        p_idempotency_key: `receipt.create:${crypto.randomUUID()}`,
      });
      toast.ok(tr('ws.receipts.panel.saved'));
      void queryClient.invalidateQueries({ queryKey: SK.receipts });
      void navigate({ to: '/stock/receive', search: { receipt: id } });
      void readReceipt(id).then(() => {
        void queryClient.invalidateQueries({ queryKey: SK.receipts });
      });
    } catch (e) {
      if (e instanceof PhotoRejected) setRejected(e.reason);
      else setFailure(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  const toCheck = receipts.filter((r) => r.status !== 'reading').length;

  return (
    <Panel
      title={<CardTitle icon="receipt">{tr('ws.receipts.panel.title')}</CardTitle>}
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
          {toCheck > 0 && <StatusBadge tone="warn" label={tr('ws.receipts.panel.badge', { count: formatNumber(toCheck, locale) })} />}
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            data-testid="receipts.input"
            onChange={(e) => void scan(e.target.files)}
          />
          <Button size="sm" kind="soft" icon="receipt" busy={busy} onClick={() => input.current?.click()} data-testid="receipts.scan">
            {busy ? tr('ws.receipts.panel.uploading') : tr('ws.receipts.panel.scan')}
          </Button>
        </div>
      }
      data-testid="scanned-receipts"
    >
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0, marginBlockEnd: 'var(--tp-sp-2)' }}>
        {receipts.length === 0 ? tr('ws.receipts.panel.empty') : tr('ws.receipts.panel.lead')}
      </p>
      {rejected && (
        <p role="alert" style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)', margin: 0 }}>
          {tr(rejected === 'type' ? 'ws.receipts.panel.wrongType' : 'ws.receipts.panel.tooBig')}
        </p>
      )}
      <ErrorText error={failure ?? q.error} />
      {receipts.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
          {receipts.map((r) => (
            <li
              key={r.id}
              data-testid="receipts.row"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--tp-sp-2)',
                flexWrap: 'wrap',
                paddingBlock: 'var(--tp-sp-1-5)',
                paddingInline: 'var(--tp-sp-2)',
                borderRadius: 'var(--tp-radius-ctl)',
                background: 'var(--tp-surface-2)',
              }}
            >
              <span style={{ display: 'grid', flex: '1 1 14rem', minInlineSize: 0 }}>
                <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                  <bdi>{r.supplier_name_read ?? tr(`ws.receipts.status.${r.status}`)}</bdi>
                </span>
                <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                  <bdi>
                    {tr('ws.receipts.panel.from', {
                      name: isolate(r.uploaded_by_name ?? '—'),
                      time: r.created_at ? formatDateTime(new Date(r.created_at), locale) : '—',
                    })}
                  </bdi>
                  {r.line_count > 0 && (
                    <>
                      {' · '}
                      {tr('ws.receipts.panel.lines', {
                        matched: formatNumber(r.matched_count, locale),
                        count: formatNumber(r.line_count, locale),
                      })}
                    </>
                  )}
                </span>
              </span>
              <StatusBadge tone={STATUS_TONE[r.status]} label={tr(`ws.receipts.status.${r.status}`)} />
              {r.total_iqd_read !== null && <Money amount={r.total_iqd_read} strong />}
              <Button size="sm" kind="soft" icon="box" onClick={() => void navigate({ to: '/stock/receive', search: { receipt: r.id } })}>
                {tr('ws.receipts.panel.check')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
