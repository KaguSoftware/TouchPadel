/**
 * The Files page's pure half (0354): reading the server's list, sizes in
 * words, what kind of file a row is, the search, and what a picked file may
 * be. Node-tested beside it.
 */
import type { IconName } from '../../components/icons';
import { MAX_FILE_BYTES, type Encoding } from './compress';

export const NAME_MAX = 200;
export const NOTE_MAX = 500;

export interface StoredFile {
  id: string;
  name: string;
  note: string | null;
  mime: string;
  sizeBytes: number;
  storedBytes: number;
  encoding: Encoding;
  blobPath: string;
  textPath: string | null;
  hasText: boolean;
  textChars: number | null;
  ownerOnly: boolean;
  uploadedByName: string | null;
  addedAt: string | null;
  canDelete: boolean;
}

export interface FilesView {
  files: StoredFile[];
  usedBytes: number;
  quotaBytes: number;
  isOwner: boolean;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

export function readFile(raw: unknown): StoredFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const name = str(r.name);
  const blobPath = str(r.blob_path);
  if (!id || !name || !blobPath) return null;
  return {
    id,
    name,
    note: str(r.note),
    mime: str(r.mime) ?? 'application/octet-stream',
    sizeBytes: num(r.size_bytes),
    storedBytes: num(r.stored_bytes),
    encoding: r.encoding === 'webp' ? 'webp' : 'gzip',
    blobPath,
    textPath: str(r.text_path),
    hasText: r.has_text === true,
    textChars: typeof r.text_chars === 'number' ? r.text_chars : null,
    ownerOnly: r.owner_only === true,
    uploadedByName: str(r.uploaded_by_name),
    addedAt: str(r.added_at),
    canDelete: r.can_delete === true,
  };
}

export function readList(raw: unknown): FilesView {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const files = Array.isArray(r.files) ? r.files.map(readFile).filter((f): f is StoredFile => f !== null) : [];
  return { files, usedBytes: num(r.used_bytes), quotaBytes: num(r.quota_bytes), isOwner: r.is_owner === true };
}

/** 1,234 bytes → "1.2 KB"; digits are formatted by the caller's locale. */
export function sizeParts(bytes: number): { value: number; unit: 'B' | 'KB' | 'MB' | 'GB' } {
  if (bytes < 1024) return { value: Math.max(0, Math.round(bytes)), unit: 'B' };
  if (bytes < 1024 * 1024) return { value: round1(bytes / 1024), unit: 'KB' };
  if (bytes < 1024 * 1024 * 1024) return { value: round1(bytes / (1024 * 1024)), unit: 'MB' };
  return { value: round1(bytes / (1024 * 1024 * 1024)), unit: 'GB' };
}
const round1 = (n: number) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);

/** How much smaller storage made it, as a whole percent (0 when it did not shrink). */
export function savedPercent(sizeBytes: number, storedBytes: number): number {
  if (sizeBytes <= 0 || storedBytes >= sizeBytes) return 0;
  return Math.round(((sizeBytes - storedBytes) / sizeBytes) * 100);
}

export type FileKind = 'pdf' | 'image' | 'sheet' | 'doc' | 'slides' | 'text' | 'archive' | 'other';

export function fileKind(name: string, mime: string): FileKind {
  const m = mime.toLowerCase();
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (m.startsWith('image/')) return 'image';
  if (['xlsx', 'xls', 'xlsm', 'ods', 'csv', 'tsv'].includes(ext) || m.includes('spreadsheet') || m === 'text/csv') return 'sheet';
  if (['docx', 'doc', 'docm', 'odt', 'rtf'].includes(ext) || m.includes('wordprocessing') || m === 'application/msword') return 'doc';
  if (['pptx', 'ppt', 'odp'].includes(ext) || m.includes('presentation')) return 'slides';
  if (m.startsWith('text/') || ['txt', 'md', 'json', 'xml', 'log'].includes(ext)) return 'text';
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(ext) || m.includes('zip') || m.includes('compressed')) return 'archive';
  return 'other';
}

export const KIND_ICON: Readonly<Record<FileKind, IconName>> = {
  pdf: 'fileText',
  image: 'image',
  sheet: 'table',
  doc: 'fileText',
  slides: 'layers',
  text: 'note',
  archive: 'package',
  other: 'folder',
};

/** Name or note contains every word of the query, case- and diacritic-blind. */
export function matchesQuery(file: StoredFile, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(`${file.name} ${file.note ?? ''} ${file.uploadedByName ?? ''}`);
  return words.every((w) => hay.includes(w));
}

function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ًͯ-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase();
}

export type PickProblem = 'empty' | 'tooLarge' | 'quota';

/** Why a picked file cannot be stored, before anything is compressed. */
export function pickProblem(file: { size: number }, view: Pick<FilesView, 'usedBytes' | 'quotaBytes'>): PickProblem | null {
  if (file.size <= 0) return 'empty';
  if (file.size > MAX_FILE_BYTES) return 'tooLarge';
  // The compressed size is not known yet; a file that would not fit even
  // shrunk to a tenth is refused now rather than after the work.
  if (view.quotaBytes > 0 && view.usedBytes + file.size / 10 > view.quotaBytes) return 'quota';
  return null;
}

/** The name the server will keep: the picked name, trimmed to NAME_MAX. */
export function cleanName(name: string): string {
  const t = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (t || 'file').slice(0, NAME_MAX);
}

/** The type stored with the file: the browser's, lower case, else a safe default. */
export function cleanMime(type: string): string {
  const t = type.toLowerCase().split(';')[0]?.trim() ?? '';
  return /^[a-z0-9][a-z0-9.+_-]*\/[a-z0-9][a-z0-9.+_-]*$/.test(t) && t.length <= 120 ? t : 'application/octet-stream';
}

export function usedShare(view: Pick<FilesView, 'usedBytes' | 'quotaBytes'>): number {
  if (view.quotaBytes <= 0) return 0;
  return Math.min(1, Math.max(0, view.usedBytes / view.quotaBytes));
}
