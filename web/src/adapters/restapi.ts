import { AuthError, type VaultAdapter, type VaultFile } from './types';
import { HIDDEN_DIRS } from '../vault/paths';

/**
 * Adapter für das Obsidian-Community-Plugin "Local REST API" (coddingtonbear/obsidian-local-rest-api).
 * Standard: https://127.0.0.1:27124 (selbstsigniertes Zertifikat) oder http://127.0.0.1:27123 (wenn aktiviert).
 */
export class RestApiAdapter implements VaultAdapter {
  readonly kind = 'restapi';
  readonly readOnly = false;
  readonly name: string;
  private folders = new Set<string>(); // leere Ordner, die die API nicht kennt
  private base: string;

  constructor(
    base: string,
    private apiKey: string,
    name = 'Obsidian',
  ) {
    this.base = base.replace(/\/+$/, '');
    this.name = name;
  }

  static async connect(base: string, apiKey: string): Promise<RestApiAdapter> {
    const a = new RestApiAdapter(base, apiKey);
    let r: Response;
    try {
      r = await fetch(`${a.base}/`, { headers: a.headers() });
    } catch {
      throw new Error(
        'Keine Verbindung. Läuft Obsidian mit dem Plugin „Local REST API“? Bei HTTPS das Zertifikat einmal im Browser öffnen und akzeptieren.',
      );
    }
    const info = (await r.json().catch(() => ({}))) as { authenticated?: boolean; service?: string };
    if (!info.authenticated) throw new AuthError('API-Key ungültig');
    return a;
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.apiKey}`, ...extra };
  }

  private url(path: string, dir = false) {
    const enc = path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return `${this.base}/vault/${enc}${dir && enc ? '/' : ''}`;
  }

  private async req(method: string, url: string, init: RequestInit = {}) {
    const r = await fetch(url, { ...init, method, headers: this.headers((init.headers as Record<string, string>) ?? {}) });
    if (r.status === 401 || r.status === 403) throw new AuthError('API-Key ungültig');
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { message?: string };
      throw new Error(j.message ?? `${method}: HTTP ${r.status}`);
    }
    return r;
  }

  async list(): Promise<VaultFile[]> {
    const out: VaultFile[] = [];
    const seen = new Set<string>();
    const walk = async (dir: string) => {
      const r = await this.req('GET', this.url(dir, true));
      const { files } = (await r.json()) as { files: string[] };
      for (const entry of files) {
        const isDir = entry.endsWith('/');
        const name = entry.replace(/\/$/, '');
        const p = dir ? `${dir}/${name}` : name;
        if (isDir) {
          if (HIDDEN_DIRS.has(name.split('/').pop()!)) continue;
          out.push({ path: p, type: 'folder' });
          seen.add(p);
          await walk(p);
        } else {
          out.push({ path: p, type: 'file' });
        }
      }
    };
    await walk('');
    for (const f of this.folders) if (!seen.has(f)) out.push({ path: f, type: 'folder' });
    return out;
  }

  async read(path: string) {
    return (await this.req('GET', this.url(path), { headers: { Accept: 'text/markdown' } })).text();
  }

  async readBinary(path: string) {
    return (await this.req('GET', this.url(path))).blob();
  }

  async write(path: string, content: string | Blob) {
    await this.req('PUT', this.url(path), {
      body: content,
      headers: { 'Content-Type': typeof content === 'string' ? 'text/markdown' : 'application/octet-stream' },
    });
  }

  async mkdir(path: string) {
    // Die API kennt keine leeren Ordner – Ordner entsteht beim ersten Speichern einer Datei darin.
    this.folders.add(path);
  }

  private async filesUnder(path: string): Promise<string[] | null> {
    const all = await this.list();
    const isFolder = all.some((f) => f.type === 'folder' && f.path === path);
    if (!isFolder) return null;
    return all.filter((f) => f.type === 'file' && f.path.startsWith(`${path}/`)).map((f) => f.path);
  }

  async rename(from: string, to: string) {
    const children = await this.filesUnder(from);
    const pairs = children ? children.map((c) => [c, to + c.slice(from.length)]) : [[from, to]];
    for (const [a, b] of pairs) {
      const blob = await this.readBinary(a);
      await this.write(b, a.endsWith('.md') ? await blob.text() : blob);
      await this.req('DELETE', this.url(a));
    }
    if (this.folders.delete(from)) this.folders.add(to);
  }

  async delete(path: string) {
    const children = await this.filesUnder(path);
    for (const f of children ?? [path]) await this.req('DELETE', this.url(f));
    this.folders.delete(path);
  }
}
