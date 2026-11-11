// Lese-Ansicht: Markdown rendern, säubern und Obsidian-Elemente (Links, Embeds, Aufgaben) verdrahten.
import DOMPurify from 'dompurify';
import { renderMarkdown } from '../markdown/render';
import type { FMValue } from '../vault/frontmatter';
import { AUDIO_EXT, IMAGE_EXT, VIDEO_EXT, extname, basename } from '../vault/paths';
import { h } from './dom';

export interface PreviewContext {
  resolve(target: string, from: string): string | null;
  readText(path: string): Promise<string>;
  blobUrl(path: string): Promise<string>;
  openLink(target: string, from: string, newTab: boolean): void;
  openTag(tag: string): void;
  toggleTask(path: string, line: number): void;
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('target') === '_blank') node.setAttribute('rel', 'noopener noreferrer');
});

function sanitize(html: string) {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['details', 'summary', 'mark'],
    ADD_ATTR: ['target', 'open', 'data-callout'],
    FORBID_TAGS: ['style', 'form'],
  });
}

export function renderPropertiesBlock(data: Record<string, FMValue>, ctx: PreviewContext, path: string) {
  const keys = Object.keys(data);
  if (!keys.length) return null;
  const table = h('div.metadata-properties');
  for (const k of keys) {
    const v = data[k];
    const valEl = h('div.metadata-property-value');
    const items = Array.isArray(v) ? v : [v];
    for (const item of items) {
      if (item == null || item === '') continue;
      const s = String(item);
      if (k === 'tags' || k === 'tag') {
        const tag = s.replace(/^#/, '');
        valEl.append(h('a.tag', { href: '#', onclick: (e: Event) => (e.preventDefault(), ctx.openTag(tag)), text: `#${tag}` }));
      } else if (/^\[\[.*\]\]$/.test(s)) {
        const target = s.slice(2, -2).split('|')[0];
        valEl.append(
          h('a.internal-link', { href: '#', onclick: (e: Event) => (e.preventDefault(), ctx.openLink(target, path, false)), text: s.slice(2, -2).split('|').pop()! }),
        );
      } else if (/^https?:\/\//.test(s)) {
        valEl.append(h('a.external-link', { href: s, target: '_blank', rel: 'noopener noreferrer', text: s }));
      } else if (typeof item === 'boolean') {
        valEl.append(h('input', { type: 'checkbox', checked: item, disabled: true }));
      } else {
        valEl.append(h('span.metadata-pill', { text: s }));
      }
    }
    table.append(h('div.metadata-property', {}, h('div.metadata-property-key', { text: k }), valEl));
  }
  return h('div.metadata-container', {}, h('div.metadata-properties-heading', { text: 'Eigenschaften' }), table);
}

/** Rendert Markdown in `el`. `depth` begrenzt verschachtelte Embeds. */
export async function renderInto(el: HTMLElement, src: string, path: string, ctx: PreviewContext, depth = 0, showProps = true) {
  const { html, frontmatter } = renderMarkdown(src);
  el.innerHTML = sanitize(html);
  if (showProps && depth === 0) {
    const props = renderPropertiesBlock(frontmatter.data, ctx, path);
    if (props) el.prepend(props);
  }

  // Interne Links
  el.querySelectorAll<HTMLAnchorElement>('a.internal-link[data-href]').forEach((a) => {
    const href = a.dataset.href!;
    const hash = href.indexOf('#');
    const target = hash >= 0 ? href.slice(0, hash) : href;
    if (target && !ctx.resolve(target, path)) a.classList.add('is-unresolved');
    a.title = href;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      ctx.openLink(href, path, e.ctrlKey || e.metaKey);
    });
    a.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        ctx.openLink(href, path, true);
      }
    });
  });

  el.querySelectorAll<HTMLAnchorElement>('a.tag[data-tag]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      ctx.openTag(a.dataset.tag!);
    }),
  );

  // Aufgaben
  el.querySelectorAll<HTMLInputElement>('li.task-list-item > input.task-list-item-checkbox, li.task-list-item > p > input.task-list-item-checkbox').forEach((box) => {
    const li = box.closest('li')!;
    const line = Number(li.dataset.line);
    if (depth > 0 || Number.isNaN(line)) {
      box.disabled = true;
      return;
    }
    box.addEventListener('click', (e) => {
      e.preventDefault();
      ctx.toggleTask(path, line);
    });
  });

  // Callouts: faltbare per Klick (details übernimmt das nativ)

  // Embeds
  const embeds = [...el.querySelectorAll<HTMLElement>('span.internal-embed')];
  await Promise.all(embeds.map((span) => renderEmbed(span, path, ctx, depth)));
}

