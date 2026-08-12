import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/handler.ts', 'src/admin-handler.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
})
