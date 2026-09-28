/**
 * The supplier, in ONE box (owner, 2026-09-27): type any name, or pick one of
 * the venue's suppliers from the list that opens under the box and narrows as
 * you type. It replaced a "choose from the list / Not on the list" select with
 * a second name box that appeared under it, on Goods in, the driver's
 * purchase and the scanned receipt.
 *
 * The caller keeps the same two values as before, a supplier id and a typed
 * name, and sends one or the other: a pick sets the id, typing clears it and
 * keeps the text. A typed name that matches a supplier exactly (ignoring case
 * and spaces) is linked to it when the box is left, so typing a known name
 * files the delivery under that supplier, not as a loose name.
 *
 * The list is portalled and fixed, measured off the box, dismissed on scroll,
 * like SelectMenu, because the box sits inside panels and tables that clip.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '../../lib/i18n';
import { Icon } from '../../components/icons';
import { inputStyle } from '../../components/ui';

export interface SupplierOption {
  id: string;
  name: string;
}

const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/** The suppliers whose name contains the typed text: those starting with it first. */
export function matchSuppliers(suppliers: readonly SupplierOption[], text: string): SupplierOption[] {
  const q = text.trim().toLocaleLowerCase();
  if (q === '') return [...suppliers];
  const hits = suppliers.filter((s) => s.name.toLocaleLowerCase().includes(q));
  return [...hits.filter((s) => s.name.toLocaleLowerCase().startsWith(q)), ...hits.filter((s) => !s.name.toLocaleLowerCase().startsWith(q))];
}

export function SupplierField({
  suppliers,
  supplierId,
  name,
  onChange,
  disabled,
  maxLength = 80,
  style,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  id: idProp,
}: {
  suppliers: readonly SupplierOption[];
  /** A supplier from the list; '' when the name is typed. */
  supplierId: string;
  /** The typed name, used when no supplier is picked. */
  name: string;
  onChange: (supplierId: string, name: string) => void;
  disabled?: boolean;
  maxLength?: number;
  style?: CSSProperties;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  id?: string;
}) {
  const { tr } = useLocale();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState<{ start: number; top: number; width: number } | null>(null);
  const [dir, setDir] = useState<'ltr' | 'rtl'>('ltr');

  const picked = supplierId ? suppliers.find((s) => s.id === supplierId) : undefined;
  const text = picked ? picked.name : name;
  // With a supplier picked the whole list shows, so another can be chosen
  // without clearing the box first.
  const options = picked ? [...suppliers] : matchSuppliers(suppliers, text);
  const showList = open && !disabled && (options.length > 0 || text.trim() !== '');

  function measure() {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === 'rtl';
    setDir(rtl ? 'rtl' : 'ltr');
    setBox({ start: rtl ? window.innerWidth - r.right : r.left, top: r.bottom, width: r.width });
  }

  useLayoutEffect(() => {
    if (showList) measure();
  }, [showList]);

  // Closed on scroll (outside the list), resize and a press elsewhere: the
  // list is fixed to where the box was, so it is dismissed rather than chased.
  useEffect(() => {
    if (!showList) return;
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !inputRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onDown);
    };
  }, [showList]);

  function pick(s: SupplierOption) {
    onChange(s.id, s.name);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => Math.min(Math.max(i + delta, 0), options.length - 1));
    } else if (e.key === 'Enter' && open && active >= 0 && options[active]) {
      e.preventDefault();
      pick(options[active]!);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  }

  // Leaving the box: a typed name that IS a supplier becomes that supplier.
  function onBlur() {
    if (supplierId) return;
    const match = suppliers.find((s) => same(s.name, name));
    if (match) onChange(match.id, match.name);
  }

  const activeId = showList && active >= 0 && options[active] ? `${listId}-${active}` : undefined;

  return (
    <div style={{ position: 'relative', ...style }}>
      <input
        ref={inputRef}
        id={idProp}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        autoComplete="off"
        style={{ ...inputStyle, paddingInlineEnd: '2rem' }}
        value={text}
        maxLength={maxLength}
        disabled={disabled}
        placeholder={suppliers.length > 0 ? tr('ws.manager.stock.goodsIn.supplierPlaceholder') : undefined}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          onChange('', e.target.value);
          setOpen(true);
          setActive(-1);
        }}
      />
      {suppliers.length > 0 && (
        <Icon
          name="chevronDown"
          size={14}
          style={{ position: 'absolute', insetInlineEnd: '0.65rem', insetBlockStart: '50%', transform: 'translateY(-50%)', color: 'var(--tp-muted-fg)', pointerEvents: 'none' }}
        />
      )}
      {showList &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            id={listId}
            role="listbox"
            aria-label={tr('ws.manager.stock.goodsIn.supplier')}
            className="tp-menu-glass tp-rise"
            data-menu-portal=""
            dir={dir}
            style={{
              position: 'fixed',
              insetInlineStart: `${box.start}px`,
              insetBlockStart: `${box.top}px`,
              marginBlockStart: 'var(--tp-sp-1)',
              minInlineSize: `${box.width}px`,
              maxInlineSize: 'min(28rem, calc(100vw - 16px))',
              maxBlockSize: '18rem',
              overflowY: 'auto',
              zIndex: 'var(--tp-z-menu)',
              display: 'grid',
              padding: 'var(--tp-sp-1)',
            }}
          >
            {options.map((s, i) => (
              <div
                key={s.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={s.id === supplierId}
                data-active={i === active ? 'true' : undefined}
                // mousedown, not click: the box's blur would otherwise run first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                onPointerEnter={() => setActive(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--tp-sp-2)',
                  minBlockSize: 'var(--tp-touch)',
                  paddingInline: 'var(--tp-sp-3)',
                  borderRadius: 'var(--tp-radius-ctl)',
                  cursor: 'pointer',
                  background: i === active ? 'var(--tp-hover)' : undefined,
                  color: i === active ? 'var(--tp-hover-fg)' : 'var(--tp-fg)',
                  fontWeight: s.id === supplierId ? 700 : undefined,
                }}
              >
                <bdi style={{ flex: 1 }}>{s.name}</bdi>
                {s.id === supplierId && <Icon name="check" size={14} />}
              </div>
            ))}
            {!picked && text.trim() !== '' && !suppliers.some((s) => same(s.name, text)) && (
              // Not a row: says what a name that is on no list will do.
              <div aria-hidden="true" style={{ paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', borderBlockStart: options.length > 0 ? '1px solid var(--tp-border)' : undefined }}>
                {tr('ws.manager.stock.goodsIn.supplierNew', { name: text.trim() })}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
