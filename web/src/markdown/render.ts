// Obsidian-kompatibles Markdown-Rendering auf Basis von markdown-it.
import markdownit, { type MarkdownIt, type StateInline, type StateBlock, type StateCore, type Token } from 'markdown-it';
import katex from 'katex';
import { parseFrontmatter, type Frontmatter } from '../vault/frontmatter';
import { parseWikiInner, slugify } from '../vault/index';

export interface RenderResult {
  html: string;
  frontmatter: Frontmatter;
}

const CALLOUT_ALIASES: Record<string, string> = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
};

export const CALLOUT_ICONS: Record<string, string> = {
  note: '✎',
  abstract: '☰',
  info: 'ℹ',
  todo: '☑',
  tip: '🔥',
  success: '✓',
  question: '?',
  warning: '⚠',
  failure: '✗',
  danger: '⚡',
  bug: '🐞',
  example: '☷',
  quote: '❝',
};

export function calloutType(t: string) {
  const k = t.toLowerCase();
  return CALLOUT_ALIASES[k] ?? k;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type M = any;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderMath(tex: string, display: boolean) {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'htmlAndMathml' });
  } catch {
    return `<code>${esc(tex)}</code>`;
  }
}

// ---------- Inline-Regeln ----------

function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  let pos = state.pos;
  const embed = src.charCodeAt(pos) === 0x21; /* ! */
  if (embed) pos++;
  if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
  const end = src.indexOf(']]', pos + 2);
  if (end < 0) return false;
  const inner = src.slice(pos + 2, end);
  if (!inner || inner.includes('\n') || inner.includes('[[')) return false;
  if (!silent) {
    const t = state.push(embed ? 'wiki_embed' : 'wikilink', '', 0);
    t.meta = parseWikiInner(inner);
  }
  state.pos = end + 2;
  return true;
}

const TAG_BODY = /^#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/u;
function tagRule(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x23 /* # */) return false;
  const prev = state.pos > 0 ? state.src[state.pos - 1] : ' ';
  if (!/[\s(,]/.test(prev)) return false;
  const m = TAG_BODY.exec(state.src.slice(state.pos));
  if (!m) return false;
  if (!silent) {
    const t = state.push('tag', '', 0);
    t.meta = { tag: m[1] };
  }
  state.pos += m[0].length;
  return true;
}

function highlightRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x3d || src.charCodeAt(start + 1) !== 0x3d) return false;
  if (src.charCodeAt(start + 2) === 0x3d || /\s/.test(src[start + 2] ?? ' ')) return false;
  const end = src.indexOf('==', start + 2);
  if (end < 0 || end > state.posMax) return false;
  if (src.slice(start + 2, end).includes('\n\n')) return false;
  if (!silent) {
    const oldMax = state.posMax;
    state.push('mark_open', 'mark', 1);
    state.pos = start + 2;
    state.posMax = end;
    state.md.inline.tokenize(state);
    state.posMax = oldMax;
    state.push('mark_close', 'mark', -1);
  }
  state.pos = end + 2;
  return true;
}

function mathInlineRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x24 /* $ */) return false;
  if (start > 0 && src[start - 1] === '\\') return false;
  const display = src.charCodeAt(start + 1) === 0x24;
  const open = display ? 2 : 1;
  const first = src[start + open];
  if (!first || (!display && /\s/.test(first))) return false;
  let end = start + open;
  for (;;) {
    end = src.indexOf(display ? '$$' : '$', end);
    if (end < 0) return false;
    if (src[end - 1] === '\\') {
      end++;
      continue;
    }
    break;
  }
  const tex = src.slice(start + open, end);
  if (!tex.trim() || (!display && /\s$/.test(tex))) return false;
  // "$5 und $10" nicht als Mathe interpretieren: nach schließendem $ darf keine Ziffer folgen
  if (!display && /\d/.test(src[end + 1] ?? '')) return false;
  if (!silent) {
    const t = state.push('math_inline', '', 0);
    t.content = tex;
    t.meta = { display };
  }
  state.pos = end + open;
  return true;
}

function blockIdRule(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x5e /* ^ */) return false;
  const prev = state.pos > 0 ? state.src[state.pos - 1] : ' ';
  if (!/\s/.test(prev)) return false;
  const m = /^\^([A-Za-z0-9-]+)[ \t]*(?=\n|$)/.exec(state.src.slice(state.pos));
  if (!m) return false;
  if (!silent) {
    const t = state.push('block_id', '', 0);
    t.meta = { id: m[1] };
  }
  state.pos += m[0].length;
  return true;
}

// ---------- Block-Regeln ----------

function mathBlockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const pos = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  if (state.src.slice(pos, pos + 2) !== '$$') return false;
  const firstLine = state.src.slice(pos + 2, max);
  let content: string;
  let next = startLine;
  if (firstLine.trim().endsWith('$$') && firstLine.trim().length > 2) {
    content = firstLine.trim().slice(0, -2);
  } else {
    const lines = [firstLine];
    let found = false;
    while (++next < endLine) {
      const s = state.bMarks[next] + state.tShift[next];
      const line = state.src.slice(s, state.eMarks[next]);
      if (line.trimEnd().endsWith('$$')) {
        lines.push(line.trimEnd().slice(0, -2));
        found = true;
        break;
      }
      lines.push(line);
    }
    if (!found) return false;
    content = lines.join('\n');
  }
  if (silent) return true;
  state.line = next + 1;
  const t = state.push('math_block', 'div', 0);
  t.content = content;
  t.map = [startLine, state.line];
  return true;
}

// ---------- Core-Regeln (Tasks, Callouts, Überschriften) ----------

const TASK_RE = /^\[([ xX\-/<>!?*])\][ \t]/;

function tasksPre(state: StateCore) {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'inline') continue;
    if (tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue;
    const m = TASK_RE.exec(t.content);
    if (!m) continue;
    const li = tokens[i - 2];
    t.content = t.content.slice(m[0].length);
    t.meta = { ...(t.meta ?? {}), task: m[1] };
    li.attrJoin('class', 'task-list-item');
    li.attrSet('data-task', m[1]);
    if (m[1] !== ' ') li.attrJoin('class', 'is-checked');
    if (li.map) li.attrSet('data-line', String(li.map[0] + ((state.env as { lineOffset?: number }).lineOffset ?? 0)));
  }
}

function tasksPost(state: StateCore) {
  for (const t of state.tokens) {
    if (t.type !== 'inline' || !t.meta?.task || !t.children) continue;
    const box = new state.Token('html_inline', '', 0);
    const checked = t.meta.task !== ' ';
    box.content = `<input type="checkbox" class="task-list-item-checkbox"${checked ? ' checked' : ''}> `;
    t.children.unshift(box);
  }
}

const CALLOUT_RE = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/;

function calloutsPre(state: StateCore) {
  const tokens = state.tokens;
  const stack: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'blockquote_open') {
      stack.push(t);
      const p = tokens[i + 1];
      const inl = tokens[i + 2];
      if (p?.type !== 'paragraph_open' || inl?.type !== 'inline') continue;
      const nl = inl.content.indexOf('\n');
      const firstLine = nl < 0 ? inl.content : inl.content.slice(0, nl);
      const m = CALLOUT_RE.exec(firstLine);
      if (!m) continue;
      const type = calloutType(m[1]);
      t.meta = { callout: { type, raw: m[1].toLowerCase(), fold: m[2], title: m[3] } };
      const rest = nl < 0 ? '' : inl.content.slice(nl + 1);
      if (rest.trim()) {
        inl.content = rest;
      } else {
        tokens.splice(i + 1, 3); // leeren Absatz entfernen
      }
    } else if (t.type === 'blockquote_close') {
      const open = stack.pop();
      if (open?.meta?.callout) t.meta = { callout: open.meta.callout };
    }
  }
}

function headingIds(state: StateCore) {
  const used = new Map<string, number>();
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue;
    const text = tokens[i + 1]?.content ?? '';
    let id = slugify(text) || 'heading';
    const n = used.get(id) ?? 0;
    used.set(id, n + 1);
    if (n) id = `${id}-${n}`;
    tokens[i].attrSet('id', id);
    tokens[i].attrSet('data-heading', text);
    if (tokens[i].map) tokens[i].attrSet('data-line', String(tokens[i].map![0] + ((state.env as { lineOffset?: number }).lineOffset ?? 0)));
  }
}

// ---------- Instanz ----------

