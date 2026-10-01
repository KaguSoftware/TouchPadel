import { describe, expect, it } from 'vitest';
import { t, type Locale, type MessageKey } from '@touch/i18n';
import { STAFF_ROLES, canAccess, type StaffRole } from '../../lib/auth';
import type { WorkspaceKey } from '../../lib/workspaces';
import {
  ALL_STEP_IDS,
  GUIDES,
  GUIDE_WORKSPACES,
  TRAINEE_ROLE,
  guideFor,
  progressOf,
  stepLink,
  visibleGuide,
  type GuideStep,
} from './guideContent';

const LOCALES: readonly Locale[] = ['en', 'ar'];
const allSteps = (): { ws: (typeof GUIDE_WORKSPACES)[number]; step: GuideStep }[] =>
  GUIDE_WORKSPACES.flatMap((ws) => GUIDES[ws].flatMap((s) => s.steps.map((step) => ({ ws, step }))));

/** The raw template, no interpolation, so a {hole} is still visible. */
function text(locale: Locale, key: MessageKey): string {
  return t(locale, key);
}
/** The distinct {placeholder} names in a template (one may be used twice). */
const holes = (s: string) => [...new Set((s.match(/\{(\w+)\}/g) ?? []).map((h) => h.slice(1, -1)))].sort();

describe('which workspaces have a guide', () => {
  it('exactly the court desk, the till, the kitchen and Touch Shop', () => {
    expect(Object.keys(GUIDES).sort()).toEqual(['cashier', 'courtDesk', 'prep', 'shop']);
    for (const ws of ['manager', 'owner', 'team'] as WorkspaceKey[]) expect(guideFor(ws)).toBeNull();
    for (const ws of GUIDE_WORKSPACES) expect(guideFor(ws)).toBe(GUIDES[ws]);
  });
});

describe('step ids and keys', () => {
  it('ids are unique, `ws.section.step`, and name their own keys', () => {
    const ids = allSteps().map(({ step }) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ALL_STEP_IDS.size).toBe(ids.length);
    for (const ws of GUIDE_WORKSPACES) {
      const sectionIds = GUIDES[ws].map((s) => s.id);
      expect(new Set(sectionIds).size, ws).toBe(sectionIds.length);
      for (const s of GUIDES[ws]) {
        expect(s.titleKey).toBe(`ws.guide.${ws}.${s.id}.title`);
        expect(s.steps.length, `${ws}.${s.id}`).toBeGreaterThan(0);
        for (const step of s.steps) {
          expect(step.id).toMatch(new RegExp(`^${ws}\\.${s.id}\\.[a-zA-Z]+$`));
          expect(step.titleKey).toBe(`ws.guide.${step.id}.title`);
          expect(step.bodyKey).toBe(`ws.guide.${step.id}.body`);
        }
      }
    }
  });

  it('every key and every label it names reads as real text in English and Arabic', () => {
    const keys = new Set<MessageKey>(['ws.guide.chrome.title', 'ws.guide.chrome.progress', 'ws.guide.chrome.learned']);
    for (const ws of GUIDE_WORKSPACES) {
      for (const s of GUIDES[ws]) {
        keys.add(s.titleKey);
        for (const step of s.steps) {
          keys.add(step.titleKey);
          keys.add(step.bodyKey);
          for (const v of Object.values(step.params ?? {})) if (typeof v === 'string') keys.add(v);
        }
      }
    }
    for (const key of keys) {
      const en = text('en', key);
      const ar = text('ar', key);
      expect(en, key).not.toBe(key);
      expect(en.trim().length, key).toBeGreaterThan(0);
      expect(ar, key).not.toBe(key);
      expect(ar.trim().length, key).toBeGreaterThan(0);
      // The Arabic catalog is not an English fallback.
      if (key.startsWith('ws.guide.') && !key.endsWith('tabCount')) expect(ar, key).not.toBe(en);
    }
  });

  it('a body’s placeholders are exactly its params, and a title has none', () => {
    for (const { step } of allSteps()) {
      const want = Object.keys(step.params ?? {}).sort();
      for (const locale of LOCALES) {
        expect(holes(text(locale, step.bodyKey)), `${locale} ${step.id}`).toEqual(want);
        expect(holes(text(locale, step.titleKey)), `${locale} ${step.id} title`).toEqual([]);
      }
    }
  });

  it('a label used as a param has no placeholder of its own', () => {
    for (const { step } of allSteps()) {
      for (const v of Object.values(step.params ?? {})) {
        if (typeof v === 'string') expect(holes(text('en', v)), `${step.id} → ${v}`).toEqual([]);
      }
    }
  });
});

