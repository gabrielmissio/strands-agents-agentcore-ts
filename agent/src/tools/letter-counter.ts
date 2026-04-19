import { z } from 'zod'
import * as strands from '@strands-agents/sdk'

export const letterCounterTool = strands.tool({
  name: 'letterCounter',
  description: 'Counts how many times a specific letter appears in a given string (case-insensitive)',
  inputSchema: z.object({
    text: z.string(),
    letter: z.string().length(1).describe('The single letter to count occurrences of'),
  }),
  callback: (input): number => {
    const target = input.letter.toLowerCase()
    return input.text.toLowerCase().split(target).length - 1
  },
})
