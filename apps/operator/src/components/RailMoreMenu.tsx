/**
 * The rail foot's one menu. Lives beside __root.tsx rather than inside it so
 * it can be rendered by a test without dragging in supabase, the IPC bridge
 * and the whole shell.
 */
import { useState, type ReactNode } from 'react';
import { useLocale } from '../lib/i18n';
import { useThemeMode } from '../lib/themeMode';
import { Kbd } from './kit';
import { Icon, ThemeModeIcon, type IconName } from './icons';
import { useAssistantDrawerOrNull } from '../features/assistant/AssistantDrawer';
import { navButtonStyle } from './railStyles';

/**
 * The rail foot's one collapsible group (owner call, 2026-09-21). Switch
 * workspace, the assistant, the language switch and the appearance switch were
 * four rows stacked above Sign out — four preferences competing with the
 * shift-ending control for the place where fingers rest. They are all "change
 * something about this station", so they fold into one row that opens them.
 *
 * Sign out, Go on break, Pair kitchen screen and the update row stay outside:
 * none of them is a preference, and burying Sign out costs a press on every
 * shift change.
 *
 * It expands IN PLACE, reusing the rail's own accordion (.tp-rail-group +
 * .tp-rail-group-body in GlobalStyles, what RailGroup uses for Operations and
 * Records). That is one collapse idiom on the rail rather than two, and it
 * brings the 0fr→1fr row animation, the chevron rotation and its RTL mirror
 * for free. No floating layer, so nothing to position, clip or dismiss.
 */
export function RailMoreMenu({
  canSwitch,
  onWorkspacePicker,
  onSwitchWorkspace,
}: {
  canSwitch: boolean;
  /**
   * Already standing on the workspace picker. The row STAYS and lights up
   * instead of vanishing (owner call, 2026-09-21): it used to be dropped from
   * the list, so opening Options on that one screen showed a different, shorter
   * menu and the row an owner reaches for had moved. A destination you are
   * already on is what `data-active` is for everywhere else on the rail.
   */
  onWorkspacePicker?: boolean;
  onSwitchWorkspace: () => void;
}) {
  const { tr, toggleLocale, locale } = useLocale();
  const { mode, toggleMode } = useThemeMode();
  const assistant = useAssistantDrawerOrNull();
  // Shut on every load: this is a drawer of settings, not a place to be left
  // standing open above Sign out.
  const [open, setOpen] = useState(false);
  const listId = 'rail-more-body';

  // Every item is optional by role, so an owner sees four and a cashier two.
  // `glyph` is for a row whose icon is not a static member of the set: the
  // appearance switch renders ThemeModeIcon, which animates between two glyphs
  // and so has to survive the re-render rather than be swapped by name.
  const items: {
    key: string;
    icon?: IconName;
    glyph?: ReactNode;
    label: ReactNode;
    onSelect: () => void;
    pressed?: boolean;
    /** Lit like any rail row standing on its own destination. */
    active?: boolean;
    hint?: ReactNode;
  }[] = [];
  if (canSwitch) {
    items.push({
      key: 'workspace',
      icon: 'repeat',
      label: tr('ws.shell.nav.switchWorkspace'),
      // A row standing on its own destination goes nowhere, and the guard lives
      // HERE rather than in the caller's handler: the row is lit by this same
      // flag, so the thing that makes it look inert is the thing that makes it
      // inert. Not `disabled` — that would grey it out and drop it from the Tab
      // order, and "you are here" is not "you may not".
      onSelect: () => {
        if (!onWorkspacePicker) onSwitchWorkspace();
      },
      active: onWorkspacePicker,
    });
  }
  if (assistant?.allowed) {
    items.push({
      key: 'assistant',
      icon: 'spark',
      label: tr('ws.shell.nav.assistant'),
      onSelect: assistant.toggleDrawer,
      pressed: assistant.open,
      hint: <Kbd>⌘K</Kbd>,
    });
  }
  items.push({
    key: 'language',
    icon: 'globe',
    // The label names the language the press takes you TO, so it is rendered
    // in that language and needs its own lang attribute.
    label: <span lang={locale === 'ar' ? 'en' : 'ar'}>{tr('ws.shell.nav.language')}</span>,
    onSelect: toggleLocale,
  });
  items.push({
    key: 'mode',
    // Not `icon`: the sun and the moon cross-fade into each other, which needs
    // one component that stays mounted across the flip. See ThemeModeIcon.
    glyph: <ThemeModeIcon mode={mode} size={16} />,
    label: tr(mode === 'blue' ? 'ws.shell.nav.lightMode' : 'ws.shell.nav.blueMode'),
    onSelect: toggleMode,
    pressed: mode === 'blue',
  });

  return (
    <div style={{ display: 'grid' }}>
      <button
        type="button"
        className="tp-nav-item tp-rail-group"
        style={navButtonStyle}
        data-testid="rail.more"
        aria-expanded={open}
        aria-controls={listId}
        // The assistant's shortcut still works from anywhere, so the row that
        // now holds it announces it even while the group is shut.
        aria-keyshortcuts={assistant?.allowed ? 'Control+K Meta+K' : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {/* A gear, not the ellipsis it used to be (owner call, 2026-09-21).
            Everything behind this row is a SETTING — workspace, assistant,
            language, appearance — and an ellipsis says "there is more here"
            without saying what, which is the one thing the row already says
            in words. The Setup SECTION wears the sliders instead, so the two
            never read as the same destination. */}
        <Icon name="settings" size={16} />
        <span style={{ flex: 1, minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tr('ws.shell.nav.more')}
        </span>
        <span className="tp-rail-group-chevron" style={{ display: 'inline-flex' }}>
          <Icon name="chevronDown" size={14} />
        </span>
      </button>
      <div id={listId} className="tp-rail-group-body" data-open={open ? 'true' : undefined}>
        {/* `inert` while shut, so the four controls are not Tab stops and a
            screen reader does not read a closed drawer — the same guard
            RailGroup puts on its own collapsed list. */}
        <div style={{ overflow: 'hidden', minBlockSize: 0 }} inert={!open}>
          <div
            role="group"
            aria-label={tr('ws.shell.nav.moreMenu')}
            className="tp-rail-options-list"
            style={{ display: 'grid', gap: 'var(--tp-sp-0)', paddingBlockStart: 'var(--tp-sp-0)' }}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                className="tp-nav-item"
                style={navButtonStyle}
                data-testid={`rail.more.${item.key}`}
                data-active={item.active ? 'true' : undefined}
                // `aria-current`, not `aria-pressed`: this is the screen you are
                // on, not a control left switched on. The assistant row keeps
                // aria-pressed, because that one IS a toggle.
                aria-current={item.active ? 'page' : undefined}
                aria-pressed={item.pressed}
                onClick={item.onSelect}
              >
                {item.glyph ?? <Icon name={item.icon!} size={16} />}
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.hint}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
