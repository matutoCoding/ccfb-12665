import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 2000 },
  server: { port: 5178, host: '127.0.0.1' },
});
