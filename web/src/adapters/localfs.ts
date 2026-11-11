import type { VaultAdapter, VaultFile } from './types';
import { HIDDEN_DIRS } from '../vault/paths';

// Minimale Typen für die File System Access API (Chromium).
type PermissionMode = { mode: 'read' | 'readwrite' };
interface FSHandle {
  kind: 'file' | 'directory';
  name: string;
  queryPermission?(o: PermissionMode): Promise<PermissionState>;
  requestPermission?(o: PermissionMode): Promise<PermissionState>;
}
interface FSFileHandle extends FSHandle {
  kind: 'file';
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(d: string | Blob): Promise<void>; close(): Promise<void> }>;
  move?(parent: FSDirHandle, name: string): Promise<void>;
}
interface FSDirHandle extends FSHandle {
  kind: 'directory';
  values(): AsyncIterable<FSFileHandle | FSDirHandle>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<FSFileHandle>;
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<FSDirHandle>;
  removeEntry(name: string, o?: { recursive?: boolean }): Promise<void>;
}

declare global {
  interface Window {
    showDirectoryPicker?(o?: { id?: string; mode?: 'read' | 'readwrite' }): Promise<FSDirHandle>;
  }
}

export const supportsFSAccess = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

// ---- Handle in IndexedDB merken, damit der Ordner beim nächsten Besuch wieder geöffnet werden kann ----
const DB = 'obui';
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('handles');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbSet(key: string, val: unknown) {
  const db = await idb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((res, rej) => {
    const r = db.transaction('handles').objectStore('handles').get(key);
    r.onsuccess = () => res(r.result as T);
    r.onerror = () => rej(r.error);
  });
}

export async function pickLocalVault(): Promise<LocalFsAdapter> {
  const handle = await window.showDirectoryPicker!({ id: 'obsidian-vault', mode: 'readwrite' });
  await idbSet('vault', handle).catch(() => {});
  return new LocalFsAdapter(handle);
}

/** Zuletzt geöffneten Ordner, falls vorhanden. */
export async function rememberedLocalVault(): Promise<FSDirHandle | undefined> {
  try {
    return await idbGet<FSDirHandle>('vault');
  } catch {
    return undefined;
  }
}

export async function reopenLocalVault(handle: FSDirHandle): Promise<LocalFsAdapter> {
  const opt: PermissionMode = { mode: 'readwrite' };
  if ((await handle.queryPermission?.(opt)) !== 'granted') {
    if ((await handle.requestPermission?.(opt)) !== 'granted') throw new Error('Zugriff verweigert');
  }
  return new LocalFsAdapter(handle);
}

export class LocalFsAdapter implements VaultAdapter {
  readonly kind = 'localfs';
  readonly readOnly = false;
  readonly name: string;

  constructor(private root: FSDirHandle) {
    this.name = root.name;
  }

  async list(): Promise<VaultFile[]> {
    const out: VaultFile[] = [];
    const walk = async (dir: FSDirHandle, prefix: string) => {
      for await (const h of dir.values()) {
        if (h.kind === 'directory' && HIDDEN_DIRS.has(h.name)) continue;
        const p = prefix ? `${prefix}/${h.name}` : h.name;
        if (h.kind === 'directory') {
          out.push({ path: p, type: 'folder' });
          await walk(h, p);
        } else {
          out.push({ path: p, type: 'file' });
        }
      }
    };
    await walk(this.root, '');
    return out;
  }

  private async dir(parts: string[], create = false): Promise<FSDirHandle> {
    let d = this.root;
    for (const part of parts) d = await d.getDirectoryHandle(part, { create });
    return d;
  }

  private split(path: string) {
    const parts = path.split('/').filter(Boolean);
    if (parts.some((p) => p === '..' || p === '.')) throw new Error('Ungültiger Pfad');
    const name = parts.pop()!;
    return { parts, name };
  }

  private async fileHandle(path: string, create = false) {
    const { parts, name } = this.split(path);
    return (await this.dir(parts, create)).getFileHandle(name, { create });
  }