export function createMarkdown(): MarkdownIt {
  const md = markdownit({ html: true, linkify: true, breaks: true, typographer: false });

  md.inline.ruler.before('link', 'wikilink', wikilinkRule);
  md.inline.ruler.before('link', 'obsidian_tag', tagRule);
  md.inline.ruler.before('emphasis', 'highlight', highlightRule);
  md.inline.ruler.before('escape', 'math_inline', mathInlineRule);
  md.inline.ruler.push('block_id', blockIdRule);
  md.block.ruler.before('fence', 'math_block', mathBlockRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.core.ruler.before('inline', 'tasks_pre', tasksPre);
  md.core.ruler.before('inline', 'callouts', calloutsPre);
  md.core.ruler.after('inline', 'tasks_post', tasksPost);
  md.core.ruler.after('inline', 'heading_ids', headingIds);

  const r = md.renderer.rules;

  r.wikilink = (tokens, idx) => {
    const { target, subpath, alias } = tokens[idx].meta as ReturnType<typeof parseWikiInner>;
    const label = alias || (target ? target + (subpath ? ` > ${subpath.replace(/^#\^?/, '')}` : '') : subpath.replace(/^#\^?/, ''));
    return `<a class="internal-link" data-href="${esc(target + subpath)}" href="#">${md.utils.escapeHtml(label)}</a>`;
  };

  r.wiki_embed = (tokens, idx) => {
    const { target, subpath, alias } = tokens[idx].meta as ReturnType<typeof parseWikiInner>;
    return `<span class="internal-embed" data-src="${esc(target)}" data-subpath="${esc(subpath)}" data-alias="${esc(alias)}"></span>`;
  };

  r.tag = (tokens, idx) => {
    const tag = (tokens[idx].meta as M).tag as string;
    return `<a class="tag" data-tag="${esc(tag)}" href="#">#${md.utils.escapeHtml(tag)}</a>`;
  };

  r.block_id = (tokens, idx) => `<span class="block-id" id="^${esc((tokens[idx].meta as M).id)}"></span>`;
  r.math_inline = (tokens, idx) => renderMath(tokens[idx].content, (tokens[idx].meta as M).display);
  r.math_block = (tokens, idx) => `<div class="math-block">${renderMath(tokens[idx].content, true)}</div>\n`;

  const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href);

  const defaultLinkOpen = r.link_open ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
  r.link_open = (tokens, idx, opts, env, self) => {
    const t = tokens[idx];
    const href = String(t.attrGet('href') ?? '');
    if (isExternal(href)) {
      t.attrSet('target', '_blank');
      t.attrSet('rel', 'noopener noreferrer');
      t.attrJoin('class', 'external-link');
    } else if (!href.startsWith('#')) {
      let decoded = href;
      try {
        decoded = decodeURIComponent(href);
      } catch {
        /* belassen */
      }
      t.attrSet('data-href', decoded);
      t.attrSet('href', '#');
      t.attrJoin('class', 'internal-link');
    }
    return defaultLinkOpen(tokens, idx, opts, env, self);
  };

  const defaultImage = r.image!;
  r.image = (tokens, idx, opts, env, self) => {
    const t = tokens[idx];
    const src = String(t.attrGet('src') ?? '');
    if (isExternal(src)) return defaultImage(tokens, idx, opts, env, self);
    let decoded = src;
    try {
      decoded = decodeURIComponent(src);
    } catch {
      /* belassen */
    }
    const alt = self.renderInlineAsText(t.children ?? [], opts, env);
    return `<span class="internal-embed" data-src="${esc(decoded)}" data-subpath="" data-alias="${esc(alt)}"></span>`;
  };

  r.blockquote_open = (tokens, idx, opts, _env, self) => {
    const c = (tokens[idx].meta as M)?.callout;
    if (!c) return self.renderToken(tokens, idx, opts);
    const title = c.title ? md.renderInline(c.title) : esc(c.raw.charAt(0).toUpperCase() + c.raw.slice(1));
    const icon = CALLOUT_ICONS[c.type] ?? CALLOUT_ICONS.note;
    const head = `<span class="callout-icon">${icon}</span><span class="callout-title-inner">${title}</span>`;
    if (c.fold) {
      return `<details class="callout" data-callout="${esc(c.type)}"${c.fold === '+' ? ' open' : ''}><summary class="callout-title">${head}</summary><div class="callout-content">\n`;
    }
    return `<div class="callout" data-callout="${esc(c.type)}"><div class="callout-title">${head}</div><div class="callout-content">\n`;
  };
  r.blockquote_close = (tokens, idx, opts, _env, self) => {
    const c = (tokens[idx].meta as M)?.callout;
    if (!c) return self.renderToken(tokens, idx, opts);
    return c.fold ? '</div></details>\n' : '</div></div>\n';
  };

  const defaultFence = r.fence!;
  r.fence = (tokens, idx, opts, env, self) => {
    const info = tokens[idx].info.trim().split(/\s+/)[0];
    if (info === 'mermaid') return `<pre class="mermaid">${esc(tokens[idx].content)}</pre>\n`;
    return defaultFence(tokens, idx, opts, env, self);
  };

  return md;
}

/** %%Kommentare%% entfernen – Zeilenumbrüche bleiben erhalten, Codeblöcke unberührt. */
export function stripComments(src: string): string {
  return src.replace(/(^(```|~~~)[^\n]*\n[\s\S]*?^\2[^\n]*$)|%%[\s\S]*?%%/gm, (m, fence) =>
    fence ? m : m.replace(/[^\n]/g, ''),
  );
}

let shared: MarkdownIt | null = null;

export function renderMarkdown(src: string): RenderResult {
  shared ??= createMarkdown();
  const fm = parseFrontmatter(src);
  const html = shared.render(stripComments(fm.body), { lineOffset: fm.lines });
  return { html, frontmatter: fm };
}
