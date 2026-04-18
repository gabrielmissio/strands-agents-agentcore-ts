import axios from 'axios'
import { z } from 'zod/v3'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createX402Client } from '../utils/x402-client.js'

const ORACULO_DO_BICHO_API = process.env.X402_APP_URL || 'https://j14d7ms014.execute-api.us-east-1.amazonaws.com'

const server = new McpServer({
  name: 'oraculo-do-bicho',
  version: '1.0.0',
  description: 'AI-powered mystical interpretations of "Jogo do Bicho" symbols, available through x402-powered USDC payments.'
})

// Lazy singleton for the x402-enabled client (requires EVM_PRIVATE_KEY at runtime)
let _client: Awaited<ReturnType<typeof createX402Client>> | null = null
async function getClient() {
  if (!_client) _client = await createX402Client(ORACULO_DO_BICHO_API)
  return _client
}

// Free plain axios instance for unauthenticated endpoints
const publicClient = axios.create({ baseURL: ORACULO_DO_BICHO_API })

function toText(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

// ── Tool: get_tabela_animais ───────────────────────────────────────────────
// GET /tabela/animais — free, no payment required
server.registerTool(
  'get_animal_table',
  {
    description: 'Returns the complete official table of the 25 "Jogo do Bicho" animals with their groups, dozens and symbolic meanings. Free — no payment required.',
    inputSchema: {},
  },
  async () => {
    const { data } = await publicClient.get('/tabela/animais')
    return { content: [{ type: 'text' as const, text: toText(data) }] }
  },
)

// ── Tool: interpretar ─────────────────────────────────────────────────────
// POST /interpretar — paid $0.10 USDC via x402
server.registerTool(
  'interpret',
  {
    description: 'Main interpretation endpoint. Accepts any textual input (dream, number, phrase, color, car plate, name, date, etc.) and returns a mystical interpretation linked to one of the 25 Jogo do Bicho animals, with betting suggestions. Costs $0.10 USDC via x402.',
    inputSchema: {
      input: z.string().min(1).describe('Any text to interpret — dream, number, phrase, color, car plate, name, date, etc.'),
      modalidade: z.enum(['sonho', 'placa', 'palpite', 'numero', 'data', 'cor', 'generalizado', 'numerica', 'fonetica'])
        .optional()
        .describe('Interpretation modality. If omitted the LLM decides automatically.'),
    },
  },
  async ({ input, modalidade }) => {
    const client = await getClient()
    const { data } = await client.post('/interpretar', { input, ...(modalidade ? { modalidade } : {}) })
    return { content: [{ type: 'text' as const, text: toText(data) }] }
  },
)

// ── Tool: interpretar_sonho ───────────────────────────────────────────────
// POST /sonho — paid $0.10 USDC via x402
server.registerTool(
  'interpret_dream',
  {
    description: 'Specialized dream analysis. Receives a dream description and optional details, returns an oniric interpretation focused on Jogo do Bicho symbolism with signal strength and spiritual message. Costs $0.10 USDC via x402.',
    inputSchema: {
      sonho: z.string().min(1).describe('Description of the dream the user had.'),
      detalhes: z.string().optional().describe('Additional dream details (scenario, emotions, characters, etc.)'),
    },
  },
  async ({ sonho, detalhes }) => {
    const client = await getClient()
    const { data } = await client.post('/sonho', { sonho, ...(detalhes ? { detalhes } : {}) })
    return { content: [{ type: 'text' as const, text: toText(data) }] }
  },
)

// ── Tool: gerar_palpites ──────────────────────────────────────────────────
// POST /palpite — paid $0.25 USDC via x402
server.registerTool(
  'generate_daily_tips',
  {
    description: 'Generates 3 simultaneous daily tips based on the provided context and reference date. Returns all 3 tips and highlights the main one. Costs $0.25 USDC via x402.',
    inputSchema: {
      contexto: z.string().optional().describe('Free context to personalize tips (birthday, event, feeling of the day, etc.). Defaults to "palpite geral do dia".'),
      data: z.string().optional().describe('Reference date in YYYY-MM-DD format. Defaults to today.'),
    },
  },
  async ({ contexto, data }) => {
    try {
      const client = await getClient()
      const body: Record<string, string> = {}
      if (contexto) body.contexto = contexto
      if (data) body.data = data
      const { data: responseData } = await client.post('/palpite', body)
      return { content: [{ type: 'text' as const, text: toText(responseData) }] }
    } catch (err) {
      console.error('Error in generate_daily_tips tool:', err)
      throw err
    }
  },
)

// ── Tool: analisar_numerologia ────────────────────────────────────────────
// POST /numerologia — paid $0.10 USDC via x402
server.registerTool(
  'analyze_numerology',
  {
    description: 'Receives a list of numbers and/or a name for numerological analysis. Calculates numerological sum, reduction and the corresponding animal, plus a creative LLM analysis. At least one of `numeros` or `nome` should be provided for a meaningful reading. Costs $0.10 USDC via x402.',
    inputSchema: {
      numeros: z.array(z.number().int()).optional().describe('List of numbers to analyse numerologically.'),
      nome: z.string().optional().describe('Name for numerological analysis.'),
    },
  },
  async ({ numeros, nome }) => {
    const client = await getClient()
    const body: Record<string, unknown> = {}
    if (numeros && numeros.length > 0) body.numeros = numeros
    if (nome) body.nome = nome
    const { data } = await client.post('/numerologia', body)
    return { content: [{ type: 'text' as const, text: toText(data) }] }
  },
)

// Start server with stdio transport
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('🔌 MCP Server "oraculo-do-bicho" running on stdio')
}

main().catch((err) => {
  console.error('Fatal MCP server error:', err)
  process.exit(1)
})
