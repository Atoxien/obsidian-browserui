import { describe, expect, it } from 'vitest';
import { VaultIndex, extractLinks } from '../src/vault/index';

function makeIndex() {
  const idx = new VaultIndex();
  const files = ['Start.md', 'Projekte/Alpha.md', 'Archiv/Alpha.md', 'Projekte/Beta.md', 'Bilder/logo.png', 'Notiz mit Leerzeichen.md'];
  idx.setFiles([
    ...files.map((path) => ({ path, type: 'file' as const })),
    ...['Projekte', 'Archiv', 'Bilder'].map((path) => ({ path, type: 'folder' as const })),
  ]);
  idx.setContent('Start.md', '# Start\n[[Beta]] und [[Alpha]] ![[logo.png]] #home\n[md](Projekte/Beta.md)');
  idx.setContent('Projekte/Beta.md', '---\naliases: [B]\ntags: [projekt]\n---\nSiehe [[Start#Start|zurück]]. Start erwähnt.');
  idx.setContent('Projekte/Alpha.md', '`[[Nicht]]` \n```\n[[AuchNicht]]\n```');
  return idx;
}

describe('VaultIndex', () => {
  it('löst Links wie Obsidian auf', () => {
    const idx = makeIndex();
    expect(idx.resolve('Beta')).toBe('Projekte/Beta.md');
    expect(idx.resolve('logo.png')).toBe('Bilder/logo.png');
    expect(idx.resolve('Archiv/Alpha')).toBe('Archiv/Alpha.md');
    expect(idx.resolve('Alpha', 'Projekte/Beta.md')).toBe('Projekte/Alpha.md');
    expect(idx.resolve('beta')).toBe('Projekte/Beta.md');
    expect(idx.resolve('B')).toBe('Projekte/Beta.md');
    expect(idx.resolve('Gibtsnicht')).toBeNull();
    expect(idx.resolve('Notiz mit Leerzeichen')).toBe('Notiz mit Leerzeichen.md');
  });

  it('ignoriert Links in Code', () => {
    expect(extractLinks('`[[Nicht]]`\n```\n[[AuchNicht]]\n```\n[[Ja]]').map((l) => l.target)).toEqual(['Ja']);
  });

  it('Backlinks und unverlinkte Erwähnungen', () => {
    const idx = makeIndex();
    const bl = idx.backlinks('Projekte/Beta.md');
    expect(bl.map((b) => b.source)).toEqual(['Start.md']);
    expect(bl[0].links).toHaveLength(2);
    expect(idx.backlinks('Start.md').map((b) => b.source)).toEqual(['Projekte/Beta.md']);
    expect(idx.unlinkedMentions('Start.md').map((m) => m.source)).toEqual(['Projekte/Beta.md']);
  });

  it('Tags inkl. Frontmatter', () => {
    const tags = makeIndex().allTags();
    expect(tags.get('home')).toBe(1);
    expect(tags.get('projekt')).toBe(1);
  });

  it('Suche mit Operatoren', () => {
    const idx = makeIndex();
    expect(idx.search('zurück').map((h) => h.path)).toEqual(['Projekte/Beta.md']);
    expect(idx.search('tag:#projekt').map((h) => h.path)).toEqual(['Projekte/Beta.md']);
    expect(idx.search('path:projekte start').map((h) => h.path)).toEqual(['Projekte/Beta.md']);
    expect(idx.search('start -zurück').map((h) => h.path)).toEqual(['Start.md']);
  });

  it('schreibt Links beim Umbenennen um', () => {
    const idx = makeIndex();
    const changed = idx.rewriteLinks('Projekte/Beta.md', 'Projekte/Gamma.md');
    expect(changed.get('Start.md')).toBe('# Start\n[[Gamma]] und [[Alpha]] ![[logo.png]] #home\n[md](Projekte/Gamma.md)');
    const c2 = idx.rewriteLinks('Start.md', 'Home.md');
    expect(c2.get('Projekte/Beta.md')).toContain('[[Home#Start|zurück]]');
  });
});
