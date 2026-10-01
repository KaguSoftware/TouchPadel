/**
 * The iOS privacy manifest against the App Privacy label.
 *
 * app.config.ts says its collected types "mirror the App Privacy label in
 * docs/store/app-store-submission.md §2 exactly — change both together". Once
 * they drifted (Purchase History and Other Financial Info were declared on the
 * label, and the tickets build shipped without them in the manifest), so the
 * two are compared here: every "Yes" row of the §2 table is one manifest type,
 * each linked, not tracking, for App Functionality, and nothing more.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, '../../..');
const DOC = join(APP, '../../docs/store/app-store-submission.md');

/** "| Contact Info → **Email Address** | Yes | …" → "NSPrivacyCollectedDataTypeEmailAddress". */
function labelTypes(markdown: string): string[] {
  const section = markdown.split(/^## 2 · /m)[1]?.split(/^## /m)[0] ?? '';
  const out: string[] = [];
  for (const line of section.split('\n')) {
    const m = /^\| [^|]*→ \*\*([^*]+)\*\* \| Yes \|/.exec(line);
    if (m) out.push(`NSPrivacyCollectedDataType${m[1]!.replace(/\s+/g, '')}`);
  }
  return out;
}

describe('the iOS privacy manifest', () => {
  it('declares exactly the collected types of the App Privacy label, each for App Functionality', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { default: appConfig } = await import('../../../app.config');
    warn.mockRestore();
    const config = appConfig({ config: {} } as never);
    const collected = (config.ios?.privacyManifests?.NSPrivacyCollectedDataTypes ?? []) as Record<string, unknown>[];

    const label = labelTypes(readFileSync(DOC, 'utf8'));
    // The table was read: the rows the tickets build and the staff area added are there.
    expect(label).toContain('NSPrivacyCollectedDataTypePurchaseHistory');
    expect(label).toContain('NSPrivacyCollectedDataTypeOtherFinancialInfo');
    expect(collected.map((c) => c.NSPrivacyCollectedDataType).sort()).toEqual([...label].sort());
    for (const c of collected) {
      expect(c).toEqual({
        NSPrivacyCollectedDataType: c.NSPrivacyCollectedDataType,
        NSPrivacyCollectedDataTypeLinked: true,
        NSPrivacyCollectedDataTypeTracking: false,
        NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
      });
    }
    expect(config.ios?.privacyManifests?.NSPrivacyTracking).toBe(false);
  });
});
