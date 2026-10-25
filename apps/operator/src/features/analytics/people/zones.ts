/**
 * The People tab's zones (0369), in the order the owner asks: who they are,
 * what they are into, which groups are biggest, when each group plays, and
 * whether the levels on record hold up.
 */
import type { ZoneDef } from '../Zone';

export const PEOPLE_ZONES: readonly ZoneDef[] = [
  { id: 'who', titleKey: 'ws.analytics.people.zones.who', descKey: 'ws.analytics.people.zones.whoDesc', navKey: 'ws.analytics.people.zones.whoNav' },
  { id: 'interests', titleKey: 'ws.analytics.people.zones.interests', descKey: 'ws.analytics.people.zones.interestsDesc', navKey: 'ws.analytics.people.zones.interestsNav' },
  { id: 'groups', titleKey: 'ws.analytics.people.zones.groups', descKey: 'ws.analytics.people.zones.groupsDesc', navKey: 'ws.analytics.people.zones.groupsNav' },
  { id: 'when', titleKey: 'ws.analytics.people.zones.when', descKey: 'ws.analytics.people.zones.whenDesc', navKey: 'ws.analytics.people.zones.whenNav' },
  { id: 'judged', titleKey: 'ws.analytics.people.zones.judged', descKey: 'ws.analytics.people.zones.judgedDesc', navKey: 'ws.analytics.people.zones.judgedNav' },
];
