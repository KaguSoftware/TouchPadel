// Entry shim. THE IMPORT ORDER IS LOAD-BEARING — do not reorder or alphabetise.
//
// `ulid@2.4.0` runs `detectPrng()` at MODULE SCOPE. It reads `window.crypto`,
// which Hermes does not have, then falls through to `require("crypto")` — which
// ulid's package.json `browser` field redirects to ./stubs/crypto.js, a
// literally 0-byte file. The try block therefore SUCCEEDS with `nodeCrypto === {}`
// and returns a closure that throws "nodeCrypto.randomBytes is not a function"
// on the first id it is asked for.
//
// packages/core/src/index.ts does `export * from './schemas/mutations'`, so every
// `@touch/core` import drags ulid in, and src/lib/idempotency.ts calls it on
// every hold_slot — i.e. booking was 100% broken on device while the unit tests
// stayed green, because vitest runs `environment: 'node'` where `require('crypto')`
// is real.
//
// react-native-get-random-values installs global.crypto.getRandomValues, so it
// must evaluate BEFORE anything that can reach @touch/core.
// Guarded by src/lib/__tests__/entryOrder.test.ts.
import 'react-native-get-random-values';
import 'expo-router/entry';
