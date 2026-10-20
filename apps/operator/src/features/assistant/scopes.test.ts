import { describe, expect, it } from 'vitest';
import { NEW_CHAT_SCOPES, refusedScopes } from './scopes';
import { ASSISTANT_SCOPES, type AssistantScope } from '@touch/core/assistant/tools';

describe('NEW_CHAT_SCOPES (owner call 2026-10-20: the owner must pick what a chat reads)', () => {
  it('starts a new chat with nothing checked, not even Pages and how-to', () => {
    expect(NEW_CHAT_SCOPES).toEqual([]);
  });
});

describe('refusedScopes', () => {
  const labels = Object.fromEntries(ASSISTANT_SCOPES.map((s) => [s, [s]])) as unknown as Record<AssistantScope, string[]>;

  it('reads the scope from the tool error and skips one already on', () => {
    expect(refusedScopes('', ['Scope "cafe" is off for this chat'], labels, [])).toEqual(['cafe']);
    expect(refusedScopes('', ['Scope "cafe" is off for this chat'], labels, ['cafe'])).toEqual([]);
  });

  it('falls back to the labels the refusal sentence names', () => {
    expect(refusedScopes('Stock context is off for this chat.', [], labels, ['howto'])).toEqual(['stock']);
  });
});
