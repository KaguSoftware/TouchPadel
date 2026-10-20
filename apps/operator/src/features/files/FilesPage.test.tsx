import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { ConfirmProvider } from '../../components/ConfirmDialog';

// /files (0354): management's documents. The list is the server's; adding,
// editing and removing go through the page's API module.

vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
const toast = { ok: vi.fn(), info: vi.fn(), err: vi.fn() };
vi.mock('../../components/toast', () => ({ useToast: () => toast }));

const file = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  name: 'Water contract.pdf',
  note: 'Supplier, renewed every October',
  mime: 'application/pdf',
  size_bytes: 1_048_576,
  stored_bytes: 262_144,
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

let files: () => Record<string, unknown>[] = () => [];
let isOwner = true;
const rpc: Array<{ fn: string; args: Record<string, unknown> }> = [];

vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    rpc.push({ fn, args });
    if (fn === 'venue_files_list') return { files: files(), used_bytes: 300_000, quota_bytes: 2147483648, is_owner: isOwner };
    if (fn === 'venue_file_update') return file({ name: args.p_name, note: args.p_note });
    throw new Error(`unexpected ${fn}`);
  }),
}));

const uploadFile = vi.fn();
const deleteFile = vi.fn();
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  uploadFile: (...a: unknown[]) => uploadFile(...a),
  deleteFile: (...a: unknown[]) => deleteFile(...a),
}));

import { FilesPageScreen } from './FilesPage';

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <ConfirmProvider>
          <FilesPageScreen />
        </ConfirmProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  files = () => [];
  isOwner = true;
  rpc.length = 0;
  uploadFile.mockReset();
  deleteFile.mockReset();
  for (const f of Object.values(toast)) f.mockReset();
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe('FilesPageScreen', () => {
  it('teaches the first file when there are none', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Files' })).toBeTruthy();
    expect(await screen.findByText('No files yet')).toBeTruthy();
    expect(screen.getByTestId('files.drop').textContent).toMatch(/Drop files here/);
    expect(screen.getByTestId('files.usage').textContent).toMatch(/of 2 GB used/);
  });

  it('lists each file with who added it, its size before and after packing, and whether the assistant reads it', async () => {
    files = () => [file(), file({ id: 'f2', name: 'Licence.webp', note: null, mime: 'image/jpeg', encoding: 'webp', has_text: false, text_path: null, owner_only: true })];
    renderPage();
    const table = await screen.findByRole('table', { name: 'Saved files' });
    expect(within(table).getByText('Water contract.pdf')).toBeTruthy();
    expect(within(table).getByText('Supplier, renewed every October')).toBeTruthy();
    expect(within(table).getAllByText('Maha').length).toBe(2);
    expect(within(table).getAllByText('1 MB').length).toBe(2);
    expect(within(table).getAllByText(/stored 256 KB, 75% smaller/).length).toBe(2);
    expect(within(table).getByText('Can read it')).toBeTruthy();
    expect(within(table).getByText('Name only')).toBeTruthy();
    expect(within(table).getByText('Only the owner')).toBeTruthy();
  });

  it('finds a file by its note, and clears the search', async () => {
    const user = userEvent.setup();
    files = () => [file(), file({ id: 'f2', name: 'Menu prices.xlsx', note: null })];
    renderPage();
    await screen.findByText('Menu prices.xlsx');
    await user.type(screen.getByRole('searchbox', { name: 'Find by name or note' }), 'october');
    expect(screen.queryByText('Menu prices.xlsx')).toBeNull();
    expect(screen.getByText('Water contract.pdf')).toBeTruthy();
  });

  it('uploads what is dropped in, with Only me for the owner, and says how it was saved', async () => {
    const user = userEvent.setup();
    uploadFile.mockImplementation(async ({ onStage }: { onStage: (s: string) => void }) => {
      onStage('compressing');
      onStage('uploading');
      onStage('saving');
      return { stored_bytes: 262_144, has_text: true };
    });
    renderPage();
    await screen.findByText('No files yet');
    await user.click(screen.getByTestId('files.ownerOnly'));
    const pdf = new File([new Uint8Array(1_048_576)], 'Lease.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByTestId('files.input'), pdf);
    await waitFor(() => expect(screen.getByTestId('files.jobs').textContent).toMatch(/Saved as 256 KB, 75% smaller\. The assistant can read it\./));
    expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({ file: pdf, ownerOnly: true, note: '' }));
    // The list is read again after the upload.
    await waitFor(() => expect(rpc.filter((c) => c.fn === 'venue_files_list').length).toBeGreaterThan(1));
  });

  it('refuses a file over 50 MB before packing it, and shows a server refusal on its line', async () => {
    const user = userEvent.setup();
    const { AppRpcError } = await import('../../lib/appRpc');
    uploadFile.mockRejectedValue(new AppRpcError('FILES_QUOTA_FULL', 'FILES_QUOTA_FULL'));
    renderPage();
    await screen.findByText('No files yet');
    const big = new File(['x'], 'huge.mov');
    Object.defineProperty(big, 'size', { value: 60 * 1024 * 1024 });
    await user.upload(screen.getByTestId('files.input'), [big, new File(['a'], 'b.txt', { type: 'text/plain' })]);
    await waitFor(() => expect(screen.getByTestId('files.jobs').textContent).toMatch(/over 50 MB/));
    await waitFor(() => expect(screen.getByTestId('files.jobs').textContent).toMatch(/no room left in Files/));
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });

  it('a manager sees no Only me, and cannot remove a file someone else added', async () => {
    isOwner = false;
    files = () => [file({ can_delete: false })];
    renderPage();
    await screen.findByText('Water contract.pdf');
    expect(screen.queryByTestId('files.ownerOnly')).toBeNull();
    expect((screen.getByTestId('files.remove.f1') as HTMLButtonElement).disabled).toBe(true);
  });

  it('edits a file in its row: name and note together', async () => {
    const user = userEvent.setup();
    files = () => [file()];
    renderPage();
    await user.click(await screen.findByTestId('files.edit.f1'));
    const name = screen.getByTestId('files.field.name');
    await user.clear(name);
    await user.type(name, 'Water contract 2026.pdf');
    await user.clear(screen.getByTestId('files.field.note'));
    await user.click(screen.getByTestId('files.field.save'));
    await waitFor(() => expect(rpc.some((c) => c.fn === 'venue_file_update')).toBe(true));
    expect(rpc.find((c) => c.fn === 'venue_file_update')!.args).toEqual({ p_id: 'f1', p_name: 'Water contract 2026.pdf', p_note: null, p_owner_only: false });
    await waitFor(() => expect(screen.queryByTestId('files.editForm.f1')).toBeNull());
  });

  it('removes a file only after the confirmation', async () => {
    const user = userEvent.setup();
    files = () => [file()];
    deleteFile.mockResolvedValue(undefined);
    renderPage();
    await user.click(await screen.findByTestId('files.remove.f1'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/deleted for everyone/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(deleteFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1', blobPath: 'v/f1.gz', textPath: 'v/f1.txt.gz' })));
    expect(toast.ok).toHaveBeenCalledWith('Water contract.pdf removed');
  });
});
