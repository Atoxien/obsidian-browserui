// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Atoxien

// Direkter Zugriff auf einen Self-hosted-LiveSync-Vault (CouchDB) aus dem Browser.
// Lesen, Schreiben und Verschlüsselung übernimmt die offizielle Bibliothek des LiveSync-Autors
// (@vrtmrz/livesync-commonlib, MIT) – das Datenformat wird hier NICHT nachgebaut.
// Dieses Modul wird erst beim Verbinden nachgeladen (eigener Chunk).
import { DirectFileManipulator, type DirectFileManipulatorOptions } from '@vrtmrz/livesync-commonlib';
import { decodeSettingsFromSetupURI } from '@vrtmrz/livesync-commonlib/setup-uri';
import { readAsBlob } from '@vrtmrz/livesync-commonlib/compat/common/utils';
import { ConnectionStringParser } from '@vrtmrz/livesync-commonlib/compat/common/ConnectionString';
import { initialiseWorkerModule } from '@vrtmrz/livesync-commonlib/compat/worker/bgWorker';
import { createLiveSyncEventHub } from '@vrtmrz/livesync-commonlib/context';
import { AuthError, type ChangeEvent, type VaultAdapter, type VaultFile } from './types';
import { TEXT_EXT, extname } from '../vault/paths';

// Verschlüsselung und Chunk-Aufteilung laufen in Web Workern der Bibliothek; einmalig starten.
// Nach einem fehlgeschlagenen Versuch (z.B. falsche Passphrase) werden die Worker neu gestartet,
// damit kein Zustand des Fehlversuchs in spätere Vorgänge hineinwirkt.
let workersStarted = false;
function ensureWorkers() {
  if (workersStarted) return;
  initialiseWorkerModule(createLiveSyncEventHub()); // beendet vorhandene Worker selbst
  workersStarted = true;
}
function resetWorkers() {
  workersStarted = false;
}

/**
 * Verbindung vollständig schließen. `DirectFileManipulator.close()` (commonlib 0.3.1) beendet den
 * internen Live-Änderungskanal nicht, wenn – wie hier – kein Host-Aufräum-Haken registriert ist.
 * Darum werden die Manager vorher selbst heruntergefahren (abgesichert, falls sich das intern ändert).
 */
async function shutdown(man: DirectFileManipulator) {
  try {
    man.endWatch();
  } catch {
    /* egal */
  }
  try {
    // Änderungskanal und Chunk-Abrufer der Manager beenden (sonst laufen sie nach close() weiter)
    const managers = (man.liveSyncLocalDB as unknown as { _managers?: { teardownManagers?: () => Promise<void> } })._managers;
    await managers?.teardownManagers?.();
  } catch {
    /* egal */
  }
  await man.close().catch(() => {});
}

/** Prüft Erreichbarkeit, Zugangsdaten und Datenbank direkt per HTTP – für klare Fehlermeldungen */
async function checkDatabase(cfg: LiveSyncConfig) {
  const url = `${cfg.url.replace(/\/+$/, '')}/${encodeURIComponent(cfg.database)}`;
  let r: Response;
  try {
    r = await fetch(url, { headers: { Authorization: `Basic ${btoa(unescape(encodeURIComponent(`${cfg.username}:${cfg.password}`)))}` } });
  } catch {
    throw new Error(
      `CouchDB nicht erreichbar oder blockiert. Prüfe die Adresse und ob in CouchDB unter CORS „${location.origin}“ erlaubt ist (siehe Anleitung).`,
    );
  }
  if (r.status === 401 || r.status === 403) throw new AuthError('CouchDB: Benutzername oder Passwort falsch.');
  if (r.status === 404) throw new Error(`CouchDB: Die Datenbank „${cfg.database}“ gibt es nicht. Datenbanknamen prüfen.`);
  if (!r.ok) throw new Error(`CouchDB antwortet mit HTTP ${r.status}.`);
}

/** Von LiveSync (Obsidian-Plugin) angelegtes Dokument mit den Vault-weiten Einstellungen */
const MILESTONE_ID = '_local/obsydian_livesync_milestone';
const PREFERRED_TWEAKS = 'PREFERRED';
const RECOVERY_PREFIX = 'sls-id-v1:';

