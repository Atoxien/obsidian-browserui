import { describe, expect, it } from 'vitest';
import { DEMO_KEY, DEMO_TTL_MS, DemoAdapter, demoSeed } from '../src/adapters/demo';

/** Minimaler Storage-Ersatz (sessionStorage) */
class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

const seed = [
  { path: 'Start.md', text: '# Start' },
  { path: 'Ordner/Notiz.md', text: 'Notiz' },
  { path: 'Bilder/a.svg', dataUrl: 'data:image/svg+xml,%3Csvg%2F%3E' },
  { path: '.obsidian/app.json', text: '{}' },
];

describe('DemoAdapter', () => {
  it('liefert den Beispiel-Vault und blendet .obsidian aus, liest aber Konfiguration', async () => {
    const d = new DemoAdapter(seed, new MemStorage());
    const paths = (await d.list()).map((f) => f.path).sort();
    expect(paths).toEqual(['Bilder', 'Bilder/a.svg', 'Ordner', 'Ordner/Notiz.md', 'Start.md']);
    expect(await d.read('.obsidian/app.json')).toBe('{}');
    expect(await (await d.readBinary('Bilder/a.svg')).text()).toBe('<svg/>');
  });

  it('schreibt, benennt um, löscht – auch Binärdateien', async () => {
    const st = new MemStorage();
    const d = new DemoAdapter(seed, st);
    await d.write('Neu.md', 'hallo');
    await d.write('Bilder/b.bin', new Blob([new Uint8Array([1, 2, 3])]));
    expect([...new Uint8Array(await (await d.readBinary('Bilder/b.bin')).arrayBuffer())]).toEqual([1, 2, 3]);
    await d.rename('Ordner', 'Umbenannt');
    expect(await d.read('Umbenannt/Notiz.md')).toBe('Notiz');
    await expect(d.read('Ordner/Notiz.md')).rejects.toThrow();
    await expect(d.rename('Neu.md', 'Start.md')).rejects.toThrow('existiert');
    await d.delete('Umbenannt');
    expect((await d.list()).map((f) => f.path)).not.toContain('Umbenannt/Notiz.md');
    await expect(d.write('../x.md', 'x')).rejects.toThrow('Ungültig');
    // Zustand überlebt "Neuladen" im selben Tab
    const again = new DemoAdapter(seed, st);
    expect(await again.read('Neu.md')).toBe('hallo');
  });

  it('setzt sich nach 4 Stunden zurück', async () => {
    const st = new MemStorage();
    let now = 1_000_000;
    const d = new DemoAdapter(seed, st, () => now);
    await d.write('Privat.md', 'geheim');
    now += DEMO_TTL_MS - 1;
    expect(d.expired).toBe(false);
    expect(DemoAdapter.hasSession(st, now)).toBe(true);
    now += 1;
    expect(d.expired).toBe(true);
    expect(DemoAdapter.hasSession(st, now)).toBe(false);
    st.setItem('obui.session.demo.Demo-Vault', '{"tabs":[{"path":"Privat.md"}]}');
    DemoAdapter.purgeExpired(st, now);
    expect(st.getItem(DEMO_KEY)).toBeNull();
    expect(st.getItem('obui.session.demo.Demo-Vault')).toBeNull();
    const after = new DemoAdapter(seed, st, () => now);
    expect((await after.list()).map((f) => f.path)).not.toContain('Privat.md');
    expect(after.expired).toBe(false);
  });

  it('Zurücksetzen entfernt nur Demo-Schlüssel', async () => {
    const st = new MemStorage();
    st.setItem('obui.remote', 'eigener-server');
    st.setItem('obui.session.demo.Demo-Vault', '{"tabs":[]}');
    const d = new DemoAdapter(seed, st);
    await d.write('Privat.md', 'x');
    d.reset();
    expect(st.getItem('obui.remote')).toBe('eigener-server');
    expect(st.getItem('obui.session.demo.Demo-Vault')).toBeNull();
    expect(JSON.parse(st.getItem(DEMO_KEY)!).files['Privat.md']).toBeUndefined();
  });

  it('meldet vollen Speicher verständlich und behält den alten Stand', async () => {
    const st = new MemStorage();
    const d = new DemoAdapter(seed, st);
    const orig = st.setItem.bind(st);
    st.setItem = (k, v) => {
      if (v.length > 2000) throw new DOMException('voll', 'QuotaExceededError');
      orig(k, v);
    };
    await expect(d.write('Groß.md', 'x'.repeat(5000))).rejects.toThrow('Demo-Speicher ist voll');
    await expect(d.read('Groß.md')).rejects.toThrow();
  });

  it('bettet den Beispiel-Vault beim Build ein', () => {
    const paths = demoSeed().map((f) => f.path);
    expect(paths).toContain('Willkommen.md');
    expect(paths).toContain('.obsidian/daily-notes.json');
    expect(paths).toContain('Anhänge/diagramm.svg');
  });
});
