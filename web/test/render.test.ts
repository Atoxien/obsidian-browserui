import { describe, expect, it } from 'vitest';
import { renderMarkdown, stripComments } from '../src/markdown/render';

const html = (s: string) => renderMarkdown(s).html;

describe('Obsidian-Markdown', () => {
  it('Wikilinks mit Alias und Überschrift', () => {
    expect(html('[[Note]]')).toContain('<a class="internal-link" data-href="Note" href="#">Note</a>');
    expect(html('[[Note|Anzeige]]')).toContain('data-href="Note" href="#">Anzeige</a>');
    expect(html('[[Note#Kapitel 1]]')).toContain('data-href="Note#Kapitel 1" href="#">Note &gt; Kapitel 1</a>');
  });

  it('Embeds', () => {
    expect(html('![[bild.png|300]]')).toContain('class="internal-embed" data-src="bild.png" data-subpath="" data-alias="300"');
    expect(html('![](attachments/a%20b.png)')).toContain('data-src="attachments/a b.png"');
    expect(html('![x](https://example.com/a.png)')).toContain('<img src="https://example.com/a.png"');
  });

  it('Tags, aber keine Überschriften oder URL-Anker', () => {
    expect(html('Text #projekt/alpha und #2024')).toContain('data-tag="projekt/alpha"');
    expect(html('Text #projekt/alpha und #2024')).not.toContain('data-tag="2024"');
    expect(html('# Überschrift')).toContain('<h1');
    expect(html('a#b')).not.toContain('class="tag"');
  });

  it('Highlights und Kommentare', () => {
    expect(html('Das ist ==wichtig== hier')).toContain('<mark>wichtig</mark>');
    expect(html('sichtbar %%geheim%% ende')).not.toContain('geheim');
    expect(stripComments('```\n%%bleibt%%\n```')).toContain('%%bleibt%%');
  });

  it('Callouts inkl. Faltbar', () => {
    const out = html('> [!warning] Achtung\n> Inhalt');
    expect(out).toContain('<div class="callout" data-callout="warning">');
    expect(out).toContain('Achtung');
    expect(out).toContain('<p>Inhalt</p>');
    const fold = html('> [!faq]- Frage?\n> Antwort');
    expect(fold).toContain('<details class="callout" data-callout="question">');
    expect(html('> [!note]')).toContain('Note</span>');
    expect(html('> normales Zitat')).toContain('<blockquote>');
  });

  it('Aufgaben mit Zeilennummer (inkl. Frontmatter-Versatz)', () => {
    const out = html('---\ntags: [a]\n---\n- [ ] offen\n- [x] erledigt');
    expect(out).toMatch(/data-line="3"[^>]*>|data-line="3"/);
    expect(out).toContain('<input type="checkbox" class="task-list-item-checkbox"> offen');
    expect(out).toContain('checked> erledigt');
  });

  it('Mathe', () => {
    expect(html('$a^2$')).toContain('katex');
    expect(html('$$\nx=1\n$$')).toContain('math-block');
    expect(html('Kostet $5 und $10')).not.toContain('katex');
  });

  it('Frontmatter wird nicht als Text gerendert', () => {
    const r = renderMarkdown('---\ntitle: Hallo\ntags:\n  - x\n---\nText');
    expect(r.html).not.toContain('title');
    expect(r.frontmatter.data).toEqual({ title: 'Hallo', tags: ['x'] });
  });

  it('Block-IDs und Überschriften-IDs', () => {
    expect(html('Absatz ^abc123')).toContain('id="^abc123"');
    expect(html('## Mein Kapitel')).toContain('id="mein-kapitel"');
  });
});