export interface LiveSyncConfig {
  url: string;
  database: string;
  username: string;
  password: string;
  /** Ende-zu-Ende-Passphrase (leer, wenn die Datenbank unverschlüsselt ist) */
  passphrase: string;
  /** ID-Schlüssel bzw. Wiederherstellungscode („sls-id-v1:…“), nur bei neueren Vaults nötig */
  idDerivationKey?: string;
  /** Einstellungen des Geräts aus der Setup-URI (die Datenbank hat Vorrang) */
  settings?: Record<string, unknown>;
}

/** Einstellungen, die in der Datenbank für alle Geräte gleich sein müssen (vom Plugin hinterlegt) */
const TWEAK_KEYS = [
  'customChunkSize',
  'minimumChunkSize',
  'hashAlg',
  'useEden',
  'maxChunksInEden',
  'maxTotalLengthInEden',
  'maxAgeInEden',
  'enableCompression',
  'useDynamicIterationCount',
  'enableChunkSplitterV2',
  'chunkSplitterVersion',
  'E2EEAlgorithm',
  'handleFilenameCaseSensitive',
  'idDerivationVersion',
  'encryptInternalMetadata',
  'pathNormalizationVersion',
] as const;

type Tweaks = Partial<Record<(typeof TWEAK_KEYS)[number] | 'encrypt' | 'usePathObfuscation', unknown>>;

/** Liest eine Setup-URI aus dem LiveSync-Plugin („Copy setup URI“) */
export async function configFromSetupURI(uri: string, setupPassphrase: string): Promise<LiveSyncConfig> {
  let s: Record<string, unknown>;
  try {
    s = (await decodeSettingsFromSetupURI(uri.trim(), setupPassphrase)) as unknown as Record<string, unknown>;
  } catch {
    s = {};
  }
  if (!s || typeof s !== 'object' || Object.keys(s).length === 0) {
    throw new Error('Setup-URI konnte nicht geöffnet werden. Passwort der Setup-URI prüfen (nicht die E2EE-Passphrase) – oder die URI ist abgelaufen.');
  }
  let url = String(s.couchDB_URI ?? '');
  let database = String(s.couchDB_DBNAME ?? '');
  let username = String(s.couchDB_USER ?? '');
  let password = String(s.couchDB_PASSWORD ?? '');
  // Neuere Versionen: Verbindung als Connection-String in remoteConfigurations
  const remotes = s.remoteConfigurations as Record<string, { uri?: string; isEncrypted?: boolean }> | undefined;
  if (!url && remotes) {
    const active = remotes[String(s.activeConfigurationId ?? '')] ?? Object.values(remotes)[0];
    if (active?.uri && !active.isEncrypted) {
      const parsed = ConnectionStringParser.parse(active.uri);
      if (parsed.type !== 'couchdb') throw new Error(`Diese Setup-URI nutzt „${parsed.type}“ statt CouchDB – das wird (noch) nicht unterstützt.`);
      const c = parsed.settings as unknown as Record<string, string>;
      url = c.couchDB_URI ?? url;
      database = c.couchDB_DBNAME ?? database;
      username = c.couchDB_USER ?? username;
      password = c.couchDB_PASSWORD ?? password;
    }
  }
  if (!url || !database) throw new Error('In der Setup-URI fehlt die CouchDB-Verbindung.');
  const settings: Record<string, unknown> = {};
  for (const k of [...TWEAK_KEYS, 'encrypt', 'usePathObfuscation']) if (s[k] !== undefined && s[k] !== '') settings[k] = s[k];
  // Der Decoder setzt idDerivationVersion: 0 als Platzhalter, wenn die URI keinen Schlüssel enthält
  // (LiveSync lässt verschlüsselt gespeicherte Schlüssel weg). Dann entscheidet die Datenbank bzw. der eingegebene Code.
  if (!s.idDerivationKey) delete settings.idDerivationVersion;
  return {
    settings,
    url,
    database,
    username,
    password,
    passphrase: s.encrypt === false ? '' : String(s.passphrase ?? ''),
    idDerivationKey: String(s.idDerivationKey ?? '') || undefined,
  };
}

/** Wiederherstellungscode oder Hex-Schlüssel → 64-stelliger Hex-Schlüssel (streng geprüft) */
export function normalizeIdKey(input: string | undefined): string | undefined {
  const v = (input ?? '').trim();
  if (!v) return undefined;
  const hex = (v.startsWith(RECOVERY_PREFIX) ? v.slice(RECOVERY_PREFIX.length) : v).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error('Der ID-Schlüssel ist ungültig. Bitte den Wiederherstellungscode aus LiveSync („Show current recovery code“) vollständig einfügen.');
  }
  return hex;
}

