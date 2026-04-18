import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/mcp-servers/http-mcp-server.ts',
    'src/mcp-servers/stdio-mcp-server.ts',
    'src/mcp-servers/x402-mcp-server.ts',
  ],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
})