async function renderEmbed(span: HTMLElement, from: string, ctx: PreviewContext, depth: number) {
  const target = span.dataset.src ?? '';
  const subpath = span.dataset.subpath ?? '';
  const alias = span.dataset.alias ?? '';
  const resolved = target ? ctx.resolve(target, from) : from;
  if (!resolved) {
    span.replaceWith(
      h('span.embed-missing', {}, h('a.internal-link.is-unresolved', { href: '#', text: `„${target}“ nicht gefunden`, onclick: (e: Event) => (e.preventDefault(), ctx.openLink(target, from, false)) })),
    );
    return;
  }
  const ext = extname(resolved);
  try {
    if (IMAGE_EXT.has(ext)) {
      const img = h('img', { src: await ctx.blobUrl(resolved), alt: alias && !/^\d+(x\d+)?$/.test(alias) ? alias : basename(resolved), loading: 'lazy' });
      const size = /^(\d+)(?:x(\d+))?$/.exec(alias);
      if (size) {
        img.width = Number(size[1]);
        if (size[2]) img.height = Number(size[2]);
      }
      span.replaceWith(img);
    } else if (AUDIO_EXT.has(ext) && ext !== 'webm') {
      span.replaceWith(h('audio', { controls: true, src: await ctx.blobUrl(resolved) }));
    } else if (VIDEO_EXT.has(ext)) {
      span.replaceWith(h('video', { controls: true, src: await ctx.blobUrl(resolved) }));
    } else if (ext === 'pdf') {
      const page = /page=(\d+)/.exec(subpath)?.[1];
      const url = (await ctx.blobUrl(resolved)) + (page ? `#page=${page}` : '');
      span.replaceWith(h('iframe.pdf-embed', { src: url, title: basename(resolved) }));
    } else if (ext === 'md') {
      if (depth >= 3) {
        span.replaceWith(h('a.internal-link', { href: '#', text: basename(resolved), onclick: (e: Event) => (e.preventDefault(), ctx.openLink(target, from, false)) }));
        return;
      }
      const text = await ctx.readText(resolved);
      const part = subpath ? extractSubpath(text, subpath) : text;
      const inner = h('div.markdown-embed-content');
      const box = h(
        'div.markdown-embed',
        {},
        h('div.markdown-embed-title', {}, h('a.internal-link', { href: '#', text: alias || basename(resolved).replace(/\.md$/, '') + (subpath ? ` › ${subpath.slice(1)}` : ''), onclick: (e: Event) => (e.preventDefault(), ctx.openLink(target + subpath, from, false)) })),
        inner,
      );
      span.replaceWith(box);
      await renderInto(inner, part, resolved, ctx, depth + 1, false);
    } else {
      span.replaceWith(h('a.internal-link', { href: '#', text: basename(resolved), onclick: (e: Event) => (e.preventDefault(), ctx.openLink(target, from, false)) }));
    }
  } catch (e) {
    span.replaceWith(h('span.embed-missing', { text: `Fehler beim Laden: ${(e as Error).message}` }));
  }
}

/** Abschnitt (#Überschrift) oder Block (#^id) aus einer Notiz herausschneiden. */
export function extractSubpath(text: string, subpath: string): string {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, '');
  const lines = body.split('\n');
  if (subpath.startsWith('#^')) {
    const id = subpath.slice(2);
    const i = lines.findIndex((l) => new RegExp(`\\s\\^${id.replace(/[-]/g, '\\-')}\\s*$`).test(l));
    if (i < 0) return '';
    // ganzen Absatz bzw. Listeneintrag zurückgeben
    let s = i;
    while (s > 0 && lines[s - 1].trim() !== '' && !/^\s*([-*+]|\d+\.)\s/.test(lines[s])) s--;
    return lines.slice(s, i + 1).join('\n');
  }
  const parts = subpath.slice(1).split('#').map((p) => p.trim().toLowerCase());
  let start = -1;
  let level = 0;
  let pi = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (!m) continue;
    if (start >= 0 && m[1].length <= level) return lines.slice(start, i).join('\n');
    if (start < 0 && m[2].toLowerCase() === parts[pi]) {
      if (pi === parts.length - 1) {
        start = i;
        level = m[1].length;
      } else pi++;
    }
  }
  return start >= 0 ? lines.slice(start).join('\n') : '';
}

/** Zu Überschrift oder Block scrollen */
export function scrollToSubpath(container: HTMLElement, subpath: string) {
  if (!subpath) return;
  let el: Element | null = null;
  if (subpath.startsWith('#^')) {
    el = container.querySelector(`[id="${CSS.escape(subpath.slice(1))}"]`)?.parentElement ?? null;
  } else {
    const want = subpath.slice(1).split('#').pop()!.trim().toLowerCase();
    el = [...container.querySelectorAll<HTMLElement>('[data-heading]')].find((x) => x.dataset.heading!.toLowerCase() === want) ?? null;
  }
  if (el) {
    el.scrollIntoView({ block: 'start' });
    el.classList.add('is-flashing');
    setTimeout(() => el!.classList.remove('is-flashing'), 1500);
  }
}
