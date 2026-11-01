/**
 * How long a staff PIN is (F-50, 2026-11-01): 4 to 12 digits, for every role.
 * The server checks the same range (app.set_staff_pin and the PIN-gated RPCs),
 * packages/core's MANAGER_PIN_RE for queued payloads and the shell's
 * validatePin for leaving the station. Every PIN field in the operator reads
 * these two numbers, so a field never enables at a length the server refuses
 * or cuts off a PIN the server accepts.
 */
export const PIN_MIN = 4;
export const PIN_MAX = 12;

/** Long enough to send: the field's button enables from here. */
export function pinLongEnough(pin: string): boolean {
  return pin.length >= PIN_MIN;
}

/** Digits only, cut at PIN_MAX: what a PIN field keeps of what was typed or pasted. */
export function pinDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, PIN_MAX);
}
