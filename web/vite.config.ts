import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The shared contract lives outside /web so Member 2 can import the same file.
      '@contract': fileURLToPath(new URL('../contract/types.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'mocks/**/*.test.ts'],
  },
})