  private async entry(path: string): Promise<FSFileHandle | FSDirHandle> {
    const { parts, name } = this.split(path);
    const parent = await this.dir(parts);
    try {
      return await parent.getFileHandle(name);
    } catch {
      return parent.getDirectoryHandle(name);
    }
  }

  async read(path: string) {
    return (await (await this.fileHandle(path)).getFile()).text();
  }

  async readBinary(path: string): Promise<Blob> {
    return (await this.fileHandle(path)).getFile();
  }

  async write(path: string, content: string | Blob) {
    const fh = await this.fileHandle(path, true);
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
  }

  async mkdir(path: string) {
    await this.dir(path.split('/').filter(Boolean), true);
  }

  private async copy(h: FSFileHandle | FSDirHandle, targetParent: FSDirHandle, name: string) {
    if (h.kind === 'file') {
      const fh = await targetParent.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(await h.getFile());
      await w.close();
    } else {
      const d = await targetParent.getDirectoryHandle(name, { create: true });
      for await (const c of h.values()) await this.copy(c, d, c.name);
    }
  }

  private async exists(path: string) {
    try {
      await this.entry(path);
      return true;
    } catch {
      return false;
    }
  }

  async rename(from: string, to: string) {
    if (await this.exists(to)) throw new Error('Ziel existiert bereits');
    const src = await this.entry(from);
    const { parts: fromParts, name: fromName } = this.split(from);
    const { parts, name } = this.split(to);
    const targetParent = await this.dir(parts, true);
    if (src.kind === 'file' && src.move) {
      await src.move(targetParent, name);
      return;
    }
    await this.copy(src, targetParent, name);
    await (await this.dir(fromParts)).removeEntry(fromName, { recursive: true });
  }

  /** Verschiebt in .trash wie Obsidian. */
  async delete(path: string) {
    const src = await this.entry(path);
    const { parts, name } = this.split(path);
    const trash = await this.dir(['.trash', ...parts], true);
    let target = name;
    try {
      await trash.getFileHandle(target);
      target = `${Date.now()} ${name}`;
    } catch {
      /* frei */
    }
    await this.copy(src, trash, target);
    await (await this.dir(parts)).removeEntry(name, { recursive: true });
  }
}

/** Fallback für Firefox/Safari: Ordner über <input webkitdirectory> – nur lesen. */
export class ReadOnlyFilesAdapter implements VaultAdapter {
  readonly kind = 'readonly';
  readonly readOnly = true;
  private files = new Map<string, File>();
  readonly name: string;

  constructor(list: FileList) {
    let root = '';
    for (const f of Array.from(list)) {
      const rel = (f as File & { webkitRelativePath: string }).webkitRelativePath || f.name;
      const parts = rel.split('/');
      if (parts.length > 1) {
        root = parts[0];
        parts.shift();
      }
      if (parts.some((p) => HIDDEN_DIRS.has(p))) continue;
      this.files.set(parts.join('/'), f);
    }
    this.name = root || 'Vault';
  }

  async list(): Promise<VaultFile[]> {
    const folders = new Set<string>();
    const out: VaultFile[] = [];
    for (const p of this.files.keys()) {
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
      out.push({ path: p, type: 'file' });
    }
    for (const f of folders) out.push({ path: f, type: 'folder' });
    return out;
  }
  private get(path: string) {
    const f = this.files.get(path);
    if (!f) throw new Error('Datei nicht gefunden');
    return f;
  }
  async read(path: string) {
    return this.get(path).text();
  }
  async readBinary(path: string) {
    return this.get(path);
  }
  private ro(): never {
    throw new Error('Dieser Modus ist schreibgeschützt (Browser unterstützt keinen Ordner-Schreibzugriff).');
  }
  async write() {
    this.ro();
  }
  async mkdir() {
    this.ro();
  }
  async rename() {
    this.ro();
  }
  async delete() {
    this.ro();
  }
}
