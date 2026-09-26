/**
 * Work photos from the private `staff-media` bucket (0159), opened through a
 * signed URL that lasts ten minutes, as on the phone (build-contracts §2.3).
 * The bucket's read policy decides who sees a photo (app.staff_media_visible):
 * management sees every one at its venue, the driver's receipts included, so
 * this file asks for nothing it could be refused.
 *
 * Goods in shows the driver's receipt with it, /marketing the photos
 * marketing attached to a draft or staff attached to a request, and the
 * checklists sheet each ticked line's photo.
 */
import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { useLocale } from '../../lib/i18n';
import { Modal } from '../../components/ui';
import { Icon } from '../../components/icons';

export const STAFF_MEDIA_BUCKET = 'staff-media';
const SIGNED_SECONDS = 600;

export function useSignedPhoto(path: string | null) {
  return useQuery({
    queryKey: ['staffMedia', path],
    enabled: Boolean(path),
    // A minute short of the URL's life, so a cached link is never a dead one.
    staleTime: (SIGNED_SECONDS - 60) * 1000,
    gcTime: (SIGNED_SECONDS - 60) * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(STAFF_MEDIA_BUCKET).createSignedUrl(path ?? '', SIGNED_SECONDS);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export function StaffPhoto({ path, alt, style }: { path: string; alt: string; style?: CSSProperties }) {
  const { tr } = useLocale();
  const q = useSignedPhoto(path);
  const frame: CSSProperties = {
    display: 'grid',
    placeItems: 'center',
    minBlockSize: '10rem',
    borderRadius: 'var(--tp-radius-ctl)',
    background: 'var(--tp-surface-2)',
    border: '1px solid var(--tp-border)',
    overflow: 'hidden',
    ...style,
  };
  if (q.isSuccess) {
    return (
      <a href={q.data} target="_blank" rel="noreferrer" style={frame}>
        <img src={q.data} alt={alt} style={{ display: 'block', inlineSize: '100%', blockSize: 'auto', maxBlockSize: '70vh', objectFit: 'contain' }} />
      </a>
    );
  }
  return (
    <div style={{ ...frame, color: q.isError ? 'var(--tp-danger-fg)' : 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', padding: 'var(--tp-sp-3)' }}>
      {q.isError ? tr('ws.supplies.photo.error') : tr('ws.supplies.photo.loading')}
    </div>
  );
}

/**
 * A small square of one photo that opens it (the caller decides how: the
 * checklists sheet expands it under the line). While the link is fetched, or
 * when it cannot be, the square holds a photo mark instead, with the reason as
 * its tooltip.
 */
export function StaffPhotoThumb({ path, label, expanded, onClick }: { path: string; label: string; expanded?: boolean; onClick: () => void }) {
  const { tr } = useLocale();
  const q = useSignedPhoto(path);
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      title={q.isError ? tr('ws.supplies.photo.error') : label}
      onClick={onClick}
      style={{
        flex: '0 0 auto',
        display: 'grid',
        placeItems: 'center',
        inlineSize: '3rem',
        blockSize: '3rem',
        padding: 0,
        borderRadius: 'var(--tp-radius-ctl)',
        border: `1px solid ${expanded ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
        background: 'var(--tp-surface-2)',
        color: q.isError ? 'var(--tp-danger-fg)' : 'var(--tp-muted-fg)',
        overflow: 'hidden',
        cursor: 'pointer',
      }}
    >
      {q.isSuccess ? (
        <img src={q.data} alt="" style={{ display: 'block', inlineSize: '100%', blockSize: '100%', objectFit: 'cover' }} />
      ) : (
        <Icon name="frame" size={18} />
      )}
    </button>
  );
}

/** One or more photos in a dialog, largest first: a receipt has to be readable. */
export function PhotoViewer({ title, paths, onClose }: { title: string; paths: readonly string[]; onClose: () => void }) {
  const { tr, locale } = useLocale();
  return (
    <Modal title={title} onClose={onClose} size={paths.length > 1 ? 'xl' : 'lg'}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: paths.length > 1 ? 'repeat(auto-fit, minmax(16rem, 1fr))' : '1fr' }}>
        {paths.map((p, i) => (
          <StaffPhoto key={p} path={p} alt={tr('ws.supplies.photo.alt', { n: formatNumber(i + 1, locale) })} />
        ))}
      </div>
    </Modal>
  );
}