/** Baut die Verbindungsoptionen aus Zugangsdaten + den in der Datenbank hinterlegten Einstellungen */
export function buildOptions(cfg: LiveSyncConfig, tweaks: Tweaks | undefined): DirectFileManipulatorOptions {
  const t: Tweaks = { ...(cfg.settings as Tweaks | undefined), ...(tweaks ?? {}) };
  const encrypted = t.encrypt === undefined ? Boolean(cfg.passphrase) : Boolean(t.encrypt);
  if (encrypted && !cfg.passphrase) {
    throw new Error('Dieser Vault ist Ende-zu-Ende-verschlüsselt. Bitte die E2EE-Passphrase aus LiveSync angeben.');
  }
  const idKey = normalizeIdKey(cfg.idDerivationKey);
  if (t.idDerivationVersion === 1 && !idKey) {
    throw new Error(ID_KEY_HINT);
  }
  const obfuscate = t.usePathObfuscation === undefined ? encrypted : Boolean(t.usePathObfuscation);
  const opts: DirectFileManipulatorOptions = {
    url: cfg.url.replace(/\/+$/, ''),
    database: cfg.database,
    username: cfg.username,
    password: cfg.password,
    passphrase: encrypted ? cfg.passphrase : undefined,
    obfuscatePassphrase: encrypted && obfuscate ? cfg.passphrase : undefined,
    idDerivationKey: idKey,
  };
  const target = opts as unknown as Record<string, unknown>;
  for (const k of TWEAK_KEYS) if (t[k] !== undefined) target[k] = t[k];
  // Mit Schlüssel und ohne andere Vorgabe: ID-Ableitung Version 1 (die Bibliothek nähme sonst 0 und ignorierte den Schlüssel)
  if (idKey && t.idDerivationVersion === undefined) target.idDerivationVersion = 1;
  return opts;
}

function pickTweaks(milestone: unknown): Tweaks | undefined {
  if (!milestone || typeof milestone !== 'object') return undefined;
  const values = (milestone as { tweak_values?: Record<string, Tweaks> }).tweak_values;
  if (!values || typeof values !== 'object') return undefined;
  return values[PREFERRED_TWEAKS] ?? Object.values(values)[0];
}

const PATH_HINT =
  'Die Pfad-Einstellungen passen nicht zu dieser Datenbank. Bitte die Setup-URI aus einem Gerät verwenden, das mit diesem Vault synchronisiert.';

function isPathIdentityError(e: unknown) {
  return /path identity/i.test(String((e as Error)?.message ?? ''));
}

const ID_KEY_HINT =
  'Dieser Vault nutzt einen ID-Schlüssel, der fehlt oder nicht passt. Bitte den Wiederherstellungscode aus LiveSync angeben (Remote Configuration → Configure E2EE → „Show current recovery code“).';

const DECRYPT_HINT = 'Die Notizen lassen sich nicht entschlüsseln. E2EE-Passphrase (und ggf. ID-Schlüssel) prüfen.';

/** Web Crypto meldet eine falsche Passphrase als DOMException „OperationError“ ohne Text */
function isDecryptError(e: unknown) {
  const name = (e as { name?: string })?.name ?? '';
  const msg = String((e as Error)?.message ?? '');
  return name === 'OperationError' || /decrypt|passphrase|Could not decrypt/i.test(msg);
}

function friendlyError(e: unknown): Error {
  if (isDecryptError(e)) return new Error(DECRYPT_HINT);
  if (/do not match the configured ID key|ID key/i.test(String((e as Error)?.message ?? ''))) return new Error(ID_KEY_HINT);
  const msg = String((e as Error)?.message ?? e);
  const status = (e as { status?: number })?.status;
  if (status === 401 || /unauthorized|name or password/i.test(msg)) return new AuthError('CouchDB: Benutzername oder Passwort falsch.');
  if (status === 404 || /not_found|no_db_file|Database does not exist/i.test(msg)) return new Error('CouchDB: Diese Datenbank gibt es nicht. Datenbanknamen prüfen.');
  if (/Failed to fetch|NetworkError|Load failed|fetch failed|ERR_/i.test(msg)) {
    return new Error(
      `CouchDB nicht erreichbar oder blockiert. Prüfe die Adresse und ob in CouchDB unter CORS „${location.origin}“ erlaubt ist (siehe Anleitung).`,
    );
  }
  return e instanceof Error ? e : new Error(msg);
}

