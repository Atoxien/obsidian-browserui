// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Atoxien
// Fastify-App: Vault-API + Auslieferung des Frontends.
import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { watch } from 'chokidar';
import { Vault, VaultError, HIDDEN_DIRS, TMP_SUFFIX } from './vault.js';
import { createAuth } from './auth.js';

const MIME = {
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  canvas: 'application/json; charset=utf-8',
  json: 'application/json; charset=utf-8',
  css: 'text/css; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

/**
 * @param {{vaultPath:string, password?:string, sessionSecret?:string, staticDir?:string,
 *          secureCookie?:boolean, watchFiles?:boolean, logger?:boolean}} opts
 */
export async function buildApp(opts) {
  const vault = new Vault(opts.vaultPath);
  await vault.init();

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 50 * 1024 * 1024, trustProxy: true });
  await app.register(fastifyCookie);

  // Rohdaten für PUT /api/file
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  app.addContentTypeParser(['text/plain', 'text/markdown'], { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body),
  );

  const auth = createAuth({
    password: opts.password,
    secret: opts.sessionSecret,
    secureCookie: opts.secureCookie ?? false,
  });

  // CORS: erlaubt z.B. der auf GitHub Pages gehosteten Oberfläche den Zugriff auf diesen Server.
  // Fremde Herkünfte melden sich per Token (Authorization-Header) an, nicht per Cookie.
  const allowedOrigins = new Set((opts.allowedOrigins ?? []).map((o) => o.replace(/\/+$/, '')));
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) return;
    reply.header('access-control-allow-origin', origin);
    reply.header('vary', 'Origin');
    reply.header('access-control-expose-headers', 'x-mtime');
    if (req.method === 'OPTIONS') {
      reply.header('access-control-allow-methods', 'GET, PUT, POST, DELETE');
      reply.header('access-control-allow-headers', 'authorization, content-type, x-obui, x-expected-mtime');
      reply.header('access-control-max-age', '600');
      // Chrome "Private Network Access": Seite im Internet -> Server im Heimnetz
      if (req.headers['access-control-request-private-network'] === 'true') {
        reply.header('access-control-allow-private-network', 'true');
      }
      reply.code(204).send();
      return reply;
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof VaultError) return reply.code(err.status).send({ error: err.message });
    if (err.code === 'ENOENT') return reply.code(404).send({ error: 'Nicht gefunden' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: 'Serverfehler' });
  });

  app.get('/api/info', async (req) => ({
    app: 'vault-browser',
    vaultName: path.basename(vault.realRoot),
    auth: auth.enabled,
    loggedIn: auth.isLoggedIn(req),
  }));
  auth.register(app);

  await app.register(async (api) => {
    api.addHook('onRequest', auth.guard);
    // CSRF-Schutz: ändernde Requests brauchen einen Custom-Header (kein simple request möglich)
    api.addHook('onRequest', async (req, reply) => {
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-obui'] !== '1') {
        reply.code(403).send({ error: 'Fehlender Header' });
        return reply;
      }
    });

    api.get('/api/files', async () => ({ files: await vault.list() }));

    api.get('/api/file', async (req, reply) => {
      const { abs, stat } = await vault.read(req.query.path);
      const ext = path.extname(abs).slice(1).toLowerCase();
      reply.header('content-type', MIME[ext] ?? 'application/octet-stream');
      reply.header('x-mtime', String(stat.mtimeMs));
      reply.header('cache-control', 'no-store');
      return reply.send(fs.createReadStream(abs));
    });

    api.put('/api/file', async (req) => {
      const expected = req.headers['x-expected-mtime'];
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? '');
      return vault.write(req.query.path, body, expected ? Number(expected) : undefined);
    });

    api.delete('/api/file', async (req) => {
      await vault.remove(req.query.path);
      return { ok: true };
    });

    api.post('/api/folder', async (req) => {
      await vault.mkdir(req.body?.path);
      return { ok: true };
    });

    api.post('/api/rename', async (req) => {
      await vault.rename(req.body?.from, req.body?.to);
      return { ok: true };
    });

    // Server-Sent Events: Änderungen von außen (z.B. Obsidian selbst, Sync-Clients)
    const clients = new Set();
    let watcher;
    if (opts.watchFiles !== false) {
      watcher = watch(vault.realRoot, {
        ignoreInitial: true,
        ignored: (p) => {
          const rel = path.relative(vault.realRoot, p);
          return rel.split(path.sep).some((seg) => HIDDEN_DIRS.has(seg)) || p.endsWith(TMP_SUFFIX);
        },
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      });
      watcher.on('all', (event, p) => {
        const rel = path.relative(vault.realRoot, p).split(path.sep).join('/');
        const msg = `data: ${JSON.stringify({ event, path: rel })}\n\n`;
        for (const c of clients) c.write(msg);
      });
      app.addHook('onClose', async () => watcher.close());
    }

    api.get('/api/events', (req, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      reply.raw.write(': ok\n\n');
      clients.add(reply.raw);
      const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
      req.raw.on('close', () => {
        clearInterval(ping);
        clients.delete(reply.raw);
      });
    });
    app.addHook('onClose', async () => {
      for (const c of clients) c.end();
    });
  });

  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    await app.register(fastifyStatic, { root: path.resolve(opts.staticDir) });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Nicht gefunden' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
