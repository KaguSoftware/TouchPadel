/**
 * The staff phone's daily work (build-contracts-2026-09-23 §6.1, §6.2): today's
 * checklists, production, stock, teachings, suggestions, recipes and recipe
 * changes, each rendered as a staff session of a role that sees its primary,
 * in EN and AR. See `src/smoke/auth.smoke.test.tsx` for what a case asserts
 * and `src/test/smokeCase.tsx` for how.
 *
 * Every read a screen makes on its first render is seeded under its
 * `staffKeys` key, so nothing reaches the (mocked) client; no seeded row
 * carries a photo path, which would ask storage for a signed URL.
 *
 * The cases after the table pin who sees what: the photo field on a line that
 * needs one, the head's write and ask buttons that the team members lack, the
 * manager's view of everyone's suggestions, and the owner's decision.
 */
import { describe, expect, it } from '@jest/globals';
import { makeT, type Locale } from '@touch/i18n';
import { runSmokeCases } from '../test/smokeCase';
import { TEST_VENUE_ID, renderRoute } from '../test/smoke';
import { staffKeys } from '../features/staff/keys';
import type { ChecklistsToday } from '../features/staff/checklists/logic';
import type { ProductionItem, ProductionLogRow } from '../features/staff/supplies/production';
import type { StockView } from '../features/staff/stock/logic';
import type { TeachingsPage } from '../features/staff/teachings/logic';
import type { SuggestionsPage } from '../features/staff/suggestions/logic';
import type { RecipeChangesPage, RecipeView } from '../features/staff/recipes/logic';
import StaffChecklist from '../../app/staff-checklist';
import StaffProduction from '../../app/staff-production';
import StaffStock from '../../app/staff-stock';
import StaffTeachings from '../../app/staff-teachings';
import StaffSuggestions from '../../app/staff-suggestions';
import StaffRecipes from '../../app/staff-recipes';
import StaffRecipeChange from '../../app/staff-recipe-change';

const V = TEST_VENUE_ID;

const CHECKLISTS: ChecklistsToday = {
  business_date: '2026-09-25',
  lists: [
    {
      run_id: 'run-open',
      role: 'barista',
      slot: 'open',
      name_en: 'Opening the bar',
      name_ar: 'افتتاح البار',
      done: 1,
      total: 2,
      items: [
        {
          id: 'line-1',
          position: 1,
          text_en: 'Turn on the machine',
          text_ar: 'شغّل الماكينة',
          done_by_name: 'Yusuf',
          done_at: '2026-09-25T05:10:00Z',
          note: null,
          photo_required: false,
          photo_path: null,
        },
        {
          id: 'line-2',
          position: 2,
          text_en: 'Photo of the clean counter',
          text_ar: 'صورة الطاولة نظيفة',
          done_by_name: null,
          done_at: null,
          note: null,
          photo_required: true,
          photo_path: null,
        },
      ],
    },
  ],
};

const PRODUCTION: ProductionItem[] = [
  {
    ingredient_id: 'cake',
    name_en: 'Cheesecake',
    name_ar: 'تشيز كيك',
    unit: 'pc',
    on_hand: 2,
    par_level: 8,
    below_par: true,
    made_today: 0,
    shelf_life_days: 3,
  },
];
const PRODUCTION_LOG: ProductionLogRow[] = [];

const STOCK: StockView = {
  as_of: '2026-09-25T09:00:00Z',
  items: [
    {
      ingredient_id: 'grip',
      kind: 'retail',
      name_en: 'Overgrip stock',
      name_ar: 'مخزون الشريط',
      unit: 'pc',
      pack_size: null,
      on_hand: 3,
      par_level: 10,
      low_stock_threshold: 4,
      low: true,
      below_par: true,
      next_expiry: null,
      product: { menu_item_id: 'm1', name_en: 'Overgrip', name_ar: 'شريط', size_name_en: null, size_name_ar: null },
    },
  ],
};

const TEACHINGS: TeachingsPage = {
  teachings: [
    {
      id: 'teach-1',
      team: 'bar',
      title: 'Milk at 65°',
      body: 'Steam to 65 degrees, never more.',
      photos: [],
      author_name: 'Bareq',
      created_at: '2026-09-24T08:00:00Z',
      updated_at: '2026-09-24T08:00:00Z',
      mine: false,
      editable: false,
    },
  ],
  total: 1,
};

const TEAM_SUGGESTIONS: SuggestionsPage = {
  suggestions: [
    {
      id: 'sug-1',
      author_name: 'Maha',
      author_role: 'cashier',
      body: 'A second card reader',
      created_at: '2026-09-24T10:00:00Z',
      seen_by_name: null,
      seen_at: null,
    },
  ],
  new_count: 1,
  total: 1,
};

