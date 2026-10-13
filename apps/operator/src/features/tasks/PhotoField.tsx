/**
 * Photos on a desktop step form: files from this computer, uploaded the way
 * the phone uploads them (build-contracts-2026-09-23 §2.3, §5.3). Each file is
 * re-encoded to WebP first (lib/image.ts), as /protocols does, which also
 * drops the camera's location data. The server mints every path
 * (app.staff_media_slot), the file goes to exactly that path in the private
 * staff-media bucket, and only then does the path join the form; the
 * recording RPC claims it. A file that fails to upload never reaches the form,
 * so a submission never names a path with nothing behind it.
 *
 * The folder and the count come from the step's form (`photoFolder`,
 * `photosMin`, `photosMax`), never from here.
 *
 * One card: a white header with what it takes, how many are in and the Add
 * button on its end; under it, inset in the card, a rounded grey box with the
 * photos as thumbnails, each with its remove × on its corner. Tapping a thumbnail opens them full size.
 */
import { useRef, useState } from 'react';
import { formatNumber } from '@touch/i18n';
import type { PhotoFolder } from '@touch/core/protocols';
import { appRpc } from '../../lib/appRpc';
import { compressToWebp } from '../../lib/image';
import { supabase } from '../../lib/supabase';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Field } from '../../components/ui';
import { Icon } from '../../components/icons';
import { PhotoViewer, STAFF_MEDIA_BUCKET, StaffPhotoThumb } from '../checklists/StaffPhoto';

/** A thumbnail's side in the card. */
const TILE = '5rem';

const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** The bucket's own limit (0159): 5 MB. Checked here so the refusal names the file. */
const MAX_BYTES = 5 * 1024 * 1024;

export class PhotoRejected extends Error {
  constructor(readonly reason: 'type' | 'size') {
    super(reason);
  }
}

/** Mint a slot, upload the file to it, and return the path the server will claim. */
export async function uploadStaffPhoto(
  folder: PhotoFolder,
  file: File,
  // The /protocols sheet's size (features/protocols/PhotoField.tsx) by default,
  // so a photo reads the same whichever screen sent it. A scanned receipt asks
  // for more: handwriting needs the pixels (receipts/ReceiptsPanel.tsx).
  size: { maxPx: number; maxBytes: number } = { maxPx: 1600, maxBytes: 900_000 },
): Promise<string> {
  if (!TYPES.has(file.type)) throw new PhotoRejected('type');
  const webp = await compressToWebp(file, size).catch(() => {
    throw new PhotoRejected('type');
  });
  if (webp.size > MAX_BYTES) throw new PhotoRejected('size');
  const slot = await appRpc<{ path: string }>('staff_media_slot', { p_venue_id: null, p_folder: folder, p_ext: 'webp' });
  const { error } = await supabase.storage.from(STAFF_MEDIA_BUCKET).upload(slot.path, webp, { contentType: 'image/webp', upsert: false });
  if (error) throw error;
  return slot.path;
}

