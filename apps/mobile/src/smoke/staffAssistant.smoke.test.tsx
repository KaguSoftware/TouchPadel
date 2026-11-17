/**
 * The assistant on the phone: the thread and the chat list as the owner, in
 * EN and AR, the free assistant every other staff role gets (owner call
 * 2026-10-16) and the owner's "The free AI" choice, plus Today's entry and the
 * floating button, which every staff role now gets (Today's own route case is
 * in staff.smoke.test.tsx; this suite names no other route). Reads are seeded
 * under `assistantKeys`, so nothing reaches the (mocked) client on the first
 * render; the free stream is a spy on `sendFreeQuestion`.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { countPhrase, makeT, type Locale } from '@touch/i18n';
import { FREE_MODEL_CHOICE } from '@touch/core/assistant/free';
import * as assistantApi from '../features/assistant/api';
import { FreeStreamError } from '../features/assistant/free';
import { __resetFreeMode, setFreeMode } from '../features/assistant/freeMode';
import { __setAiConsent } from '../features/assistant/aiConsent';
import { runSmokeCases } from '../test/smokeCase';
import { renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import { assistantKeys } from '../features/assistant/api';
import type { ConversationRow } from '../features/assistant/chat';
import { SettingsBody } from '../features/assistant/SettingsSheet';
import StaffAssistant from '../../app/(staff)/staff-assistant';
import StaffAssistantChats from '../../app/(staff)/staff-assistant-chats';
import StaffScreenshots from '../../app/(staff)/staff-screenshots';
import StaffToday from '../../app/staff';
import { AssistantFab, fabHidden, withAssistantFab } from '../features/assistant/AssistantFab';
import { screenshotKeys, type ScreenshotEvent } from '../features/staff/screenGuard/api';

// The AI notice is accepted for every case but its own (they set it back): the cases below test the assistant.
__setAiConsent(true);

const CHAT = 'a5510000-0000-4000-8000-000000000001';

const MODELS = { default_model: 'claude-opus-5-5', models: ['claude-opus-5-5', 'claude-sonnet-5-5'] };

const CHATS: ConversationRow[] = [
  {
    id: CHAT,
    title: 'Yesterday’s takings',
    scopes: ['money', 'howto'],
    model: null,
    updated_at: '2026-10-06T18:30:00Z',
    created_at: '2026-10-06T18:20:00Z',
  },
];

const SHOTS: ScreenshotEvent[] = [
  { id: 7, at: '2026-10-07T09:15:00Z', page: '/staff-order', staffName: 'Rana' },
];

runSmokeCases('the owner assistant', [
  {
    route: 'staff-assistant',
    Component: StaffAssistant,
    nearbyKey: 'staff.assistant.empty.title',
    options: { staff: { role: 'owner' } },
  },
  {
    route: 'staff-assistant-chats',
    Component: StaffAssistantChats,
    labelKey: 'staff.assistant.chats.new',
    options: { staff: { role: 'owner' }, queryData: [[assistantKeys.conversations, CHATS]] },
  },
  {
    route: 'staff-screenshots',
    Component: StaffScreenshots,
    nearbyKey: 'staff.screenshots.intro',
    options: { staff: { role: 'owner' }, queryData: [[screenshotKeys.list, SHOTS]] },
  },
]);

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('the AI notice in %s (App Review 5.1.2(i))', (locale) => {
  const t = makeT(locale);

  afterEach(() => {
    __setAiConsent(true);
  });

  it('stands before the assistant until accepted, for the owner and for any other role', async () => {
    for (const role of ['owner', 'driver'] as const) {
      __setAiConsent(false);
      const screen = renderRoute(StaffAssistant, { locale, staff: { role } });
      try {
        expect(screen.getByText(t('staff.assistant.aiNotice.body'))).toBeTruthy();
        expect(screen.getByText(t('staff.assistant.aiNotice.data'))).toBeTruthy();
        expect(screen.queryByTestId('staff-assistant.composer.send')).toBeNull();
        const accept = screen.getByTestId('staff-assistant.ai-notice.accept');
        expect(within(accept).getByText(t('staff.assistant.aiNotice.accept'))).toBeTruthy();
        fireEvent.press(accept);
        await waitFor(() => expect(screen.queryByTestId('staff-assistant.ai-notice.accept')).toBeNull());
      } finally {
        screen.unmount();
      }
    }
  });
});

describe.each(LOCALES)('the owner assistant in %s', (locale) => {
  const t = makeT(locale);

  afterEach(() => {
    // The owner's choice is kept on the phone; no case leaves it behind for the next.
    setFreeMode(false);
    __resetFreeMode();
  });

  it('offers starters and scope chips on a new chat that reads nothing, with the composer locked', async () => {
    const screen = renderRoute(StaffAssistant, { locale, staff: { role: 'owner' } });
    try {
      expect(screen.getByTestId('staff-assistant.suggestion.yesterday')).toBeTruthy();
      expect(
        within(screen.getByTestId('staff-assistant.scope.howto')).getByText(
          t('staff.assistant.scopes.howto'),
        ),
      ).toBeTruthy();
      // A new chat reads nothing until the owner picks, as on the desktop (owner, 2026-10-20).
      for (const scope of ['howto', 'money']) {
        expect(
          screen.getByTestId(`staff-assistant.scope.${scope}`).props.accessibilityState.checked,
        ).toBe(false);
      }
      expect(screen.getByPlaceholderText(t('staff.assistant.composer.locked'))).toBeTruthy();
      expect(screen.getByTestId('staff-assistant.composer.send').props.accessibilityState.disabled).toBe(
        true,
      );
      // Ticking a scope unlocks it.
      fireEvent.press(screen.getByTestId('staff-assistant.scope.howto'));
      expect(await screen.findByPlaceholderText(t('staff.assistant.composer.placeholder'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('puts thumbs on a rateable stored answer only, shows the stored rating and writes a press', async () => {
    const mk = (id: string, seq: number, role: string, content: unknown, extra: Record<string, unknown> = {}) => ({
      id,
      conversation_id: CHAT,
      seq,
      role,
      content,
      sources: null,
      gate: null,
      tokens: { stop_reason: 'end_turn' },
      created_at: '2026-10-06T18:20:05Z',
      ...extra,
    });
    const rows = [
      mk('u1', 1, 'user', 'How much?'),
      mk('a1', 2, 'assistant', [{ type: 'text', text: 'A lot.' }], { feedback: { rating: 1, note: null } }),
      mk('u2', 3, 'user', 'And now?'),
      mk('a2', 4, 'assistant', [{ type: 'text', text: 'Same.' }]),
      mk('u3', 5, 'user', 'Again?'),
      mk('a3', 6, 'assistant', [{ type: 'text', text: 'Half an ans' }], { tokens: { stop_reason: 'stopped' } }),
    ];
    const rate = jest.spyOn(assistantApi, 'rateMessage').mockResolvedValue(undefined);
    const screen = renderRoute(StaffAssistant, {
      locale,
      staff: { role: 'owner' },
      params: { id: CHAT },
      queryData: [[assistantKeys.messages(CHAT), rows]],
    });
    try {
      const up1 = screen.getByTestId('staff-assistant.answer.a1.thumbs-up');
      expect(up1.props.accessibilityLabel).toBe(t('staff.assistant.feedback.good'));
      expect(up1.props.accessibilityState.selected).toBe(true);
      expect(screen.getByTestId('staff-assistant.answer.a1.thumbs-down').props.accessibilityLabel).toBe(
        t('staff.assistant.feedback.bad'),
      );
      expect(screen.getByTestId('staff-assistant.answer.a1.thumbs-down').props.accessibilityState.selected).toBe(false);
      // A stopped answer and a user row carry none.
      expect(screen.queryByTestId('staff-assistant.answer.a3.thumbs-up')).toBeNull();
      expect(screen.queryByTestId('staff-assistant.answer.u1.thumbs-up')).toBeNull();

      await act(async () => {
        fireEvent.press(screen.getByTestId('staff-assistant.answer.a2.thumbs-down'));
        // A second press while the write is in flight sends nothing more.
        fireEvent.press(screen.getByTestId('staff-assistant.answer.a2.thumbs-up'));
      });
      expect(rate).toHaveBeenCalledTimes(1);
      expect(rate).toHaveBeenCalledWith('a2', -1);
      await waitFor(() =>
        expect(screen.getByTestId('staff-assistant.answer.a2.thumbs-down').props.accessibilityState.selected).toBe(true),
      );

      // Pressing the chosen thumb again clears it.
      await act(async () => {
        fireEvent.press(screen.getByTestId('staff-assistant.answer.a1.thumbs-up'));
      });
      expect(rate).toHaveBeenLastCalledWith('a1', 0);
      await waitFor(() =>
        expect(screen.getByTestId('staff-assistant.answer.a1.thumbs-up').props.accessibilityState.selected).toBe(false),
      );
    } finally {
      screen.unmount();
      rate.mockRestore();
    }
  });

  it('puts the thumb back and says so quietly when the write fails', async () => {
    const rows = [
      { id: 'u1', conversation_id: CHAT, seq: 1, role: 'user', content: 'Q', sources: null, gate: null, created_at: '2026-10-06T18:20:00Z' },
      { id: 'a1', conversation_id: CHAT, seq: 2, role: 'assistant', content: [{ type: 'text', text: 'A.' }], sources: null, gate: null, tokens: null, created_at: '2026-10-06T18:20:05Z' },
    ];
    const rate = jest.spyOn(assistantApi, 'rateMessage').mockRejectedValue(new Error('x'));
    const screen = renderRoute(StaffAssistant, {
      locale,
      staff: { role: 'owner' },
      params: { id: CHAT },
      queryData: [[assistantKeys.messages(CHAT), rows]],
    });
    try {
      await act(async () => {
        fireEvent.press(screen.getByTestId('staff-assistant.answer.a1.thumbs-up'));
      });
      await waitFor(() =>
        expect(screen.getByTestId('staff-assistant.answer.a1.thumbs-up').props.accessibilityState.selected).toBe(false),
      );
      expect(await screen.findByText(t('staff.assistant.feedback.failed'))).toBeTruthy();
    } finally {
      screen.unmount();
      rate.mockRestore();
    }
  });

  it('keeps the model and the spend behind the settings sheet', () => {
    // The thread itself no longer carries the model row.
    const thread = renderRoute(StaffAssistant, {
      locale,
      staff: { role: 'owner' },
      queryData: [[assistantKeys.models, MODELS]],
    });
    try {
      expect(thread.queryByTestId('staff-assistant.settings.model.__default__')).toBeNull();
      expect(thread.queryByTestId('staff-assistant.model.__default__')).toBeNull();
    } finally {
      thread.unmount();
    }

    const onChange = jest.fn();
    const onChooseFree = jest.fn();
    const Sheet = () => (
      <SettingsBody
        testID="staff-assistant.settings"
        visible
        onClose={() => {}}
        chatMicros={42_000}
        models={MODELS.models}
        defaultModel={MODELS.default_model}
        value={null}
        onChange={onChange}
        onChooseFree={onChooseFree}
      />
    );
    const screen = renderRoute(Sheet, {
      locale,
      staff: { role: 'owner' },
      queryData: [[assistantKeys.usage, { monthMicros: 1_250_000, capMicros: 20_000_000 }]],
    });
    try {
      expect(within(screen.getByTestId('staff-assistant.settings.month')).getByText(/\$1\.25/)).toBeTruthy();
      expect(within(screen.getByTestId('staff-assistant.settings.chat')).getByText(/\$0\.04/)).toBeTruthy();
      expect(
        within(screen.getByTestId('staff-assistant.settings.model.__default__')).getByText(
          t('staff.assistant.model.default'),
        ),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId('staff-assistant.settings.model.claude-opus-5-5')).getByText('Opus 5.5'),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId('staff-assistant.settings.model.claude-sonnet-5-5')).getByText(
          'Sonnet 5.5',
        ),
      ).toBeTruthy();
      expect(screen.getByTestId('staff-assistant.settings.done')).toBeTruthy();
      // "The free AI" after the paid models: it switches the screen, it is not a model to save.
      const free = screen.getByTestId(`staff-assistant.settings.model.${FREE_MODEL_CHOICE}`);
      expect(within(free).getByText(t('staff.assistant.free.choice'))).toBeTruthy();
      expect(within(free).getByText(t('staff.assistant.free.choiceHint'))).toBeTruthy();
      fireEvent.press(free);
      expect(onChooseFree).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      screen.unmount();
    }
  });

  it('gives other staff the free assistant only: no scopes, no settings, no chats', () => {
    const screen = renderRoute(StaffAssistant, {
      locale,
      staff: { role: 'waiter' },
      queryData: [[assistantKeys.models, MODELS]],
    });
    try {
      expect(within(screen.getByTestId('staff-assistant.free.intro')).getByText(t('staff.assistant.touch.intro'))).toBeTruthy();
      // Only the owner is told there is a free or a paid assistant.
      expect(screen.queryByText(/free|paid|مجاني|مدفوع/i)).toBeNull();
      expect(screen.queryByTestId('staff-assistant.free.use-paid')).toBeNull();
      expect(
        within(screen.getByTestId('staff-assistant.free.starter.dayOff')).getByText(
          t('staff.assistant.free.starters.dayOff'),
        ),
      ).toBeTruthy();
      expect(screen.getByTestId('staff-assistant.free.badge')).toBeTruthy();
      expect(screen.getByTestId('staff-assistant.composer.send')).toBeTruthy();
      expect(screen.queryByTestId('staff-assistant.scope.howto')).toBeNull();
      expect(screen.queryByTestId('staff-assistant.settings-open')).toBeNull();
      expect(screen.queryByTestId('staff-assistant.chats')).toBeNull();
      expect(screen.queryByTestId('staff-assistant.suggestion.yesterday')).toBeNull();
      expect(screen.queryByTestId('staff-assistant.free.use-paid')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('streams a free answer, with a button for each page it names', async () => {
    const spy = jest
      .spyOn(assistantApi, 'sendFreeQuestion')
      .mockImplementation(async (body, opts) => {
        expect(body.app).toBe('mobile');
        expect(body.route).toBe('/staff-order');
        expect((body.pages ?? []).map((p) => p.route)).toContain('/staff-request');
        opts.onEvent('message_start', { model: 'm', free: true });
        opts.onEvent('delta', { text: 'Open /staff-request and pick Leave.' });
        opts.onEvent('done', { stop_reason: 'end_turn' });
      });
    const screen = renderRoute(StaffAssistant, {
      locale,
      staff: { role: 'waiter' },
      params: { from: '/staff-order' },
    });
    try {
      await act(async () => {
        fireEvent.press(screen.getByTestId('staff-assistant.free.starter.dayOff'));
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const open = await screen.findByTestId('staff-assistant.answer.1.open.staff-request');
      fireEvent.press(open);
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/staff-request' });
    } finally {
      screen.unmount();
    }
  });

  it('says when the minute’s free questions are used up', async () => {
    jest
      .spyOn(assistantApi, 'sendFreeQuestion')
      .mockRejectedValue(new FreeStreamError({ code: 'RATE_LIMITED', scope: 'minute', retryAfterS: 12 }));
    const screen = renderRoute(StaffAssistant, { locale, staff: { role: 'cashier' } });
    try {
      await act(async () => {
        fireEvent.press(screen.getByTestId('staff-assistant.free.starter.incident'));
      });
      const error = await screen.findByTestId('staff-assistant.answer.1.error');
      expect(within(error).getByText(countPhrase('staff.assistant.free.errors.minute', 12, locale))).toBeTruthy();
      expect(screen.getByTestId('staff-assistant.answer.1.retry')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('lets the owner use the free AI and come back to the paid one', () => {
    act(() => setFreeMode(true));
    const screen = renderRoute(StaffAssistant, { locale, staff: { role: 'owner' } });
    try {
      expect(screen.getByTestId('staff-assistant.free.intro')).toBeTruthy();
      expect(screen.queryByTestId('staff-assistant.scope.howto')).toBeNull();
      act(() => {
        fireEvent.press(screen.getByTestId('staff-assistant.free.use-paid'));
      });
      expect(screen.getByTestId('staff-assistant.scope.howto')).toBeTruthy();
      expect(screen.queryByTestId('staff-assistant.free.intro')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('lists earlier chats, each opening on the assistant screen', () => {
    const screen = renderRoute(StaffAssistantChats, {
      locale,
      staff: { role: 'owner' },
      queryData: [[assistantKeys.conversations, CHATS]],
    });
    try {
      const row = screen.getByTestId(`staff-assistant-chats.chat.${CHAT}`);
      expect(within(row).getByText('Yesterday’s takings')).toBeTruthy();
      fireEvent.press(row);
      expect(routerState.calls).toContainEqual({
        method: 'dismissTo',
        arg: { pathname: '/staff-assistant', params: { id: CHAT } },
      });
    } finally {
      screen.unmount();
    }
  });

  it('opens an empty chat from New chat, even when the one on screen is empty', () => {
    const screen = renderRoute(StaffAssistantChats, {
      locale,
      staff: { role: 'owner' },
      queryData: [[assistantKeys.conversations, CHATS]],
    });
    try {
      fireEvent.press(screen.getByTestId('staff-assistant-chats.new'));
      const call = routerState.calls.filter((c) => c.method === 'dismissTo').pop();
      const arg = call?.arg as { pathname: string; params: { id: string; n?: string } };
      expect(arg.pathname).toBe('/staff-assistant');
      expect(arg.params.id).toBe('');
      expect(arg.params.n).toMatch(/^\d+$/);
    } finally {
      screen.unmount();
    }
  });

  it('draws a stored failed turn once, in the reader’s language, with Ask again; chips wait for the row', () => {
    const rows = [
      { id: 'u1', conversation_id: CHAT, seq: 1, role: 'user', content: 'How much?', sources: null, gate: null, created_at: '2026-10-06T18:20:00Z' },
      {
        id: 'a1',
        conversation_id: CHAT,
        seq: 2,
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        sources: null,
        gate: null,
        tokens: { stop_reason: 'error', error_code: 'UPSTREAM' },
        created_at: '2026-10-06T18:20:05Z',
      },
    ];
    const screen = renderRoute(StaffAssistant, {
      locale,
      staff: { role: 'owner' },
      params: { id: CHAT },
      queryData: [[assistantKeys.messages(CHAT), rows]],
    });
    try {
      expect(screen.getAllByText('How much?')).toHaveLength(1);
      const error = screen.getByTestId(`staff-assistant.answer.a1.error`);
      expect(within(error).getByText(t('staff.assistant.errors.UPSTREAM'))).toBeTruthy();
      expect(screen.getByTestId('staff-assistant.answer.a1.retry')).toBeTruthy();
      // The chat's own row has not loaded: a tap would overwrite its scopes.
      expect(screen.getByTestId('staff-assistant.scope.money').props.accessibilityState.disabled).toBe(true);
    } finally {
      screen.unmount();
    }
  });

  it('says a stopped, cut-short and declined answer in the reader’s language', () => {
    const base = { conversation_id: CHAT, role: 'assistant', sources: null, gate: null, created_at: '2026-10-06T18:20:05Z' };
    const rows = [
      { ...base, id: 's', seq: 1, content: [{ type: 'text', text: 'Part' }], tokens: { stop_reason: 'stopped' } },
      { ...base, id: 'c', seq: 2, content: [{ type: 'text', text: 'Part' }], tokens: { stop_reason: 'max_tokens' } },
      { ...base, id: 'r', seq: 3, content: [{ type: 'text', text: 'No' }], tokens: { stop_reason: 'refusal' } },
      { ...base, id: 'j', seq: 4, content: [{ type: 'text', text: 'Done' }], tokens: { stop_reason: 'job_proposed' }, sources: [{ job_id: 'j1' }] },
    ];
    const screen = renderRoute(StaffAssistant, {
      locale,
      staff: { role: 'owner' },
      params: { id: CHAT },
      queryData: [[assistantKeys.messages(CHAT), rows]],
    });
    try {
      expect(screen.getByText(t('staff.assistant.composer.stopped'))).toBeTruthy();
      expect(screen.getByText(t('staff.assistant.message.cutShort'))).toBeTruthy();
      expect(screen.getByText(t('staff.assistant.message.refused'))).toBeTruthy();
      // A job's result is not a proposal: no "open the desktop app" note.
      expect(screen.queryByTestId('staff-assistant.answer.j.job')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('lists the staff screenshots, who and which page', () => {
    const screen = renderRoute(StaffScreenshots, {
      locale,
      staff: { role: 'owner' },
      queryData: [[screenshotKeys.list, SHOTS]],
    });
    try {
      const row = screen.getByTestId('staff-screenshots.row.7');
      expect(within(row).getByText(t('staff.screenshots.row', { name: 'Rana', page: '/staff-order' }))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('gives the owner the assistant pill and a screenshots tile on Today, other staff the pill only', () => {
    const owner = renderRoute(StaffToday, { locale, staff: { role: 'owner' } });
    try {
      expect(owner.queryByTestId('staff.assistant')).toBeNull();
      fireEvent.press(owner.getByTestId('staff.assistant.header'));
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/staff-assistant' });
      fireEvent.press(owner.getByTestId('staff.screenshots'));
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/staff-screenshots' });
    } finally {
      owner.unmount();
    }
    const manager = renderRoute(StaffToday, { locale, staff: { role: 'manager' } });
    try {
      expect(manager.queryByTestId('staff.screenshots')).toBeNull();
      // Every staff role has the (free) assistant (owner, 2026-10-16).
      fireEvent.press(manager.getByTestId('staff.assistant.header'));
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/staff-assistant' });
    } finally {
      manager.unmount();
    }
  });

  it('floats the assistant button for every staff role, off its own screens', () => {
    const owner = renderRoute(AssistantFab, { locale, staff: { role: 'owner' }, pathname: '/staff-order' });
    try {
      fireEvent.press(owner.getByTestId('staff.assistant.fab'));
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/staff-assistant', params: { from: '/staff-order' } },
      });
    } finally {
      owner.unmount();
    }
    const manager = renderRoute(AssistantFab, { locale, staff: { role: 'manager' }, pathname: '/staff-shopping' });
    try {
      fireEvent.press(manager.getByTestId('staff.assistant.fab'));
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/staff-assistant', params: { from: '/staff-shopping' } },
      });
    } finally {
      manager.unmount();
    }
    const onAssistant = renderRoute(AssistantFab, { locale, staff: { role: 'owner' }, pathname: '/staff-assistant' });
    try {
      expect(onAssistant.queryByTestId('staff.assistant.fab')).toBeNull();
    } finally {
      onAssistant.unmount();
    }
    expect(fabHidden('/staff-assistant-chats')).toBe(true);
    expect(fabHidden('/(tabs)')).toBe(true);
    expect(fabHidden('/staff-order')).toBe(false);
    // Off the "new" forms a header + opens (owner, 2026-10-17).
    expect(fabHidden('/staff-incident-report')).toBe(true);
    expect(fabHidden('/staff-start')).toBe(true);
    expect(fabHidden('/staff-incidents')).toBe(false);
    // The main panel carries it in its header instead.
    expect(fabHidden('/staff')).toBe(true);
    // Drawn per screen by the Stack's screenLayout: a staff page is wrapped,
    // the main panel, a guest screen and a staff sheet come back untouched.
    const page = <></>;
    const layout = (name: string, presentation?: string) =>
      withAssistantFab({ route: { name }, options: { presentation }, children: page });
    expect(layout('staff-order')).not.toBe(page);
    expect(layout('staff')).toBe(page);
    expect(layout('settings')).toBe(page);
    expect(layout('staff-group', 'formSheet')).toBe(page);
  });
});
