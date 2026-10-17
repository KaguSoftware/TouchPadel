'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A command in a monospaced box with a themed copy button (staff download page).
 *
 * The box is always LTR, also on the Arabic page: a shell command does not mirror. Both labels
 * ("Copy" / "Copied") sit in one grid cell and the idle one is only hidden, so the button keeps
 * the width of the longer word and nothing shifts when the state flips. If the browser refuses
 * the clipboard (insecure origin, denied permission) the command is selected instead, so a
 * Ctrl+C still works.
 */
export function CopyCommand({
  command,
  copyLabel,
  copiedLabel,
  commandLabel,
}: {
  command: string;
  copyLabel: string;
  copiedLabel: string;
  commandLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      const node = codeRef.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  };

  return (
    <div className="tp-download__cmd">
      <code ref={codeRef} className="tp-download__code" dir="ltr" aria-label={commandLabel}>
        {command}
      </code>
      <button type="button" className="tp-btn tp-btn--ghost tp-download__copy" onClick={copy}>
        <span className="tp-download__copy-label" data-on={!copied} aria-hidden={copied}>
          {copyLabel}
        </span>
        <span className="tp-download__copy-label" data-on={copied} aria-hidden={!copied}>
          {copiedLabel}
        </span>
      </button>
      <span className="tp-download__sr" role="status">
        {copied ? copiedLabel : ''}
      </span>
    </div>
  );
}
