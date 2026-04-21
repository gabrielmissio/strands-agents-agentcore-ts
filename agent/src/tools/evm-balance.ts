import { z } from 'zod'
import * as strands from '@strands-agents/sdk'
import { JsonRpcProvider, formatEther } from 'ethers'

const evmRpcProvider = new JsonRpcProvider(process.env.EVM_RPC_URL)

export const evmBalanceTool = strands.tool({
  name: 'evmBalance',
  description: 'Fetches the Ether balance of a given Ethereum address',
  inputSchema: z.object({
    address: z.string(),
  }),
  callback: async (input): Promise<string> => {
    const balance = await evmRpcProvider.getBalance(input.address)
    return formatEther(balance) + ' ETH'
  },
})