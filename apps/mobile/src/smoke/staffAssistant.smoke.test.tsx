/**
 * The owner's assistant on the phone: the thread and the chat list as the
 * owner, in EN and AR, plus Today's highlighted entry, which only the owner
 * gets (Today's own route case is in staff.smoke.test.tsx; this suite names no
 * other route). Reads are seeded under `assistantKeys`, so nothing reaches the
 * (mocked) client on the first render.
 */
import { describe, expect, it } from '@jest/globals';
import { fireEvent, within } from '@testing-library/react-native';
import { makeT, type Locale } from '@touch/i18n';
import { runSmokeCases } from '../test/smokeCase';
import { renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import { assistantKeys } from '../features/assistant/api';
import type { ConversationRow } from '../features/assistant/chat';
import { SettingsBody } from '../features/assistant/SettingsSheet';
import StaffAssistant from '../../app/staff-assistant';
import StaffAssistantChats from '../../app/staff-assistant-chats';
import StaffScreenshots from '../../app/staff-screenshots';
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

  it('offers starters and scope chips on a new chat, the default scope on', () => {
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

    const Sheet = () => (
      <SettingsBody
        testID="staff-assistant.settings"
        visible
        onClose={() => {}}
        chatMicros={42_000}
        models={MODELS.models}
        defaultModel={MODELS.default_model}
        value={null}
        onChange={() => {}}
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

  it('gives the owner the assistant pill and a screenshots tile on Today, and other staff neither', () => {
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
      expect(manager.queryByTestId('staff.assistant.header')).toBeNull();
    } finally {
      manager.unmount();
    }
  });

  it('floats the assistant button for the owner only, off its own screens', () => {
    const owner = renderRoute(AssistantFab, { locale, staff: { role: 'owner' }, pathname: '/staff-order' });
    try {
      fireEvent.press(owner.getByTestId('staff.assistant.fab'));
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/staff-assistant' });
    } finally {
      owner.unmount();
    }
    const manager = renderRoute(AssistantFab, { locale, staff: { role: 'manager' }, pathname: '/staff-order' });
    try {
      expect(manager.queryByTestId('staff.assistant.fab')).toBeNull();
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
