/**
 * Pure rules for the add-ons screen: item-group vs sub-group partition,
 * min/max validation, linked-item diffing and reveal eligibility (the
 * client-side mirror of app.set_modifier_reveals' REVEAL_SELF / REVEAL_DEPTH;
 * the server stays authoritative).
 */

export interface GroupLike {
  id: string;
}
export interface LinkLike {
  item_id: string;
  group_id: string;
}
export interface RevealLike {
  modifier_id: string;
  group_id: string;
  sort_order: number;
}
export interface ModifierLike {
  id: string;
  group_id: string;
}

/** Item groups = linked to ≥ 1 item; sub-groups = zero links (reveal-only). */
export function partitionGroups<G extends GroupLike>(
  groups: readonly G[],
  links: readonly LinkLike[],
): { itemGroups: G[]; subGroups: G[] } {
  const linked = new Set(links.map((l) => l.group_id));
  return {
    itemGroups: groups.filter((g) => linked.has(g.id)),
    subGroups: groups.filter((g) => !linked.has(g.id)),
  };
}

export type MinMaxError = 'min' | 'max' | 'order' | null;

/** `0 ≤ min ≤ max`, `max ≥ 1`. */
export function minMaxError(min: number, max: number): MinMaxError {
  if (!Number.isInteger(min) || min < 0) return 'min';
  if (!Number.isInteger(max) || max < 1) return 'max';
  if (min > max) return 'order';
  return null;
}

export interface LinkDiff {
  link: string[];
  unlink: string[];
}

/** Item ids to link / unlink so `before` becomes `after`. */
export function diffLinks(before: Iterable<string>, after: Iterable<string>): LinkDiff {
  const b = new Set(before);
  const a = new Set(after);
  return {
    link: [...a].filter((id) => !b.has(id)),
    unlink: [...b].filter((id) => !a.has(id)),
  };
}

/**
 * Sub-groups a modifier may reveal: not linked to any item, not its own
 * group, and not containing a modifier that already reveals (depth 1 only).
 * Returns an empty list when the modifier's own group is itself a reveal
 * target (depth rule (b)), except for groups it already reveals so an
 * existing list can still be cleared.
 */
export function eligibleRevealGroups<G extends GroupLike>(
  modifier: ModifierLike,
  groups: readonly G[],
  links: readonly LinkLike[],
  reveals: readonly RevealLike[],
  modifiers: readonly ModifierLike[],
): G[] {
  const { subGroups } = partitionGroups(groups, links);
  const ownGroupIsTarget = reveals.some((r) => r.group_id === modifier.group_id);
  if (ownGroupIsTarget) return [];
  const revealingModifiers = new Set(reveals.map((r) => r.modifier_id));
  const groupsWithRevealingModifiers = new Set(
    modifiers.filter((m) => revealingModifiers.has(m.id)).map((m) => m.group_id),
  );
  return subGroups.filter(
    (g) => g.id !== modifier.group_id && !groupsWithRevealingModifiers.has(g.id),
  );
}

/** Ordered group ids currently revealed by a modifier. */
export function revealedGroupIds(modifierId: string, reveals: readonly RevealLike[]): string[] {
  return reveals
    .filter((r) => r.modifier_id === modifierId)
    .sort((a, b) => a.sort_order - b.sort_order || a.group_id.localeCompare(b.group_id))
    .map((r) => r.group_id);
}

/** Move `index` one step; returns the same array when the move is impossible. */
export function moveInList<T>(list: readonly T[], index: number, direction: 'up' | 'down'): T[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  const tmp = next[index]!;
  next[index] = next[target]!;
  next[target] = tmp;
  return next;
}

export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
