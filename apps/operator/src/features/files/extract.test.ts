import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import {
  TEXT_MAX_CHARS,
  columnIndex,
  decodeEntities,
  docxText,
  drawingText,
  extractText,
  htmlText,
  odfText,
  sharedStrings,
  sheetText,
  textKind,
  tidyText,
  workbookSheetNames,
} from './extract';

// The words the assistant reads (0354), pulled out in the browser.

/** A real ZIP (deflate entries, like Office writes), built with node's zlib. */
function zip(entries: Record<string, string>): Uint8Array<ArrayBuffer> {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.from(text, 'utf8');
    const data = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, data);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(8, 10);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(raw.length, 24);
    head.writeUInt16LE(nameBuf.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}

const file = (body: BlobPart, name: string, type = '') => new File([body], name, { type });

describe('textKind', () => {
  it('reads the extension first, then the type', () => {
    expect(textKind('Contract.PDF', '')).toBe('pdf');
    expect(textKind('prices.xlsx', 'application/octet-stream')).toBe('xlsx');
    expect(textKind('notes', 'text/plain')).toBe('plain');
    expect(textKind('page', 'text/html')).toBe('html');
    expect(textKind('photo.jpg', 'image/jpeg')).toBeNull();
    expect(textKind('old.doc', 'application/msword')).toBeNull();
  });
});

describe('the XML readers', () => {
  it('decodes entities', () => {
    expect(decodeEntities('A &amp; B &lt;3 &#1593;&#x642;&#1583; &quot;x&quot;')).toBe('A & B <3 عقد "x"');
  });

  it('Word: runs, tabs and breaks, a paragraph a line', () => {
    const xml =
      '<w:body><w:p><w:r><w:t>Supplier</w:t></w:r><w:r><w:t xml:space="preserve"> contract</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Term</w:t><w:tab/><w:t>12 months</w:t><w:br/><w:t>renewable</w:t></w:r></w:p></w:body>';
    expect(docxText(xml)).toBe('Supplier contract\nTerm\t12 months\nrenewable\n');
  });

  it('Excel: shared and inline strings, numbers, gaps kept by column', () => {
    const shared = sharedStrings('<sst><si><t>Item</t></si><si><r><t>Pri</t></r><r><t>ce</t></r></si><si><t>Water &amp; ice</t></si></sst>');
    expect(shared).toEqual(['Item', 'Price', 'Water & ice']);
    const sheet =
      '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"/><c r="C2"><v>2500</v></c></row>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><t>Total</t></is></c><c r="B3" t="b"><v>1</v></c></row>' +
      '<row r="4"></row></sheetData>';
    expect(sheetText(sheet, shared)).toBe('Item\t\tPrice\nWater & ice\t\t2500\nTotal\tTRUE');
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('AA10')).toBe(26);
    expect(workbookSheetNames('<sheets><sheet name="Prices" sheetId="1"/><sheet name="Q&amp;A" sheetId="2"/></sheets>')).toEqual(['Prices', 'Q&A']);
  });

  it('PowerPoint, OpenDocument and HTML', () => {
    expect(drawingText('<a:p><a:r><a:t>Q4 plan</a:t></a:r></a:p><a:p><a:r><a:t>Two courts</a:t></a:r></a:p>')).toBe('Q4 plan\nTwo courts\n');
    expect(odfText('<office:meta>skip</office:meta><office:body><text:h>Title</text:h><text:p>One<text:s/>two<text:tab/>three</text:p></office:body>')).toBe('Title\nOne two\tthree\n');
    expect(htmlText('<html><head><title>x</title></head><body><script>bad()</script><p>Hi&nbsp;there</p><table><tr><td>a</td><td>b</td></tr></table></body></html>')).toBe('Hi there\na\tb\t\n\n');
  });

  it('tidies line endings and blank runs, and caps the length', () => {
    expect(tidyText('a  \r\n\r\n\r\n\r\nb\t \n')).toBe('a\n\nb');
    expect(tidyText('x'.repeat(TEXT_MAX_CHARS + 10)).length).toBe(TEXT_MAX_CHARS);
  });
});

describe('extractText', () => {
  it('reads plain text and HTML files', async () => {
    expect(await extractText(file('Name,Price\nWater,2500\n', 'prices.csv', 'text/csv'))).toBe('Name,Price\nWater,2500');
    expect(await extractText(file('<p>Opening hours</p>', 'hours.html'))).toBe('Opening hours');
  });

  it('reads a Word file out of its ZIP', async () => {
    const docx = zip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Lease for court 3</w:t></w:r></w:p><w:p><w:r><w:t>Rent 1,500,000 IQD</w:t></w:r></w:p></w:body></w:document>',
    });
    expect(await extractText(file(docx, 'Lease.docx'))).toBe('Lease for court 3\nRent 1,500,000 IQD');
  });

  it('reads every sheet of an Excel file, named, in order', async () => {
    const xlsx = zip({
      'xl/workbook.xml': '<sheets><sheet name="Drinks" sheetId="1"/><sheet name="Food" sheetId="2"/></sheets>',
      'xl/sharedStrings.xml': '<sst><si><t>Water</t></si><si><t>Burger</t></si></sst>',
      'xl/worksheets/sheet2.xml': '<sheetData><row><c r="A1" t="s"><v>1</v></c><c r="B1"><v>9000</v></c></row></sheetData>',
      'xl/worksheets/sheet1.xml': '<sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><v>500</v></c></row></sheetData>',
    });
    expect(await extractText(file(xlsx, 'menu.xlsx'))).toBe('# Drinks\nWater\t500\n\n# Food\nBurger\t9000');
  });

  it('reads PowerPoint slides in their order', async () => {
    const pptx = zip({
      'ppt/slides/slide10.xml': '<a:p><a:t>Last</a:t></a:p>',
      'ppt/slides/slide2.xml': '<a:p><a:t>First</a:t></a:p>',
    });
    expect(await extractText(file(pptx, 'deck.pptx'))).toBe('# Slide 2\nFirst\n\n# Slide 10\nLast');
  });

  it('reads the text layer of a PDF, page by page', async () => {
    const pdf = minimalPdf(['Supplier contract', 'Price 2500 IQD a case']);
    const text = await extractText(file(pdf, 'contract.pdf', 'application/pdf'));
    expect(text).toContain('[page 1]');
    expect(text).toContain('Supplier contract');
    expect(text).toContain('Price 2500 IQD a case');
  });

  it('answers null, never throws, for what has no words or is broken', async () => {
    expect(await extractText(file(new Uint8Array([0xff, 0xd8, 0xff]), 'photo.jpg', 'image/jpeg'))).toBeNull();
    expect(await extractText(file('not a zip', 'broken.docx'))).toBeNull();
    expect(await extractText(file('not a pdf', 'broken.pdf', 'application/pdf'))).toBeNull();
    expect(await extractText(file('   \n\n', 'empty.txt', 'text/plain'))).toBeNull();
  });
});

/** A one-page PDF with a Helvetica text line per string, offsets computed so the xref is valid. */
function minimalPdf(lines: string[]): Uint8Array<ArrayBuffer> {
  const content = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l) => `(${l}) Tj T*`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
