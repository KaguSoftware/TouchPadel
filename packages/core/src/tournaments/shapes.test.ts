import { describe, expect, it } from 'vitest';
import {
  PUBLIC_TOURNAMENT_READS,
  TOURNAMENT_SHAPES,
  TOUR_PUBLIC_FORBIDDEN_KEYS,
  tourHasKeys,
  tourMissingKeys,
  type TourShape,
  type TournamentShapeName,
} from './shapes';

const entries = Object.entries(TOURNAMENT_SHAPES) as Array<[TournamentShapeName, TourShape]>;

function splitPath(path: string): { parent: string; name: string } {
  const at = path.lastIndexOf('.');
  const last = at < 0 ? path : path.slice(at + 1);
  return { parent: at < 0 ? '' : path.slice(0, at), name: last.replace(/\[\]$/, '') };
}

function keysAt(shape: TourShape, level: string): string[] {
  return level === '' ? [...shape.keys] : [...(shape.nested?.[level] ?? [])];
}

/** A smallest answer that carries every key of `shape`. */
function sampleOf(shape: TourShape): Record<string, unknown> {
  const build = (level: string): Record<string, unknown> => {
    const obj: Record<string, unknown> = {};
    const prefix = level === '' ? '' : `${level}.`;
    for (const key of keysAt(shape, level)) {
      if (shape.nested?.[`${prefix}${key}[]`]) obj[key] = [build(`${prefix}${key}[]`)];
      else if (shape.nested?.[`${prefix}${key}`]) obj[key] = build(`${prefix}${key}`);
      else obj[key] = null;
    }
    return obj;
  };
  return build('');
}

/** Every key of a shape with its path. */
function allKeyPaths(shape: TourShape): string[] {
  const out = [...shape.keys];
  for (const [path, keys] of Object.entries(shape.nested ?? {})) {
    for (const key of keys) out.push(`${path}.${key}`);
  }
  return out;
}

describe('TOURNAMENT_SHAPES: every list is well formed', () => {
  it('covers every client RPC of build contracts §1.6 and the money engine', () => {
    expect(Object.keys(TOURNAMENT_SHAPES).sort()).toEqual(
      [
        'desk_tournament_detail',
        'desk_tournaments',
        'set_tournaments_enabled',
        'tournament_add_entry',
        'tournament_cancel',
        'tournament_entry_money',
        'tournament_mark_no_show',
        'tournament_public',
        'tournament_publish',
        'tournament_register',
        'tournament_remove_entry',
        'tournament_score',
        'tournament_set_rounds',
        'tournament_settle',
        'tournament_withdraw',
        'tournaments_public',
      ].sort(),
    );
  });

  it.each(entries)(
    '%s: named after its rpc, lists non-empty, no duplicate, snake_case keys',
    (name, shape) => {
      expect(shape.rpc).toBe(name);
      for (const list of [shape.keys, ...Object.values(shape.nested ?? {})]) {
        expect(list.length).toBeGreaterThan(0);
        expect(new Set(list).size).toBe(list.length);
        for (const key of list) expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    },
  );

  it.each(entries)('%s: every nested path hangs off a listed key of its parent', (_name, shape) => {
    for (const path of Object.keys(shape.nested ?? {})) {
      const { parent, name } = splitPath(path);
      if (parent !== '') expect(shape.nested?.[parent], `${path}: parent ${parent}`).toBeDefined();
      expect(keysAt(shape, parent), `${path}: ${name} under '${parent}'`).toContain(name);
      const twin = path.endsWith('[]') ? path.slice(0, -2) : `${path}[]`;
      expect(shape.nested?.[twin]).toBeUndefined();
    }
  });

  it.each(entries)('%s: a full sample passes, and losing any key fails', (_name, shape) => {
    const sample = sampleOf(shape);
    expect(tourMissingKeys(sample, shape)).toEqual([]);
    expect(tourHasKeys(sample, shape)).toBe(true);
    for (const key of shape.keys) {
      const copy = { ...sample };
      delete copy[key];
      expect(tourMissingKeys(copy, shape)).toContain(`$.${key}`);
    }
  });

  it('checks nested players in the public schedule', () => {
    const shape = TOURNAMENT_SHAPES.tournament_public;
    const sample = sampleOf(shape) as {
      rounds: Array<{ matches: Array<{ a: Array<Record<string, unknown>> }> }>;
    };
    delete sample.rounds[0]!.matches[0]!.a[0]!.former;
    expect(tourMissingKeys(sample, shape)).toEqual(['$.rounds[0].matches[0].a[0].former']);
  });

  it('skips a null mine / me (a caller with no entry)', () => {
    const list = sampleOf(TOURNAMENT_SHAPES.tournaments_public) as {
      tournaments: Array<Record<string, unknown>>;
    };
    list.tournaments[0]!.mine = null;
    expect(tourHasKeys(list, TOURNAMENT_SHAPES.tournaments_public)).toBe(true);
    const one = sampleOf(TOURNAMENT_SHAPES.tournament_public);
    one.me = null;
    expect(tourHasKeys(one, TOURNAMENT_SHAPES.tournament_public)).toBe(true);
  });
});

describe('pinned names (§1.6, S13)', () => {
  it('score answers both revisions; set_rounds the tournament revision', () => {
    expect(TOURNAMENT_SHAPES.tournament_score.keys).toEqual(
      expect.arrayContaining(['revision', 'tournament_revision', 'removed_from_round']),
    );
    expect(TOURNAMENT_SHAPES.tournament_set_rounds.keys).toEqual([
      'revision',
      'rounds_planned',
      'status',
    ]);
  });

  it('the desk detail carries standings as app.tournament_standings rows', () => {
    expect(TOURNAMENT_SHAPES.desk_tournament_detail.nested['standings[]']).toEqual([
      'entry_id',
      'rank',
      'points_won',
      'points_against',
      'diff',
      'h2h',
      'played',
      'sat_out',
      'withdrawn',
    ]);
    expect(TOURNAMENT_SHAPES.desk_tournament_detail.nested.can).toEqual([
      'add',
      'set_rounds',
      'score',
      'cancel',
      'settle',
    ]);
  });

  it('the public player is {name, former, no}', () => {
    const nested = TOURNAMENT_SHAPES.tournament_public.nested;
    for (const path of [
      'rounds[].sit_out[]',
      'rounds[].matches[].a[]',
      'rounds[].matches[].b[]',
      'standings[].player',
    ]) {
      expect(nested[path as keyof typeof nested], path).toEqual(['name', 'former', 'no']);
    }
  });
});

describe('public reads carry no person (T-8, §1.8)', () => {
  it.each(PUBLIC_TOURNAMENT_READS)('%s names no guest id, phone, full name or court id', (name) => {
    const leaves = allKeyPaths(TOURNAMENT_SHAPES[name]).map((p) => p.split('.').pop()!);
    for (const bad of TOUR_PUBLIC_FORBIDDEN_KEYS) expect(leaves, bad).not.toContain(bad);
  });
});
