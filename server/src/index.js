#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Atoxien
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const vaultPath = process.env.VAULT_PATH || process.argv[2];
if (!vaultPath) {
  console.error('Bitte VAULT_PATH setzen (oder Pfad als Argument übergeben).');
  process.exit(1);
}

const password = process.env.VAULT_PASSWORD || '';
if (!password && process.env.NO_AUTH !== '1') {
  console.error(
    'VAULT_PASSWORD ist nicht gesetzt. Setze ein Passwort oder – nur für lokale Tests – NO_AUTH=1.',
  );
  process.exit(1);
}

const app = await buildApp({
  vaultPath,
  password,
  sessionSecret: process.env.SESSION_SECRET,
  staticDir: process.env.STATIC_DIR || path.resolve(here, '../../web/dist'),
  secureCookie: process.env.SECURE_COOKIE === '1',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  logger: process.env.LOG !== '0',
});

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';
await app.listen({ port, host });
console.log(`Vault Browser läuft auf http://${host}:${port}  (Vault: ${vaultPath})`);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
