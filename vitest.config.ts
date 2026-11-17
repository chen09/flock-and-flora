import { defineConfig } from 'vitest/config';

// Simulation core is pure TypeScript (no DOM/Phaser), so tests run in plain node.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
