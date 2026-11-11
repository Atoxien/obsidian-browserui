import { afterEach, describe, expect, it, vi } from 'vitest';
import { RestApiAdapter } from '../src/adapters/restapi';

/** Bildet die Endpunkte des Obsidian-Plugins "Local REST API" nach. */
function mockObsidian(files: Record<string, string>, key = 'geheim') {
  const store = new Map(Object.entries(files));
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const auth = (init.headers as Record<string, string>)?.Authorization;
    if (u.pathname === '/') return Response.json({ status: 'OK', authenticated: auth === `Bearer ${key}` });
    if (auth !== `Bearer ${key}`) return new Response('{}', { status: 401 });
    const p = decodeURIComponent(u.pathname.replace(/^\/vault\/?/, ''));
    const method = init.method ?? 'GET';
    if (method === 'GET' && (p === '' || p.endsWith('/'))) {
      const entries = new Set<string>();
      for (const k of store.keys()) {
        if (!k.startsWith(p)) continue;
        const rest = k.slice(p.length);
        entries.add(rest.includes('/') ? `${rest.split('/')[0]}/` : rest);
      }
      return Response.json({ files: [...entries] });
    }
    if (method === 'GET') return store.has(p) ? new Response(store.get(p)) : new Response('{}', { status: 404 });
    if (method === 'PUT') {
      store.set(p, typeof init.body === 'string' ? init.body : await (init.body as Blob).text());
      return new Response(null, { status: 204 });
    }
    if (method === 'DELETE') {
      store.delete(p);
      return new Response(null, { status: 204 });
    }
    return new Response('{}', { status: 405 });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('RestApiAdapter', () => {
  it('lehnt falschen Key ab', async () => {
    vi.stubGlobal('fetch', mockObsidian({}));
    await expect(RestApiAdapter.connect('http://127.0.0.1:27123', 'falsch')).rejects.toThrow('API-Key');
  });

  it('listet rekursiv, liest, schreibt, benennt um und löscht', async () => {
    const f = mockObsidian({ 'A.md': 'a', 'Ordner/B.md': 'b', 'Ordner/Unter/C.md': 'c', '.obsidian/app.json': '{}' });
    vi.stubGlobal('fetch', f);
    const a = await RestApiAdapter.connect('http://127.0.0.1:27123/', 'geheim');
    const list = await a.list();
    expect(list.map((x) => x.path).sort()).toEqual(['A.md', 'Ordner', 'Ordner/B.md', 'Ordner/Unter', 'Ordner/Unter/C.md']);
    expect(await a.read('Ordner/Unter/C.md')).toBe('c');
    await a.write('Neu mit Leerzeichen.md', 'x');
    expect(f.mock.calls.some(([u]) => String(u).endsWith('/vault/Neu%20mit%20Leerzeichen.md'))).toBe(true);
    await a.rename('Ordner', 'Umbenannt');
    expect((await a.list()).map((x) => x.path)).toContain('Umbenannt/Unter/C.md');
    expect(await a.read('Umbenannt/B.md')).toBe('b');
    await a.delete('A.md');
    expect((await a.list()).map((x) => x.path)).not.toContain('A.md');
  });
});
