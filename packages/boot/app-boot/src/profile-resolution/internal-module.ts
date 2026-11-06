/** Load one Node internal module, preferring `--expose-internals` over the fingerprint-checked addon. */

import { createRequire } from 'node:module'

/** Runtime flag that lets `require` reach Node's internal modules. */
const EXPOSE_INTERNALS_FLAG = '--expose-internals'
/** Addon that reaches internal modules without the flag, on the Node and Electron releases it recognizes. */
const REQUIRE_BUILTIN_ADDON = 'node-addon-require-builtin'

/**
 * Load one Node internal module. A process started with `--expose-internals` needs no addon, so Electron releases
 * outside the addon's support list keep working; the addon stays as the path for every other launch.
 * @param id - internal module identifier, such as `internal/modules/esm/loader`.
 * @param execArgv - flags of the running process.
 * @param load - resolver for the internal module and the addon.
 * @returns the internal module's exports.
 * @throws the addon's load or support error when neither path provides the module.
 */
export function requireInternalModule(
  id: string,
  execArgv: readonly string[] = process.execArgv,
  load: (specifier: string) => unknown = createRequire(import.meta.url),
): unknown {
  if (execArgv.includes(EXPOSE_INTERNALS_FLAG)) {
    try {
      return load(id)
    } catch (_error) {
      // The flag does not expose every internal module; the addon below reports the failure if it cannot help either.
    }
  }
  return (load(REQUIRE_BUILTIN_ADDON) as { requireBuiltin(moduleId: string): unknown }).requireBuiltin(id)
}
