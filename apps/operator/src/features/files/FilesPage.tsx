/**
 * Files (/files, 0354; Majed 2026-10-20): the documents the owner and the
 * managers keep in the system, and the ones the owner's assistant reads.
 *
 * One job leads: put a file in. The drop area is always open at the top, and a
 * file starts on its way the moment it lands, with a line per file saying
 * where it is (packing, sending, saved and how much smaller). Every file is
 * compressed in the browser before anything is sent (compress.ts), and its
 * words are pulled out for the assistant (extract.ts). The owner can keep the
 * next files to themselves with "Only me" before dropping them.
 *
 * Below: the branch's files, newest first, found by name or note. A row says
 * what the file is, who added it and when, its size before and after packing,
 * and whether the assistant can read its words. Download unpacks it back to
 * the original; Edit opens the row in place (name, note, and for the owner who
 * may see it); Remove asks first. A manager removes only what they added.
 */
import { useId, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, formatNumber, type MessageKey } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { Button, ErrorText, Field, Skeleton, Spinner, inputStyle } from '../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, PageHeader, Panel, SearchField, StatusBadge, type Column } from '../../components/kit';
import { Icon } from '../../components/icons';
import { downloadName } from './compress';
import { FK, deleteFile, fetchFileBlob, fetchFiles, updateFile, uploadFile, type UploadStage } from './api';
import {
  KIND_ICON,
  NAME_MAX,
  NOTE_MAX,
  fileKind,
  matchesQuery,
  pickProblem,
  readList,
  savedPercent,
  sizeParts,
  usedShare,
  type FilesView,
  type StoredFile,
} from './filesLogic';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;

