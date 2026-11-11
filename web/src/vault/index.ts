// Vault-Index: Dateiliste, Obsidian-kompatible Link-Auflösung, Backlinks, Tags, Volltextsuche.
import type { VaultFile } from '../adapters/types';
import { basename, dirname, extname, stripExt } from './paths';
import { frontmatterAliases, frontmatterTags, parseFrontmatter } from './frontmatter';

export interface LinkRef {
  target: string; // Link-Ziel ohne #/|
  subpath: string; // "#Überschrift" oder "#^block" oder ''
  alias: string;
  embed: boolean;
  /** Original-Text des Links */
  raw: string;
  index: number;
}

const WIKI_RE = /(!?)\[\[([^\]\n]+?)\]\]/g;
const MD_LINK_RE = /(!?)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const TAG_RE = /(?:^|[\s(,])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

/** Code-Blöcke, Inline-Code und %%Kommentare%% entfernen, bevor Links/Tags gesucht werden (Länge bleibt gleich). */
export function maskCode(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, blank)
    .replace(/%%[\s\S]*?%%/g, blank)
    .replace(/`[^`\n]+`/g, blank);
}

export function parseWikiInner(inner: string): { target: string; subpath: string; alias: string } {
  let alias = '';
  const pipe = inner.indexOf('|');
  if (pipe >= 0) {
    alias = inner.slice(pipe + 1).trim();
    inner = inner.slice(0, pipe);
  }
  // in Tabellen wird "|" als "\|" geschrieben
  inner = inner.replace(/\\$/, '');
  let subpath = '';
  const hash = inner.indexOf('#');
  if (hash >= 0) {
    subpath = inner.slice(hash).trim();
    inner = inner.slice(0, hash);
  }
  return { target: inner.trim(), subpath, alias };
}

export function extractLinks(src: string): LinkRef[] {
  const text = maskCode(src);
  const out: LinkRef[] = [];
  for (const m of text.matchAll(WIKI_RE)) {
    const { target, subpath, alias } = parseWikiInner(m[2]);
    out.push({ target, subpath, alias, embed: m[1] === '!', raw: m[0], index: m.index! });
  }
  for (const m of text.matchAll(MD_LINK_RE)) {
    const href = m[3];
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) continue;
    let decoded = href;
    try {
      decoded = decodeURIComponent(href);
    } catch {
      /* belassen */
    }
    const hash = decoded.indexOf('#');
    out.push({
      target: hash >= 0 ? decoded.slice(0, hash) : decoded,
      subpath: hash >= 0 ? decoded.slice(hash) : '',
      alias: m[2],
      embed: m[1] === '!',
      raw: m[0],
      index: m.index!,
    });
  }
  return out;
}

export function extractInlineTags(src: string): string[] {
  const text = maskCode(parseFrontmatter(src).body);
  const out = new Set<string>();
  for (const m of text.matchAll(TAG_RE)) out.add(m[1]);
  return [...out];
}

export interface NoteMeta {
  links: LinkRef[];
  tags: string[];
  aliases: string[];
  headings: { level: number; text: string; line: number }[];
}

export function analyzeNote(src: string): NoteMeta {
  const fm = parseFrontmatter(src);
  const tags = new Set([...frontmatterTags(fm.data), ...extractInlineTags(src)]);
  const headings: NoteMeta['headings'] = [];
  const masked = maskCode(src).split('\n');
  masked.forEach((line, i) => {
    if (i < fm.lines) return;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) headings.push({ level: h[1].length, text: h[2], line: i });
  });
  return { links: extractLinks(src), tags: [...tags], aliases: frontmatterAliases(fm.data), headings };
}

export interface SearchHit {
  path: string;
  score: number;
  snippets: { line: number; text: string }[];
}

export class VaultIndex {
  files = new Map<string, VaultFile>();
  /** Inhalte von Markdown-Dateien (für Backlinks/Suche) */
  content = new Map<string, string>();
  meta = new Map<string, NoteMeta>();
  private byName = new Map<string, string[]>(); // basename ohne .md (lowercase) -> Pfade

  setFiles(list: VaultFile[]) {
    this.files.clear();
    for (const f of list) this.files.set(f.path, f);
    for (const p of [...this.content.keys()]) {
      if (!this.files.has(p)) {
        this.content.delete(p);
        this.meta.delete(p);
      }
    }
    this.rebuildNames();
  }

  private rebuildNames() {
    this.byName.clear();
    const add = (key: string, path: string) => {
      const k = key.toLowerCase();
      const arr = this.byName.get(k) ?? [];
      if (!arr.includes(path)) arr.push(path);
      this.byName.set(k, arr);
    };
    for (const f of this.files.values()) {
      if (f.type !== 'file') continue;
      add(basename(f.path), f.path);
      if (extname(f.path) === 'md') add(stripExt(basename(f.path)), f.path);
    }
    // kürzeste Pfade zuerst (Obsidian bevorzugt bei Mehrdeutigkeit die Datei am nächsten zur Wurzel)
    for (const arr of this.byName.values()) arr.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  }

  addFile(f: VaultFile) {
    this.files.set(f.path, f);
    // Elternordner sicherstellen
    let d = dirname(f.path);
    while (d) {
      if (!this.files.has(d)) this.files.set(d, { path: d, type: 'folder' });
      d = dirname(d);
    }
    this.rebuildNames();
  }

  removePath(path: string) {
    for (const p of [...this.files.keys()]) {
      if (p === path || p.startsWith(`${path}/`)) {
        this.files.delete(p);
        this.content.delete(p);
        this.meta.delete(p);
      }
    }
    this.rebuildNames();
  }

  setContent(path: string, text: string) {
    this.content.set(path, text);
    this.meta.set(path, analyzeNote(text));
  }

  notes(): string[] {
    return [...this.files.values()].filter((f) => f.type === 'file' && extname(f.path) === 'md').map((f) => f.path);
  }

  /**
   * Löst ein Link-Ziel wie Obsidian auf:
   * 1. exakter Vault-Pfad (mit/ohne .md)  2. relativ zur Quelldatei  3. per Dateiname (kürzester Pfad)  4. Alias
   */
  resolve(target: string, from = ''): string | null {
    if (!target) return from || null;
    let t = target.replace(/\\/g, '/').replace(/^\.\//, '');
    if (t.startsWith('/')) t = t.slice(1);
    const candidates = extname(t) ? [t, `${t}.md`] : [`${t}.md`, t];
    for (const c of candidates) if (this.isFile(c)) return c;
    const base = dirname(from);
    if (base || t.startsWith('../')) {
      for (const c of candidates) {
        const rel = normalize(`${base}/${c}`);
        if (rel && this.isFile(rel)) return rel;
      }
    }
    if (t.includes('/')) {
      // Teilpfad: Datei, deren Pfad auf das Ziel endet
      const lower = candidates.map((c) => `/${c.toLowerCase()}`);
      const hit = [...this.files.keys()]
        .filter((p) => this.isFile(p) && lower.some((c) => `/${p.toLowerCase()}`.endsWith(c)))
        .sort((a, b) => a.length - b.length)[0];
      if (hit) return hit;
    }
    const name = basename(t).toLowerCase();
    const byName = this.byName.get(name);
    if (byName?.length) return byName[0];
    for (const [p, m] of this.meta) {
      if (m.aliases.some((a) => a.toLowerCase() === t.toLowerCase())) return p;
    }
    return null;
  }

  private isFile(p: string) {
    if (this.files.get(p)?.type === 'file') return true;
    // case-insensitive Fallback
    const lower = p.toLowerCase();
    for (const [k, v] of this.files) if (v.type === 'file' && k.toLowerCase() === lower) return true;
    return false;
  }

  /** Text, mit dem auf eine Datei verlinkt werden sollte (kürzester eindeutiger Name, wie Obsidian). */
  linkText(path: string): string {
    const isMd = extname(path) === 'md';
    const name = isMd ? stripExt(basename(path)) : basename(path);
    const same = this.byName.get(name.toLowerCase()) ?? [];
    if (same.length <= 1) return name;
    return isMd ? stripExt(path) : path;
  }

  backlinks(path: string): { source: string; links: LinkRef[]; lines: string[] }[] {
    const out: { source: string; links: LinkRef[]; lines: string[] }[] = [];
    for (const [src, m] of this.meta) {
      if (src === path) continue;
      const links = m.links.filter((l) => this.resolve(l.target, src) === path);
      if (!links.length) continue;
      const text = this.content.get(src) ?? '';
      const lines = links.map((l) => lineAt(text, l.index).trim());
      out.push({ source: src, links, lines: [...new Set(lines)] });
    }
    return out.sort((a, b) => a.source.localeCompare(b.source));
  }

  /** Erwähnungen ohne Link (unlinked mentions) */
  unlinkedMentions(path: string): { source: string; line: string }[] {
    const name = stripExt(basename(path));
    if (name.length < 3) return [];
    const re = new RegExp(`(^|[^\\p{L}\\p{N}\\[])${escapeRe(name)}(?![\\p{L}\\p{N}])`, 'iu');
    const out: { source: string; line: string }[] = [];
    for (const [src, text] of this.content) {
      if (src === path) continue;
      const masked = maskCode(text).replace(WIKI_RE, (m) => ' '.repeat(m.length));
      const lines = masked.split('\n');
      const orig = text.split('\n');
      lines.forEach((l, i) => {
        if (re.test(l)) out.push({ source: src, line: orig[i].trim() });
      });
    }
    return out;
  }

  outgoing(path: string): { link: LinkRef; resolved: string | null }[] {
    return (this.meta.get(path)?.links ?? []).map((link) => ({ link, resolved: this.resolve(link.target, path) }));
  }

  allTags(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const m of this.meta.values()) {
      for (const t of m.tags) {
        // Verschachtelte Tags zählen auch für die Eltern
        const parts = t.split('/');
        for (let i = 1; i <= parts.length; i++) {
          const k = parts.slice(0, i).join('/');
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
      }
    }
    return new Map([...counts].sort((a, b) => a[0].localeCompare(b[0])));
  }

  /**
   * Volltextsuche mit Obsidian-ähnlicher Syntax: Wörter (UND), "Phrase", -ausschließen,
   * tag:#x, path:ordner, file:name.
   */
  search(query: string, limit = 200): SearchHit[] {
    const q = parseQuery(query);
    if (!q.terms.length && !q.tags.length && !q.paths.length && !q.files.length) return [];
    const hits: SearchHit[] = [];
    for (const path of this.notes()) {
      const text = this.content.get(path);
      if (text == null) continue;
      const lowerPath = path.toLowerCase();
      if (q.paths.some((p) => !lowerPath.includes(p))) continue;
      if (q.files.some((f) => !basename(lowerPath).includes(f))) continue;
      const tags = (this.meta.get(path)?.tags ?? []).map((t) => t.toLowerCase());
      if (q.tags.some((t) => !tags.some((x) => x === t || x.startsWith(`${t}/`)))) continue;
      const lower = text.toLowerCase();
      if (q.exclude.some((e) => lower.includes(e) || lowerPath.includes(e))) continue;
      let score = 0;
      let ok = true;
      for (const t of q.terms) {
        const inName = basename(lowerPath).includes(t);
        const count = countOccurrences(lower, t);
        if (!inName && !count) {
          ok = false;
          break;
        }
        score += count + (inName ? 10 : 0);
      }
      if (!ok) continue;
      const snippets: SearchHit['snippets'] = [];
      if (q.terms.length) {
        const lines = text.split('\n');
        for (let i = 0; i < lines.length && snippets.length < 5; i++) {
          const l = lines[i].toLowerCase();
          if (q.terms.some((t) => l.includes(t))) snippets.push({ line: i, text: lines[i].trim().slice(0, 240) });
        }
      }
      hits.push({ path, score: score || 1, snippets });
    }
    return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
  }

  /** Alle Links auf `oldPath` in anderen Notizen auf `newPath` umschreiben. Liefert geänderte Inhalte. */
  rewriteLinks(oldPath: string, newPath: string): Map<string, string> {
    const changed = new Map<string, string>();
    for (const [src, m] of this.meta) {
      const text = this.content.get(src);
      if (text == null) continue;
      const affected = m.links.filter((l) => this.resolve(l.target, src) === oldPath);
      if (!affected.length) continue;
      let out = text;
      // von hinten ersetzen, damit Indizes stimmen
      for (const l of [...affected].sort((a, b) => b.index - a.index)) {
        let repl: string;
        if (l.raw.includes('[[')) {
          const isMd = extname(newPath) === 'md';
          const tgt = this.linkTextAfterRename(newPath, oldPath, isMd);
          repl = `${l.embed ? '!' : ''}[[${tgt}${l.subpath}${l.alias ? `|${l.alias}` : ''}]]`;
        } else {
          const enc = newPath.split('/').map(encodeURIComponent).join('/');
          repl = `${l.embed ? '!' : ''}[${l.alias}](${enc}${l.subpath})`;
        }
        out = out.slice(0, l.index) + repl + out.slice(l.index + l.raw.length);
      }
      changed.set(src, out);
    }
    return changed;
  }

  private linkTextAfterRename(newPath: string, oldPath: string, isMd: boolean) {
    const name = isMd ? stripExt(basename(newPath)) : basename(newPath);
    const others = (this.byName.get(name.toLowerCase()) ?? []).filter((p) => p !== oldPath && p !== newPath);
    if (others.length === 0) return name;
    return isMd ? stripExt(newPath) : newPath;
  }
}

function parseQuery(query: string) {
  const q = { terms: [] as string[], exclude: [] as string[], tags: [] as string[], paths: [] as string[], files: [] as string[] };
  const re = /(-?)(?:(tag|path|file):)?(?:"([^"]*)"|(\S+))/gi;
  for (const m of query.matchAll(re)) {
    const neg = m[1] === '-';
    const op = m[2]?.toLowerCase();
    const val = (m[3] ?? m[4] ?? '').toLowerCase();
    if (!val) continue;
    if (op === 'tag' || (!op && val.startsWith('#') && val.length > 1)) q.tags.push(val.replace(/^#/, ''));
    else if (op === 'path') q.paths.push(val);
    else if (op === 'file') q.files.push(val);
    else if (neg) q.exclude.push(val);
    else q.terms.push(val);
  }
  return q;
}

function countOccurrences(hay: string, needle: string) {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

function lineAt(text: string, index: number) {
  const s = text.lastIndexOf('\n', index - 1) + 1;
  const e = text.indexOf('\n', index);
  return text.slice(s, e < 0 ? undefined : e);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalize(p: string): string | null {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}
