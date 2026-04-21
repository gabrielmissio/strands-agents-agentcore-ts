import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod/v3'

const server = new McpServer({
  name: 'crypto-tools',
  version: '1.0.0',
})

// Tool 1: Convert between crypto units (wei <-> ether, satoshi <-> btc)
server.registerTool(
  'convert_crypto_units',
  {
    description: 'Convert between cryptocurrency denominations (e.g. wei to ether, satoshi to BTC)',
    inputSchema: {
      amount: z.string().describe('The amount to convert (as string to preserve precision)'),
      from: z.enum(['wei', 'gwei', 'ether', 'satoshi', 'btc']).describe('Source unit'),
      to: z.enum(['wei', 'gwei', 'ether', 'satoshi', 'btc']).describe('Target unit'),
    },
  },
  async ({ amount, from, to }) => {
    const ethUnits: Record<string, bigint> = {
      wei: 1n,
      gwei: 10n ** 9n,
      ether: 10n ** 18n,
    }

    const btcUnits: Record<string, bigint> = {
      satoshi: 1n,
      btc: 100_000_000n,
    }

    const isEthUnit = (u: string) => u in ethUnits
    const isBtcUnit = (u: string) => u in btcUnits

    if ((isEthUnit(from) && isBtcUnit(to)) || (isBtcUnit(from) && isEthUnit(to))) {
      return { content: [{ type: 'text' as const, text: 'Cannot convert between ETH and BTC units' }] }
    }

    const units = isEthUnit(from) ? ethUnits : btcUnits
    const baseAmount = BigInt(amount) * units[from]
    const result = baseAmount / units[to]
    const remainder = baseAmount % units[to]

    const text =
      remainder === 0n
        ? `${amount} ${from} = ${result.toString()} ${to}`
        : `${amount} ${from} ≈ ${result.toString()} ${to} (remainder: ${remainder.toString()} base units)`

    return { content: [{ type: 'text' as const, text }] }
  },
)

// Tool 2: Validate and classify a blockchain address
server.registerTool(
  'validate_address',
  {
    description: 'Validate and classify a blockchain address (Ethereum or Bitcoin)',
    inputSchema: {
      address: z.string().describe('The blockchain address to validate'),
    },
  },
  async ({ address }) => {
    const checks = []

    // Ethereum address check
    if (/^0x[0-9a-fA-F]{40}$/.test(address)) {
      const isChecksummed = address !== address.toLowerCase() && address !== address.toUpperCase()
      checks.push(`Valid Ethereum address${isChecksummed ? ' (checksummed)' : ' (not checksummed)'}`)
    }
    // Bitcoin legacy (P2PKH)
    else if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)) {
      checks.push(`Valid Bitcoin address (legacy P2PKH/P2SH)`)
    }
    // Bitcoin bech32 (SegWit)
    else if (/^bc1[a-zA-HJ-NP-Z0-9]{25,90}$/.test(address)) {
      checks.push(`Valid Bitcoin address (Bech32 SegWit)`)
    } else {
      checks.push('Unknown or invalid address format')
    }

    return { content: [{ type: 'text' as const, text: checks.join('\n') }] }
  },
)

// Tool 3: Generate a vanity Ethereum address with a given prefix
server.registerTool(
  'vanity_address',
  {
    description: 'Generate an Ethereum address starting with a given hex prefix (e.g. "dead", "cafe"). Returns the address and private key.',
    inputSchema: {
      prefix: z
        .string()
        .regex(/^[0-9a-fA-F]{1,6}$/)
        .describe('Hex prefix for the address (1-6 hex chars, e.g. "dead")'),
    },
  },
  async ({ prefix }) => {
    const { Wallet } = await import('ethers')

    const target = prefix.toLowerCase()
    let attempts = 0
    const maxAttempts = 1_000_000

    while (attempts < maxAttempts) {
      attempts++
      const wallet = Wallet.createRandom()

      if (attempts % 100 === 0) {
        console.error(`[vanity_address] Attempt ${attempts} - Address: ${wallet.address}`)
      }

      if (wallet.address.toLowerCase().slice(2).startsWith(target)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Found after ${attempts} attempts!`,
                `Address: ${wallet.address}`,
                `Private Key: ${wallet.privateKey}`,
                ``,
                `⚠️ This is for demonstration only. Do NOT use this key for real funds.`,
              ].join('\n'),
            },
          ],
        }
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Could not find address with prefix "0x${prefix}..." within ${maxAttempts} attempts. Try a shorter prefix.`,
        },
      ],
    }
  },
)

// Start server with stdio transport
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('🔌 MCP Server "crypto-tools" running on stdio')
}

main().catch((err) => {
  console.error('Fatal MCP server error:', err)
  process.exit(1)
})
