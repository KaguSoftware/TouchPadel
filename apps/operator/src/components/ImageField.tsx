/**
 * Photo / hero-media picker: drag-and-drop or click, client-side WebP
 * compression (lib/image.ts), upload to `menu-media` (lib/storage.ts), then
 * `onChange(path)`. Persisting the path (set_item_photo / set_cafe_setting)
 * and removing the previous object are the CALLER's job — this field only
 * moves bytes. Remove asks for confirmation and emits `onChange(null)`.
 */
import { useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { useLocale } from '../lib/i18n';
import { compressToWebp, isImageFile, isVideoFile } from '../lib/image';
import {
  publicUrl,
  uploadMedia,
  isVideoPath,
  type MediaExt,
  type MediaFolder,
} from '../lib/storage';
import { useToast } from './toast';
import { useConfirm } from './ConfirmDialog';
import { Button, Spinner } from './ui';

export interface ImageFieldProps {
  label: string;
  /** Stored bucket path (not a URL) or null. */
  value: string | null;
  onChange: (path: string | null) => void;
  folder: MediaFolder;
  /** item / category id; ignored for `hero`. */
  ownerId?: string | null;
  accept?: 'image' | 'image+video';
  /** Input size ceiling before compression (default 10). */
  maxMb?: number;
  /** Videos pass through untouched, so they get their own ceiling (default = maxMb). */
  maxVideoMb?: number;
  aspect?: '1:1' | '16:9';
  /** Longest edge after compression (default 1200; hero 1600). */
  maxPx?: number;
  /** Compressed target (default 512 000; hero 800 000). */
  maxBytes?: number;
  disabled?: boolean;
  style?: CSSProperties;
}

export function ImageField({
  label,
  value,
  onChange,
  folder,
  ownerId = null,
  accept = 'image',
  maxMb = 10,
  maxVideoMb = maxMb,
  aspect = '1:1',
  maxPx,
  maxBytes,
  disabled,
  style,
}: ImageFieldProps) {
  const { tr } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const acceptAttr =
    accept === 'image+video'
      ? 'image/*,video/mp4,video/webm'
      : 'image/jpeg,image/png,image/webp,image/gif,image/avif';

  async function handleFile(file: File) {
    if (disabled || uploading) return;
    const video = accept === 'image+video' && isVideoFile(file);
    const ceilingMb = video ? maxVideoMb : maxMb;
    if (file.size > ceilingMb * 1024 * 1024) {
      toast.err(tr('op.toast.tooLarge', { mb: ceilingMb }));
      return;
    }
    if (!video && !isImageFile(file)) {
      toast.err(tr('op.toast.invalidImage'));
      return;
    }
    setUploading(true);
    try {
      let blob: Blob;
      let ext: MediaExt;
      if (video) {
        blob = file;
        ext = file.type === 'video/webm' ? 'webm' : 'mp4';
      } else {
        try {
          blob = await compressToWebp(file, { maxPx, maxBytes });
        } catch {
          toast.err(tr('op.toast.invalidImage'));
          return;
        }
        ext = 'webp';
      }
      const path = await uploadMedia(folder, ownerId, blob, ext);
      onChange(path);
    } catch {
      toast.err(tr('op.toast.uploadFailed'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove() {
    if (disabled || uploading) return;
    const ok = await confirm({
      title: tr('op.confirm.removePhoto'),
      kind: 'danger',
      confirmLabel: tr('op.common.remove'),
    });
    if (ok) onChange(null);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  const preview = value ? publicUrl(value) : null;

  return (
    <div style={{ marginBlockEnd: '0.6rem', ...style }}>
      <span
        style={{
          display: 'block',
          fontSize: 'var(--tp-fs-sm)',
          color: 'var(--tp-muted-fg)',
          marginBlockEnd: '0.2rem',
        }}
      >
        {label}
      </span>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={value ? tr('op.common.replace') : tr('op.common.upload')}
        aria-busy={uploading || undefined}
        onClick={() => !disabled && !uploading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled && !uploading) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          position: 'relative',
          inlineSize: '100%',
          maxInlineSize: aspect === '16:9' ? '22rem' : '14rem',
          aspectRatio: aspect === '16:9' ? '16 / 9' : '1 / 1',
          border: `2px dashed ${dragOver ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
          borderRadius: 'var(--tp-radius-ctl)',
          background: 'var(--tp-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 'var(--tp-opacity-disabled)' : 1,
          // No `outline: 'none'`. This is a role="button" tabIndex={0} drop
          // zone, so removing its ring left the only keyboard-reachable control
          // in the app with no visible focus — a flat accessibility failure.
          // The global :focus-visible rule paints it.
        }}
      >
        {preview &&
          !uploading &&
          (isVideoPath(value) ? (
            <video
              src={preview}
              muted
              loop
              autoPlay
              playsInline
              style={{ inlineSize: '100%', blockSize: '100%', objectFit: 'cover' }}
            />
          ) : (
            <img
              src={preview}
              alt=""
              style={{ inlineSize: '100%', blockSize: '100%', objectFit: 'cover' }}
            />
          ))}
        {uploading && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Spinner size="sm" />
            <span style={{ fontSize: 'var(--tp-fs-md)' }}>{tr('op.common.uploading')}</span>
          </span>
        )}
        {!preview && !uploading && (
          <span
            style={{
              fontSize: 'var(--tp-fs-md)',
              color: 'var(--tp-muted-fg)',
              textAlign: 'center',
              paddingInline: '0.8rem',
            }}
          >
            {tr('op.common.dragHere')}
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={acceptAttr}
        disabled={disabled}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <div data-no-print style={{ display: 'flex', gap: '0.4rem', marginBlockStart: '0.4rem' }}>
        <Button
          kind="ghost"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {value ? tr('op.common.replace') : tr('op.common.upload')}
        </Button>
        {value && (
          <Button kind="ghost" disabled={disabled || uploading} onClick={() => void remove()}>
            {tr('op.common.remove')}
          </Button>
        )}
      </div>
    </div>
  );
}
