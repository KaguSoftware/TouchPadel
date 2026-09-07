/**
 * Setup home (/setup) — the landing screen of the owner's Setup SECTION.
 *
 * The card grid, the role wall and the "no card back to this screen" rule all
 * live in components/SectionHome, shared with Financial and Observation; this
 * file is now only the section's own copy.
 *
 * Not to be confused with features/setup/StationSetupScreen — that is the
 * first-run, pre-sign-in setup of the MACHINE.
 */
import { useLocale } from '../../lib/i18n';
import { SectionHome } from '../../components/SectionHome';

type CardKey = 'staff' | 'courts' | 'tables' | 'settings' | 'guestSite';

export function SetupHomeScreen() {
  const { tr } = useLocale();
  return (
    <SectionHome
      sectionKey="setup"
      title={tr('ws.owner.setupHome.title')}
      lead={tr('ws.owner.setupHome.lead')}
      card={(key) => tr(`ws.owner.setupHome.cards.${key as CardKey}`)}
    />
  );
}
