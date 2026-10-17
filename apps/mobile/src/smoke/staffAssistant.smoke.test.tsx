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
import { act, fireEvent, within } from '@testing-library/react-native';
import { countPhrase, makeT, type Locale } from '@touch/i18n';
import { FREE_MODEL_CHOICE } from '@touch/core/assistant/free';
import * as assistantApi from '../features/assistant/api';
import { FreeStreamError } from '../features/assistant/free';
import { __resetFreeMode, setFreeMode } from '../features/assistant/freeMode';
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

describe.each(LOCALES)('the owner assistant in %s', (locale) => {
  const t = makeT(locale);

  afterEach(() => {
    // The owner's choice is kept on the phone; no case leaves it behind for the next.
    setFreeMode(false);
    __resetFreeMode();
  });

  it('offers starters and scope chips on a new chat, How-to only', () => {
    const screen = renderRoute(StaffAssistant, { locale, staff: { role: 'owner' } });
    try {
      expect(screen.getByTestId('staff-assistant.suggestion.yesterday')).toBeTruthy();
      expect(
        within(screen.getByTestId('staff-assistant.scope.howto')).getByText(
          t('staff.assistant.scopes.howto'),
        ),
      ).toBeTruthy();
      expect(
        screen.getByTestId('staff-assistant.scope.howto').props.accessibilityState.checked,
      ).toBe(true);
      // A new chat reads How-to only (owner, 2026-10-16): the owner turns on what the question needs.
      expect(
        screen.getByTestId('staff-assistant.scope.money').props.accessibilityState.checked,
      ).toBe(false);
      // Nothing to send until something is typed.
      expect(screen.getByTestId('staff-assistant.composer.send').props.accessibilityState.disabled).toBe(
        true,
      );
    } finally {
      screen.unmount();
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
      expect(within(screen.getByTestId('staff-assistant.free.intro')).getByText(t('staff.assistant.free.intro'))).toBeTruthy();
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
