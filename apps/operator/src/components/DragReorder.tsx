/**
 * Reordering by hand: a six-dot grip (two dots across, three down) and rows
 * that can be dragged. The grip is also a button, so the up and down arrow
 * keys move a row without a mouse; the drag is the pointer's way.
 */
import { useState, type DragEvent } from 'react';

export function DragHandle({ label, disabled, onMove }: { label: string; disabled?: boolean; onMove: (direction: 'up' | 'down') => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        e.stopPropagation();
        onMove(e.key === 'ArrowUp' ? 'up' : 'down');
      }}
      style={{
        display: 'grid',
        placeItems: 'center',
        inlineSize: '2rem',
        blockSize: '2rem',
        padding: 0,
        border: 'none',
        borderRadius: 'var(--tp-radius-ctl)',
        background: 'transparent',
        color: 'var(--tp-muted-fg)',
        cursor: disabled ? 'not-allowed' : 'grab',
        opacity: disabled ? 'var(--tp-opacity-disabled)' : 1,
      }}
    >
      <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="4" r="1.6" />
        <circle cx="11" cy="4" r="1.6" />
        <circle cx="5" cy="10" r="1.6" />
        <circle cx="11" cy="10" r="1.6" />
        <circle cx="5" cy="16" r="1.6" />
        <circle cx="11" cy="16" r="1.6" />
      </svg>
    </button>
  );
}

/**
 * Drag state for a list that is not a DataTable. `keys` is the list's order;
 * `onDrop(from, to)` applies the move. Spread `rowProps(key)` on each row
 * element (it must be a real element: a Fragment or `display: contents` box
 * cannot be dragged); pass `enabled={false}` to switch dragging off.
 */
export function useDragReorder(keys: readonly string[], onDrop: (from: string, to: string) => void, enabled = true) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const end = () => {
    setDragKey(null);
    setOverKey(null);
  };
  const rowProps = (key: string) => {
    if (!enabled) return {};
    const drop = dragKey !== null && overKey === key && dragKey !== key ? (keys.indexOf(dragKey) < keys.indexOf(key) ? 'after' : 'before') : undefined;
    return {
      className: 'tp-dnd',
      draggable: true,
      'data-dragging': dragKey === key ? 'true' : undefined,
      'data-drop': drop,
      onDragStart: (e: DragEvent) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', key);
        setDragKey(key);
      },
      onDragOver: (e: DragEvent) => {
        if (dragKey === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (overKey !== key) setOverKey(key);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        if (dragKey !== null && dragKey !== key) onDrop(dragKey, key);
        end();
      },
      onDragEnd: end,
    } as const;
  };
  return rowProps;
}
