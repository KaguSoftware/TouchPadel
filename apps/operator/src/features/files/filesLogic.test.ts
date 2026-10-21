import { describe, expect, it } from 'vitest';
import { cleanMime, cleanName, fileKind, matchesQuery, pickProblem, readList, savedPercent, sizeParts, usedShare, type StoredFile } from './filesLogic';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  name: 'Contract.pdf',
  note: 'Water supplier',
  mime: 'application/pdf',
  size_bytes: 120_000,
  stored_bytes: 40_000,
  encoding: 'gzip',
  blob_path: 'v/f1.gz',
  text_path: 'v/f1.txt.gz',
  has_text: true,
  text_chars: 900,
  owner_only: false,
  uploaded_by_name: 'Maha',
  added_at: '2026-10-20T09:00:00Z',
  can_delete: true,
  ...over,
});

describe('readList', () => {
  it('reads the server list and drops rows it cannot use', () => {
    const v = readList({ files: [row(), row({ id: null }), 'x', row({ id: 'f2', encoding: 'webp', note: '', has_text: false, text_path: null })], used_bytes: 5, quota_bytes: 10, is_owner: true });
    expect(v.files.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(v.files[0]).toMatchObject({ name: 'Contract.pdf', sizeBytes: 120_000, storedBytes: 40_000, encoding: 'gzip', textPath: 'v/f1.txt.gz', hasText: true, canDelete: true });
    expect(v.files[1]).toMatchObject({ encoding: 'webp', note: null, textPath: null, hasText: false });
    expect(v).toMatchObject({ usedBytes: 5, quotaBytes: 10, isOwner: true });
    expect(readList(null)).toEqual({ files: [], usedBytes: 0, quotaBytes: 0, isOwner: false });
  });
});

describe('sizes', () => {
  it('says a size in the right unit', () => {
    expect(sizeParts(512)).toEqual({ value: 512, unit: 'B' });
    expect(sizeParts(1536)).toEqual({ value: 1.5, unit: 'KB' });
    expect(sizeParts(250 * 1024 * 1024)).toEqual({ value: 250, unit: 'MB' });
    expect(sizeParts(2147483648)).toEqual({ value: 2, unit: 'GB' });
  });

  it('says how much smaller it was stored, never a negative', () => {
    expect(savedPercent(1000, 280)).toBe(72);
    expect(savedPercent(1000, 1010)).toBe(0);
    expect(savedPercent(0, 0)).toBe(0);
    expect(usedShare({ usedBytes: 3, quotaBytes: 4 })).toBe(0.75);
    expect(usedShare({ usedBytes: 9, quotaBytes: 4 })).toBe(1);
  });
});

describe('fileKind', () => {
  it('names the kind by type or extension', () => {
    expect(fileKind('a.pdf', '')).toBe('pdf');
    expect(fileKind('scan.jpg', 'image/jpeg')).toBe('image');
    expect(fileKind('menu.xlsx', '')).toBe('sheet');
    expect(fileKind('lease.docx', '')).toBe('doc');
    expect(fileKind('deck.pptx', '')).toBe('slides');
    expect(fileKind('notes.txt', 'text/plain')).toBe('text');
    expect(fileKind('backup.zip', 'application/zip')).toBe('archive');
    expect(fileKind('thing.bin', 'application/octet-stream')).toBe('other');
  });
});

describe('matchesQuery', () => {
  const f = readList({ files: [row({ name: 'عقد المياه.pdf', note: 'Supplier price list' })] }).files[0] as StoredFile;

  it('finds every word in the name, the note or who added it, ignoring case and Arabic letter forms', () => {
    expect(matchesQuery(f, '')).toBe(true);
    expect(matchesQuery(f, 'supplier PRICE')).toBe(true);
    expect(matchesQuery(f, 'maha')).toBe(true);
    expect(matchesQuery(f, 'عقد')).toBe(true);
    expect(matchesQuery(f, 'supplier lease')).toBe(false);
  });
});

describe('what may be stored', () => {
  const room = { usedBytes: 0, quotaBytes: 2147483648 };

  it('refuses an empty file, one over 50 MB, and one that cannot fit', () => {
    expect(pickProblem({ size: 0 }, room)).toBe('empty');
    expect(pickProblem({ size: 51 * 1024 * 1024 }, room)).toBe('tooLarge');
    expect(pickProblem({ size: 40 * 1024 * 1024 }, { usedBytes: 2147483648 - 1000, quotaBytes: 2147483648 })).toBe('quota');
    expect(pickProblem({ size: 10 * 1024 * 1024 }, room)).toBeNull();
  });

  it('cleans the name and the type the server keeps', () => {
    expect(cleanName('  Lease\u0007.pdf ')).toBe('Lease.pdf');
    expect(cleanName('')).toBe('file');
    expect(cleanName('x'.repeat(300))).toHaveLength(200);
    expect(cleanMime('Text/CSV; charset=utf-8')).toBe('text/csv');
    expect(cleanMime('')).toBe('application/octet-stream');
    expect(cleanMime('weird type')).toBe('application/octet-stream');
  });
});
