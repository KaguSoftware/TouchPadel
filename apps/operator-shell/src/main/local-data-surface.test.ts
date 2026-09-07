import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { openQueue } from './queue';

/**
 * SEC-32 — what the venue PC is allowed to keep, and what it must never send.
 *
 * Two properties that are TRUE today and have nothing holding them true. Both
 * are the kind of thing a single well-meaning commit undoes: "cache the customer
 * list so search works offline", "let the KDS trigger a reprint". Each would be
 * reasonable in isolation and neither would be reviewed as a security change.
 *
 * The venue PC is an unmanaged Windows box in a room the public walks through.
 * It is the one machine in this system with no RLS in front of its storage.
 */

describe('the local queue stores no guest identity (SEC-32)', () => {
  /**
   * The offline queue exists to replay the till's OWN writes. It has no reason
   * to hold a roster of people: a guest list at rest on that machine is the
   * single largest personal-data exposure the desktop lane could create, and
   * unlike the server there is no policy layer to stop a later query reading it.
   */
  it('has no table that looks like a customer roster', () => {
    const tables = (
      openQueue()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((t) => t.name);

    // Whatever else it grows, these are the only tables it is allowed to have.
    expect(tables.sort()).toEqual(
      ['meta', 'mutation_queue', 'pin_cache', 'ref_cache', 'sqlite_sequence'].sort(),
    );
  });

  /**
   * Column-level, so a `customer_name` added to an existing table is caught too.
   * `ref_cache` legitimately holds the MENU (items, prices, recipes) — reference
   * data about products, never about people.
   */
  it('has no column that names a person', () => {
    const db = openQueue();
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((t) => t.name);

    const offenders: string[] = [];
    const FORBIDDEN = /guest|customer|profile|phone|email|full_name|surname/i;
    for (const t of tables) {
      const cols = db.pragma(`table_info(${t})`) as { name: string }[];
      for (const c of cols) {
        if (FORBIDDEN.test(c.name)) offenders.push(`${t}.${c.name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the LAN KDS protocol cannot reach the printer (SEC-31)', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf8');

  /**
   * The KDS tablets sit on the venue's LAN, authenticated by a pre-shared key in
   * station.json. That is a reasonable boundary for "show me tickets and let me
   * bump one". It is not a boundary anyone should be able to print through: a
   * print frame would let anything that reached the LAN socket drive a physical
   * device — and the receipt path opens the cash drawer on some hardware.
   */
  it('declares exactly three frame types, none of them print', () => {
    const frames = read('lan-frames.ts');
    const types = [...frames.matchAll(/type:\s*'([a-z.]+)'/g)].map((m) => m[1]);
    expect(types.sort()).toEqual(['status.update', 'ticket.new', 'ticket.snapshot']);
    expect(frames).not.toMatch(/print/i);
  });

  it('the KDS server never imports the print module', () => {
    for (const f of ['lan-kds-server.ts', 'lan-kds-client.ts', 'lan-frames.ts']) {
      expect(read(f), `${f} must not reach the printer`).not.toMatch(/from '\.\/print/);
    }
  });

  /**
   * The printer transport DIALS OUT to the printer's host:port. It never listens,
   * so there is no print socket for anything on the LAN to connect to in the
   * first place — the strongest form of "restricted to the shell's host".
   */
  it('the printer transport is outbound-only — it never listens', () => {
    const transport = read('print/transport.ts');
    expect(transport).toMatch(/createConnection/);
    expect(transport).not.toMatch(/createServer|\.listen\(/);
  });
});
