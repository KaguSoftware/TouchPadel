import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocaleProvider } from '../../lib/i18n';
import { KitchenReachFlag, KitchenSendStatus } from './KitchenReachFlag';
import { noteKitchenSend, resetKitchenSendsForTests, setCloudFetcherForTests } from './kitchenReachStore';

afterEach(() => {
  resetKitchenSendsForTests();
  setCloudFetcherForTests(async () => []);
});

function renderWith(node: React.ReactNode) {
  return render(<LocaleProvider>{node}</LocaleProvider>);
}

describe('KitchenReach (F-11)', () => {
  it('flags a tab whose order no kitchen screen has drawn, from the cloud read', async () => {
    setCloudFetcherForTests(async () => [
      { id: 't1', status: 'queued', createdAtMs: Date.now() - 60_000, seenAtMs: null, tabId: 'tab-1', key: null },
    ]);
    renderWith(<KitchenReachFlag tabId="tab-1" />);
    expect((await screen.findByTestId('kitchen-not-received')).textContent).toContain('Not received by the kitchen yet');
  });

  it('says nothing for a tab whose orders were seen', async () => {
    setCloudFetcherForTests(async () => [
      { id: 't1', status: 'queued', createdAtMs: Date.now() - 60_000, seenAtMs: Date.now() - 50_000, tabId: 'tab-1', key: null },
    ]);
    renderWith(<KitchenReachFlag tabId="tab-1" compact />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('kitchen-not-received')).toBeNull();
  });

  it('never a bare "sent": the basket line waits for a kitchen screen', async () => {
    setCloudFetcherForTests(async () => []);
    noteKitchenSend({ key: 'TILL1:order.add_items:Z', tabId: 'tab-3', queued: false });
    renderWith(<KitchenSendStatus tabId="tab-3" />);
    const line = await screen.findByTestId('kitchen-send-status');
    expect(line.getAttribute('data-state')).toBe('waiting');
    expect(line.textContent).toContain('Waiting for a kitchen screen');
  });
});
