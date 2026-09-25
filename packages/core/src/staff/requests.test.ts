/**
 * The staff request form's rules, as 0072's CHECK constraints state them: a
 * request the phone sends is one the table accepts.
 */
import { describe, expect, it } from 'vitest';
import {
  localIsoDate,
  parseTypedAmount,
  parseTypedDate,
  staffRequestArgs,
  validateStaffRequest,
  westernDigits,
  type StaffRequestDraft,
} from './requests';

const draft = (patch: Partial<StaffRequestDraft>): StaffRequestDraft => ({
  kind: 'leave',
  from: '',
  to: '',
  amount: '',
  note: '',
  ...patch,
});

describe('typed values', () => {
  it('folds Arabic-Indic and Persian digits and keeps everything else', () => {
    expect(westernDigits('٢٠٢٦-١٠-٠٥')).toBe('2026-10-05');
    expect(westernDigits('۲۵۰۰۰ IQD')).toBe('25000 IQD');
  });

  it('reads a day in either digit set and with /, . or - between the parts', () => {
    expect(parseTypedDate('2026-10-05')).toBe('2026-10-05');
    expect(parseTypedDate(' 2026/10/5 ')).toBe('2026-10-05');
    expect(parseTypedDate('٢٠٢٦.١٠.٠٥')).toBe('2026-10-05');
  });

  it('refuses a day that does not exist, and anything that is not a day', () => {
    expect(parseTypedDate('2026-02-30')).toBeNull();
    expect(parseTypedDate('05-10-2026')).toBeNull();
    expect(parseTypedDate('tomorrow')).toBeNull();
    expect(parseTypedDate('')).toBeNull();
  });

  it('reads a whole amount above 0 that fits an int column', () => {
    expect(parseTypedAmount('250,000')).toBe(250000);
    expect(parseTypedAmount('٢٥٠٠٠٠')).toBe(250000);
    expect(parseTypedAmount('0')).toBeNull();
    expect(parseTypedAmount('12.5')).toBeNull();
    expect(parseTypedAmount('-5')).toBeNull();
    expect(parseTypedAmount('2147483648')).toBeNull();
  });

  it('names today by the phone’s own calendar', () => {
    expect(localIsoDate(new Date(2026, 0, 7, 23, 30))).toBe('2026-01-07');
  });
});

describe('validateStaffRequest (0072 staff_requests_dates_chk, _amount_chk, _correction_note_chk)', () => {
  it('passes a leave or shift swap with both days in order', () => {
    expect(validateStaffRequest(draft({ from: '2026-10-05', to: '2026-10-07' }))).toEqual([]);
    expect(validateStaffRequest(draft({ kind: 'shift_swap', from: '2026-10-05', to: '2026-10-05' }))).toEqual([]);
  });

  it('asks for both days, real ones, the last not before the first', () => {
    expect(validateStaffRequest(draft({}))).toEqual([
      { field: 'from', code: 'required' },
      { field: 'to', code: 'required' },
    ]);
    expect(validateStaffRequest(draft({ from: '2026-10-32', to: '2026-10-05' }))).toEqual([
      { field: 'from', code: 'invalid' },
    ]);
    expect(validateStaffRequest(draft({ from: '2026-10-07', to: '2026-10-05' }))).toEqual([
      { field: 'to', code: 'order' },
    ]);
  });

  it('asks a correction for its day and for what the record gets wrong', () => {
    expect(validateStaffRequest(draft({ kind: 'correction', from: '2026-09-20' }))).toEqual([
      { field: 'note', code: 'required' },
    ]);
    expect(validateStaffRequest(draft({ kind: 'correction', from: '2026-09-20', note: 'I closed the till' }))).toEqual(
      [],
    );
  });

  it('asks an advance for an amount above 0 and nothing else', () => {
    expect(validateStaffRequest(draft({ kind: 'advance', amount: '' }))).toEqual([{ field: 'amount', code: 'required' }]);
    expect(validateStaffRequest(draft({ kind: 'advance', amount: 'lots' }))).toEqual([{ field: 'amount', code: 'invalid' }]);
    expect(validateStaffRequest(draft({ kind: 'advance', amount: '50000', from: 'x' }))).toEqual([]);
  });
});

describe('staffRequestArgs', () => {
  it('sends only the fields a kind uses, so the CHECKs never see a stray date or amount', () => {
    expect(staffRequestArgs(draft({ from: '2026/10/5', to: '2026-10-06', amount: '9', note: ' ' }))).toEqual({
      kind: 'leave',
      from: '2026-10-05',
      to: '2026-10-06',
      amountIqd: null,
      note: '',
    });
    expect(staffRequestArgs(draft({ kind: 'correction', from: '2026-09-20', to: '2026-09-21', note: ' Late ' }))).toEqual({
      kind: 'correction',
      from: '2026-09-20',
      to: null,
      amountIqd: null,
      note: 'Late',
    });
    expect(staffRequestArgs(draft({ kind: 'advance', from: '2026-09-20', amount: '75,000' }))).toEqual({
      kind: 'advance',
      from: null,
      to: null,
      amountIqd: 75000,
      note: '',
    });
  });
});
