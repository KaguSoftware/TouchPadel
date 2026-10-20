/**
 * Scope conveniences (plan §5.5). The set that APPLIES is the one stored on
 * the conversation and enforced by the edge function; everything here is
 * what the UI pre-checks for a new chat and how it recognises a refusal.
 */
import { ASSISTANT_SCOPES, type AssistantScope } from '@touch/core/assistant/tools';

export const CONVERSATION_SESSION_KEY = 'touch-assistant-conversation';

export function isScope(value: unknown): value is AssistantScope {
  return typeof value === 'string' && (ASSISTANT_SCOPES as readonly string[]).includes(value);
}

/** Keep catalog order so two equal sets print the same way. */
export function normaliseScopes(scopes: Iterable<string>): AssistantScope[] {
  const set = new Set<string>(scopes);
  return ASSISTANT_SCOPES.filter((s) => set.has(s));
}

export function sameScopes(a: readonly string[], b: readonly string[]): boolean {
  const na = normaliseScopes(a);
  const nb = normaliseScopes(b);
  return na.length === nb.length && na.every((s, i) => s === nb[i]);
}

/**
 * A new chat reads nothing until the owner picks (owner call 2026-10-20: the
 * AI is expensive, so the owner must choose what each chat reads). No page
 * scope, no remembered set and no Pages and how-to pre-checked: the composer
 * stays locked until at least one scope is on, or a starter question that
 * names its own scopes is pressed. Was Pages and how-to plus the page's scope
 * and the owner's last ticks from 2026-10-16.
 */
export const NEW_CHAT_SCOPES: readonly AssistantScope[] = [];

export function loadSessionConversation(): string | null {
  try {
    return sessionStorage.getItem(CONVERSATION_SESSION_KEY);
  } catch {
    return null;
  }
}

export function saveSessionConversation(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(CONVERSATION_SESSION_KEY, id);
    else sessionStorage.removeItem(CONVERSATION_SESSION_KEY);
  } catch {
    /* private mode */
  }
}

// ---------------------------------------------------------------------------
// "Cafe context is off for this chat" → Turn on Cafe
// ---------------------------------------------------------------------------

/** The sentence the model is told to say, in either language. */
const OFF_EN = /context is off for this chat/i;
const OFF_AR = /(?:سياق|نطاق).{0,40}?(?:مغلق|متوقف|معطّل|معطل|غير مفعّل|غير مفعل|غير مسموح).{0,20}?(?:المحادثة|الدردشة)/;
/** The tool error the edge function writes: `Scope "cafe" is off for this chat`. */
const TOOL_ERROR = /Scope\s+"([a-z]+)"\s+is off/i;

export function mentionsRefusedScope(text: string): boolean {
  return OFF_EN.test(text) || OFF_AR.test(text);
}

/**
 * Which scopes the answer says are off. Tool errors name the scope exactly;
 * failing those, the prose is searched for each scope's label in both
 * languages. Only scopes NOT already on are offered.
 */
export function refusedScopes(
  text: string,
  toolErrors: readonly string[],
  labels: Record<AssistantScope, readonly string[]>,
  current: readonly string[],
): AssistantScope[] {
  const found = new Set<AssistantScope>();
  for (const err of toolErrors) {
    const m = TOOL_ERROR.exec(err);
    if (m && isScope(m[1])) found.add(m[1]);
  }
  if (found.size === 0 && mentionsRefusedScope(text)) {
    const lower = text.toLowerCase();
    for (const scope of ASSISTANT_SCOPES) {
      if (labels[scope].some((label) => label && lower.includes(label.toLowerCase()))) found.add(scope);
    }
  }
  return normaliseScopes(found).filter((s) => !current.includes(s));
}