export class LiveSyncAdapter implements VaultAdapter {
  readonly kind = 'livesync';
  readonly readOnly = false;
  readonly ephemeral = true;
  readonly name: string;
  private folders = new Set<string>();
  /** zuletzt selbst geschriebene Inhalte (zum Unterdrücken eigener Änderungs-Events) */
  private ownWrites = new Map<string, number>();

  private constructor(
    private man: DirectFileManipulator,
    readonly config: LiveSyncConfig,
  ) {
    this.name = config.database;
  }

  /** Verbindet sich, übernimmt die Vault-Einstellungen aus der Datenbank und prüft Passphrase/Schlüssel. */
  static async connect(cfg: LiveSyncConfig): Promise<LiveSyncAdapter> {
    if (!/^https?:\/\//i.test(cfg.url)) cfg = { ...cfg, url: `https://${cfg.url.trim()}` };
    await checkDatabase(cfg);
    ensureWorkers();
    try {
      return await LiveSyncAdapter.attempt(cfg, undefined);
    } catch (e) {
      if (!isPathIdentityError(e)) throw e;
      // Die Datenbank gibt die Pfad-Identität (Unicode-Normalisierung) vor. Die Bibliothek prüft beim
      // zweiten Versuch erneut, dass die Einstellung zur Datenbank passt – geschrieben wurde bis hier nichts.
      const tried = (e as { triedPathVersion?: 0 | 1 }).triedPathVersion ?? 0;
      try {
        return await LiveSyncAdapter.attempt(cfg, tried === 1 ? 0 : 1);
      } catch (e2) {
        if (isPathIdentityError(e2)) throw new Error(PATH_HINT);
        throw e2;
      }
    }
  }

  private static async attempt(cfg: LiveSyncConfig, pathVersion: 0 | 1 | undefined): Promise<LiveSyncAdapter> {
    const override: Tweaks = pathVersion === undefined ? {} : { pathNormalizationVersion: pathVersion };
    const effective = (pathVersion ?? (cfg.settings?.pathNormalizationVersion as 0 | 1 | undefined) ?? 0) as 0 | 1;
    const tag = (e: unknown) => {
      const err = friendlyError(e);
      (err as { triedPathVersion?: 0 | 1 }).triedPathVersion = effective;
      return err;
    };
    const probe = new DirectFileManipulator(buildOptions(cfg, override));
    let milestone: unknown;
    try {
      await probe.ready.promise;
      milestone = await probe.rawGet(MILESTONE_ID as never);
    } catch (e) {
      await shutdown(probe);
      resetWorkers();
      throw tag(e);
    }
    await shutdown(probe);
    if (!milestone) {
      throw new Error('Diese Datenbank wurde noch nicht von Self-hosted LiveSync eingerichtet. Bitte zuerst in Obsidian mit LiveSync verbinden.');
    }
    // Hinweis zu "locked": LiveSync markiert die Datenbank nach einem Rebuild dauerhaft als gesperrt und
    // führt eine Liste freigegebener Geräte. Gesperrt ist sie nur für Geräte mit einer veralteten LOKALEN
    // Kopie, die alte Stände zurückspielen könnten. Der Vault Browser hat keine lokale Kopie – er liest und
    // schreibt immer direkt den aktuellen Stand – und ist davon daher nicht betroffen.
    const opts = buildOptions(cfg, { ...pickTweaks(milestone), ...override });
    const man = new DirectFileManipulator(opts);
    const adapter = new LiveSyncAdapter(man, cfg);
    try {
      await man.ready.promise;
      // Passphrase prüfen: mindestens eine Datei muss sich lesen lassen
      await adapter.verifyPassphrase();
    } catch (e) {
      await shutdown(man);
      resetWorkers();
      throw tag(e);
    }
    return adapter;
  }

  private async verifyPassphrase() {
    for await (const doc of this.man.enumerateAllNormalDocs({ metaOnly: true })) {
      const d = doc as { path: string; deleted?: boolean; _deleted?: boolean };
      if (d.deleted || d._deleted) continue;
      const e = await this.man.get(d.path as never);
      if (!e) throw new Error(DECRYPT_HINT);
      return;
    }
  }

  private visible(path: string) {
    return path && !path.startsWith('.') && !path.includes(':') && !path.split('/').some((s) => s === '.obsidian' || s === '.trash');
  }

  async list(): Promise<VaultFile[]> {
    const out: VaultFile[] = [];
    const folders = new Set(this.folders);
    try {
      for await (const doc of this.man.enumerateAllNormalDocs({ metaOnly: true })) {
        const d = doc as { path: string; deleted?: boolean; _deleted?: boolean; mtime?: number; size?: number };
        if (d.deleted || d._deleted || !this.visible(d.path)) continue;
        out.push({ path: d.path, type: 'file', mtime: d.mtime, size: d.size });
        const parts = d.path.split('/');
        for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
      }
    } catch (e) {
      throw friendlyError(e);
    }
    for (const f of folders) out.push({ path: f, type: 'folder' });
    return out;
  }

  private async entry(path: string) {
    let e;
    try {
      e = await this.man.get(path as never);
    } catch (err) {
      throw friendlyError(err);
    }
    if (!e || (e as { deleted?: boolean }).deleted) throw new Error('Datei nicht gefunden');
    return e;
  }

  async read(path: string): Promise<string> {
    return (await this.readBinary(path)).text();
  }

  async readBinary(path: string): Promise<Blob> {
    return readAsBlob((await this.entry(path)) as never);
  }

  async write(path: string, content: string | Blob): Promise<void> {
    const now = Date.now();
    const isText = typeof content === 'string';
    const blob = isText
      ? new Blob([content], { type: 'text/plain' })
      : TEXT_EXT.has(extname(path))
        ? new Blob([await content.text()], { type: 'text/plain' })
        : content;
    let ctime = now;
    try {
      const old = await this.man.get(path as never, true);
      if (old && !(old as { deleted?: boolean }).deleted) ctime = (old as { ctime?: number }).ctime ?? now;
    } catch {
      /* neu */
    }
    this.ownWrites.set(path, now);
    let ok: boolean;
    try {
      ok = await this.man.put(path, blob, { ctime, mtime: now, size: blob.size });
    } catch (e) {
      throw friendlyError(e);
    }
    if (!ok) throw new Error(`Speichern von „${path}“ fehlgeschlagen.`);
  }

  async mkdir(path: string) {
    // LiveSync kennt keine leeren Ordner – er entsteht mit der ersten Datei darin.
    this.folders.add(path);
  }

  private async filesUnder(path: string) {
    const all = await this.list();
    const isFolder = all.some((f) => f.type === 'folder' && f.path === path);
    return isFolder ? all.filter((f) => f.type === 'file' && f.path.startsWith(`${path}/`)).map((f) => f.path) : null;
  }

  async rename(from: string, to: string) {
    const children = await this.filesUnder(from);
    const pairs = children ? children.map((c) => [c, to + c.slice(from.length)] as const) : [[from, to] as const];
    for (const [a, b] of pairs) {
      const blob = await this.readBinary(a);
      await this.write(b, TEXT_EXT.has(extname(a)) ? await blob.text() : blob);
      await this.remove(a);
    }
    if (this.folders.delete(from)) this.folders.add(to);
  }

  private async remove(path: string) {
    this.ownWrites.set(path, Date.now());
    let ok: boolean;
    try {
      ok = await this.man.delete(path);
    } catch (e) {
      throw friendlyError(e);
    }
    if (!ok) throw new Error(`Löschen von „${path}“ fehlgeschlagen.`);
  }

  /** Löschen wie in LiveSync (als gelöscht markiert, auf allen Geräten entfernt) */
  async delete(path: string) {
    const children = await this.filesUnder(path);
    for (const f of children ?? [path]) await this.remove(f);
    this.folders.delete(path);
  }

  watch(cb: (e: ChangeEvent) => void): () => void {
    // Nur Änderungen ab jetzt verfolgen – die Dateiliste ist beim Verbinden schon aktuell.
    this.man.since = 'now';
    this.man.beginWatch(async (doc) => {
      const d = doc as { path: string; deleted?: boolean; _deleted?: boolean; mtime?: number };
      if (!this.visible(d.path)) return;
      const own = this.ownWrites.get(d.path);
      if (own && Date.now() - own < 5000) return;
      cb({ event: d.deleted || d._deleted ? 'unlink' : 'change', path: d.path });
    });
    return () => this.man.endWatch();
  }

  close() {
    void shutdown(this.man);
  }
}
