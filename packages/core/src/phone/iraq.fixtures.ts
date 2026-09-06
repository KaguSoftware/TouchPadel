/**
 * Shared fixture table for the Iraqi phone normaliser. Consumed by
 * packages/core/src/phone/iraq.test.ts AND packages/db/tests/phone-otp.test.ts,
 * which runs it through the edge-function copy (_shared/phone.ts) as well —
 * the two implementations must never drift. Change both together.
 */
export const IRAQ_PHONE_FIXTURES: ReadonlyArray<{
  raw: string;
  digits: string;
  canon: string;
  e164: string | null;
}> = [
  { raw: '07701234567', digits: '07701234567', canon: '7701234567', e164: '+9647701234567' },
  { raw: '7701234567', digits: '7701234567', canon: '7701234567', e164: '+9647701234567' },
  { raw: '+964 770 123 4567', digits: '9647701234567', canon: '7701234567', e164: '+9647701234567' },
  { raw: '009647701234567', digits: '009647701234567', canon: '7701234567', e164: '+9647701234567' },
  { raw: '+964 (770) 123-4567', digits: '9647701234567', canon: '7701234567', e164: '+9647701234567' },
  { raw: '٠٧٧٠١٢٣٤٥٦٧', digits: '07701234567', canon: '7701234567', e164: '+9647701234567' },
  { raw: '۰۷۷۰۱۲۳۴۵۶۷', digits: '07701234567', canon: '7701234567', e164: '+9647701234567' },
  { raw: '0750 123 4567', digits: '07501234567', canon: '7501234567', e164: '+9647501234567' },
  // Too short: a mobile is 7 + nine digits.
  { raw: '0770123456', digits: '0770123456', canon: '770123456', e164: null },
  // Too long.
  { raw: '077012345678', digits: '077012345678', canon: '77012345678', e164: null },
  // A landline (Baghdad 01), not a mobile.
  { raw: '017712345', digits: '017712345', canon: '17712345', e164: null },
  // Another country keeps its code and is refused as an Iraqi mobile.
  { raw: '+995 419 010 203', digits: '995419010203', canon: '995419010203', e164: null },
  { raw: '+1 770 123 4567', digits: '17701234567', canon: '17701234567', e164: null },
  { raw: '', digits: '', canon: '', e164: null },
  { raw: 'call me', digits: '', canon: '', e164: null },
];