export function FilesPageScreen() {
  const { tr } = useLocale();
  const q = useQuery({ queryKey: FK.list(), queryFn: fetchFiles });
  const view = readList(q.data);
  const [query, setQuery] = useState('');
  const shown = view.files.filter((f) => matchesQuery(f, query));

  return (
    <div style={{ maxInlineSize: '96rem' }}>
      <PageHeader title={tr('ws.files.title')} subtitle={tr('ws.files.lead')} />
      <div style={{ display: 'grid', gap: 'var(--tp-sp-5)' }}>
        <AddFiles view={view} ready={q.data !== undefined} />

        <section aria-labelledby="files-list-title" style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--tp-sp-3)' }}>
            <h2 id="files-list-title" style={{ fontSize: 'var(--tp-fs-lg)', fontWeight: 700, color: 'var(--tp-heading)' }}>
              {tr('ws.files.list.title')}
            </h2>
            <Usage view={view} ready={q.data !== undefined} />
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder={tr('ws.files.list.search')}
              aria-label={tr('ws.files.list.search')}
              style={{ marginInlineStart: 'auto', inlineSize: '20rem', maxInlineSize: '100%' }}
            />
          </div>
          <AsyncStateWrapper
            status={q.isError && q.data === undefined ? 'error' : q.data === undefined ? 'loading' : 'ready'}
            error={q.error}
            onRetry={() => void q.refetch()}
            skeleton={<Skeleton lines={5} blockSize="2.5rem" />}
          >
            {view.files.length === 0 ? (
              <EmptyState icon="folder" title={tr('ws.files.list.emptyTitle')} body={tr('ws.files.list.emptyBody')} />
            ) : shown.length === 0 ? (
              <EmptyState kind="filtered" onClearFilters={() => setQuery('')} />
            ) : (
              <FileTable files={shown} isOwner={view.isOwner} />
            )}
          </AsyncStateWrapper>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sizes in words
// ---------------------------------------------------------------------------

function useSize() {
  const { tr, locale } = useLocale();
  return (bytes: number) => {
    const { value, unit } = sizeParts(bytes);
    return tr(`ws.files.size.${unit}` as MessageKey, { n: formatNumber(value, locale) });
  };
}

function Usage({ view, ready }: { view: FilesView; ready: boolean }) {
  const { tr } = useLocale();
  const size = useSize();
  if (!ready || view.quotaBytes <= 0) return null;
  const share = usedShare(view);
  return (
    <span style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }} data-testid="files.usage">
      <span
        aria-hidden="true"
        style={{ inlineSize: '5rem', blockSize: '0.375rem', borderRadius: '999px', background: 'var(--tp-surface-2)', border: '1px solid var(--tp-border)', overflow: 'hidden' }}
      >
        <span
          style={{
            display: 'block',
            blockSize: '100%',
            inlineSize: `${Math.max(share * 100, share > 0 ? 3 : 0)}%`,
            background: share > 0.9 ? 'var(--tp-danger-mark)' : 'var(--tp-accent)',
          }}
        />
      </span>
      {tr('ws.files.usage', { used: size(view.usedBytes), total: size(view.quotaBytes) })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Putting files in
// ---------------------------------------------------------------------------

type Job = {
  key: string;
  name: string;
  size: number;
  stage: UploadStage | 'done' | 'failed';
  stored?: number;
  readable?: boolean;
  error?: unknown;
};

function AddFiles({ view, ready }: { view: FilesView; ready: boolean }) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const size = useSize();
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [dragOver, setDragOver] = useState(false);
  const [ownerOnly, setOwnerOnly] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const busy = jobs.some((j) => j.stage !== 'done' && j.stage !== 'failed');

  const patch = (key: string, next: Partial<Job>) => setJobs((all) => all.map((j) => (j.key === key ? { ...j, ...next } : j)));

  async function take(list: FileList | null) {
    if (!list || !list.length || !ready) return;
    const picked = [...list];
    const fresh: Job[] = picked.map((f) => ({ key: crypto.randomUUID(), name: f.name, size: f.size, stage: 'compressing' }));
    setJobs((all) => [...fresh, ...all.filter((j) => j.stage !== 'done' && j.stage !== 'failed')]);
    if (inputRef.current) inputRef.current.value = '';
    // One at a time: the quota check on the server sees each file's real size.
    for (const [i, file] of picked.entries()) {
      const job = fresh[i]!;
      const problem = pickProblem(file, view);
      if (problem) {
        patch(job.key, { stage: 'failed', error: tr(`ws.files.add.problem.${problem}` as MessageKey) });
        continue;
      }
      try {
        const saved = (await uploadFile({ file, note: '', ownerOnly, onStage: (stage) => patch(job.key, { stage }) })) as Record<string, unknown>;
        patch(job.key, {
          stage: 'done',
          stored: typeof saved?.stored_bytes === 'number' ? saved.stored_bytes : undefined,
          readable: saved?.has_text === true,
        });
      } catch (e) {
        patch(job.key, { stage: 'failed', error: e });
      }
      void qc.invalidateQueries({ queryKey: FK.all });
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    void take(e.dataTransfer.files);
  }

  return (
    <Panel title={tr('ws.files.add.title')}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <div
          role="button"
          tabIndex={ready ? 0 : -1}
          aria-describedby={hintId}
          aria-disabled={!ready || undefined}
          onClick={() => ready && inputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && ready) {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (ready) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          data-testid="files.drop"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--tp-sp-4)',
            padding: 'var(--tp-sp-5) var(--tp-sp-5)',
            border: `2px dashed ${dragOver ? 'var(--tp-accent)' : 'var(--tp-border-input)'}`,
            borderRadius: 'var(--tp-radius-ctl)',
            background: dragOver ? 'var(--tp-accent-soft)' : 'var(--tp-surface)',
            cursor: ready ? 'pointer' : 'not-allowed',
            opacity: ready ? 1 : 'var(--tp-opacity-disabled)',
          }}
        >
          <Icon name="upload" size={28} style={{ color: 'var(--tp-accent)', flexShrink: 0 }} />
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', minInlineSize: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 'var(--tp-fs-md)' }}>{tr('ws.files.add.drop')}</span>
            <span id={hintId} style={muted}>
              {tr('ws.files.add.hint')}
            </span>
          </div>
          <span style={{ marginInlineStart: 'auto' }}>
            <Button kind="primary" icon="plus" disabled={!ready} onClick={() => inputRef.current?.click()} data-testid="files.pick">
              {tr('ws.files.add.pick')}
            </Button>
          </span>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => void take(e.target.files)}
            data-testid="files.input"
          />
        </div>

        {view.isOwner && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, cursor: 'pointer', inlineSize: 'fit-content' }}>
            <input
              type="checkbox"
              checked={ownerOnly}
              disabled={busy}
              onChange={(e) => setOwnerOnly(e.target.checked)}
              data-testid="files.ownerOnly"
              style={{ inlineSize: '1.1rem', blockSize: '1.1rem' }}
            />
            {tr('ws.files.add.ownerOnly')}
            <span style={{ ...muted, fontWeight: 400 }}>{tr('ws.files.add.ownerOnlyHint')}</span>
          </label>
        )}

        {jobs.length > 0 && (
          <ul aria-live="polite" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }} data-testid="files.jobs">
            {jobs.map((j) => (
              <li key={j.key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', minBlockSize: 'var(--tp-row-h-dense)' }}>
                {j.stage === 'done' ? (
                  <Icon name="checkCircle" size={18} style={{ color: 'var(--tp-success-mark)' }} />
                ) : j.stage === 'failed' ? (
                  <Icon name="alert" size={18} style={{ color: 'var(--tp-danger-mark)' }} />
                ) : (
                  <Spinner size="xs" />
                )}
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxInlineSize: '24rem' }}><bdi>{j.name}</bdi></span>
                <span style={muted}>
                  {j.stage === 'done'
                    ? tr(j.readable ? 'ws.files.add.doneReadable' : 'ws.files.add.done', {
                        size: size(j.stored ?? j.size),
                        saved: formatNumber(savedPercent(j.size, j.stored ?? j.size), locale),
                      })
                    : j.stage === 'failed'
                      ? null
                      : tr(`ws.files.add.stage.${j.stage}` as MessageKey)}
                </span>
                {j.stage === 'failed' && (typeof j.error === 'string' ? <span style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>{j.error}</span> : <ErrorText error={j.error} style={{ margin: 0 }} />)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function FileTable({ files, isOwner }: { files: StoredFile[]; isOwner: boolean }) {
  const { tr, locale } = useLocale();
  const size = useSize();
  const [editing, setEditing] = useState<string | null>(null);

  const columns: Column<StoredFile>[] = [
    {
      key: 'name',
      header: tr('ws.files.col.name'),
      render: (f) =>
        editing === f.id ? (
          <EditRow file={f} isOwner={isOwner} onDone={() => setEditing(null)} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--tp-sp-2)', paddingBlock: 'var(--tp-sp-1)', minInlineSize: 0 }}>
            <Icon name={KIND_ICON[fileKind(f.name, f.mime)]} size={18} style={{ color: 'var(--tp-muted-fg)', flexShrink: 0, marginBlockStart: '0.1rem' }} />
            <div style={{ display: 'grid', minInlineSize: 0 }}>
              <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                <bdi>{f.name}</bdi>
                {f.ownerOnly && (
                  <span style={{ marginInlineStart: 'var(--tp-sp-2)' }}>
                    <StatusBadge size="sm" tone="neutral" icon="lock" dot={false} label={tr('ws.files.ownerOnly')} />
                  </span>
                )}
              </span>
              {f.note && <span style={{ ...muted, overflowWrap: 'anywhere' }}>{f.note}</span>}
            </div>
          </div>
        ),
    },
    {
      key: 'added',
      header: tr('ws.files.col.added'),
      width: '12rem',
      render: (f) => (
        <div style={{ display: 'grid' }}>
          <span>{f.addedAt ? formatDate(new Date(f.addedAt), locale) : ''}</span>
          {f.uploadedByName && <span style={muted}>{f.uploadedByName}</span>}
        </div>
      ),
    },
    {
      key: 'size',
      header: tr('ws.files.col.size'),
      width: '15rem',
      render: (f) => (
        <div style={{ display: 'grid' }}>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{size(f.sizeBytes)}</span>
          <span style={muted}>
            {savedPercent(f.sizeBytes, f.storedBytes) > 0
              ? tr('ws.files.stored', { size: size(f.storedBytes), saved: formatNumber(savedPercent(f.sizeBytes, f.storedBytes), locale) })
              : tr('ws.files.storedSame', { size: size(f.storedBytes) })}
          </span>
        </div>
      ),
    },
    {
      key: 'assistant',
      header: tr('ws.files.col.assistant'),
      width: '10rem',
      render: (f) =>
        f.hasText ? (
          <StatusBadge size="sm" tone="info" icon="spark" dot={false} label={tr('ws.files.readable')} title={tr('ws.files.readableHint')} />
        ) : (
          <span style={muted} title={tr('ws.files.nameOnlyHint')}>
            {tr('ws.files.nameOnly')}
          </span>
        ),
    },
    {
      key: 'actions',
      header: <span className="tp-sr-only">{tr('ws.files.col.actions')}</span>,
      width: '15rem',
      align: 'end',
      render: (f) => (editing === f.id ? null : <RowButtons file={f} onEdit={() => setEditing(f.id)} />),
    },
  ];

  return <DataTable columns={columns} rows={files} rowKey={(f) => f.id} aria-label={tr('ws.files.list.title')} />;
}

function RowButtons({ file, onEdit }: { file: StoredFile; onEdit: () => void }) {
  const { tr } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [downloading, setDownloading] = useState(false);

  const remove = useMutation({
    mutationFn: () => deleteFile(file),
    onSuccess: () => {
      toast.ok(tr('ws.files.removed', { name: file.name }));
      void qc.invalidateQueries({ queryKey: FK.all });
    },
    onError: (e) => toast.err(e),
  });

  async function download() {
    setDownloading(true);
    try {
      const blob = await fetchFileBlob(file.blobPath, file.encoding, file.mime);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName(file.name, file.encoding);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.err(e);
    } finally {
      setDownloading(false);
    }
  }

  async function askRemove() {
    const ok = await confirm({
      title: tr('ws.files.removeTitle', { name: file.name }),
      body: tr('ws.files.removeBody'),
      kind: 'danger',
      confirmLabel: tr('ws.files.remove'),
    });
    if (ok) remove.mutate();
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
      <Button size="sm" kind="ghost" icon="download" busy={downloading} onClick={() => void download()} data-testid={`files.download.${file.id}`}>
        {tr('ws.files.download')}
      </Button>
      <Button size="sm" kind="ghost" icon="note" onClick={onEdit} data-testid={`files.edit.${file.id}`}>
        {tr('ws.files.edit')}
      </Button>
      <Button
        size="sm"
        kind="ghost"
        icon="trash"
        busy={remove.isPending}
        disabled={!file.canDelete}
        disabledReason={file.canDelete ? undefined : tr('ws.files.notYours')}
        onClick={() => void askRemove()}
        aria-label={tr('ws.files.removeTitle', { name: file.name })}
        data-testid={`files.remove.${file.id}`}
      />
    </div>
  );
}

function EditRow({ file, isOwner, onDone }: { file: StoredFile; isOwner: boolean; onDone: () => void }) {
  const { tr } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(file.name);
  const [note, setNote] = useState(file.note ?? '');
  const [ownerOnly, setOwnerOnly] = useState(file.ownerOnly);

  const save = useMutation({
    mutationFn: () => updateFile(file.id, name.trim(), note, isOwner ? ownerOnly : null),
    onSuccess: () => {
      toast.ok(tr('ws.files.saved'));
      void qc.invalidateQueries({ queryKey: FK.all });
      onDone();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    save.mutate();
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--tp-sp-2)', paddingBlock: 'var(--tp-sp-2)', maxInlineSize: '36rem' }} data-testid={`files.editForm.${file.id}`}>
      <Field label={tr('ws.files.field.name')} required>
        <input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} style={inputStyle} autoFocus data-testid="files.field.name" />
      </Field>
      <Field label={tr('ws.files.field.note')} optional hint={tr('ws.files.field.noteHint')}>
        <textarea value={note} maxLength={NOTE_MAX} rows={2} onChange={(e) => setNote(e.target.value)} style={{ ...inputStyle, blockSize: 'auto', resize: 'vertical' }} data-testid="files.field.note" />
      </Field>
      {isOwner && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" checked={ownerOnly} onChange={(e) => setOwnerOnly(e.target.checked)} style={{ inlineSize: '1.1rem', blockSize: '1.1rem' }} data-testid="files.field.ownerOnly" />
          {tr('ws.files.add.ownerOnly')}
        </label>
      )}
      <ErrorText error={save.error} />
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)' }}>
        <Button type="submit" kind="primary" size="sm" busy={save.isPending} disabled={!name.trim()} data-testid="files.field.save">
          {tr('ws.files.save')}
        </Button>
        <Button size="sm" kind="ghost" onClick={onDone} disabled={save.isPending}>
          {tr('ws.files.cancel')}
        </Button>
      </div>
    </form>
  );
}
