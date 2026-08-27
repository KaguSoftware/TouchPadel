// Metro config for a pnpm `node-linker=hoisted` monorepo.
//
// Two jobs:
//   1. watchFolders — without the workspace root, editing packages/core,
//      packages/i18n or packages/ui does NOT hot-reload the app. Metro's
//      default watch scope is the project root only (apps/mobile).
//   2. nodeModulesPaths — app-local first, hoisted workspace root second.
//
// DELIBERATELY NOT SET: resolver.disableHierarchicalLookup.
// That flag belongs to pnpm's *isolated* linker, where every dependency is a
// symlink into .pnpm and walking up the tree finds nothing useful. We run
// node-linker=hoisted (.npmrc), where a version divergence materialises a real
// nested copy under apps/mobile/node_modules — and hierarchical lookup is
// exactly the mechanism that lets the app's own copy win. Disabling it here
// would silently resolve the ROOT copy instead and produce
// two-copies-of-a-module runtime failures that look like nothing at build time.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// ADD to Expo's defaults rather than replacing them — `expo-doctor` checks for
// exactly this, and overwriting drops entries Expo needs (it seeds watchFolders
// itself in SDK 54).
config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
