/**
 * The Files page's PDF viewer (F-64, Majed 2026-11-01: "an in-app PDF viewer").
 * The stored file is fetched and unpacked as Download does (fetchFileBlob),
 * then drawn page by page on a canvas with pdf.js, on the main thread as the
 * word extraction does (extract.ts: the shell loads the app from file://, so
 * no Worker is started; pdf.js's worker module is put on globalThis). Previous
 * and Next move a page; the document is torn down when the dialog closes.
 */
import { useEffect, useRef, useState } from 'react';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button, Modal } from '../../components/ui';
import { MessagePresenter } from '../../components/kit';
import { fetchFileBlob } from './api';
import { stepPage, type StoredFile } from './filesLogic';

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown; canvas?: HTMLCanvasElement }) => { promise: Promise<void> };
  cleanup: () => void;
};

async function openPdf(buf: Uint8Array): Promise<{ doc: PdfDoc; destroy: () => Promise<void> }> {
  const g = globalThis as { pdfjsWorker?: unknown };
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    g.pdfjsWorker ? Promise.resolve(g.pdfjsWorker) : import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ]);
  g.pdfjsWorker ??= worker;
  const task = pdfjs.getDocument({ data: buf, verbosity: 0 });
  const doc = (await task.promise) as unknown as PdfDoc;
  return { doc, destroy: () => task.destroy() };
}

export function PdfViewer({ file, onClose }: { file: StoredFile; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let destroy: (() => Promise<void>) | null = null;
    let gone = false;
    void (async () => {
      try {
        const blob = await fetchFileBlob(file.blobPath, file.encoding, file.mime);
        const opened = await openPdf(new Uint8Array(await blob.arrayBuffer()));
        destroy = opened.destroy;
        if (gone) return void opened.destroy();
        setDoc(opened.doc);
      } catch {
        if (!gone) setFailed(true);
      }
    })();
    return () => {
      gone = true;
      if (destroy) void destroy();
    };
  }, [file.blobPath, file.encoding, file.mime]);

  useEffect(() => {
    if (!doc || !canvas.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const p = await doc.getPage(page);
        if (cancelled || !canvas.current) return;
        const base = p.getViewport({ scale: 1 });
        const width = canvas.current.parentElement?.clientWidth || 800;
        const viewport = p.getViewport({ scale: Math.min(2, width / base.width) });
        const c = canvas.current;
        c.width = Math.floor(viewport.width);
        c.height = Math.floor(viewport.height);
        const ctx = c.getContext('2d');
        if (!ctx) return;
        await p.render({ canvasContext: ctx, viewport, canvas: c }).promise;
        p.cleanup();
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, page]);

  const total = doc?.numPages ?? 0;
  return (
    <Modal
      title={file.name}
      onClose={onClose}
      size="lg"
      footer={
        doc ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', inlineSize: '100%' }}>
            <Button size="sm" icon="chevronStart" disabled={page <= 1} onClick={() => setPage(stepPage(page, -1, total))} data-testid="pdf.previous">
              {tr('ws.files.viewer.previous')}
            </Button>
            <span data-testid="pdf.page" style={{ marginInline: 'auto', fontVariantNumeric: 'tabular-nums' }}>
              {tr('ws.files.viewer.page', { n: formatNumber(page, locale), total: formatNumber(total, locale) })}
            </span>
            <Button size="sm" iconEnd="chevronEnd" disabled={page >= total} onClick={() => setPage(stepPage(page, 1, total))} data-testid="pdf.next">
              {tr('ws.files.viewer.next')}
            </Button>
          </div>
        ) : undefined
      }
    >
      {failed ? (
        <MessagePresenter tone="error" message={tr('ws.files.viewer.failed')} />
      ) : !doc ? (
        <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr('ws.files.viewer.loading')}</p>
      ) : null}
      <div style={{ display: doc && !failed ? 'block' : 'none', overflow: 'auto', maxBlockSize: '70vh', background: 'var(--tp-surface-2)', borderRadius: 'var(--tp-radius-ctl)' }}>
        <canvas ref={canvas} data-testid="pdf.canvas" style={{ display: 'block', marginInline: 'auto', maxInlineSize: '100%' }} />
      </div>
    </Modal>
  );
}
