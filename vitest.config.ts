import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  define: {
    ENABLE_ADJACENT_HTML: 'false',
    ENABLE_CLONE_NODE: 'false',
    ENABLE_CONTAINS: 'false',
    ENABLE_INNER_HTML: 'false',
    ENABLE_MUTATION_OBSERVER: 'false',
    ENABLE_SIZE_APIS: 'false',
    ENABLE_TEMPLATE_CONTENT: 'false',
    PLATFORM_TYPE: '"h5"',
    SUPPORT_TARO_POLYFILL: 'false'
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: { reporter: ['text', 'json-summary'], include: ['src/domain/**/*.ts', 'scripts/lib/**/*.ts'] }
  }
})
