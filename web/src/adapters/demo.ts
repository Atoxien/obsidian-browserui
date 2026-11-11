// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Atoxien
// Demo-Vault: läuft komplett im Browser-Tab. Keine Netzwerkzugriffe, keine gemeinsamen Daten –
// jeder Besucher bekommt seine eigene Kopie, die mit dem Tab verschwindet oder nach Ablauf zurückgesetzt wird.
import type { VaultAdapter, VaultFile } from './types';
import { dirname } from '../vault/paths';

export const DEMO_KEY = 'obui.demo.v1';
export const DEMO_TTL_MS = 4 * 60 * 60 * 1000; // 4 Stunden

interface StoredFile {
  /** Text oder Data-URL (Binärdateien) */
  d: string;
  bin?: true;
  mtime: number;
}

interface DemoState {
  created: number;
  files: Record<string, StoredFile>;
  folders: string[];
}

export type SeedFile = { path: string; text?: string; dataUrl?: string };

export class DemoAdapter implements VaultAdapter {
  readonly kind = 'demo';
  readonly name = 'Demo-Vault';
  readonly readOnly = false;
  readonly ephemeral = true;
  private state: DemoState;

  constructor(
    private seed: SeedFile[],
    private storage: Storage = sessionStorage,
    private now: () => number = Date.now,
  ) {
    this.state = this.load() ?? this.fresh();
    this.persist();
  }

  /** Zeitpunkt, an dem die Demo zurückgesetzt wird */
  get expiresAt() {
    return this.state.created + DEMO_TTL_MS;
  }

  get expired() {
    return this.now() >= this.expiresAt;
  }

  /** Vorhandene, noch gültige Demo-Sitzung in diesem Tab? */
  static hasSession(storage: Storage = sessionStorage, now = Date.now()) {
    try {
      const s = JSON.parse(storage.getItem(DEMO_KEY) ?? 'null') as DemoState | null;
      return Boolean(s && now < s.created + DEMO_TTL_MS);
    } catch {
      return false;
    }
  }

  /** Abgelaufene Demo-Daten sofort entfernen (beim Laden der Seite aufrufen) */
  static purgeExpired(storage: Storage = sessionStorage, now = Date.now()) {
    if (!DemoAdapter.hasSession(storage, now)) removeDemoKeys(storage);
  }

  /** Alles auf den Ausgangszustand zurücksetzen und alle Demo-Spuren aus der Session entfernen */
  reset() {
    removeDemoKeys(this.storage);
    this.state = this.fresh();
    this.persist();
  }

  private load(): DemoState | null {
    try {
      const s = JSON.parse(this.storage.getItem(DEMO_KEY) ?? 'null') as DemoState | null;
      if (!s || this.now() >= s.created + DEMO_TTL_MS) return null;
      return s;
    } catch {
      return null;
    }
  }

  private fresh(): DemoState {
    const files: DemoState['files'] = {};
    const t = this.now();
    for (const f of this.seed) files[f.path] = f.dataUrl != null ? { d: f.dataUrl, bin: true, mtime: t } : { d: f.text ?? '', mtime: t };
    return { created: t, files, folders: [] };
  }

  private persist() {
    try {
      this.storage.setItem(DEMO_KEY, JSON.stringify(this.state));
    } catch {
      throw new Error('Der Demo-Speicher ist voll (ca. 5 MB pro Tab). Lösche Dateien oder setze die Demo zurück.');
    }
  }

  private check(path: string) {
    if (!path || path.split('/').some((p) => p === '' || p === '.' || p === '..')) throw new Error('Ungültiger Pfad');
  }

  private exists(path: string) {
    return path in this.state.files || this.state.folders.includes(path) || Object.keys(this.state.files).some((p) => p.startsWith(`${path}/`));
  }

  async list(): Promise<VaultFile[]> {
    const folders = new Set(this.state.folders);
    const out: VaultFile[] = [];
    for (const [path, f] of Object.entries(this.state.files)) {
      if (path.split('/').some((seg) => seg === '.obsidian' || seg === '.trash')) continue;
      out.push({ path, type: 'file', mtime: f.mtime, size: f.d.length });
      for (let d = dirname(path); d; d = dirname(d)) folders.add(d);
    }
    for (const d of folders) out.push({ path: d, type: 'folder' });
    return out;
  }

  private get(path: string) {
    const f = this.state.files[path];
    if (!f) throw new Error('Datei nicht gefunden');
    return f;
  }

  async read(path: string) {
    const f = this.get(path);
    return f.bin ? (await (await fetch(f.d)).blob()).text() : f.d;
  }

  async readBinary(path: string): Promise<Blob> {
    const f = this.get(path);
    if (f.bin) return (await fetch(f.d)).blob();
    return new Blob([f.d], { type: path.endsWith('.svg') ? 'image/svg+xml' : 'text/plain' });
  }

  async write(path: string, content: string | Blob) {
    this.check(path);
    const prev = this.state.files[path];
    this.state.files[path] =
      typeof content === 'string' ? { d: content, mtime: this.now() } : { d: await blobToDataUrl(content), bin: true, mtime: this.now() };
    try {
      this.persist();
    } catch (e) {
      if (prev) this.state.files[path] = prev;
      else delete this.state.files[path];
      throw e;
    }
  }

  async mkdir(path: string) {
    this.check(path);
    if (!this.state.folders.includes(path)) this.state.folders.push(path);
    this.persist();
  }

  async rename(from: string, to: string) {
    this.check(to);
    if (this.exists(to)) throw new Error('Ziel existiert bereits');
    if (!this.exists(from)) throw new Error('Datei nicht gefunden');
    const move = (p: string) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
    this.state.files = Object.fromEntries(Object.entries(this.state.files).map(([p, f]) => [move(p), f]));
    this.state.folders = this.state.folders.map(move);
    this.persist();
  }

  async delete(path: string) {
    if (!this.exists(path)) throw new Error('Datei nicht gefunden');
    for (const p of Object.keys(this.state.files)) if (p === path || p.startsWith(`${path}/`)) delete this.state.files[p];
    this.state.folders = this.state.folders.filter((d) => d !== path && !d.startsWith(`${path}/`));
    this.persist();
  }
}

function removeDemoKeys(storage: Storage) {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) keys.push(storage.key(i)!);
  for (const k of keys) if (k.startsWith('obui.demo') || k.startsWith('obui.session.demo')) storage.removeItem(k);
}

async function blobToDataUrl(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${b.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

/** Beispiel-Vault aus examples/vault, beim Build eingebettet */
export function demoSeed(): SeedFile[] {
  const text = import.meta.glob<string>(['../../../examples/vault/**/*.{md,canvas,json}', '../../../examples/vault/.obsidian/*.json'], {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const bin = import.meta.glob<string>('../../../examples/vault/**/*.{png,jpg,jpeg,gif,webp,svg,pdf}', {
    query: '?inline',
    import: 'default',
    eager: true,
  });
  const rel = (k: string) => k.slice(k.indexOf('/examples/vault/') + '/examples/vault/'.length);
  return [
    ...Object.entries(text).map(([k, v]) => ({ path: rel(k), text: v })),
    ...Object.entries(bin).map(([k, v]) => ({ path: rel(k), dataUrl: v })),
  ];
}
