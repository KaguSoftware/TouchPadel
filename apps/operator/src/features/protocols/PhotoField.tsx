/**
 * Photos on a desktop step form (build-contracts-2026-09-23 §5.3, §2.3): the
 * same contract as the phone. The server mints each path
 * (app.staff_media_slot), the file goes to the private `staff-media` bucket
 * under it, and the step's submit claims the paths. Files are re-encoded to
 * WebP first (lib/image.ts), which also drops the camera's location data.
 *
 * A photo already sent in an earlier round comes back with the form: the
 * engine re-claims it for the new submission, so it is kept, not uploaded
 * again.
 */
import { useRef, useState } from 'react';
import { formatNumber } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { compressToWebp, isImageFile } from '../../lib/image';
import { supabase } from '../../lib/supabase';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText } from '../../components/ui';
import { PhotoViewer, STAFF_MEDIA_BUCKET, StaffPhotoThumb } from '../checklists/StaffPhoto';

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Upload one file into a fresh slot of `folder`; resolves to its path. */
export async function uploadStaffPhoto(file: File, folder: string): Promise<string> {
  const webp = await compressToWebp(file, { maxPx: 1600, maxBytes: 900_000 });
  if (webp.size > PHOTO_MAX_BYTES) throw new Error('PHOTO_TOO_BIG');
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
  disabled,
  invalid,
}: {
  folder: string;
  paths: string[];
  onChange: (next: string[]) => void;
  min: number;
  max: number;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const { tr, locale } = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notImage, setNotImage] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const room = max - paths.length;

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setNotImage(false);
    setBusy(true);
    const added: string[] = [];
    try {
      for (const file of [...files].slice(0, Math.max(0, room))) {
        if (!isImageFile(file)) {
          setNotImage(true);
          continue;
        }
        added.push(await uploadStaffPhoto(file, folder));
      }
    } catch (e) {
      setError(e);
    } finally {
      if (added.length > 0) onChange([...paths, ...added]);
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  const count =
    min > 0
      ? tr('ws.protocols.photos.countMin', { count: formatNumber(paths.length, locale), min: formatNumber(min, locale), max: formatNumber(max, locale) })
      : tr('ws.protocols.photos.count', { count: formatNumber(paths.length, locale), max: formatNumber(max, locale) });

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }} data-testid="photo-field">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--tp-sp-2)' }}>
        <strong>{tr('ws.protocols.photos.label')}</strong>
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: invalid ? 'var(--tp-danger-fg)' : 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
      </div>
      {paths.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
          {paths.map((p, i) => (
            <li key={p} style={{ display: 'grid', gap: 'var(--tp-sp-0)', justifyItems: 'center' }}>
              <StaffPhotoThumb path={p} label={tr('ws.protocols.photos.open', { n: formatNumber(i + 1, locale) })} onClick={() => setViewing(p)} />
              {!disabled && (
                <Button
                  size="sm"
                  kind="ghost"
                  icon="x"
                  aria-label={tr('ws.protocols.photos.remove', { n: formatNumber(i + 1, locale) })}
                  title={tr('ws.protocols.photos.remove', { n: formatNumber(i + 1, locale) })}
                  onClick={() => onChange(paths.filter((x) => x !== p))}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && room > 0 && (
        <div>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => void add(e.target.files)}
          />
          <Button size="sm" icon="plus" busy={busy} onClick={() => input.current?.click()}>
            {tr(busy ? 'ws.protocols.photos.uploading' : 'ws.protocols.photos.add')}
          </Button>
        </div>
      )}
      {notImage && <p style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.protocols.photos.notImage')}</p>}
      {error != null &&
        (error instanceof Error && error.message === 'PHOTO_TOO_BIG' ? (
          <p style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.protocols.photos.tooBig')}</p>
        ) : (
          <ErrorText error={error} />
        ))}
      {viewing && <PhotoViewer title={tr('ws.protocols.photos.label')} paths={[viewing]} onClose={() => setViewing(null)} />}
    </div>
  );
}

/** Photos someone sent, as thumbnails that open larger. */
export function PhotoStrip({ paths, title }: { paths: readonly string[]; title: string }) {
  const { tr, locale } = useLocale();
  const [viewing, setViewing] = useState<string | null>(null);
  if (paths.length === 0) return null;
  return (
    <>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
        {paths.map((p, i) => (
          <li key={p}>
            <StaffPhotoThumb path={p} label={tr('ws.protocols.photos.open', { n: formatNumber(i + 1, locale) })} onClick={() => setViewing(p)} />
          </li>
        ))}
      </ul>
      {viewing && <PhotoViewer title={title} paths={paths.includes(viewing) ? [viewing, ...paths.filter((x) => x !== viewing)] : [viewing]} onClose={() => setViewing(null)} />}
    </>
  );
}
