// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Atoxien
type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;

/** Kleiner Hyperscript-Helfer: h('div.klasse', {onclick}, kinder) */
export function h<K extends keyof HTMLElementTagNameMap>(
  sel: K | `${K}.${string}` | `${K}#${string}`,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const [tagAndId, ...classes] = sel.split('.');
  const [tag, id] = tagAndId.split('#');
  const el = document.createElement(tag as K);
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c != null && c !== false) el.append(c);
  return el;
}

export function icon(name: keyof typeof ICONS, size = 18): SVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon">${ICONS[name]}</svg>`;
  return wrap.firstElementChild as SVGElement;
}

// Lucide-Icons (ISC-Lizenz), wie in Obsidian verwendet
export const ICONS = {
  files: '<path d="M20 7h-3a2 2 0 0 1-2-2V2"/><path d="M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z"/><path d="M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  tags: '<path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19"/><path d="M9.586 5.586A2 2 0 0 0 8.172 5H3a1 1 0 0 0-1 1v5.172a2 2 0 0 0 .586 1.414L8.29 18.29a2.426 2.426 0 0 0 3.42 0l3.58-3.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="6.5" cy="9.5" r=".5" fill="currentColor"/>',
  newNote: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  newFolder: '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  sidebarRight: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  list: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  vault: '<path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  sortAZ: '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M20 8h-5"/><path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"/><path d="M15 14h5l-5 6h5"/>',
  collapse: '<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>',
} as const;

// ---------- Modale Dialoge ----------

export function modal(title: string, body: HTMLElement, opts: { wide?: boolean } = {}) {
  const close = () => {
    bg.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const box = h(
    'div.modal',
    { class: opts.wide ? 'mod-wide' : '' },
    h('div.modal-header', {}, h('div.modal-title', { text: title }), h('button.clickable-icon.modal-close', { onclick: () => close(), 'aria-label': 'Schließen' }, icon('x'))),
    body,
  );
  const bg = h('div.modal-container', { onmousedown: (e: Event) => e.target === bg && close() }, box);
  document.body.append(bg);
  document.addEventListener('keydown', onKey, true);
  return { close, el: box };
}

export function prompt(title: string, value = '', placeholder = ''): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input.prompt-input', { type: 'text', value, placeholder });
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const form = h(
      'form.modal-form',
      { onsubmit: (e: Event) => (e.preventDefault(), finish(input.value.trim() || null)) },
      input,
      h('div.modal-button-container', {}, h('button.mod-cta', { type: 'submit', text: 'OK' }), h('button', { type: 'button', text: 'Abbrechen', onclick: () => finish(null) })),
    );
    const m = modal(title, form);
    const origClose = m.close;
    m.close = () => {
      origClose();
      if (!done) {
        done = true;
        resolve(null);
      }
    };
    input.focus();
    const dot = value.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : value.length);
  });
}

export function confirmDialog(title: string, text: string, ok = 'OK', danger = false, cancel = 'Abbrechen'): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const okBtn = h('button', { class: danger ? 'mod-warning' : 'mod-cta', text: ok, onclick: () => finish(true) });
    const body = h(
      'div.modal-form',
      {},
      h('p', { text }),
      h('div.modal-button-container', {}, okBtn, h('button', { text: cancel, onclick: () => finish(false) })),
    );
    const m = modal(title, body);
    const orig = m.close;
    m.close = () => {
      orig();
      if (!done) {
        done = true;
        resolve(false);
      }
    };
    okBtn.focus();
  });
}

let noticeWrap: HTMLElement | null = null;
export function notice(text: string, ms = 3500, kind: 'info' | 'error' = 'info') {
  noticeWrap ??= document.body.appendChild(h('div.notice-container'));
  const n = h('div.notice', { class: kind === 'error' ? 'mod-error' : '', text });
  n.onclick = () => n.remove();
  noticeWrap.append(n);
  setTimeout(() => n.remove(), ms);
}

/** Kontextmenü an Mausposition */
export function contextMenu(e: MouseEvent, items: ({ label: string; action: () => void; danger?: boolean } | '-')[]) {
  e.preventDefault();
  document.querySelector('.menu')?.remove();
  const menu = h('div.menu');
  for (const it of items) {
    if (it === '-') menu.append(h('div.menu-separator'));
    else
      menu.append(
        h('div.menu-item', { class: it.danger ? 'is-warning' : '', text: it.label, onclick: () => (menu.remove(), it.action()) }),
      );
  }
  document.body.append(menu);
  const { innerWidth: W, innerHeight: H } = window;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(e.clientX, W - r.width - 8)}px`;
  menu.style.top = `${Math.min(e.clientY, H - r.height - 8)}px`;
  const off = (ev: Event) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener('mousedown', off, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', off, true));
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.flush = () => clearTimeout(t);
  return d;
}

/** Einfaches Fuzzy-Matching (alle Zeichen in Reihenfolge), liefert Score oder -1 */
export function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct - t.length * 0.1;
  let ti = 0;
  let score = 0;
  let last = -1;
  for (const ch of q) {
    const i = t.indexOf(ch, ti);
    if (i < 0) return -1;
    score += i === last + 1 ? 5 : 1;
    last = i;
    ti = i + 1;
  }
  return score - t.length * 0.1;
}