const RECIPES: RecipeView = {
  items: [
    {
      menu_item_id: 'latte',
      name_en: 'Latte',
      name_ar: 'لاتيه',
      category_name_en: 'Coffee',
      category_name_ar: 'قهوة',
      sizes: [
        {
          variant_id: 'latte-1',
          name_en: 'Regular',
          name_ar: 'عادي',
          lines: [{ recipe_line_id: 'rl-1', ingredient_id: 'milk', name_en: 'Milk', name_ar: 'حليب' }],
        },
      ],
    },
  ],
  prepared: [],
};

const WAITING: RecipeChangesPage = {
  requests: [
    {
      id: 'req-1',
      target: 'variant',
      variant_id: 'latte-1',
      output_ingredient_id: null,
      item_name_en: 'Latte',
      item_name_ar: 'لاتيه',
      size_name_en: 'Regular',
      size_name_ar: 'عادي',
      requested_by_name: 'Bareq',
      requested_at: '2026-09-24T09:00:00Z',
      note: null,
      status: 'waiting',
      decided_by_name: null,
      decided_at: null,
      decline_reason: null,
      stale: false,
      before: [{ recipe_line_id: 'rl-1', ingredient_id: 'milk', name_en: 'Milk', name_ar: 'حليب', qty: 180, unit: 'ml' }],
      after: [{ ingredient_id: 'milk', name_en: 'Milk', name_ar: 'حليب', qty: 200, unit: 'ml' }],
    },
  ],
  waiting_count: 1,
  total: 1,
};

const HEAD_RECIPE_SEEDS: [readonly unknown[], unknown][] = [
  [staffKeys.recipes(V, 'all'), RECIPES],
  [staffKeys.ingredients(V), { ingredients: [] }],
  [staffKeys.myRecipeChanges(V), []],
];

