import { AuthError, ConflictError, type ChangeEvent, type VaultAdapter, type VaultFile } from './types';

export interface ServerInfo {
  app: string;
  vaultName: string;
  auth: boolean;
  loggedIn: boolean;
}

export async function probeServer(base = ''): Promise<ServerInfo | null> {
  try {
    const r = await fetch(`${base}/api/info`, { credentials: 'same-origin' });
    if (!r.ok) return null;
    const j = (await r.json()) as ServerInfo;
    return j.app === 'obsidian-browserui' ? j : null;
  } catch {
    return null;
  }
}

export async function serverLogin(password: string, base = ''): Promise<void> {
  const r = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-obui': '1' },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Login fehlgeschlagen');
}

export class ServerAdapter implements VaultAdapter {
  readonly kind = 'server';
  readonly readOnly = false;
  private mtimes = new Map<string, number>();

  constructor(
    readonly name: string,
    private base = '',
  ) {}

  private async req(method: string, url: string, init: RequestInit = {}): Promise<Response> {
    const r = await fetch(this.base + url, {
      ...init,
      method,
      credentials: 'same-origin',
      headers: { 'x-obui': '1', ...(init.headers ?? {}) },
    });
    if (r.status === 401) throw new AuthError('Sitzung abgelaufen – bitte neu anmelden');
    if (r.status === 409) throw new ConflictError(((await r.json()) as { error: string }).error);
    if (!r.ok) {
      const msg = ((await r.json().catch(() => ({}))) as { error?: string }).error;
      throw new Error(msg ?? `${method} ${url}: HTTP ${r.status}`);
    }
    return r;
  }

  private q(path: string) {
    return `?path=${encodeURIComponent(path)}`;
  }

  async list(): Promise<VaultFile[]> {
    const r = await this.req('GET', '/api/files');
    const { files } = (await r.json()) as { files: VaultFile[] };
    for (const f of files) if (f.mtime) this.mtimes.set(f.path, f.mtime);
    return files;
  }

  async read(path: string): Promise<string> {
    const r = await this.req('GET', `/api/file${this.q(path)}`);
    const m = Number(r.headers.get('x-mtime'));
    if (m) this.mtimes.set(path, m);
    return r.text();
  }

  async readBinary(path: string): Promise<Blob> {
    return (await this.req('GET', `/api/file${this.q(path)}`)).blob();
  }

  async write(path: string, content: string | Blob): Promise<void> {
    const headers: Record<string, string> = {
      'content-type': typeof content === 'string' ? 'text/markdown' : 'application/octet-stream',
    };
    const known = this.mtimes.get(path);
    if (known) headers['x-expected-mtime'] = String(known);
    const r = await this.req('PUT', `/api/file${this.q(path)}`, { body: content, headers });
    const { mtime } = (await r.json()) as { mtime: number };
    this.mtimes.set(path, mtime);
  }

  /** Überschreibt ohne Konfliktprüfung (nach Bestätigung durch den Nutzer). */
  forget(path: string) {
    this.mtimes.delete(path);
  }

  async mkdir(path: string): Promise<void> {
    await this.req('POST', '/api/folder', { body: JSON.stringify({ path }), headers: { 'content-type': 'application/json' } });
  }

  async rename(from: string, to: string): Promise<void> {
    await this.req('POST', '/api/rename', {
      body: JSON.stringify({ from, to }),
      headers: { 'content-type': 'application/json' },
    });
    const m = this.mtimes.get(from);
    this.mtimes.delete(from);
    if (m) this.mtimes.set(to, m);
  }

  async delete(path: string): Promise<void> {
    await this.req('DELETE', `/api/file${this.q(path)}`);
    this.mtimes.delete(path);
  }

  watch(cb: (e: ChangeEvent) => void): () => void {
    const es = new EventSource(`${this.base}/api/events`);
    es.onmessage = (m) => {
      try {
        cb(JSON.parse(m.data) as ChangeEvent);
      } catch {
        /* ignorieren */
      }
    };
    return () => es.close();
  }

  async logout() {
    await fetch(`${this.base}/api/logout`, { method: 'POST', headers: { 'x-obui': '1' } });
  }
}
