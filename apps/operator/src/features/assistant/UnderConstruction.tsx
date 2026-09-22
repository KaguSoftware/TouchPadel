/**
 * TEMPORARY — greys out the assistant and blocks every click/keypress.
 * To revert: delete this file and undo the two marked lines in routes/assistant.tsx.
 */
import type { ReactNode } from 'react';

export function UnderConstruction({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: 'relative', blockSize: '100%', minBlockSize: 0 }}>
      <div inert aria-hidden style={{ blockSize: '100%', filter: 'grayscale(1)', opacity: 0.4, pointerEvents: 'none', userSelect: 'none' }}>
        {children}
      </div>
      <div
        role="status"
        style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 'var(--tp-sp-4)' }}
      >
        <p
          style={{
            margin: 0,
            maxInlineSize: '32rem',
            padding: 'var(--tp-sp-4) var(--tp-sp-5)',
            borderRadius: 12,
            border: '1px solid var(--tp-border)',
            background: 'var(--tp-surface)',
            color: 'var(--tp-fg)',
            fontWeight: 600,
            textAlign: 'center',
            boxShadow: '0 8px 24px rgb(0 0 0 / 0.15)',
          }}
        >
          🚧 Under construction, patience please tofy abi, you’ll get this soon
        </p>
      </div>
    </div>
  );
}
