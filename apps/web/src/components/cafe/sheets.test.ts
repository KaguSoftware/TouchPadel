import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Sheet guard (web-slice §2). Drag-to-close broke three separate times in ways
 * a unit test on the maths could never see, because the defects were all in the
 * WIRING, not the arithmetic:
 *
 *  1. A second, drifted copy of `useSheetDrag` lived in hooks/cafe. Its binding
 *     effect had only stable deps, so for a sheet that returns null until it is
 *     open — every sheet here — the header did not exist on the one render the
 *     effect ran, and the pointer listeners were never attached at all. The
 *     orders and waiter sheets shipped with a grip that did nothing.
 *  2. Sheets that dragged closed without passing `dragged` to SheetShell
 *     replayed the slide-out from the top instead of fading from where the
 *     finger let go, which reads as the sheet bouncing back up.
 *  3. Sheets that hand-rolled their own backdrop instead of using SheetShell
 *     had no exit animation, no Escape and no focus trap.
 *
 * apps/web has no DOM test environment (vitest runs on `node`, and there is no
 * @testing-library/react), so these are source-level guards in the spirit of
 * styles/cafe/cafe-css.test.ts. They are cheap and they pin the exact
 * regressions that shipped.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');

function read(rel: string): string {
  return readFileSync(path.join(SRC, rel), 'utf8');
}

/** Every *Sheet.tsx under components/cafe, as [name, source]. */
function sheetSources(): [string, string][] {
  const out: [string, string][] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('Sheet.tsx')) out.push([entry.name, readFileSync(full, 'utf8')]);
    }
  };
  walk(path.join(SRC, 'components', 'cafe'));
  return out.sort(([a], [b]) => a.localeCompare(b));
}

describe('sheet drag wiring', () => {
  const sheets = sheetSources();

  it('finds every cafe sheet', () => {
    expect(sheets.map(([n]) => n)).toEqual([
      'BasketSheet.tsx',
      'ItemSheet.tsx',
      'OrdersSheet.tsx',
      'QrRequiredSheet.tsx',
      'WaiterSheet.tsx',
    ]);
  });

  /**
   * ONE implementation. The duplicate in hooks/cafe is what allowed the binding
   * fix to be made in one copy and silently missed in the other.
   */
  it('has a single useSheetDrag implementation', () => {
    const impls: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
          walk(full);
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
          if (/export function useSheetDrag/.test(readFileSync(full, 'utf8'))) {
            // Normalize for Windows: path.relative emits backslashes there.
            impls.push(path.relative(SRC, full).replaceAll('\\', '/'));
          }
        }
      }
    };
    walk(SRC);
    expect(impls).toEqual(['components/cafe/ItemSheet/drag.ts']);
  });

  /**
   * The binding effect must depend on the header NODE, not just the ref object.
   * A ref's .current is neither a render nor a dependency, so an effect keyed
   * only on the ref never re-runs when the header finally mounts.
   */
  it('re-binds when the header node appears', () => {
    const drag = read('components/cafe/ItemSheet/drag.ts');
    expect(drag).toMatch(/useState<HTMLElement \| null>\(null\)/);
    expect(drag).toMatch(/if \(headerRef\.current !== header\) setHeader\(headerRef\.current\)/);
    // the pointer-binding effect lists the node itself
    expect(drag).toMatch(/\[headerRef, header, threshold, intent\]/);
  });

  for (const [name, src] of sheets) {
    describe(name, () => {
      it('closes through SheetShell, not a hand-rolled backdrop', () => {
        expect(src).toContain('SheetShell');
        // a sheet that renders its own scrim skips the exit, Escape and the trap
        expect(src).not.toMatch(/<div className="tp-sheet-backdrop"/);
      });

      it('uses the single drag hook', () => {
        expect(src).toMatch(/import \{ useSheetDrag \} from '(\.\.\/)?ItemSheet\/drag'|from '\.\/drag'/);
        expect(src).not.toContain("from '@/hooks/cafe/useSheetDrag'");
      });

      it('hands the swipe-close to SheetShell as dragged', () => {
        expect(src).toContain('dragged={dragClosed}');
        expect(src).toMatch(/setDragClosed\(true\)/);
      });

      /**
       * The flag must not survive an opening. A sheet that stays mounted and
       * merely returns null has to clear it explicitly; ItemSheet instead
       * unmounts its stateful inner component (keyed on the item id), which
       * resets the state for free — so it is exempt, but only for that reason.
       */
      it('does not carry the dragged flag into the next opening', () => {
        if (name === 'ItemSheet.tsx') {
          expect(src).toContain('if (!item) return null;');
          expect(src).toContain('key={item.id}');
          return;
        }
        expect(src).toMatch(/setDragClosed\(false\)/);
      });

      it('arms the drag on the header only', () => {
        expect(src).toMatch(/className="tp-sheet__header[^"]*" *\n? *(data-[^\n]*\n *)*ref=\{headerRef\}|ref=\{headerRef\}/);
        expect(src).toContain('tp-sheet__grip');
      });
    });
  }
});

describe('sheet header css', () => {
  it('keeps touch-action:none on the drag header', () => {
    // without it the browser scrolls instead of letting the gesture through
    expect(read('styles/cafe/sheet.css.ts')).toMatch(/\.tp-sheet__header \{[^}]*touch-action: none/);
  });

  it('gives a dragged close its own exit', () => {
    const css = read('styles/cafe/sheet.css.ts');
    expect(css).toContain("[data-closing='true'][data-dragged='true']");
  });
});
