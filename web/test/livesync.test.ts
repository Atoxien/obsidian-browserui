// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Atoxien
import { describe, expect, it } from 'vitest';
import { encodeSettingsToSetupURI } from '@vrtmrz/livesync-commonlib/setup-uri';
import { ConnectionStringParser } from '@vrtmrz/livesync-commonlib/compat/common/ConnectionString';
import { buildOptions, configFromSetupURI, normalizeIdKey, type LiveSyncConfig } from '../src/adapters/livesync';

const HEX = 'ab'.repeat(32);
const base: LiveSyncConfig = { url: 'https://couch.example.com/', database: 'obsidian', username: 'u', password: 'p', passphrase: 'geheim' };

describe('ID-Schlüssel', () => {
  it('akzeptiert Wiederherstellungscode und reinen Hex-Schlüssel', () => {
    expect(normalizeIdKey(`sls-id-v1:${HEX.toUpperCase()}`)).toBe(HEX);
    expect(normalizeIdKey(`  ${HEX} `)).toBe(HEX);
    expect(normalizeIdKey('')).toBeUndefined();
    expect(normalizeIdKey(undefined)).toBeUndefined();
  });
  it('lehnt alles andere ab (keine Ableitung aus beliebigem Text)', () => {
    expect(() => normalizeIdKey('sls-id-v1:abc')).toThrow('ungültig');
    expect(() => normalizeIdKey('mein passwort')).toThrow('ungültig');
  });
});

describe('Optionen aus Datenbank-Einstellungen', () => {
  it('übernimmt die vom Plugin hinterlegten Einstellungen', () => {
    const o = buildOptions(base, {
      encrypt: true,
      usePathObfuscation: true,
      E2EEAlgorithm: 'v2',
      chunkSplitterVersion: 'v3-rabin-karp',
      hashAlg: 'xxhash64',
      customChunkSize: 60,
      useDynamicIterationCount: false,
    }) as unknown as Record<string, unknown>;
    expect(o.url).toBe('https://couch.example.com');
    expect(o.passphrase).toBe('geheim');
    expect(o.obfuscatePassphrase).toBe('geheim');
    expect(o.E2EEAlgorithm).toBe('v2');
    expect(o.chunkSplitterVersion).toBe('v3-rabin-karp');
    expect(o.customChunkSize).toBe(60);
    expect(o.useDynamicIterationCount).toBe(false);
  });
  it('verschlüsselt nicht, wenn die Datenbank unverschlüsselt ist', () => {
    const o = buildOptions(base, { encrypt: false, usePathObfuscation: false });
    expect(o.passphrase).toBeUndefined();
    expect(o.obfuscatePassphrase).toBeUndefined();
  });
  it('Verschlüsselung ohne Pfad-Verschleierung', () => {
    const o = buildOptions(base, { encrypt: true, usePathObfuscation: false });
    expect(o.passphrase).toBe('geheim');
    expect(o.obfuscatePassphrase).toBeUndefined();
  });
  it('verlangt Passphrase und ID-Schlüssel, wenn die Datenbank sie braucht', () => {
    expect(() => buildOptions({ ...base, passphrase: '' }, { encrypt: true })).toThrow('E2EE-Passphrase');
    expect(() => buildOptions(base, { encrypt: true, idDerivationVersion: 1 })).toThrow('Wiederherstellungscode');
    const o = buildOptions({ ...base, idDerivationKey: `sls-id-v1:${HEX}` }, { encrypt: true, idDerivationVersion: 1 }) as unknown as Record<string, unknown>;
    expect(o.idDerivationKey).toBe(HEX);
    expect(o.idDerivationVersion).toBe(1);
    // Schlüssel ohne Vorgabe der Datenbank -> Version 1, sonst würde er ignoriert
    expect((buildOptions({ ...base, idDerivationKey: HEX }, {}) as unknown as Record<string, unknown>).idDerivationVersion).toBe(1);
    expect((buildOptions(base, {}) as unknown as Record<string, unknown>).idDerivationVersion).toBeUndefined();
  });
});

describe('Setup-URI', () => {
  const settings = {
    couchDB_URI: 'https://couch.example.com',
    couchDB_USER: 'admin',
    couchDB_PASSWORD: 'pw',
    couchDB_DBNAME: 'vault',
    encrypt: true,
    passphrase: 'e2ee',
    usePathObfuscation: true,
  };
  it('liest eine Setup-URI des Plugins', async () => {
    const uri = await encodeSettingsToSetupURI(settings as never, 'setup-pw');
    const cfg = await configFromSetupURI(uri, 'setup-pw');
    expect(cfg).toMatchObject({ url: 'https://couch.example.com', database: 'vault', username: 'admin', password: 'pw', passphrase: 'e2ee' });
  });
  it('übernimmt Geräte-Einstellungen wie die Pfad-Identität aus der Setup-URI', async () => {
    const uri = await encodeSettingsToSetupURI({ ...settings, pathNormalizationVersion: 1, E2EEAlgorithm: 'v2' } as never, 'setup-pw');
    const cfg = await configFromSetupURI(uri, 'setup-pw');
    expect(cfg.settings).toMatchObject({ pathNormalizationVersion: 1, E2EEAlgorithm: 'v2', encrypt: true });
    const o = buildOptions(cfg, undefined) as unknown as Record<string, unknown>;
    expect(o.pathNormalizationVersion).toBe(1);
    // Die Datenbank hat Vorrang vor der Setup-URI
    const o2 = buildOptions(cfg, { pathNormalizationVersion: 0 }) as unknown as Record<string, unknown>;
    expect(o2.pathNormalizationVersion).toBe(0);
  });
  it('Setup-URI ohne ID-Schlüssel legt die ID-Version nicht fest', async () => {
    const uri = await encodeSettingsToSetupURI(settings as never, 'setup-pw');
    const cfg = await configFromSetupURI(uri, 'setup-pw');
    expect(cfg.settings?.idDerivationVersion).toBeUndefined();
    expect((buildOptions({ ...cfg, idDerivationKey: HEX }, undefined) as unknown as Record<string, unknown>).idDerivationVersion).toBe(1);
  });
  it('meldet ein falsches Setup-Passwort verständlich', async () => {
    const uri = await encodeSettingsToSetupURI(settings as never, 'setup-pw');
    await expect(configFromSetupURI(uri, 'falsch')).rejects.toThrow('Setup-URI konnte nicht geöffnet werden');
  });
  it('versteht das neuere Format mit Connection-String', async () => {
    const connection = ConnectionStringParser.serialize({
      type: 'couchdb',
      settings: { couchDB_URI: 'https://neu.example.com', couchDB_USER: 'neu', couchDB_PASSWORD: 'npw', couchDB_DBNAME: 'ndb' } as never,
    });
    const uri = await encodeSettingsToSetupURI(
      { encrypt: true, passphrase: 'e2ee', activeConfigurationId: 'a', remoteConfigurations: { a: { id: 'a', name: 'A', uri: connection, isEncrypted: false } } } as never,
      'setup-pw',
    );
    const cfg = await configFromSetupURI(uri, 'setup-pw');
    expect(cfg).toMatchObject({ url: 'https://neu.example.com', database: 'ndb', username: 'neu', password: 'npw', passphrase: 'e2ee' });
  });
});
