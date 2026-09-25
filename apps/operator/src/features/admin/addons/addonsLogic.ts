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

export type ChoiceRule =
  | { kind: 'exactly'; count: number }
  | { kind: 'range'; min: number; max: number }
  | { kind: 'upTo'; max: number };

/**
 * The group's min/max as the rule a guest meets, so screens can say it in
 * words ("Required · choose 1", "Optional · choose up to 2") instead of
 * printing "(0–2)".
 */
export function choiceRule(min: number, max: number): ChoiceRule {
  if (min <= 0) return { kind: 'upTo', max };
  if (min === max) return { kind: 'exactly', count: min };
  return { kind: 'range', min, max };
}

/**
 * The compulsory add-on lock (price_promo, build-contracts-2026-09-23 §2.13):
 * a manager's choice limit, item link, reveal or option switch that makes
 * guests pay more for an item or a choice is refused with PRICE_VIA_PROTOCOL,
 * hint required_addon. No price change covers it, so the screen says the
 * owner makes it instead of pointing at Protocols.
 */
export function isRequiredAddonRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: unknown; hint?: unknown };
  return e.code === 'PRICE_VIA_PROTOCOL' && e.hint === 'required_addon';
}

/**
 * Launched = on sale now or at some point: launched_at set, or switched on,
 * the same test app.upsert_modifier's lock makes (price_promo, #51, #53).
 */
export function addonLaunched(m: { launched_at: string | null; is_active: boolean }): boolean {
  return m.launched_at !== null || m.is_active;
}

export interface AddonLock {
  /** The price is read-only: "Change the price", an addon_price change. */
  priceLocked: boolean;
  /**
   * A paid option never on sale: its switch is off and "Put on sale" sends
   * its price to the owner. Its price stays editable until then.
   */
  needsLaunch: boolean;
}

/**
 * What an option row offers a caller without `editLaunchedPrices` or
 * `launchDirectly` (a manager, build-contracts-2026-09-23 §5.5). Renaming,
 * reordering and switching a launched option off and on stay as they are:
 * each re-sends the stored price, which the lock lets through. A free option
 * (0 IQD) carries no price, so it may be switched on directly.
 */
export function addonLock(
  m: { launched_at: string | null; is_active: boolean; price_delta_iqd: number },
  caps: { editLaunchedPrices: boolean; launchDirectly: boolean },
): AddonLock {
  const launched = addonLaunched(m);
  return {
    priceLocked: !caps.editLaunchedPrices && launched,
    needsLaunch: !caps.launchDirectly && !launched && m.price_delta_iqd > 0,
  };
}

/**
 * A new option's switch as it is saved: a manager's paid one goes in hidden
 * (upsert_modifier's p_is_active defaults to true, which would be refused
 * LAUNCH_VIA_PROTOCOL); a free one, and anything the owner adds, goes on.
 */
export function newOptionActive(deltaIqd: number, launchDirectly: boolean): boolean {
  return launchDirectly || deltaIqd <= 0;
}

/** The options (in any group) that reveal `groupId`, in a stable order. */
export function revealersOf<M extends ModifierLike>(
  groupId: string,
  reveals: readonly RevealLike[],
  modifiers: readonly M[],
): M[] {
  const ids = new Set(reveals.filter((r) => r.group_id === groupId).map((r) => r.modifier_id));
  return modifiers.filter((m) => ids.has(m.id));
}