runSmokeCases('staff daily work', [
  {
    route: 'staff-checklist',
    Component: StaffChecklist,
    labelKey: 'staff.checklists.done',
    options: { staff: { role: 'barista' }, queryData: [[staffKeys.checklists(V), CHECKLISTS]] },
  },
  {
    route: 'staff-production',
    Component: StaffProduction,
    labelKey: 'staff.checklists.production.record',
    options: {
      staff: { role: 'chef' },
      queryData: [
        [staffKeys.production(V), PRODUCTION],
        [staffKeys.productionLog(V), PRODUCTION_LOG],
      ],
    },
  },
  {
    route: 'staff-stock',
    Component: StaffStock,
    labelKey: 'staff.checklists.stock.listTitle',
    options: { staff: { role: 'court_desk' }, queryData: [[staffKeys.stock(V, 'all'), STOCK]] },
  },
  {
    route: 'staff-teachings',
    Component: StaffTeachings,
    labelKey: 'staff.checklists.teachings.listTitle',
    options: { staff: { role: 'barista' }, queryData: [[staffKeys.teachings(V, 'bar'), TEACHINGS]] },
  },
  {
    route: 'staff-suggestions',
    Component: StaffSuggestions,
    labelKey: 'staff.checklists.suggestions.submit',
    options: { staff: { role: 'cashier' }, queryData: [[staffKeys.mySuggestions(V), []]] },
  },
  {
    route: 'staff-recipes',
    Component: StaffRecipes,
    labelKey: 'staff.checklists.recipes.listTitle',
    options: { staff: { role: 'barista' }, queryData: [[staffKeys.recipes(V, 'all'), RECIPES]] },
  },
  {
    route: 'staff-recipe-change',
    Component: StaffRecipeChange,
    labelKey: 'staff.checklists.recipeChange.submit',
    options: { staff: { role: 'head_chef' }, queryData: HEAD_RECIPE_SEEDS },
  },
]);

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('who sees what on the daily-work pages in %s', (locale) => {
  const t = makeT(locale);

  it('asks for a photo on a line that needs one, and names who ticked the others', () => {
    const screen = renderRoute(StaffChecklist, {
      locale,
      staff: { role: 'barista' },
      queryData: [[staffKeys.checklists(V), CHECKLISTS]],
    });
    try {
      expect(screen.getByTestId('staff-checklist.photo.line-2.add')).toBeTruthy();
      expect(screen.getByText(t('staff.checklists.needsPhoto'))).toBeTruthy();
      expect(screen.queryByTestId('staff-checklist.photo.line-1.add')).toBeNull();
      expect(screen.getByTestId('staff-checklist.item.line-1').props.accessibilityState.checked).toBe(true);
    } finally {
      screen.unmount();
    }
  });

  it('keeps production off the phone of a role that does not make batches', () => {
    const screen = renderRoute(StaffProduction, {
      locale,
      staff: { role: 'barista' },
      queryData: [
        [staffKeys.production(V), PRODUCTION],
        [staffKeys.productionLog(V), PRODUCTION_LOG],
      ],
    });
    try {
      expect(screen.queryByTestId('staff-production.record')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('gives the head a Write button and the team member none', () => {
    const member = renderRoute(StaffTeachings, {
      locale,
      staff: { role: 'barista' },
      queryData: [[staffKeys.teachings(V, 'bar'), TEACHINGS]],
    });
    try {
      expect(member.getByTestId('staff-teachings.item.teach-1')).toBeTruthy();
      expect(member.queryByTestId('staff-teachings.write')).toBeNull();
    } finally {
      member.unmount();
    }
    const head = renderRoute(StaffTeachings, {
      locale,
      staff: { role: 'head_barista' },
      queryData: [[staffKeys.teachings(V, 'bar'), TEACHINGS]],
    });
    try {
      expect(head.getByTestId('staff-teachings.write')).toBeTruthy();
    } finally {
      head.unmount();
    }
  });

  it('lets only a head ask for a recipe change', () => {
    const barista = renderRoute(StaffRecipes, {
      locale,
      staff: { role: 'barista' },
      queryData: [[staffKeys.recipes(V, 'all'), RECIPES]],
    });
    try {
      expect(barista.getByTestId('staff-recipes.item.latte')).toBeTruthy();
      expect(barista.queryByTestId('staff-recipes.ask-change')).toBeNull();
    } finally {
      barista.unmount();
    }
    const head = renderRoute(StaffRecipes, {
      locale,
      staff: { role: 'head_barista' },
      queryData: [[staffKeys.recipes(V, 'all'), RECIPES]],
    });
    try {
      expect(head.getByTestId('staff-recipes.ask-change')).toBeTruthy();
    } finally {
      head.unmount();
    }
  });

  it('shows the manager everyone’s suggestions with Mark as read', () => {
    const screen = renderRoute(StaffSuggestions, {
      locale,
      staff: { role: 'manager' },
      queryData: [
        [staffKeys.mySuggestions(V), []],
        [staffKeys.suggestions(V, 'new'), TEAM_SUGGESTIONS],
      ],
    });
    try {
      expect(screen.getByTestId('staff-suggestions.filter')).toBeTruthy();
      expect(screen.getByTestId('staff-suggestions.seen.sug-1')).toBeTruthy();
      expect(screen.getByText(t('staff.checklists.suggestions.teamTitle'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('lets the owner decide a waiting change, and the manager only read it', () => {
    const owner = renderRoute(StaffRecipeChange, {
      locale,
      staff: { role: 'owner' },
      params: { id: 'req-1' },
      queryData: [[staffKeys.recipeChanges(V, 'all'), WAITING]],
    });
    try {
      expect(owner.getByTestId('staff-recipe-change.approve')).toBeTruthy();
      expect(owner.getByTestId('staff-recipe-change.decline')).toBeTruthy();
      expect(owner.queryByTestId('staff-recipe-change.submit')).toBeNull();
    } finally {
      owner.unmount();
    }
    const manager = renderRoute(StaffRecipeChange, {
      locale,
      staff: { role: 'manager' },
      params: { id: 'req-1' },
      queryData: [[staffKeys.recipeChanges(V, 'all'), WAITING]],
    });
    try {
      expect(manager.queryByTestId('staff-recipe-change.approve')).toBeNull();
      expect(manager.getByText(t('staff.checklists.recipeChange.ownerDecides'))).toBeTruthy();
    } finally {
      manager.unmount();
    }
  });

  it('refuses the owner’s Approve on a request whose recipe has moved', () => {
    const stale: RecipeChangesPage = { ...WAITING, requests: [{ ...WAITING.requests[0]!, stale: true }] };
    const screen = renderRoute(StaffRecipeChange, {
      locale,
      staff: { role: 'owner' },
      params: { id: 'req-1' },
      queryData: [[staffKeys.recipeChanges(V, 'all'), stale]],
    });
    try {
      expect(screen.getByTestId('staff-recipe-change.approve').props.accessibilityState.disabled).toBe(true);
      expect(screen.getByText(t('staff.checklists.recipeChange.stale'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('offers the owner every stock kind and the desk only the shop', () => {
    const desk = renderRoute(StaffStock, {
      locale,
      staff: { role: 'court_desk' },
      queryData: [[staffKeys.stock(V, 'all'), STOCK]],
    });
    try {
      expect(desk.queryByTestId('staff-stock.filter')).toBeNull();
      expect(desk.getByTestId('staff-stock.item.grip')).toBeTruthy();
    } finally {
      desk.unmount();
    }
    const owner = renderRoute(StaffStock, {
      locale,
      staff: { role: 'owner' },
      queryData: [[staffKeys.stock(V, 'all'), STOCK]],
    });
    try {
      expect(owner.getByTestId('staff-stock.filter.retail')).toBeTruthy();
    } finally {
      owner.unmount();
    }
  });
});
