import { describe, expect, it, vi } from 'vitest'
import { requireInternalModule } from '../src/profile-resolution/internal-module.ts'

const ID = 'internal/modules/esm/loader'
const ADDON = 'node-addon-require-builtin'

describe('requireInternalModule', () => {
  it('uses the flag without touching the addon', () => {
    const internal = { name: 'internal' }
    const load = vi.fn<(specifier: string) => unknown>(() => internal)
    expect(requireInternalModule(ID, ['--expose-internals'], load)).toBe(internal)
    expect(load.mock.calls).toEqual([[ID]])
  })

  it('falls back to the addon when the flag does not expose the module', () => {
    const fromAddon = { name: 'addon' }
    const requireBuiltin = vi.fn(() => fromAddon)
    const load = (specifier: string): unknown => {
      if (specifier === ADDON) return { requireBuiltin }
      throw new Error('MODULE_NOT_FOUND')
    }
    expect(requireInternalModule(ID, ['--expose-internals'], load)).toBe(fromAddon)
    expect(requireBuiltin).toHaveBeenCalledWith(ID)
  })

  it('uses the addon without the flag', () => {
    const fromAddon = { name: 'addon' }
    const load = vi.fn<(specifier: string) => unknown>(() => ({ requireBuiltin: () => fromAddon }))
    expect(requireInternalModule(ID, [], load)).toBe(fromAddon)
    expect(load.mock.calls).toEqual([[ADDON]])
  })

  it('reports the addon failure when neither path provides the module', () => {
    const load = (specifier: string): unknown => {
      if (specifier === ADDON) return { requireBuiltin() { throw new Error('unsupported runtime fingerprint') } }
      throw new Error('MODULE_NOT_FOUND')
    }
    expect(() => requireInternalModule(ID, ['--expose-internals'], load)).toThrow('unsupported runtime fingerprint')
  })

  it('defaults to the running process and the real addon', () => {
    const loader = requireInternalModule(ID) as { getOrInitializeCascadedLoader: unknown }
    expect(loader.getOrInitializeCascadedLoader).toBeTypeOf('function')
  })
})
