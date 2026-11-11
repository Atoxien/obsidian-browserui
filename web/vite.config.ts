import { defineConfig } from 'vite';

// Im Dev-Modus werden /api-Requests an den lokalen Server weitergeleitet (npm start im Root).
export default defineConfig({
  base: './',
  server: { proxy: { '/api': 'http://localhost:8080' } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
  test: { environment: 'node' },
});
