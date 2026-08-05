import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

/**
 * Los tests corren contra `src`, no contra `dist`, para no tener que compilar
 * antes de cada corrida. Los alias replican el grafo de workspaces.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@sinfo/core': pkg('core'),
      '@sinfo/theory': pkg('theory'),
      '@sinfo/engine': pkg('engine'),
      '@sinfo/render': pkg('render'),
      'sinfo-mcp': pkg('mcp'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
  },
});
