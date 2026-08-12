import { describe, expect, it } from 'vitest'
import { letterCounterTool } from '../letter-counter'

describe('letterCounterTool', () => {
  it('counts occurrences case-insensitively', async () => {
    await expect(letterCounterTool.invoke({ text: 'Strawberry', letter: 'R' })).resolves.toBe(3)
    await expect(letterCounterTool.invoke({ text: 'Strawberry', letter: 'r' })).resolves.toBe(3)
  })

  it('returns 0 when the letter is absent', async () => {
    await expect(letterCounterTool.invoke({ text: 'agentcore', letter: 'z' })).resolves.toBe(0)
  })

  it('requires a single letter — a multi-character needle would skew the count', async () => {
    await expect(letterCounterTool.invoke({ text: 'berry', letter: 'rr' })).rejects.toThrow()
  })
})
