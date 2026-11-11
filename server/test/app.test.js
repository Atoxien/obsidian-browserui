import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';

let dir, outside, app, cookie;
const H = { 'x-obui': '1' };

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'obui-vault-'));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'obui-outside-'));
  await fs.writeFile(path.join(outside, 'secret.txt'), 'geheim');
  await fs.mkdir(path.join(dir, 'Ordner'));
  await fs.mkdir(path.join(dir, '.obsidian'));
  await fs.writeFile(path.join(dir, '.obsidian', 'app.json'), '{}');
  await fs.writeFile(path.join(dir, 'Start.md'), '# Hallo\n[[Ordner/Zwei]]');
  await fs.writeFile(path.join(dir, 'Ordner', 'Zwei.md'), 'zwei');
  await fs.symlink(outside, path.join(dir, 'link'));
  app = await buildApp({ vaultPath: dir, password: 'pw', watchFiles: false });
});

after(async () => {
  await app.close();
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

test('ohne Login: 401', async () => {
  const r = await app.inject({ url: '/api/files' });
  assert.equal(r.statusCode, 401);
  const info = await app.inject({ url: '/api/info' });
  assert.equal(info.json().auth, true);
  assert.equal(info.json().loggedIn, false);
});

test('falsches Passwort wird abgelehnt', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'nein' } });
  assert.equal(r.statusCode, 401);
});

test('Login setzt Cookie', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'pw' } });
  assert.equal(r.statusCode, 200);
  const c = r.cookies.find((x) => x.name === 'obui_session');
  assert.ok(c?.httpOnly);
  cookie = { obui_session: c.value };
});

test('Dateiliste blendet .obsidian aus', async () => {
  const r = await app.inject({ url: '/api/files', cookies: cookie });
  const paths = r.json().files.map((f) => f.path);
  assert.ok(paths.includes('Start.md'));
  assert.ok(paths.includes('Ordner/Zwei.md'));
  assert.ok(!paths.some((p) => p.startsWith('.obsidian')));
});

test('Datei lesen liefert Inhalt und mtime', async () => {
  const r = await app.inject({ url: '/api/file?path=Start.md', cookies: cookie });
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /# Hallo/);
  assert.ok(Number(r.headers['x-mtime']) > 0);
});

test('Path-Traversal wird blockiert', async () => {
  for (const p of ['../etc/passwd', '..%2F..%2Fetc%2Fpasswd', 'Ordner/../../x', '/etc/passwd', 'link/secret.txt']) {
    const r = await app.inject({ url: `/api/file?path=${p}`, cookies: cookie });
    assert.ok([400, 403, 404].includes(r.statusCode), `${p} -> ${r.statusCode}`);
    assert.doesNotMatch(r.body, /geheim|root:/);
  }
  const w = await app.inject({
    method: 'PUT',
    url: '/api/file?path=link/neu.txt',
    cookies: cookie,
    headers: { ...H, 'content-type': 'text/plain' },
    payload: 'x',
  });
  assert.equal(w.statusCode, 403);
});

test('Schreiben ohne CSRF-Header wird abgelehnt', async () => {
  const r = await app.inject({
    method: 'PUT',
    url: '/api/file?path=Neu.md',
    cookies: cookie,
    headers: { 'content-type': 'text/plain' },
    payload: 'x',
  });
  assert.equal(r.statusCode, 403);
});

test('Schreiben, Konflikt, Umbenennen, Löschen', async () => {
  const w = await app.inject({
    method: 'PUT',
    url: '/api/file?path=Neu/Notiz.md',
    cookies: cookie,
    headers: { ...H, 'content-type': 'text/markdown' },
    payload: 'Inhalt',
  });
  assert.equal(w.statusCode, 200);
  assert.equal(await fs.readFile(path.join(dir, 'Neu', 'Notiz.md'), 'utf8'), 'Inhalt');

  const conflict = await app.inject({
    method: 'PUT',
    url: '/api/file?path=Neu/Notiz.md',
    cookies: cookie,
    headers: { ...H, 'content-type': 'text/markdown', 'x-expected-mtime': '1' },
    payload: 'anders',
  });
  assert.equal(conflict.statusCode, 409);

  const ren = await app.inject({
    method: 'POST',
    url: '/api/rename',
    cookies: cookie,
    headers: H,
    payload: { from: 'Neu/Notiz.md', to: 'Neu/Umbenannt.md' },
  });
  assert.equal(ren.statusCode, 200);

  const del = await app.inject({ method: 'DELETE', url: '/api/file?path=Neu/Umbenannt.md', cookies: cookie, headers: H });
  assert.equal(del.statusCode, 200);
  assert.equal(await fs.readFile(path.join(dir, '.trash', 'Neu', 'Umbenannt.md'), 'utf8'), 'Inhalt');
});