describe('links', () => {
  it('every link opens for the role the guide is written for', () => {
    for (const { ws, step } of allSteps()) {
      if (!step.link) continue;
      expect(canAccess(TRAINEE_ROLE[ws], step.link), `${step.id} → ${step.link}`).toBe(true);
      expect(stepLink(step, TRAINEE_ROLE[ws])).toBe(step.link);
    }
  });

  it('stepLink is null when the viewer cannot open the page, or there is none', () => {
    const tasks = allSteps().find(({ step }) => step.link === '/tasks')!.step;
    expect(stepLink(tasks, 'cashier')).toBe('/tasks');
    expect(stepLink(tasks, 'manager')).toBeNull();
    expect(stepLink(tasks, 'owner')).toBeNull();
    const plain = allSteps().find(({ step }) => !step.link)!.step;
    expect(stepLink(plain, 'owner')).toBeNull();
  });

  it('the shop guide links nowhere the shop assistant cannot go', () => {
    for (const { ws, step } of allSteps()) {
      if (ws !== 'shop') continue;
      expect(step.link === '/tasks' || step.link === '/incidents').toBe(false);
    }
  });
});

describe('visibleGuide', () => {
  it('drops a gated step for a role without it, and keeps it for one with it', () => {
    const ids = (ws: (typeof GUIDE_WORKSPACES)[number], role: StaffRole) =>
      visibleGuide(ws, role).flatMap((s) => s.steps.map((st) => st.id));
    expect(ids('cashier', 'cashier')).toContain('cashier.more.tasks');
    expect(ids('cashier', 'manager')).not.toContain('cashier.more.tasks');
    expect(ids('shop', 'shop_staff')).toContain('shop.products.prices');
    expect(ids('shop', 'manager')).not.toContain('shop.products.prices');
    expect(ids('courtDesk', 'court_desk')).toContain('courtDesk.matches.writeOff');
  });

  it('drops a section left empty', () => {
    // The kitchen's My tasks section holds one /tasks step: prep and the
    // manager cannot open /tasks, so the whole tab goes.
    expect(visibleGuide('prep', 'chef').some((s) => s.id === 'tasks')).toBe(true);
    expect(visibleGuide('prep', 'prep').some((s) => s.id === 'tasks')).toBe(false);
    expect(visibleGuide('prep', 'manager').some((s) => s.id === 'tasks')).toBe(false);
    for (const role of STAFF_ROLES) {
      for (const ws of GUIDE_WORKSPACES) {
        for (const s of visibleGuide(ws, role)) expect(s.steps.length).toBeGreaterThan(0);
      }
    }
  });

  it('the trainee sees every step of their own guide', () => {
    for (const ws of GUIDE_WORKSPACES) {
      const shown = visibleGuide(ws, TRAINEE_ROLE[ws]).flatMap((s) => s.steps).length;
      const all = GUIDES[ws].flatMap((s) => s.steps).length;
      expect(shown, ws).toBe(all);
    }
  });
});

describe('progressOf', () => {
  it('counts ticked steps per section and ignores ids that are not steps here', () => {
    const sections = visibleGuide('cashier', 'cashier');
    const total = sections.reduce((n, s) => n + s.steps.length, 0);
    const first = sections[0]!;
    const learned = new Set([first.steps[0]!.id, 'cashier.gone.step', 'prep.work.start', 'nonsense']);
    const p = progressOf(sections, learned);
    expect(p.total).toBe(total);
    expect(p.done).toBe(1);
    expect(p.bySection[first.id]).toEqual({ done: 1, total: first.steps.length });
    expect(progressOf(sections, new Set()).done).toBe(0);
  });
});
