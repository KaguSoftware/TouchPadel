/** Telegram chat id — same rule as the 0029 `chat_id` setting shape. */
export const CHAT_ID_RE = /^-?\d{5,20}$/;

export function isValidChatId(value: string): boolean {
  return CHAT_ID_RE.test(value.trim());
}

/** Normalise Arabic-Indic digits and stray whitespace so a pasted id validates. */
export function normalizeChatId(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\s+/g, '');
}
