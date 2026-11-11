// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Atoxien
// Sicherer Dateizugriff auf den Vault-Ordner.
import fs from 'node:fs/promises';
import path from 'node:path';

export const HIDDEN_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);
/** Endung temporärer Dateien beim atomaren Schreiben */
export const TMP_SUFFIX = '.obui-tmp';

export class VaultError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class Vault {
  /** @param {string} root absoluter Pfad zum Vault */
  constructor(root) {
    this.root = path.resolve(root);
  }

  async init() {
    this.realRoot = await fs.realpath(this.root);
  }

  /**
   * Wandelt einen Vault-relativen Pfad (immer mit "/") in einen absoluten Pfad um.
   * Verhindert Ausbrüche via "..", absolute Pfade, NUL-Bytes und Symlinks.
   */
  async resolve(rel, { mustExist = false } = {}) {
    if (typeof rel !== 'string' || rel.length === 0) throw new VaultError(400, 'Pfad fehlt');
    if (rel.includes('\0')) throw new VaultError(400, 'Ungültiger Pfad');
    const normalized = path.posix.normalize(rel.replace(/\\/g, '/')).replace(/^\/+/, '');
    if (normalized === '.' || normalized === '' || normalized.startsWith('..')) {
      throw new VaultError(400, 'Ungültiger Pfad');
    }
    const abs = path.resolve(this.realRoot, ...normalized.split('/'));
    if (!isInside(this.realRoot, abs)) throw new VaultError(400, 'Ungültiger Pfad');

    // Den tiefsten existierenden Vorfahren auflösen, um Symlink-Ausbrüche zu erkennen.
    let probe = abs;
    for (;;) {
      try {
        const real = await fs.realpath(probe);
        if (!isInside(this.realRoot, real) && real !== this.realRoot) {
          throw new VaultError(403, 'Pfad außerhalb des Vaults');
        }
        break;
      } catch (e) {
        if (e instanceof VaultError) throw e;
        if (e.code !== 'ENOENT') throw e;
        if (mustExist && probe === abs) throw new VaultError(404, 'Datei nicht gefunden');
        const parent = path.dirname(probe);
        if (parent === probe) break;
        probe = parent;
      }
    }
    return { abs, rel: normalized };
  }

  async list() {
    const out = [];
    const walk = async (dirAbs, dirRel) => {
      let entries;
      try {
        entries = await fs.readdir(dirAbs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        if (ent.isDirectory() && HIDDEN_DIRS.has(ent.name)) continue;
        if (ent.name === '.DS_Store' || ent.name.endsWith(TMP_SUFFIX)) continue;
        const rel = dirRel ? `${dirRel}/${ent.name}` : ent.name;
        const abs = path.join(dirAbs, ent.name);
        if (ent.isDirectory()) {
          out.push({ path: rel, type: 'folder' });
          await walk(abs, rel);
        } else if (ent.isFile()) {
          try {
            const st = await fs.stat(abs);
            out.push({ path: rel, type: 'file', mtime: st.mtimeMs, size: st.size });
          } catch {
            /* zwischenzeitlich gelöscht */
          }
        }
      }
    };
    await walk(this.realRoot, '');
    return out;
  }

  async stat(rel) {
    const { abs } = await this.resolve(rel, { mustExist: true });
    return fs.stat(abs);
  }

  async read(rel) {
    const { abs } = await this.resolve(rel, { mustExist: true });
    const st = await fs.stat(abs);
    if (!st.isFile()) throw new VaultError(400, 'Keine Datei');
    return { abs, stat: st };
  }

  /**
   * @param {string} rel
   * @param {Buffer|string} data
   * @param {number|undefined} expectedMtime wenn gesetzt: Konflikt, falls Datei inzwischen geändert wurde
   */
  async write(rel, data, expectedMtime) {
    const { abs } = await this.resolve(rel);
    if (expectedMtime !== undefined) {
      try {
        const st = await fs.stat(abs);
        if (Math.abs(st.mtimeMs - expectedMtime) > 1) {
          throw new VaultError(409, 'Datei wurde zwischenzeitlich geändert');
        }
      } catch (e) {
        if (e instanceof VaultError) throw e;
        if (e.code !== 'ENOENT') throw e;
      }
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // Versteckte, eindeutig benannte Temp-Datei: Sync-Werkzeuge (z.B. livesync-bridge mit
    // ignore "**/*.obui-tmp") übertragen so nie einen halb geschriebenen Zwischenstand.
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.${Date.now()}${TMP_SUFFIX}`);
    try {
      await fs.writeFile(tmp, data);
      await fs.rename(tmp, abs);
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
    const st = await fs.stat(abs);
    return { mtime: st.mtimeMs, size: st.size };
  }

  async mkdir(rel) {
    const { abs } = await this.resolve(rel);
    await fs.mkdir(abs, { recursive: true });
  }

  async rename(fromRel, toRel) {
    const from = await this.resolve(fromRel, { mustExist: true });
    const to = await this.resolve(toRel);
    try {
      await fs.access(to.abs);
      throw new VaultError(409, 'Ziel existiert bereits');
    } catch (e) {
      if (e instanceof VaultError) throw e;
    }
    await fs.mkdir(path.dirname(to.abs), { recursive: true });
    await fs.rename(from.abs, to.abs);
  }

  /** Verschiebt in .trash (wie Obsidian "In Obsidian-Papierkorb verschieben"). */
  async remove(rel) {
    const { abs, rel: norm } = await this.resolve(rel, { mustExist: true });
    const trashRoot = path.join(this.realRoot, '.trash');
    let target = path.join(trashRoot, ...norm.split('/'));
    try {
      await fs.access(target);
      const ext = path.extname(target);
      target = `${target.slice(0, target.length - ext.length)} ${Date.now()}${ext}`;
    } catch {
      /* frei */
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(abs, target);
  }
}

function isInside(root, p) {
  const r = path.relative(root, p);
  return r !== '' && !r.startsWith('..') && !path.isAbsolute(r);
}
