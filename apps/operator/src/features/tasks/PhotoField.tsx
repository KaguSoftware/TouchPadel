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
 */
import { useRef, useState } from 'react';
import { formatNumber } from '@touch/i18n';
import type { PhotoFolder } from '@touch/core/protocols';
import { appRpc } from '../../lib/appRpc';
import { compressToWebp } from '../../lib/image';
import { supabase } from '../../lib/supabase';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Field } from '../../components/ui';
import { PhotoViewer, STAFF_MEDIA_BUCKET, StaffPhotoThumb } from '../checklists/StaffPhoto';

const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** The bucket's own limit (0159): 5 MB. Checked here so the refusal names the file. */
const MAX_BYTES = 5 * 1024 * 1024;

export class PhotoRejected extends Error {
  constructor(readonly reason: 'type' | 'size') {
    super(reason);
  }
}

/** Mint a slot, upload the file to it, and return the path the server will claim. */
export async function uploadStaffPhoto(folder: PhotoFolder, file: File): Promise<string> {
  if (!TYPES.has(file.type)) throw new PhotoRejected('type');
  // The /protocols sheet's size (features/protocols/PhotoField.tsx), so a
  // photo reads the same whichever screen sent it.
  const webp = await compressToWebp(file, { maxPx: 1600, maxBytes: 900_000 }).catch(() => {
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
    <Field label={tr('ws.team.tasks.photos.label')} required={min > 0} optional={min === 0} hint={hint} error={error} group>
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        {paths.map((p, i) => (
          <span key={p} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--tp-sp-0)' }}>
            <StaffPhotoThumb path={p} label={tr('ws.team.tasks.photos.photo', { n: formatNumber(i + 1, locale) })} onClick={() => setViewing(true)} />
            <Button
              size="sm"
              kind="ghost"
              icon="trash"
              aria-label={tr('ws.team.tasks.photos.remove', { n: formatNumber(i + 1, locale) })}
              disabled={disabled || busy}
              onClick={() => onChange(paths.filter((x) => x !== p))}
            />
          </span>
        ))}
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
            <Button size="sm" icon="plus" busy={busy} disabled={disabled} onClick={() => input.current?.click()} data-testid="photo.add">
              {busy ? tr('ws.team.tasks.photos.uploading') : tr('ws.team.tasks.photos.add')}
            </Button>
          </>
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