export function PhotoField({
  folder,
  paths,
  onChange,
  min,
  max,
  error,
  disabled,
}: {
  folder: PhotoFolder;
  paths: readonly string[];
  onChange: (next: string[]) => void;
  min: number;
  max: number;
  error?: string;
  disabled?: boolean;
}) {
  const { tr, locale } = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [rejected, setRejected] = useState<'type' | 'size' | null>(null);
  const [viewing, setViewing] = useState(false);

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setFailure(null);
    setRejected(null);
    const next = [...paths];
    try {
      for (const file of Array.from(files).slice(0, Math.max(0, max - next.length))) {
        next.push(await uploadStaffPhoto(folder, file));
        onChange([...next]);
      }
    } catch (e) {
      if (e instanceof PhotoRejected) setRejected(e.reason);
      else setFailure(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  const hint =
    min > 0
      ? tr('ws.team.tasks.photos.hintRange', { min: formatNumber(min, locale), max: formatNumber(max, locale) })
      : tr('ws.team.tasks.photos.hintUpTo', { max: formatNumber(max, locale) });

  return (
    // The hint lives in the card, beside the count, rather than under it.
    <Field label={tr('ws.team.tasks.photos.label')} required={min > 0} optional={min === 0} error={error} group>
      <div
        style={{
          display: 'grid',
          gap: 'var(--tp-sp-3)',
          padding: 'var(--tp-sp-3)',
          borderRadius: 'var(--tp-radius-panel)',
          border: '1px solid var(--tp-border-strong)',
          background: 'var(--tp-surface)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
          <span
            aria-hidden="true"
            style={{ display: 'grid', placeItems: 'center', inlineSize: '2.5rem', blockSize: '2.5rem', flex: 'none', borderRadius: 'var(--tp-radius-ctl)', background: 'var(--tp-accent-soft)', color: 'var(--tp-accent-soft-fg)' }}
          >
            <Icon name="image" size={20} />
          </span>
          <span style={{ flex: 1, minInlineSize: '10rem', display: 'grid', gap: 'var(--tp-sp-0)' }}>
            {/* How many are in, out of how many this step takes. */}
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatNumber(paths.length, locale)} / {formatNumber(max, locale)}
            </strong>
            <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{hint}</span>
          </span>
          {paths.length < max && (
            <>
              <input
                ref={input}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple={max - paths.length > 1}
                hidden
                data-testid="photo.input"
                onChange={(e) => void add(e.target.files)}
              />
              <Button icon="plus" busy={busy} disabled={disabled} onClick={() => input.current?.click()} data-testid="photo.add">
                {busy ? tr('ws.team.tasks.photos.uploading') : tr('ws.team.tasks.photos.add')}
              </Button>
            </>
          )}
        </div>
        {paths.length > 0 && (
          // Room above and at the end for each × that sits over its thumbnail's corner.
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--tp-sp-4)',
              paddingBlock: 'var(--tp-sp-4) var(--tp-sp-3)',
              paddingInline: 'var(--tp-sp-3) var(--tp-sp-4)',
              borderRadius: 'var(--tp-radius-ctl)',
              border: '1px solid var(--tp-border)',
              background: 'var(--tp-surface-2)',
            }}
          >
            {paths.map((p, i) => (
              <span key={p} style={{ position: 'relative', inlineSize: TILE, blockSize: TILE }}>
                <StaffPhotoThumb path={p} size={TILE} label={tr('ws.team.tasks.photos.photo', { n: formatNumber(i + 1, locale) })} onClick={() => setViewing(true)} />
                <button
                  type="button"
                  aria-label={tr('ws.team.tasks.photos.remove', { n: formatNumber(i + 1, locale) })}
                  title={tr('ws.team.tasks.photos.remove', { n: formatNumber(i + 1, locale) })}
                  disabled={disabled || busy}
                  onClick={() => onChange(paths.filter((x) => x !== p))}
                  style={{
                    position: 'absolute',
                    insetBlockStart: 'calc(var(--tp-sp-2) * -1)',
                    insetInlineEnd: 'calc(var(--tp-sp-2) * -1)',
                    inlineSize: '1.75rem',
                    blockSize: '1.75rem',
                    display: 'grid',
                    placeItems: 'center',
                    padding: 0,
                    borderRadius: 'var(--tp-radius-pill)',
                    border: '1px solid var(--tp-border-strong)',
                    background: 'var(--tp-surface)',
                    color: 'var(--tp-fg)',
                    boxShadow: 'var(--tp-shadow-raised)',
                    cursor: disabled || busy ? 'not-allowed' : 'pointer',
                    opacity: disabled || busy ? 'var(--tp-opacity-disabled)' : 1,
                  }}
                >
                  <Icon name="x" size={14} strokeWidth={2.5} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      {rejected && (
        <p role="alert" style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)', marginBlockStart: 'var(--tp-sp-1)' }}>
          {tr(rejected === 'type' ? 'ws.team.tasks.photos.wrongType' : 'ws.team.tasks.photos.tooBig')}
        </p>
      )}
      <ErrorText error={failure} />
      {viewing && paths.length > 0 && <PhotoViewer title={tr('ws.team.tasks.photos.label')} paths={paths} onClose={() => setViewing(false)} />}
    </Field>
  );
}
