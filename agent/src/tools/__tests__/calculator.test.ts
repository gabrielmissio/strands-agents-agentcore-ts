import { describe, expect, it } from 'vitest'
import { calculatorTool } from '../calculator'

describe('calculatorTool', () => {
  it('exposes the name and schema the model sees', () => {
    expect(calculatorTool.name).toBe('calculator')
    expect(calculatorTool.toolSpec.inputSchema).toBeDefined()
  })

  it('performs the four operations', async () => {
    await expect(calculatorTool.invoke({ operation: 'add', a: 2, b: 3 })).resolves.toBe(5)
    await expect(calculatorTool.invoke({ operation: 'subtract', a: 2, b: 3 })).resolves.toBe(-1)
    await expect(calculatorTool.invoke({ operation: 'multiply', a: 2, b: 3 })).resolves.toBe(6)
    await expect(calculatorTool.invoke({ operation: 'divide', a: 6, b: 3 })).resolves.toBe(2)
  })

  it('rejects an operation outside the enum instead of guessing', async () => {
    await expect(
      // @ts-expect-error — exercising the runtime schema validation the model can trip
      calculatorTool.invoke({ operation: 'modulo', a: 6, b: 3 }),
    ).rejects.toThrow()
  })
})
