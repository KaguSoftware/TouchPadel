import { describe, expect, it } from 'vitest';
import { columnLetter, sheetName, styleFor, xlsxEntries } from './xlsx';

const partsOf = (sheets: Parameters<typeof xlsxEntries>[0]) => new Map(xlsxEntries(sheets).map((e) => [e.name, e.text]));

const daySheet = {
  name: 'Day close',
  columns: ['Figure', { header: 'Value (IQD)', type: 'money' as const }, { header: 'Count', type: 'number' as const }],
  rows: [
    ['Opening float', 50000, null],
    ['Cash taken', 298000, null],
    ['Voided lines', -148000, 3],
  ],
};

describe('the package', () => {
  it('has every part a workbook needs, and declares each one', () => {
    const parts = partsOf([daySheet]);
    expect([...parts.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    const types = parts.get('[Content_Types].xml')!;
    expect(types).toContain('/xl/workbook.xml');
    expect(types).toContain('/xl/styles.xml');
    expect(types).toContain('/xl/worksheets/sheet1.xml');
  });

  it('gives every sheet its own part, relationship and tab', () => {
    const parts = partsOf([daySheet, { ...daySheet, name: 'Adjustments' }]);
    expect(parts.has('xl/worksheets/sheet2.xml')).toBe(true);
    expect(parts.get('xl/workbook.xml')).toContain('<sheet name="Day close" sheetId="1" r:id="rId1"/>');
    expect(parts.get('xl/workbook.xml')).toContain('<sheet name="Adjustments" sheetId="2" r:id="rId2"/>');
    const rels = parts.get('xl/_rels/workbook.xml.rels')!;
    expect(rels).toContain('Id="rId1"');
    expect(rels).toContain('Id="rId2"');
    // The styles part is the relationship after the last sheet.
    expect(rels).toContain('Id="rId3"');
    expect(rels).toContain('Target="styles.xml"');
  });

  it('refuses a workbook with no sheets rather than writing a broken file', () => {
    expect(() => xlsxEntries([])).toThrow();
  });
});

describe('a sheet', () => {
  const sheet = partsOf([daySheet]).get('xl/worksheets/sheet1.xml')!;

  it('sets a width on every column, so nothing is cut off', () => {
    expect(sheet).toContain('<col min="1" max="1"');
    expect(sheet).toContain('<col min="3" max="3"');
    expect(sheet).toMatch(/<col min="1" max="1" width="\d+" customWidth="1"\/>/);
  });

  it('freezes the header and puts filters on it', () => {
    expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toContain('<autoFilter ref="A1:C4"/>');
  });

  it('styles the header row apart from the data', () => {
    expect(sheet).toContain('<c r="A1" s="1"');
    expect(sheet).not.toContain(`<c r="A1" s="${styleFor('text', false)}"`);
    expect(sheet).toContain('<is><t xml:space="preserve">Figure</t></is>');
  });

  // The elements of a worksheet have a fixed order; out of order, Excel calls
  // the file damaged and offers to repair it.
  it('writes cols, then sheetData, then autoFilter', () => {
    expect(sheet.indexOf('<cols>')).toBeLessThan(sheet.indexOf('<sheetData>'));
    expect(sheet.indexOf('<sheetData>')).toBeLessThan(sheet.indexOf('<autoFilter'));
  });

  it('bands every other row', () => {
    // Row 2 is plain, row 3 banded — the two styles differ.
    expect(sheet).toContain(`<c r="A2" s="${styleFor('text', false)}"`);
    expect(sheet).toContain(`<c r="A3" s="${styleFor('text', true)}"`);
  });

  it('writes a number as a number, not as text', () => {
    expect(sheet).toContain(`<c r="B2" s="${styleFor('money', false)}"><v>50000</v></c>`);
    expect(sheet).toContain(`<c r="B4" s="${styleFor('money', false)}"><v>-148000</v></c>`);
  });

  it('leaves an absent cell out entirely rather than writing an empty string', () => {
    expect(sheet).not.toContain('<c r="C2"');
  });

  it('writes a date and a time as real dates and times', () => {
    const when = partsOf([{ name: 'w', columns: [{ header: 'Date', type: 'date' as const }, { header: 'Time', type: 'time' as const }], rows: [['2026-09-23', '14:05']] }]).get(
      'xl/worksheets/sheet1.xml',
    )!;
    // 2026-09-23 is day 46288 counting from 1899-12-30; 14:05 is 845/1440 of a day.
    expect(when).toContain('<v>46288</v>');
    expect(when).toContain(`<v>${845 / 1440}</v>`);
  });

  it('lays the sheet out right to left in Arabic', () => {
    const rtl = partsOf([{ ...daySheet, rightToLeft: true }]).get('xl/worksheets/sheet1.xml')!;
    expect(rtl).toContain('rightToLeft="1"');
  });

  it('escapes what would otherwise break the XML', () => {
    const odd = partsOf([{ name: 'x', columns: ['A & B'], rows: [['<tag> "quoted"']] }]).get('xl/worksheets/sheet1.xml')!;
    expect(odd).toContain('A &amp; B');
    expect(odd).toContain('&lt;tag&gt; &quot;quoted&quot;');
    expect(odd).not.toContain('<tag>');
  });

  it('keeps Arabic text intact', () => {
    const ar = partsOf([{ name: 'الأرقام', columns: ['الصنف'], rows: [['قهوة']] }]);
    expect(ar.get('xl/workbook.xml')).toContain('name="الأرقام"');
    expect(ar.get('xl/worksheets/sheet1.xml')).toContain('قهوة');
  });
});

describe('styles', () => {
  const styles = partsOf([daySheet]).get('xl/styles.xml')!;

  it('defines the header fill and the banding fill, after the two the format reserves', () => {
    expect(styles).toContain('<patternFill patternType="none"/>');
    expect(styles).toContain('<patternFill patternType="gray125"/>');
    expect(styles).toContain('FF1F3A5F');
    expect(styles).toContain('FFEEF3F9');
    expect(styles).toContain('<fills count="4">');
  });

  it('shows a negative amount in red', () => {
    expect(styles).toContain('#,##0;[Red]-#,##0');
  });

  it('writes a percentage as sent, not multiplied by a hundred', () => {
    expect(styles).toContain('0.0&quot;%&quot;;[Red]-0.0&quot;%&quot;');
  });
});

describe('sheet names', () => {
  it('drops the characters a sheet name may not hold and trims to 31', () => {
    expect(sheetName('Sales/2026 [Q3]', new Set())).toBe('Sales 2026 Q3');
    expect(sheetName('x'.repeat(50), new Set())).toHaveLength(31);
  });
  it('never repeats a name already taken', () => {
    expect(sheetName('Figures', new Set(['figures']))).toBe('Figures (2)');
    expect(sheetName('Figures', new Set(['figures', 'figures (2)']))).toBe('Figures (3)');
  });
});

describe('columnLetter', () => {
  it('counts past Z the way a spreadsheet does', () => {
    expect([0, 25, 26, 27, 51, 52].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });
});
