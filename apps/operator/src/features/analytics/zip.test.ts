import { describe, expect, it } from 'vitest';
import { crc32, zipBlob } from './zip';

/** The bytes of a stored zip, as a string — entry names and contents are verbatim. */
async function read(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await new Response(blob).arrayBuffer());
}

describe('zipBlob', () => {
  it('is a zip: a local header per entry, a central directory, an end record', async () => {
    const blob = zipBlob([{ name: '01-a.csv', text: 'x,y\r\n1,2\r\n' }], new Date(2026, 8, 23, 12, 0));
    expect(blob.type).toBe('application/zip');
    const bytes = new Uint8Array(await new Response(blob).arrayBuffer());
    // PK\x03\x04 opens a local header; PK\x05\x06 closes the archive.
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect([...bytes.slice(-22, -18)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it('stores each file whole, under its own name', async () => {
    const text = await read(zipBlob([
      { name: '01-window.csv', text: 'What,Value\r\nPeriod from,2026-09-01\r\n' },
      { name: '02-figures.csv', text: 'Figure,Value\r\nRevenue,15000\r\n' },
    ]));
    expect(text).toContain('01-window.csv');
    expect(text).toContain('Period from,2026-09-01');
    expect(text).toContain('02-figures.csv');
    expect(text).toContain('Revenue,15000');
  });

  it('counts both entries in the end record', async () => {
    const bytes = new Uint8Array(await new Response(zipBlob([
      { name: 'a.csv', text: 'a' },
      { name: 'b.csv', text: 'b' },
    ])).arrayBuffer());
    const end = new DataView(bytes.buffer, bytes.length - 22);
    expect(end.getUint16(8, true)).toBe(2);
    expect(end.getUint16(10, true)).toBe(2);
  });

  it('takes an Arabic file name', async () => {
    const text = await read(zipBlob([{ name: 'الأرقام.csv', text: 'قهوة' }]));
    expect(text).toContain('الأرقام.csv');
    expect(text).toContain('قهوة');
  });

  it('computes the standard CRC-32', () => {
    // The known CRC-32 of "123456789".
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
