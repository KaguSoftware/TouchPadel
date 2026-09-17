/**
 * Telegram → Find the problem (owner). One button asks the
 * `telegram-diagnose` edge function every question that decides whether a
 * notification can reach the staff group — token, bot, saved settings, the
 * group, the bot's membership, the webhook, recent outbox rows, the tap
 * allowlist — and lists the answers in order, each with the fix it needs.
 *
 * Built after 2026-09-13: the hosted chat id was the placeholder, Telegram
 * said `chat not found`, and the screen had no way to say why.
 *
 * The checks keep their order and their one-click fixes; what changed is the
 * words. The rows were named for the Bot API ("Webhook", "Bot token") and the
 * list gave no count, so an owner could not tell two warnings from a wall of
 * trouble without reading all eight. It now says how many need attention
 * first, puts the problems above the checks that passed, and names each check
 * for what it means to the venue.
 */
import { useState } from 'react';
import { formatNumber, type MessageKey } from '@touch/i18n';
import { callEdge } from '../../../lib/edge';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { Button } from '../../../components/ui';
import { StatusBadge, type Tone } from '../../../components/kit';
import type { IconName } from '../../../components/icons';
import { SettingsGroup, SettingsRow } from '../settings/SettingsList';
import { WEBHOOK_FIXABLE, checkMessage, type CheckStatus, type DiagnoseCheck, type DiagnoseResponse } from './diagnoseTypes';

const STATUS_TONE: Record<CheckStatus, Tone> = { ok: 'success', warn: 'warn', fail: 'danger', skip: 'neutral' };
const STATUS_ICON: Record<CheckStatus, IconName> = { ok: 'checkCircle', warn: 'alert', fail: 'x', skip: 'minus' };
/** Problems first, then what could not be checked, then what passed. Stable within a rank. */
const RANK: Record<CheckStatus, number> = { fail: 0, warn: 1, skip: 2, ok: 3 };

export function sortChecks(checks: readonly DiagnoseCheck[]): DiagnoseCheck[] {
  return checks.map((c, i) => ({ c, i })).sort((a, b) => RANK[a.c.status] - RANK[b.c.status] || a.i - b.i).map((x) => x.c);
}

export function DiagnosePanel({ onUseChatId }: { onUseChatId: (chatId: string) => Promise<void> }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const [report, setReport] = useState<DiagnoseResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [registering, setRegistering] = useState(false);

  async function run() {
    setRunning(true);
    try {
      setReport(await callEdge<{ action: 'diagnose' }, DiagnoseResponse>('telegram-diagnose', { action: 'diagnose' }, { ttlMs: 0 }));
    } catch (e) {
      toast.err(e);
    } finally {
      setRunning(false);
    }
  }

  async function registerWebhook() {
    setRegistering(true);
    try {
      await callEdge('telegram-diagnose', { action: 'register_webhook' }, { ttlMs: 0 });
      toast.ok(tr('ws.manager.settings.telegram.diagnose.webhookRegistered'));
      await run();
    } catch (e) {
      toast.err(e);
    } finally {
      setRegistering(false);
    }
  }

  const problems = report ? report.checks.filter((c) => c.status === 'fail' || c.status === 'warn').length : 0;
  const allOk = report !== null && report.checks.every((c) => c.status === 'ok');

  return (
    <SettingsGroup title={tr('ws.manager.settings.telegram.diagnose.title')} description={tr('ws.manager.settings.telegram.diagnose.lead')}>
      <SettingsRow>
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2-5)', alignItems: 'center', flexWrap: 'wrap' }}>
          <Button icon="search" busy={running} disabled={running} onClick={() => void run()}>
            {report ? tr('ws.manager.settings.telegram.diagnose.rerun') : tr('ws.manager.settings.telegram.diagnose.run')}
          </Button>
          {allOk && <StatusBadge tone="success" size="sm" icon="checkCircle" label={tr('ws.manager.settings.telegram.diagnose.allOk')} />}
          {problems > 0 && (
            <StatusBadge tone="warn" size="sm" icon="alert" label={tr('ws.manager.settings.telegram.diagnose.problems', { count: formatNumber(problems, locale) })} />
          )}
        </div>
      </SettingsRow>

      {report && (
        <SettingsRow>
          <ol aria-label={tr('ws.manager.settings.telegram.diagnose.title')} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
            {sortChecks(report.checks).map((check) => {
              const sentence = checkMessage(tr, check) ?? tr('ws.manager.settings.telegram.diagnose.unknown', { code: check.code });
              return (
                <li
                  key={check.id}
                  data-check={check.id}
                  data-status={check.status}
                  style={{ display: 'grid', gridTemplateColumns: 'minmax(9rem, 12rem) minmax(0, 1fr)', columnGap: 'var(--tp-sp-3)', rowGap: 'var(--tp-sp-1-5)', alignItems: 'start' }}
                >
                  <StatusBadge
                    tone={STATUS_TONE[check.status]}
                    size="sm"
                    icon={STATUS_ICON[check.status]}
                    label={tr(`ws.manager.settings.telegram.diagnose.checks.${check.id}` as MessageKey)}
                    style={{ justifySelf: 'start', whiteSpace: 'normal' }}
                  />
                  <span style={{ fontSize: 'var(--tp-fs-sm)', color: check.status === 'skip' || check.status === 'ok' ? 'var(--tp-muted-fg)' : undefined }}>{sentence}</span>
                  {check.newChatId && (
                    <div style={{ gridColumn: 2 }}>
                      <Button size="sm" kind="primary" onClick={() => void onUseChatId(check.newChatId as string).then(run)}>
                        {tr('ws.manager.settings.telegram.diagnose.useNewId')}
                      </Button>
                    </div>
                  )}
                  {check.id === 'webhook' && WEBHOOK_FIXABLE.has(check.code) && (
                    <div style={{ gridColumn: 2 }}>
                      <Button size="sm" icon="refresh" busy={registering} disabled={registering} onClick={() => void registerWebhook()}>
                        {tr('ws.manager.settings.telegram.diagnose.registerWebhook')}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}
