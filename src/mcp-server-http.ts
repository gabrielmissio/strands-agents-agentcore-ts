import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { z } from 'zod/v3'

const MCP_PORT = process.env.HTTP_MCP_PORT || 8081
const COINGECKO_API = 'https://api.coingecko.com/api/v3'

function log(tag: string, ...args: unknown[]) {
  console.log(`[${new Date().toISOString()}] [${tag}]`, ...args)
}

function logError(tag: string, ...args: unknown[]) {
  console.error(`[${new Date().toISOString()}] [${tag}]`, ...args)
}

function createServer() {
  const server = new McpServer({
    name: 'coin-price-exchange',
    version: '1.0.0',
  })

  // Tool 1: Get current price of a coin in a given currency
  server.registerTool(
    'get_coin_price',
    {
      description:
        'Get the current price of a cryptocurrency. Supports coins like bitcoin, ethereum, solana, etc. Returns price in the requested fiat currency.',
      inputSchema: {
        coinId: z
          .string()
          .describe('CoinGecko coin ID (e.g. "bitcoin", "ethereum", "solana", "cardano")'),
        currency: z
          .string()
          .default('usd')
          .describe('Fiat currency code (e.g. "usd", "eur", "gbp")'),
      },
    },
    async ({ coinId, currency }) => {
      const url = `${COINGECKO_API}/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=${encodeURIComponent(currency)}&include_24hr_change=true&include_market_cap=true`
      log('get_coin_price', `coinId=${coinId} currency=${currency}`)
      log('get_coin_price', `GET ${url}`)

      let res: Response
      try {
        res = await fetch(url)
      } catch (err) {
        logError('get_coin_price', 'fetch threw:', (err as Error).message, (err as Error).cause ?? '')
        return { content: [{ type: 'text' as const, text: `Fetch failed: ${(err as Error).message}` }] }
      }

      log('get_coin_price', `response status=${res.status} statusText=${res.statusText}`)

      if (!res.ok) {
        const body = await res.text().catch(() => '(could not read body)')
        logError('get_coin_price', `API error body: ${body}`)
        return { content: [{ type: 'text' as const, text: `API error: ${res.status} ${res.statusText}\n${body}` }] }
      }

      const data = await res.json()
      log('get_coin_price', 'response data:', JSON.stringify(data))
      const coin = data[coinId]

      if (!coin) {
        return { content: [{ type: 'text' as const, text: `Coin "${coinId}" not found. Use a valid CoinGecko ID.` }] }
      }

      const price = coin[currency]
      const change24h = coin[`${currency}_24h_change`]
      const marketCap = coin[`${currency}_market_cap`]

      const lines = [
        `${coinId.toUpperCase()} price: ${price} ${currency.toUpperCase()}`,
        change24h !== undefined ? `24h change: ${change24h.toFixed(2)}%` : null,
        marketCap !== undefined ? `Market cap: ${marketCap.toLocaleString()} ${currency.toUpperCase()}` : null,
      ].filter(Boolean)

      log('get_coin_price', 'returning:', lines.join(' | '))
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] }
    },
  )

  // Tool 2: Get prices for multiple coins at once
  server.registerTool(
    'get_multiple_coin_prices',
    {
      description: 'Get current prices for multiple cryptocurrencies at once.',
      inputSchema: {
        coinIds: z
          .array(z.string())
          .describe('Array of CoinGecko coin IDs (e.g. ["bitcoin", "ethereum", "solana"])'),
        currency: z
          .string()
          .default('usd')
          .describe('Fiat currency code (e.g. "usd", "eur")'),
      },
    },
    async ({ coinIds, currency }) => {
      const ids = coinIds.join(',')
      const url = `${COINGECKO_API}/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${encodeURIComponent(currency)}&include_24hr_change=true`
      log('get_multiple_coin_prices', `coinIds=${ids} currency=${currency}`)
      log('get_multiple_coin_prices', `GET ${url}`)

      let res: Response
      try {
        res = await fetch(url)
      } catch (err) {
        logError('get_multiple_coin_prices', 'fetch threw:', (err as Error).message, (err as Error).cause ?? '')
        return { content: [{ type: 'text' as const, text: `Fetch failed: ${(err as Error).message}` }] }
      }

      log('get_multiple_coin_prices', `response status=${res.status} statusText=${res.statusText}`)

      if (!res.ok) {
        const body = await res.text().catch(() => '(could not read body)')
        logError('get_multiple_coin_prices', `API error body: ${body}`)
        return { content: [{ type: 'text' as const, text: `API error: ${res.status} ${res.statusText}\n${body}` }] }
      }

      const data = await res.json()
      log('get_multiple_coin_prices', 'response data:', JSON.stringify(data))

      const lines = coinIds.map((id) => {
        const coin = data[id]
        if (!coin) return `${id}: not found`
        const price = coin[currency]
        const change = coin[`${currency}_24h_change`]
        return `${id}: ${price} ${currency.toUpperCase()}${change !== undefined ? ` (${change.toFixed(2)}%)` : ''}`
      })

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] }
    },
  )

  // Tool 3: Search for a coin by name/symbol
  server.registerTool(
    'search_coin',
    {
      description:
        'Search for a cryptocurrency by name or ticker symbol. Returns matching coins with their CoinGecko IDs (useful for finding the correct ID to pass to price tools).',
      inputSchema: {
        query: z.string().describe('Search query — coin name or ticker symbol (e.g. "BTC", "Ethereum", "SOL")'),
      },
    },
    async ({ query }) => {
      const url = `${COINGECKO_API}/search?query=${encodeURIComponent(query)}`
      log('search_coin', `query=${query}`)
      log('search_coin', `GET ${url}`)

      let res: Response
      try {
        res = await fetch(url)
      } catch (err) {
        logError('search_coin', 'fetch threw:', (err as Error).message, (err as Error).cause ?? '')
        return { content: [{ type: 'text' as const, text: `Fetch failed: ${(err as Error).message}` }] }
      }

      log('search_coin', `response status=${res.status} statusText=${res.statusText}`)

      if (!res.ok) {
        const body = await res.text().catch(() => '(could not read body)')
        logError('search_coin', `API error body: ${body}`)
        return { content: [{ type: 'text' as const, text: `API error: ${res.status} ${res.statusText}\n${body}` }] }
      }

      const data = await res.json()
      const coins = data.coins?.slice(0, 8) ?? []

      if (coins.length === 0) {
        return { content: [{ type: 'text' as const, text: `No coins found for "${query}"` }] }
      }

      const lines = coins.map(
        (c: { name: string; symbol: string; id: string; market_cap_rank: number | null }) =>
          `${c.name} (${c.symbol.toUpperCase()}) — id: "${c.id}"${c.market_cap_rank ? ` #${c.market_cap_rank}` : ''}`,
      )

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] }
    },
  )

  return server
}

// --- Streamable HTTP transport ---

const app = createMcpExpressApp()

app.post('/mcp', async (req, res) => {
  log('http', `POST /mcp from ${req.ip}`)
  const server = createServer()
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    })

    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)

    res.on('close', () => {
      log('http', 'connection closed')
      transport.close()
      server.close()
    })
  } catch (error) {
    logError('http', 'Error handling MCP request:', error)
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      })
    }
  }
})

// Reject GET/DELETE for stateless mode
app.get('/mcp', (_req, res) => {
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  }))
})

app.delete('/mcp', (_req, res) => {
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  }))
})

app.listen(MCP_PORT, () => {
  console.log(`💰 Coin Price MCP server (Streamable HTTP) on http://localhost:${MCP_PORT}/mcp`)
})

process.on('SIGINT', () => {
  console.log('Shutting down MCP HTTP server...')
  process.exit(0)
})