/**
 * Types for build-assistant-map.mjs, so tests/assistant-map.test.ts imports it
 * under `strict` without `allowJs`. Only what the test and the coverage check
 * use is declared; the script itself is the source of truth.
 */
export interface MapChunk {
  kind: string;
  ref: string;
  lang: 'en' | 'ar';
  title: string;
  body: string;
  route: string | null;
}

export interface BuiltMap {
  generated_from: string;
  chunks: MapChunk[];
  _pages: string[];
  _routeRoles: Map<string, string[]>;
  _tools: readonly { name: string; kind: string; scope: string; route: string | null }[];
}

export interface NavItem {
  to: string;
  labelKey: string;
  hidden: boolean;
}
export interface NavSection {
  key: string;
  home: string;
  items: NavItem[];
}
export interface Workspace {
  key: string;
  home: string;
  groups: { labelKey: string | null; items: NavItem[] }[];
  sections: NavSection[];
}

export const DB: string;
export const ROOT: string;
export const PATHS: Record<
  | 'migrations'
  | 'functions'
  | 'configToml'
  | 'catalog'
  | 'auth'
  | 'workspaces'
  | 'settingsTs'
  | 'operatorSrc'
  | 'i18n'
  | 'pages'
  | 'rules'
  | 'docsDir'
  | 'coverage'
  | 'mapJson'
  | 'mapCopy'
  | 'compact',
  string
>;
export const CHUNK_KINDS: readonly string[];
export const DOC_CHUNK_CAP: number;
export const COMPACT_BYTE_TARGET: number;

export function readMigrations(dir?: string): { file: string; number: string; sql: string }[];
export function inventorySchema(migrations?: ReturnType<typeof readMigrations>): {
  tables: Map<string, unknown>;
  views: Map<string, unknown>;
  columnComments: Map<string, string>;
  typeComments: Map<string, string>;
  functionComments: Map<string, string>;
};
export function inventoryFunctions(migrations?: ReturnType<typeof readMigrations>): Map<string, { name: string; roles: Set<string>; clientCallable: boolean }>;
export function inventoryEnums(migrations?: ReturnType<typeof readMigrations>, typeComments?: Map<string, string>): Map<string, unknown>;
export function inventoryCron(migrations?: ReturnType<typeof readMigrations>): Map<string, unknown>;
export function inventoryEdgeFunctions(): Map<string, { name: string; header: string; verify_jwt: boolean | null }>;
export function inventoryRoutes(): { routeRoles: Map<string, string[]>; subRoutes: Map<string, string[]> };
export function rolesForRoute(route: string, routeRoles: Map<string, string[]>): string[];
export function inventoryRail(): { workspaces: Workspace[]; sections: NavSection[] };
export function parseCatalog(src: string): [string, string][];
export function readPages(file?: string): Map<string, string>;
export function readRules(file?: string): { title: string; body: string }[];
export function inventoryDocs(): string[];
export function readCoverageFixture(file?: string): Record<string, Record<string, string>> | null;
export function buildMap(opts?: { catalog?: unknown; sha?: string }): Promise<BuiltMap>;
export function renderCompact(map: BuiltMap): string;
export function serialize(map: BuiltMap): string;

export const EDGE_EXCLUDED_KINDS: readonly string[];
export function serializeEdge(map: BuiltMap, compact: string): string;
