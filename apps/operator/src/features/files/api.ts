/**
 * The Files page's reads and writes (0354). Every key sits under ['files'].
 *
 * An upload is four steps, in this order, and nothing leaves the browser
 * before the first is done:
 *   1. compress: the file (compress.ts) and its words (extract.ts → gzip);
 *   2. venue_file_begin with the compressed sizes: the server records the
 *      file and mints the two object names;
 *   3. upload the compressed objects to exactly those names;
 *   4. venue_file_finish. A text object that failed to upload is dropped
 *      (the file is kept without text); a failed file upload leaves the row
 *      unfinished, which every read ignores.
 */
import type { QueryKey } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { supabase } from '../../lib/supabase';
import { STORED_TYPES, compressFile, gzipText, restoreFile, type Encoding } from './compress';
import { extractText } from './extract';
import { cleanMime, cleanName } from './filesLogic';

export const FILES_BUCKET = 'venue-files';

export const FK = {
  all: ['files'] as const satisfies QueryKey,
  list: () => ['files', 'list'] as const satisfies QueryKey,
} as const;

export function fetchFiles(): Promise<unknown> {
  return appRpc<unknown>('venue_files_list', {});
}

export type UploadStage = 'compressing' | 'uploading' | 'saving';

export interface UploadInput {
  file: File;
  note: string;
  ownerOnly: boolean;
  onStage?: (stage: UploadStage) => void;
}

interface Begun {
  id: string;
  blob_path: string;
  text_path: string | null;
}

async function put(path: string, blob: Blob, encoding: Encoding | 'text'): Promise<void> {
  const contentType = encoding === 'webp' ? STORED_TYPES.webp : STORED_TYPES.gzip;
  const { error } = await supabase.storage.from(FILES_BUCKET).upload(path, blob, { contentType, upsert: false, cacheControl: '3600' });
  if (error) throw error;
}

export async function uploadFile({ file, note, ownerOnly, onStage }: UploadInput): Promise<unknown> {
  onStage?.('compressing');
  const [packed, words] = await Promise.all([compressFile(file), extractText(file)]);
  const packedText = words ? await gzipText(words) : null;

  onStage?.('uploading');
  const begun = await appRpc<Begun>('venue_file_begin', {
    p_name: cleanName(file.name),
    p_mime: cleanMime(file.type),
    p_size_bytes: file.size,
    p_stored_bytes: packed.blob.size,
    p_encoding: packed.encoding,
    p_text_bytes: packedText ? packedText.size : null,
    p_note: note.trim() || null,
    p_owner_only: ownerOnly,
  });
  await put(begun.blob_path, packed.blob, packed.encoding);

  let textChars: number | null = null;
  if (packedText && words && begun.text_path) {
    try {
      await put(begun.text_path, packedText, 'text');
      textChars = words.length;
    } catch {
      textChars = null;
    }
  }

  onStage?.('saving');
  return appRpc<unknown>('venue_file_finish', { p_id: begun.id, p_text_chars: textChars });
}

export function updateFile(id: string, name: string, note: string, ownerOnly: boolean | null): Promise<unknown> {
  return appRpc<unknown>('venue_file_update', {
    p_id: id,
    p_name: name,
    p_note: note.trim() || null,
    ...(ownerOnly === null ? {} : { p_owner_only: ownerOnly }),
  });
}

/**
 * The objects first, then the row. Storage finds an object through its read
 * rule before deleting it, so the row must still be there (0354); its delete
 * rule admits the same people venue_file_delete does. A refused or failed
 * storage call stops here with the file intact; objects gone and the row
 * left (the RPC failed) shows a file that will not download, and removing it
 * again finishes the job.
 */
export async function deleteFile(file: { id: string; blobPath: string; textPath: string | null }): Promise<void> {
  const paths = [file.blobPath, ...(file.textPath ? [file.textPath] : [])];
  const { error } = await supabase.storage.from(FILES_BUCKET).remove(paths);
  if (error) throw error;
  await appRpc<unknown>('venue_file_delete', { p_id: file.id });
}

/** The stored object, unpacked back to the file that was picked. */
export async function fetchFileBlob(blobPath: string, encoding: Encoding, mime: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(FILES_BUCKET).download(blobPath);
  if (error || !data) throw error ?? new Error('download failed');
  return restoreFile(data, encoding, mime);
}
