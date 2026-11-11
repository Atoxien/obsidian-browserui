// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Atoxien
import { defineConfig } from 'vite';

// Im Dev-Modus werden /api-Requests an den lokalen Server weitergeleitet (npm start im Root).
export default defineConfig({
  base: './',
  server: { proxy: { '/api': 'http://localhost:8080' } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
  test: { environment: 'node' },
});
