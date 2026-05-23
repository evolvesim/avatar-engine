import { describe, it, expect } from 'vitest'
import { AzureTTSAdapter } from '../../src/adapters/azure'

describe('AzureTTSAdapter', () => {
  it('reports oneshot mode', () => {
    const a = new AzureTTSAdapter({
      tokenEndpoint: '/api/speech/token',
      voiceName: 'en-AU-WilliamNeural',
    })
    expect(a.mode).toBe('oneshot')
  })

  it('implements the TTSAdapter shape', () => {
    const a = new AzureTTSAdapter({
      tokenEndpoint: '/api/speech/token',
      voiceName: 'en-AU-WilliamNeural',
    })
    expect(typeof a.speak).toBe('function')
    expect(typeof a.stop).toBe('function')
    expect(typeof a.dispose).toBe('function')
  })

  it('stop and dispose are safe to call without speak', () => {
    const a = new AzureTTSAdapter({
      tokenEndpoint: '/api/speech/token',
      voiceName: 'en-AU-WilliamNeural',
    })
    expect(() => a.stop()).not.toThrow()
    expect(() => a.dispose()).not.toThrow()
  })
})
