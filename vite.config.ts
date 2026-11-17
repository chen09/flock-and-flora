import { defineConfig } from 'vite';

// Loopback-only dev/preview servers; static build with relative base for local deployment.
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: false },
  preview: { host: '127.0.0.1', port: 4173, strictPort: false },
  build: { target: 'es2022', sourcemap: false },
});
