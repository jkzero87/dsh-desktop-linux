/** Preset row configuration: an omitted toolFilter stays omitted after schema resolution. */
import { describe, expect, it } from 'vitest'
import AgentPreset from '../src/index.ts'

describe('AgentPreset Config', () => {
  it('keeps toolFilter undefined when the preset declares none', () => {
    expect(AgentPreset.Config({ id: 'standard-light', plugins: [] }).toolFilter).toBeUndefined()
  })

  it('keeps an omitted toolFilter side undefined instead of an empty list', () => {
    expect(AgentPreset.Config({ id: 'research', plugins: [], toolFilter: { allow: ['read'] } }).toolFilter)
      .toEqual({ allow: ['read'] })
  })
})
