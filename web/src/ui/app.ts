// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Atoxien
// Workspace: Layout, Tabs, Seitenleisten, Speichern & Dateioperationen.
import { AuthError, ConflictError, type VaultAdapter } from '../adapters/types';
import { ServerAdapter } from '../adapters/server';
import { VaultIndex } from '../vault/index';
import { TEXT_EXT, IMAGE_EXT, AUDIO_EXT, VIDEO_EXT, basename, dirname, extname, joinPath, stripExt } from '../vault/paths';
import { MarkdownEditor } from './editor';
import { FileTree } from './filetree';
import { renderInto, scrollToSubpath, type PreviewContext } from './preview';
import { confirmDialog, contextMenu, debounce, fuzzy, h, icon, modal, notice, prompt } from './dom';
import { applyTemplate, formatDate, loadObsidianConfig, loadPrefs, savePrefs, type ObsidianConfig, type Prefs } from './settings';
import { LICENSE_NAME, SOURCE_URL } from '../meta';

type Mode = 'preview' | 'source';

interface Tab {
  id: number;
  path: string;
  mode: Mode;
  text: string | null; // null = Binärdatei
  dirty: boolean;
  saving: Promise<void> | null;
  leaf: HTMLElement;
  header: HTMLElement;
  content: HTMLElement;
  previewEl: HTMLElement;
  sourceEl: HTMLElement;
  editor?: MarkdownEditor;
  tabEl: HTMLElement;
  back: string[];
  forward: string[];
  save: ReturnType<typeof debounce<[]>>;
  pendingSubpath?: string;
}

interface Command {
  id: string;
  name: string;
  hotkey?: string;
  run(): void;
}

let tabSeq = 0;

export class App {
  index = new VaultIndex();
  prefs: Prefs = loadPrefs();
  config!: ObsidianConfig;
  tabs: Tab[] = [];
  active: Tab | null = null;
  private blobUrls = new Map<string, string>();
  private tree: FileTree;
  private root = h('div.app-container');
  private tabBar = h('div.workspace-tab-header-container-inner');
  private leaves = h('div.workspace-leaves');
  private leftPanel = h('div.side-panel-content');
  private rightPanel = h('div.side-panel-content');
  private leftTab: 'files' | 'search' | 'tags' = 'files';
  private rightTab: 'backlinks' | 'outgoing' | 'outline' = 'backlinks';
  private statusLeft = h('div.status-bar-item');
  private statusRight = h('div.status-bar-item');
  private searchInput = h('input.search-input', { type: 'search', placeholder: 'Suchen … (tag:#x, path:ordner, "phrase", -wort)' });
  private searchResults = h('div.search-results');
  private indexing = 0;
  private unwatch?: () => void;
  private commands: Command[] = [];

  constructor(
    public adapter: VaultAdapter,
    private onExit: () => void,
    /** Nur Demo: Demo-Vault zurücksetzen und neu starten */
    private onDemoReset?: () => void,
  ) {
    const ro = adapter.readOnly;
    this.tree = new FileTree({
      readOnly: ro,
      storage: adapter.ephemeral ? sessionStorage : localStorage,
      open: (p, nt) => void this.openFile(p, { newTab: nt }),
      newNote: (f) => void this.createNote(f),
      newFolder: (f) => void this.createFolder(f),
      rename: (p) => void this.renamePrompt(p),
      move: (p, to) => void this.renamePath(p, joinPath(to, basename(p))),
      remove: (p) => void this.deletePath(p),
      upload: (files, folder) => void this.upload(files, folder),
    });
    this.searchInput.addEventListener('input', debounce(() => this.runSearch(), 200));
    this.registerCommands();
  }

  // ======================= Aufbau =======================

  async mount(host: HTMLElement) {
    host.replaceChildren(this.root);
    this.buildLayout();
    this.statusLeft.textContent = 'Lade Vault …';
    this.config = await loadObsidianConfig(this.adapter);
    await this.refreshFiles();
    this.restoreSession();
    void this.loadIndex();
    document.addEventListener('keydown', this.onKey);
    window.addEventListener('beforeunload', this.onUnload);
    if (this.adapter.watch) {
      this.unwatch = this.adapter.watch(debounceExternal((paths) => void this.onExternalChange(paths)));
    } else {
      window.addEventListener('focus', this.onFocus);
    }
  }

  destroy() {
    document.removeEventListener('keydown', this.onKey);
    window.removeEventListener('beforeunload', this.onUnload);
    window.removeEventListener('focus', this.onFocus);
    this.unwatch?.();
    this.adapter.close?.();
    for (const t of this.tabs) t.editor?.destroy();
    for (const u of this.blobUrls.values()) URL.revokeObjectURL(u);
  }

  private onUnload = (e: BeforeUnloadEvent) => {
    if (this.tabs.some((t) => t.dirty)) {
      for (const t of this.tabs) if (t.dirty) void this.saveTab(t);
      e.preventDefault();
    }
  };

  private onFocus = debounce(() => void this.onExternalChange(null), 300);

  private buildLayout() {
    const ro = this.adapter.readOnly;
    const ribbonBtn = (ic: Parameters<typeof icon>[0], label: string, fn: () => void, cls = '') =>
      h('div.side-dock-ribbon-action.clickable-icon', { 'aria-label': label, title: label, onclick: fn, class: cls }, icon(ic));

    const ribbon = h(
      'div.workspace-ribbon.side-dock-ribbon.mod-left',
      {},
      h(
        'div.side-dock-actions',
        {},
        ribbonBtn('command', 'Befehlspalette (Strg+P)', () => this.commandPalette()),
        ribbonBtn('search', 'Schnellwechsel (Strg+O)', () => this.quickSwitcher()),
        ro ? null : ribbonBtn('calendar', 'Heutige Tagesnotiz öffnen', () => void this.openDailyNote()),
        ro ? null : ribbonBtn('newNote', 'Neue Notiz (Strg+N)', () => void this.createNote()),
      ),
      h(
        'div.side-dock-settings',
        {},
        ribbonBtn('settings', 'Einstellungen', () => this.settingsDialog()),
        ribbonBtn('logout', 'Vault wechseln / abmelden', () => void this.exit()),
      ),
    );

    // Linke Seitenleiste
    const leftTabs = h('div.nav-header-tabs');
    const mkLeftTab = (id: App['leftTab'], ic: Parameters<typeof icon>[0], label: string) => {
      const b = h('div.clickable-icon.nav-action-button', { 'aria-label': label, title: label, 'data-tab': id, onclick: () => ((this.leftTab = id), this.renderLeft()) }, icon(ic));
      leftTabs.append(b);
    };
    mkLeftTab('files', 'files', 'Dateien');
    mkLeftTab('search', 'search', 'Suche (Strg+Umschalt+F)');
    mkLeftTab('tags', 'tags', 'Tags');
    const left = h(
      'div.workspace-split.mod-left-split',
      {},
      h('div.side-panel-header', {}, leftTabs),
      this.leftPanel,
      h('div.vault-profile', {}, icon('vault', 16), h('span.vault-name', { text: this.adapter.name }), h('span.vault-kind', { text: sourceLabel(this.adapter) })),
    );

    // Rechte Seitenleiste
    const rightTabs = h('div.nav-header-tabs');
    const mkRightTab = (id: App['rightTab'], ic: Parameters<typeof icon>[0], label: string) =>
      rightTabs.append(h('div.clickable-icon.nav-action-button', { 'aria-label': label, title: label, 'data-tab': id, onclick: () => ((this.rightTab = id), this.renderRight()) }, icon(ic)));
    mkRightTab('backlinks', 'link', 'Rückverweise');
    mkRightTab('outgoing', 'chevron', 'Ausgehende Links');
    mkRightTab('outline', 'list', 'Gliederung');
    const right = h('div.workspace-split.mod-right-split', {}, h('div.side-panel-header', {}, rightTabs), this.rightPanel);

    const toggleLeft = h('div.clickable-icon.sidebar-toggle-button.mod-left', { 'aria-label': 'Linke Seitenleiste', onclick: () => this.toggleSidebar('left') }, icon('menu'));
    const toggleRight = h('div.clickable-icon.sidebar-toggle-button.mod-right', { 'aria-label': 'Rechte Seitenleiste', onclick: () => this.toggleSidebar('right') }, icon('sidebarRight'));
    const tabHeader = h('div.workspace-tab-header-container', {}, toggleLeft, this.tabBar, h('div.workspace-tab-header-new', { title: 'Neuer Tab', onclick: () => this.quickSwitcher(true) }, '+'), toggleRight);

    const main = h('div.workspace-split.mod-root', {}, tabHeader, this.leaves);
    const backdrop = h('div.sidebar-backdrop', { onclick: () => this.closeMobileSidebars() });

    const status = h('div.status-bar', {}, this.statusLeft, h('div.status-bar-spacer'), this.statusRight);
    if (this.adapter.kind === 'demo') {
      this.root.append(
        h(
          'div.demo-banner',
          {},
          h('span', { text: 'Demo – deine Änderungen bleiben nur in diesem Browser-Tab und werden nach 4 Stunden automatisch zurückgesetzt.' }),
          h('button', { text: 'Jetzt zurücksetzen', onclick: () => this.onDemoReset?.() }),
          h('button', { text: 'Eigenen Vault öffnen', onclick: () => void this.exit() }),
        ),
      );
    }
    this.root.append(h('div.workspace', {}, ribbon, left, main, right, backdrop), status);

    const isMobile = matchMedia('(max-width: 768px)').matches;
    if (isMobile || localStorage.getItem('obui.left.closed') === '1') this.root.classList.add('left-collapsed');
    if (isMobile || localStorage.getItem('obui.right.closed') === '1') this.root.classList.add('right-collapsed');

    this.renderLeft();
    this.renderRight();
  }

  private toggleSidebar(side: 'left' | 'right') {
    const cls = `${side}-collapsed`;
    const collapsed = this.root.classList.toggle(cls);
    if (matchMedia('(max-width: 768px)').matches) {
      // auf dem Handy immer nur eine Leiste
      if (!collapsed) this.root.classList.add(side === 'left' ? 'right-collapsed' : 'left-collapsed');
    } else {
      try {
        localStorage.setItem(`obui.${side}.closed`, collapsed ? '1' : '0');
      } catch {
        /* egal */
      }
    }
  }

  private closeMobileSidebars() {
    this.root.classList.add('left-collapsed', 'right-collapsed');
  }

  // ======================= Linke Seitenleiste =======================

  private renderLeft() {
    this.leftPanel.parentElement?.querySelectorAll('.nav-header-tabs [data-tab]').forEach((b) => b.classList.toggle('is-active', (b as HTMLElement).dataset.tab === this.leftTab));
    const ro = this.adapter.readOnly;
    if (this.leftTab === 'files') {
      const btn = (ic: Parameters<typeof icon>[0], label: string, fn: () => void) => h('div.clickable-icon.nav-action-button', { 'aria-label': label, title: label, onclick: fn }, icon(ic, 16));
      const actions = h(
        'div.nav-buttons-container',
        {},
        ro ? null : btn('newNote', 'Neue Notiz', () => void this.createNote(this.currentFolder())),
        ro ? null : btn('newFolder', 'Neuer Ordner', () => void this.createFolder(this.currentFolder())),
        btn('collapse', 'Alle einklappen', () => this.tree.collapseAll()),
        btn('refresh', 'Neu laden', () => void this.onExternalChange(null)),
      );
      this.leftPanel.replaceChildren(actions, this.tree.el);
    } else if (this.leftTab === 'search') {
      this.leftPanel.replaceChildren(h('div.search-input-container', {}, this.searchInput), this.searchResults);
      setTimeout(() => this.searchInput.focus());
      this.runSearch();
    } else {
      this.leftPanel.replaceChildren(this.renderTags());
    }
  }

  private renderTags() {
    const tags = this.index.allTags();
    const wrap = h('div.tag-pane');
    if (!tags.size) wrap.append(h('div.pane-empty', { text: this.indexing ? 'Indexiere …' : 'Keine Tags gefunden.' }));
    for (const [tag, count] of tags) {
      const depth = tag.split('/').length - 1;
      wrap.append(
        h(
          'div.tree-item-self.tag-pane-tag',
          { style: `padding-left:${8 + depth * 16}px`, onclick: () => this.openTag(tag) },
          h('span.tree-item-inner', { text: `#${depth ? tag.split('/').pop() : tag}` }),
          h('span.tree-item-flair', { text: String(count) }),
        ),
      );
    }
    return wrap;
  }

  openTag(tag: string) {
    this.leftTab = 'search';
    this.searchInput.value = `tag:#${tag}`;
    this.root.classList.remove('left-collapsed');
    this.renderLeft();
  }

  private runSearch() {
    const q = this.searchInput.value.trim();
    if (!q) {
      this.searchResults.replaceChildren();
      return;
    }
    const hits = this.index.search(q);
    const terms = q
      .split(/\s+/)
      .filter((t) => t && !t.includes(':') && !t.startsWith('-'))
      .map((t) => t.replace(/"/g, ''));
    const frag = document.createDocumentFragment();
    frag.append(h('div.search-result-count', { text: `${hits.length} Treffer${this.indexing ? ' (Index wird noch geladen …)' : ''}` }));
    for (const hit of hits) {
      const item = h('div.search-result');
      item.append(h('div.search-result-file-title', { text: stripExt(hit.path), onclick: () => void this.openFile(hit.path) }));
      for (const s of hit.snippets) {
        item.append(h('div.search-result-file-match', { html: highlightTerms(s.text, terms), onclick: () => void this.openFile(hit.path, { line: s.line }) }));
      }
      frag.append(item);
    }
    this.searchResults.replaceChildren(frag);
  }

  // ======================= Rechte Seitenleiste =======================

  private renderRight = debounce(() => this.renderRightNow(), 50);

  private renderRightNow() {
    this.rightPanel.parentElement?.querySelectorAll('.nav-header-tabs [data-tab]').forEach((b) => b.classList.toggle('is-active', (b as HTMLElement).dataset.tab === this.rightTab));
    const tab = this.active;
    const panel = h('div.right-pane');
    if (!tab || extname(tab.path) !== 'md') {
      panel.append(h('div.pane-empty', { text: 'Keine Notiz geöffnet.' }));
    } else if (this.rightTab === 'backlinks') {
      const bl = this.index.backlinks(tab.path);
      panel.append(h('div.pane-section-title', { text: `Verlinkte Erwähnungen (${bl.length})` }));
      if (!bl.length) panel.append(h('div.pane-empty', { text: this.indexing ? 'Indexiere …' : 'Keine Rückverweise.' }));
      for (const b of bl) {
        const item = h('div.search-result');
        item.append(h('div.search-result-file-title', { text: stripExt(b.source), onclick: () => void this.openFile(b.source) }));
        for (const l of b.lines) item.append(h('div.search-result-file-match', { text: l, onclick: () => void this.openFile(b.source) }));
        panel.append(item);
      }
      const um = this.index.unlinkedMentions(tab.path);
      if (um.length) {
        panel.append(h('div.pane-section-title', { text: `Unverlinkte Erwähnungen (${um.length})` }));
        for (const m of um.slice(0, 50)) {
          panel.append(h('div.search-result', {}, h('div.search-result-file-title', { text: stripExt(m.source), onclick: () => void this.openFile(m.source) }), h('div.search-result-file-match', { text: m.line })));
        }
      }
    } else if (this.rightTab === 'outgoing') {
      const out = this.index.outgoing(tab.path);
      panel.append(h('div.pane-section-title', { text: `Ausgehende Links (${out.length})` }));
      const seen = new Set<string>();
      for (const o of out) {
        const key = o.resolved ?? `?${o.link.target}`;
        if (seen.has(key) || !o.link.target) continue;
        seen.add(key);
        panel.append(
          h('div.tree-item-self.outgoing-link', { class: o.resolved ? '' : 'is-unresolved', onclick: () => this.openLink(o.link.target + o.link.subpath, tab.path, false) }, h('span.tree-item-inner', { text: o.resolved ? stripExt(o.resolved) : `${o.link.target} (fehlt)` })),
        );
      }
    } else {
      const meta = this.index.meta.get(tab.path);
      const headings = meta?.headings ?? [];
      panel.append(h('div.pane-section-title', { text: 'Gliederung' }));
      if (!headings.length) panel.append(h('div.pane-empty', { text: 'Keine Überschriften.' }));
      const min = Math.min(...headings.map((x) => x.level));
      for (const hd of headings) {
        panel.append(
          h('div.tree-item-self.outline-heading', { style: `padding-left:${8 + (hd.level - min) * 16}px`, onclick: () => this.gotoHeading(tab, hd.text, hd.line) }, h('span.tree-item-inner', { text: hd.text })),
        );
      }
    }
    this.rightPanel.replaceChildren(panel);
  }

  private gotoHeading(tab: Tab, text: string, line: number) {
    if (tab.mode === 'source') tab.editor?.scrollToLine(line);
    else scrollToSubpath(tab.previewEl, `#${text}`);
  }

  // ======================= Dateien & Index =======================

  async refreshFiles() {
    const files = await this.adapter.list();
    this.index.setFiles(files);
    this.tree.setFiles([...this.index.files.values()]);
  }

  private async loadIndex(paths?: string[]) {
    const notes = paths ?? this.index.notes();
    this.indexing++;
    let done = 0;
    const queue = [...notes];
    const worker = async () => {
      while (queue.length) {
        const p = queue.shift()!;
        const open = this.tabs.find((t) => t.path === p && t.dirty);
        try {
          if (!open) this.index.setContent(p, await this.adapter.read(p));
        } catch {
          /* Datei evtl. weg */
        }
        done++;
        if (done % 25 === 0) this.statusLeft.textContent = `Indexiere ${done}/${notes.length} …`;
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, queue.length || 1) }, worker));
    this.indexing--;
    this.updateStatus();
    this.renderRight();
    if (this.leftTab !== 'files') this.renderLeft();
    // aufgelöste/unaufgelöste Links in der Ansicht aktualisieren
    for (const t of this.tabs) if (t.mode === 'preview' && t === this.active && !paths) void this.renderPreview(t);
  }

  private async onExternalChange(paths: string[] | null) {
    try {
      const before = new Map([...this.index.files].map(([k, v]) => [k, v.mtime]));
      await this.refreshFiles();
      const changed = paths ?? [...this.index.files.values()].filter((f) => f.type === 'file' && (!before.has(f.path) || (f.mtime && before.get(f.path) !== f.mtime))).map((f) => f.path);
      const md = changed.filter((p) => extname(p) === 'md' && this.index.files.has(p));
      for (const p of changed) {
        const u = this.blobUrls.get(p);
        if (u) {
          URL.revokeObjectURL(u);
          this.blobUrls.delete(p);
        }
      }
      // Bei Adaptern ohne mtime (lokal/REST) alle offenen Dateien prüfen
      const toCheck = new Set(paths === null && !this.adapter.watch ? this.tabs.map((t) => t.path) : md);
      for (const t of [...this.tabs]) {
        if (!this.index.files.has(t.path)) {
          if (!t.dirty) this.closeTab(t);
          continue;
        }
        if (!toCheck.has(t.path) || t.dirty || t.saving || t.text == null) continue;
        const fresh = await this.adapter.read(t.path);
        if (fresh !== t.text) {
          t.text = fresh;
          this.index.setContent(t.path, fresh);
          t.editor?.setText(fresh);
          if (t.mode === 'preview') await this.renderPreview(t);
        }
      }
      if (md.length) await this.loadIndex(md.filter((p) => !this.tabs.some((t) => t.path === p)));
      this.renderRight();
    } catch (e) {
      this.handleError(e);
    }
  }

  private async blobUrl(path: string) {
    let u = this.blobUrls.get(path);
    if (!u) {
      u = URL.createObjectURL(await this.adapter.readBinary(path));
      this.blobUrls.set(path, u);
    }
    return u;
  }

  private previewCtx(): PreviewContext {
    return {
      resolve: (t, from) => this.index.resolve(t, from),
      readText: async (p) => this.tabs.find((t) => t.path === p)?.text ?? this.index.content.get(p) ?? (await this.adapter.read(p)),
      blobUrl: (p) => this.blobUrl(p),
      openLink: (t, from, nt) => this.openLink(t, from, nt),
      openTag: (t) => this.openTag(t),
      toggleTask: (p, line) => this.toggleTask(p, line),
    };
  }

  // ======================= Tabs =======================

  async openFile(path: string, opts: { newTab?: boolean; subpath?: string; line?: number; mode?: Mode; noHistory?: boolean } = {}) {
    try {
      if (this.index.files.get(path)?.type === 'folder') return;
      let tab = this.tabs.find((t) => t.path === path);
      if (!tab) {
        if (!opts.newTab && this.active) {
          tab = this.active;
          await this.loadIntoTab(tab, path, opts.noHistory ? undefined : 'push', opts.mode);
        } else {
          tab = this.createTab();
          await this.loadIntoTab(tab, path, undefined, opts.mode);
        }
      } else if (opts.mode && tab.mode !== opts.mode) {
        this.setMode(tab, opts.mode);
      }
      this.activate(tab);
      if (opts.subpath) this.scrollTo(tab, opts.subpath);
      if (opts.line != null) {
        if (tab.mode === 'source') tab.editor?.scrollToLine(opts.line);
        else this.scrollPreviewToLine(tab, opts.line);
      }
      if (matchMedia('(max-width: 768px)').matches) this.closeMobileSidebars();
    } catch (e) {
      this.handleError(e);
    }
  }

  private scrollTo(tab: Tab, subpath: string) {
    if (tab.mode === 'preview') scrollToSubpath(tab.previewEl, subpath);
    else {
      const h = this.index.meta.get(tab.path)?.headings.find((x) => x.text.toLowerCase() === subpath.slice(1).split('#').pop()!.toLowerCase());
      if (h) tab.editor?.scrollToLine(h.line);
    }
  }

  private scrollPreviewToLine(tab: Tab, line: number) {
    const els = [...tab.previewEl.querySelectorAll<HTMLElement>('[data-line]')];
    let best: HTMLElement | null = null;
    for (const el of els) if (Number(el.dataset.line) <= line) best = el;
    best?.scrollIntoView({ block: 'center' });
  }

  private createTab(): Tab {
    const id = ++tabSeq;
    const header = h('div.view-header');
    const previewEl = h('div.markdown-preview-view.markdown-rendered');
    const sourceEl = h('div.markdown-source-view');
    const content = h('div.view-content', {}, h('div.markdown-reading-view', {}, previewEl), sourceEl);
    const leaf = h('div.workspace-leaf', {}, header, content);
    const tabEl = h('div.workspace-tab-header');
    const tab: Tab = {
      id,
      path: '',
      mode: this.prefs.defaultMode,
      text: null,
      dirty: false,
      saving: null,
      leaf,
      header,
      content,
      previewEl,
      sourceEl,
      tabEl,
      back: [],
      forward: [],
      save: debounce(() => void this.saveTab(tab), 1000),
    };
    tabEl.addEventListener('click', () => this.activate(tab));
    tabEl.addEventListener('auxclick', (e) => e.button === 1 && this.closeTab(tab));
    tabEl.addEventListener('contextmenu', (e) =>
      contextMenu(e, [
        { label: 'Schließen', action: () => this.closeTab(tab) },
        { label: 'Andere schließen', action: () => this.tabs.filter((t) => t !== tab).forEach((t) => this.closeTab(t)) },
      ]),
    );
    this.leaves.querySelector('.empty-state')?.remove();
    this.tabs.push(tab);
    this.tabBar.append(tabEl);
    this.leaves.append(leaf);
    return tab;
  }

  private async loadIntoTab(tab: Tab, path: string, history?: 'push', mode?: Mode) {
    if (tab.dirty) await this.saveTab(tab);
    if (history && tab.path && tab.path !== path) {
      tab.back.push(tab.path);
      tab.forward = [];
    }
    const ext = extname(path);
    const isText = TEXT_EXT.has(ext) || !ext;
    tab.text = isText ? await this.adapter.read(path) : null;
    tab.path = path;
    tab.dirty = false;
    if (ext === 'md' && tab.text != null) this.index.setContent(path, tab.text);
    tab.editor?.destroy();
    tab.editor = undefined;
    tab.sourceEl.replaceChildren();
    tab.mode = ext === 'md' ? (mode ?? (tab.mode || this.prefs.defaultMode)) : isText ? 'source' : 'preview';
    if (this.adapter.readOnly && ext === 'md') tab.mode = 'preview';
    await this.renderTab(tab);
    this.saveSession();
  }

  private async renderTab(tab: Tab) {
    this.renderHeader(tab);
    tab.content.classList.toggle('is-source', tab.mode === 'source');
    if (tab.mode === 'source') {
      this.ensureEditor(tab);
    } else {
      await this.renderPreview(tab);
    }
    this.renderTabTitle(tab);
  }

  private ensureEditor(tab: Tab) {
    if (tab.editor || tab.text == null) return;
    tab.editor = new MarkdownEditor(
      tab.sourceEl,
      tab.text,
      {
        onChange: (text) => {
          tab.text = text;
          tab.dirty = true;
          this.renderTabTitle(tab);
          this.updateStatus();
          tab.save();
        },
        onSave: () => void this.saveTab(tab),
        openLink: (target, nt) => this.openLink(target, tab.path, nt),
        linkCompletions: (q) => this.linkCompletions(q),
        tagCompletions: (q) =>
          [...this.index.allTags().keys()]
            .map((t) => ({ t, s: fuzzy(q, t) }))
            .filter((x) => x.s >= 0)
            .sort((a, b) => b.s - a.s)
            .slice(0, 30)
            .map((x) => x.t),
        saveAttachment: this.adapter.readOnly ? undefined : (f) => this.saveAttachment(f, tab.path),
      },
      this.adapter.readOnly,
    );
  }

  private linkCompletions(q: string) {
    const all = [...this.index.files.values()].filter((f) => f.type === 'file');
    return all
      .map((f) => {
        const label = this.index.linkText(f.path);
        return { label, detail: f.path, s: Math.max(fuzzy(q, label), fuzzy(q, f.path) - 5) };
      })
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50);
  }

  private async renderPreview(tab: Tab) {
    const ext = extname(tab.path);
    const el = tab.previewEl;
    if (ext === 'md' && tab.text != null) {
      const scroll = el.parentElement!.scrollTop;
      const title = h('div.inline-title', { text: stripExt(basename(tab.path)) });
      const body = h('div.markdown-preview-sizer');
      await renderInto(body, tab.text, tab.path, this.previewCtx());
      el.replaceChildren(title, body);
      el.parentElement!.scrollTop = scroll;
    } else if (IMAGE_EXT.has(ext)) {
      el.replaceChildren(h('div.media-view', {}, h('img', { src: await this.blobUrl(tab.path), alt: basename(tab.path) })));
    } else if (AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext)) {
      el.replaceChildren(h('div.media-view', {}, h(VIDEO_EXT.has(ext) ? 'video' : 'audio', { controls: true, src: await this.blobUrl(tab.path) })));
    } else if (ext === 'pdf') {
      el.replaceChildren(h('iframe.pdf-view', { src: await this.blobUrl(tab.path), title: basename(tab.path) }));
    } else {
      el.replaceChildren(
        h('div.pane-empty', {}, h('p', { text: `Dateityp „.${ext}“ kann nicht angezeigt werden.` }), h('button.mod-cta', { text: 'Herunterladen', onclick: async () => {
          const a = h('a', { href: await this.blobUrl(tab.path), download: basename(tab.path) });
          a.click();
        } })),
      );
    }
  }

  private renderHeader(tab: Tab) {
    const isMd = extname(tab.path) === 'md';
    const crumbs = h('div.view-header-title-container');
    const parts = tab.path.split('/');
    parts.forEach((p, i) => {
      const last = i === parts.length - 1;
      crumbs.append(h('span', { class: last ? 'view-header-title' : 'view-header-breadcrumb', text: last && isMd ? stripExt(p) : p, onclick: last && !this.adapter.readOnly ? () => void this.renamePrompt(tab.path) : undefined, title: last && !this.adapter.readOnly ? 'Klicken zum Umbenennen' : undefined }));
      if (!last) crumbs.append(h('span.view-header-breadcrumb-separator', { text: '/' }));
    });
    const nav = h(
      'div.view-header-nav-buttons',
      {},
      h('button.clickable-icon', { 'aria-label': 'Zurück (Alt+←)', title: 'Zurück', disabled: !tab.back.length, onclick: () => void this.goBack(tab) }, rotated(icon('chevron'), 180)),
      h('button.clickable-icon', { 'aria-label': 'Vor (Alt+→)', title: 'Vor', disabled: !tab.forward.length, onclick: () => void this.goForward(tab) }, icon('chevron')),
    );
    const actions = h('div.view-actions');
    if (isMd && !this.adapter.readOnly) {
      actions.append(
        h(
          'button.clickable-icon.view-action',
          { 'aria-label': tab.mode === 'preview' ? 'Bearbeiten (Strg+E)' : 'Leseansicht (Strg+E)', title: tab.mode === 'preview' ? 'Bearbeiten (Strg+E)' : 'Leseansicht (Strg+E)', onclick: () => this.setMode(tab, tab.mode === 'preview' ? 'source' : 'preview') },
          icon(tab.mode === 'preview' ? 'edit' : 'book'),
        ),
      );
    }
    tab.header.replaceChildren(nav, crumbs, actions);
  }

  private renderTabTitle(tab: Tab) {
    const name = extname(tab.path) === 'md' ? stripExt(basename(tab.path)) : basename(tab.path);
    tab.tabEl.replaceChildren(
      h('div.workspace-tab-header-inner-title', { text: name, title: tab.path }),
      ...(tab.dirty ? [h('div.workspace-tab-header-status-dot', { title: 'Ungespeichert' })] : []),
      h('div.workspace-tab-header-inner-close-button.clickable-icon', { 'aria-label': 'Schließen', onclick: (e: Event) => (e.stopPropagation(), this.closeTab(tab)) }, icon('x', 14)),
    );
  }

  setMode(tab: Tab, mode: Mode) {
    if (extname(tab.path) !== 'md' || this.adapter.readOnly) return;
    tab.mode = mode;
    void this.renderTab(tab).then(() => {
      if (mode === 'source') tab.editor?.focus();
    });
  }

  private activate(tab: Tab) {
    this.active = tab;
    for (const t of this.tabs) {
      const on = t === tab;
      t.leaf.classList.toggle('is-active', on);
      t.tabEl.classList.toggle('is-active', on);
    }
    tab.tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.tree.setActive(tab.path);
    document.title = `${stripExt(basename(tab.path))} – ${this.adapter.name} – Vault Browser`;
    this.renderRight();
    this.updateStatus();
    this.saveSession();
  }

  closeTab(tab: Tab) {
    if (tab.dirty) void this.saveTab(tab);
    const i = this.tabs.indexOf(tab);
    if (i < 0) return;
    tab.editor?.destroy();
    tab.leaf.remove();
    tab.tabEl.remove();
    this.tabs.splice(i, 1);
    if (this.active === tab) {
      const next = this.tabs[i] ?? this.tabs[i - 1];
      if (next) this.activate(next);
      else {
        this.active = null;
        this.tree.setActive(null);
        this.renderRight();
        this.showEmpty();
      }
    }
    this.saveSession();
  }

  private showEmpty() {
    if (this.tabs.length) return;
    const ro = this.adapter.readOnly;
    const empty = h(
      'div.empty-state',
      {},
      h('div.empty-state-title', { text: this.adapter.name }),
      h(
        'div.empty-state-action-list',
        {},
        ro ? null : h('div.empty-state-action', { text: 'Neue Notiz erstellen (Strg+N)', onclick: () => void this.createNote() }),
        h('div.empty-state-action', { text: 'Datei öffnen (Strg+O)', onclick: () => this.quickSwitcher() }),
        ro ? null : h('div.empty-state-action', { text: 'Heutige Tagesnotiz', onclick: () => void this.openDailyNote() }),
      ),
    );
    this.leaves.querySelector('.empty-state')?.remove();
    this.leaves.append(empty);
  }

  private async goBack(tab: Tab) {
    const p = tab.back.pop();
    if (!p) return;
    tab.forward.push(tab.path);
    await this.loadIntoTab(tab, p);
    this.activate(tab);
  }

  private async goForward(tab: Tab) {
    const p = tab.forward.pop();
    if (!p) return;
    tab.back.push(tab.path);
    await this.loadIntoTab(tab, p);
    this.activate(tab);
  }

  // ======================= Speichern =======================

  async saveTab(tab: Tab, force = false): Promise<void> {
    tab.save.flush();
    if (!tab.dirty || tab.text == null) return tab.saving ?? undefined;
    if (tab.saving) {
      await tab.saving;
      if (!tab.dirty) return;
    }
    const text = tab.text;
    const path = tab.path;
    tab.dirty = false;
    this.statusRight.textContent = 'Speichere …';
    tab.saving = (async () => {
      try {
        if (force && this.adapter instanceof ServerAdapter) this.adapter.forget(path);
        await this.adapter.write(path, text);
        if (extname(path) === 'md') this.index.setContent(path, text);
        this.renderRight();
      } catch (e) {
        tab.dirty = true;
        if (e instanceof ConflictError) {
          const reload = await confirmDialog(
            'Konflikt',
            `„${basename(path)}“ wurde außerhalb (z.B. in Obsidian) geändert. Deine Version überschreiben oder die externe Version laden?`,
            'Meine Version speichern',
            true,
            'Externe Version laden',
          );
          tab.saving = null;
          if (reload) return this.saveTab(tab, true);
          tab.dirty = false;
          tab.text = await this.adapter.read(path);
          tab.editor?.setText(tab.text);
          if (tab.mode === 'preview') await this.renderPreview(tab);
        } else {
          this.handleError(e);
        }
      } finally {
        tab.saving = null;
        this.renderTabTitle(tab);
        this.updateStatus();
      }
    })();
    return tab.saving;
  }

  private updateStatus() {
    const t = this.active;
    if (this.indexing) this.statusLeft.textContent = 'Indexiere …';
    else this.statusLeft.textContent = `${this.index.notes().length} Notizen`;
    if (!t || t.text == null) {
      this.statusRight.textContent = '';
      return;
    }
    const words = (t.text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
    const bl = this.index.backlinks(t.path).length;
    this.statusRight.textContent = `${bl} Rückverweise · ${words} Wörter · ${t.text.length} Zeichen${t.dirty || t.saving ? ' · ●' : ''}${this.adapter.readOnly ? ' · schreibgeschützt' : ''}`;
  }

  private async toggleTask(path: string, line: number) {
    const tab = this.tabs.find((t) => t.path === path);
    if (!tab || tab.text == null || this.adapter.readOnly) return;
    const lines = tab.text.split('\n');
    const l = lines[line];
    const m = l ? /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\])/.exec(l) : null;
    if (!m) return;
    lines[line] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3] + l.slice(m[0].length);
    tab.text = lines.join('\n');
    tab.dirty = true;
    tab.editor?.setText(tab.text);
    await this.renderPreview(tab);
    await this.saveTab(tab);
  }

  // ======================= Links & Dateioperationen =======================

  openLink(href: string, from: string, newTab: boolean) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      window.open(href, '_blank', 'noopener');
      return;
    }
    const hash = href.indexOf('#');
    const target = hash >= 0 ? href.slice(0, hash) : href;
    const subpath = hash >= 0 ? href.slice(hash) : '';
    if (!target) {
      const tab = this.tabs.find((t) => t.path === from);
      if (tab) this.scrollTo(tab, subpath);
      return;
    }
    const resolved = this.index.resolve(target, from);
    if (resolved) {
      void this.openFile(resolved, { newTab, subpath });
      return;
    }
    if (this.adapter.readOnly) {
      notice(`„${target}“ existiert nicht.`);
      return;
    }
    // Wie Obsidian: Klick auf nicht existierenden Link legt die Notiz an
    const name = extname(target) ? target : `${target}.md`;
    const path = target.includes('/') ? name : joinPath(this.newNoteFolder(from), name);
    void (async () => {
      await this.writeNew(path, '');
      await this.openFile(path, { newTab, mode: 'source' });
    })();
  }

  private currentFolder() {
    return this.active ? dirname(this.active.path) : '';
  }

  private newNoteFolder(from = this.active?.path ?? '') {
    switch (this.config.newFileLocation) {
      case 'current':
        return dirname(from);
      case 'folder':
        return this.config.newFileFolderPath;
      default:
        return '';
    }
  }

  private uniquePath(folder: string, base: string, ext: string) {
    let i = 0;
    for (;;) {
      const name = i ? `${base} ${i}` : base;
      const p = joinPath(folder, ext ? `${name}.${ext}` : name);
      if (!this.index.files.has(p)) return p;
      i++;
    }
  }

  private async writeNew(path: string, content: string | Blob) {
    await this.adapter.write(path, content);
    this.index.addFile({ path, type: 'file', mtime: Date.now() });
    if (typeof content === 'string' && extname(path) === 'md') this.index.setContent(path, content);
    this.tree.setFiles([...this.index.files.values()]);
  }

  async createNote(folder?: string, name = 'Unbenannt', content = '') {
    if (this.adapter.readOnly) return;
    try {
      const path = this.uniquePath(folder ?? this.newNoteFolder(), name, 'md');
      await this.writeNew(path, content);
      await this.openFile(path, { mode: 'source', newTab: false });
      // Titel direkt umbenennen lassen (wie Obsidian)
      const title = await prompt('Name der neuen Notiz', basename(stripExt(path)));
      if (title && title !== basename(stripExt(path))) await this.renamePath(path, joinPath(dirname(path), `${title}.md`));
      this.active?.editor?.focus();
    } catch (e) {
      this.handleError(e);
    }
  }

  async createFolder(parent = '') {
    const name = await prompt('Neuer Ordner', 'Neuer Ordner');
    if (!name) return;
    try {
      const path = joinPath(parent, name);
      await this.adapter.mkdir(path);
      this.index.addFile({ path, type: 'folder' });
      this.tree.setFiles([...this.index.files.values()]);
    } catch (e) {
      this.handleError(e);
    }
  }

  async renamePrompt(path: string) {
    const isMd = extname(path) === 'md';
    const isFolder = this.index.files.get(path)?.type === 'folder';
    const cur = isMd ? stripExt(basename(path)) : basename(path);
    const name = await prompt(isFolder ? 'Ordner umbenennen' : 'Datei umbenennen', cur);
    if (!name || name === cur) return;
    if (/[\\/:*?"<>|#^[\]]/.test(name)) {
      notice('Der Name darf keine dieser Zeichen enthalten: \\ / : * ? " < > | # ^ [ ]', 5000, 'error');
      return;
    }
    await this.renamePath(path, joinPath(dirname(path), isMd ? `${name}.md` : name));
  }

  async renamePath(from: string, to: string) {
    if (from === to) return;
    if (this.index.files.has(to)) {
      notice(`„${to}“ existiert bereits.`, 4000, 'error');
      return;
    }
    try {
      for (const t of this.tabs) if (t.dirty && (t.path === from || t.path.startsWith(`${from}/`))) await this.saveTab(t);
      // Links in anderen Notizen anpassen (wie Obsidian "Interne Links automatisch aktualisieren")
      const moved = [...this.index.files.values()]
        .filter((f) => f.type === 'file' && (f.path === from || f.path.startsWith(`${from}/`)))
        .map((f) => [f.path, to + f.path.slice(from.length)] as const);
      const rewrites = new Map<string, string>();
      if (this.prefs.updateLinks) {
        while (this.indexing) await new Promise((r) => setTimeout(r, 100));
        for (const [a, b] of moved) {
          for (const [src, text] of this.index.rewriteLinks(a, b)) {
            rewrites.set(src, text);
            this.index.setContent(src, text);
          }
        }
      }
      await this.adapter.rename(from, to);
      const mapPath = (p: string) => (p === from || p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
      for (const [src, text] of rewrites) {
        const target = mapPath(src);
        await this.adapter.write(target, text);
        const tab = this.tabs.find((t) => t.path === src);
        if (tab) {
          tab.text = text;
          tab.editor?.setText(text);
        }
      }
      for (const u of this.blobUrls.keys()) if (mapPath(u) !== u) this.blobUrls.delete(u);
      for (const t of this.tabs) {
        const np = mapPath(t.path);
        if (np !== t.path) {
          t.path = np;
          t.back = t.back.map(mapPath);
          t.forward = t.forward.map(mapPath);
        }
      }
      await this.refreshFiles();
      for (const [src, text] of rewrites) this.index.setContent(mapPath(src), text);
      for (const [, b] of moved) if (extname(b) === 'md') this.index.setContent(b, this.index.content.get(b) ?? (await this.adapter.read(b)));
      for (const t of this.tabs) {
        this.renderTabTitle(t);
        this.renderHeader(t);
        if (t.mode === 'preview') await this.renderPreview(t);
      }
      if (this.active) this.activate(this.active);
      if (rewrites.size) notice(`Links in ${rewrites.size} Notiz(en) aktualisiert.`);
    } catch (e) {
      this.handleError(e);
      await this.refreshFiles();
    }
  }

  async deletePath(path: string) {
    const isFolder = this.index.files.get(path)?.type === 'folder';
    const ok = await confirmDialog(
      'Löschen',
      `„${basename(path)}“${isFolder ? ' und alle enthaltenen Dateien' : ''} in den Papierkorb (.trash) des Vaults verschieben?`,
      'Löschen',
      true,
    );
    if (!ok) return;
    try {
      for (const t of [...this.tabs]) {
        if (t.path === path || t.path.startsWith(`${path}/`)) {
          t.dirty = false;
          this.closeTab(t);
        }
      }
      await this.adapter.delete(path);
      this.index.removePath(path);
      this.tree.setFiles([...this.index.files.values()]);
      this.renderRight();
    } catch (e) {
      this.handleError(e);
    }
  }

  private attachmentFolder(notePath: string) {
    const a = this.config.attachmentFolderPath;
    if (!a || a === '/') return '';
    if (a === './') return dirname(notePath);
    if (a.startsWith('./')) return joinPath(dirname(notePath), a.slice(2));
    return a.replace(/^\/+|\/+$/g, '');
  }

  private async saveAttachment(file: File, notePath: string): Promise<string | null> {
    try {
      const folder = this.attachmentFolder(notePath);
      let ext = extname(file.name) || file.type.split('/')[1] || 'bin';
      if (ext === 'jpeg') ext = 'jpg';
      const base = file.name && file.name !== 'image.png' ? stripExt(file.name) : `Pasted image ${formatDate(new Date(), 'YYYYMMDDHHmmss')}`;
      const path = this.uniquePath(folder, base, ext);
      await this.writeNew(path, file);
      const link = this.config.useMarkdownLinks
        ? `![${basename(path)}](${path.split('/').map(encodeURIComponent).join('/')})`
        : `![[${this.index.linkText(path)}]]`;
      return link;
    } catch (e) {
      this.handleError(e);
      return null;
    }
  }

  private async upload(files: FileList, folder: string) {
    for (const f of Array.from(files)) {
      try {
        const path = this.uniquePath(folder, stripExt(f.name), extname(f.name));
        await this.writeNew(path, extname(f.name) === 'md' ? await f.text() : f);
      } catch (e) {
        this.handleError(e);
      }
    }
    void this.loadIndex(Array.from(files).filter((f) => extname(f.name) === 'md').map((f) => joinPath(folder, f.name)));
    notice(`${files.length} Datei(en) hochgeladen.`);
  }

  async openDailyNote() {
    const d = this.config.daily;
    const name = formatDate(new Date(), d.format);
    const path = joinPath(d.folder, `${name}.md`);
    if (!this.index.files.has(path)) {
      let content = '';
      if (d.template) {
        const tpl = this.index.resolve(d.template) ?? this.index.resolve(joinPath(this.config.templatesFolder, d.template));
        if (tpl) content = applyTemplate(await this.adapter.read(tpl), basename(name));
      }
      await this.writeNew(path, content);
    }
    await this.openFile(path);
  }

  private async insertTemplate() {
    const tab = this.active;
    if (!tab?.editor && tab) this.setMode(tab, 'source');
    const folder = this.config.templatesFolder;
    if (!folder) {
      notice('Kein Vorlagen-Ordner in Obsidian konfiguriert (Core-Plugin „Vorlagen“).', 5000);
      return;
    }
    const tpls = [...this.index.files.values()].filter((f) => f.type === 'file' && f.path.startsWith(`${folder}/`) && extname(f.path) === 'md').map((f) => f.path);
    this.pickList('Vorlage einfügen', tpls.map((p) => ({ label: stripExt(p.slice(folder.length + 1)), value: p })), async (p) => {
      const t = this.active;
      if (!t?.editor) return;
      const text = applyTemplate(await this.adapter.read(p), stripExt(basename(t.path)));
      const v = t.editor.view;
      v.dispatch(v.state.replaceSelection(text));
      t.editor.focus();
    });
  }

  // ======================= Schnellwechsel & Befehle =======================

  quickSwitcher(newTab = false) {
    const files = [...this.index.files.values()].filter((f) => f.type === 'file');
    const items = files.map((f) => ({ label: extname(f.path) === 'md' ? stripExt(f.path) : f.path, value: f.path }));
    for (const [p, m] of this.index.meta) for (const a of m.aliases) items.push({ label: `${a} → ${stripExt(p)}`, value: p });
    this.pickList(
      'Datei suchen oder erstellen …',
      items,
      (p) => void this.openFile(p, { newTab }),
      this.adapter.readOnly
        ? undefined
        : async (q) => {
            const path = extname(q) ? q : `${q}.md`;
            const p = q.includes('/') ? path : joinPath(this.newNoteFolder(), path);
            await this.writeNew(p, '');
            await this.openFile(p, { newTab, mode: 'source' });
          },
    );
  }

  commandPalette() {
    this.pickList(
      'Befehl eingeben …',
      this.commands.map((c) => ({ label: c.name, value: c.id, hint: c.hotkey })),
      (id) => this.commands.find((c) => c.id === id)?.run(),
    );
  }

  private pickList(placeholder: string, items: { label: string; value: string; hint?: string }[], onPick: (v: string) => void, onCreate?: (q: string) => void) {
    const input = h('input.prompt-input', { type: 'text', placeholder });
    const list = h('div.prompt-results');
    let sel = 0;
    let shown: typeof items = [];
    const m = modal('', h('div.prompt', {}, input, list, h('div.prompt-instructions', { text: `↑↓ navigieren · ↵ öffnen${onCreate ? ' · Umschalt+↵ neu erstellen' : ''} · Esc schließen` })));
    m.el.classList.add('mod-prompt');
    const update = () => {
      const q = input.value.trim();
      shown = q
        ? items
            .map((it) => ({ it, s: fuzzy(q, it.label) }))
            .filter((x) => x.s >= 0)
            .sort((a, b) => b.s - a.s)
            .slice(0, 100)
            .map((x) => x.it)
        : items.slice(0, 100);
      sel = Math.min(sel, Math.max(shown.length - 1, 0));
      list.replaceChildren(
        ...shown.map((it, i) =>
          h('div.suggestion-item', { class: i === sel ? 'is-selected' : '', onmousedown: (e: Event) => (e.preventDefault(), choose(i)) }, h('span', { text: it.label }), it.hint ? h('kbd.suggestion-hotkey', { text: it.hint }) : null),
        ),
        ...(onCreate && q && !shown.some((s) => s.label.toLowerCase() === q.toLowerCase()) ? [h('div.suggestion-item.mod-create', { onmousedown: (e: Event) => (e.preventDefault(), (m.close(), onCreate(q))), text: `„${q}“ erstellen` })] : []),
      );
      list.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
    };
    const choose = (i: number) => {
      const it = shown[i];
      m.close();
      if (it) onPick(it.value);
    };
    input.addEventListener('input', () => ((sel = 0), update()));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        sel = Math.min(sel + 1, shown.length - 1);
        update();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        sel = Math.max(sel - 1, 0);
        update();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const q = input.value.trim();
        if ((e.shiftKey || !shown.length) && onCreate && q) {
          m.close();
          onCreate(q);
        } else choose(sel);
      }
    });
    update();
    input.focus();
  }

  private registerCommands() {
    const ro = () => this.adapter.readOnly;
    const c = (id: string, name: string, run: () => void, hotkey?: string) => this.commands.push({ id, name, run, hotkey });
    c('switcher', 'Schnellwechsel öffnen', () => this.quickSwitcher(), 'Strg+O');
    c('search', 'Im Vault suchen', () => ((this.leftTab = 'search'), this.root.classList.remove('left-collapsed'), this.renderLeft()), 'Strg+Umschalt+F');
    c('new', 'Neue Notiz erstellen', () => !ro() && void this.createNote(), 'Strg+N');
    c('daily', 'Heutige Tagesnotiz öffnen', () => !ro() && void this.openDailyNote());
    c('template', 'Vorlage einfügen', () => !ro() && void this.insertTemplate());
    c('toggle-mode', 'Bearbeiten/Lesen umschalten', () => this.active && this.setMode(this.active, this.active.mode === 'preview' ? 'source' : 'preview'), 'Strg+E');
    c('save', 'Speichern', () => this.active && void this.saveTab(this.active), 'Strg+S');
    c('rename', 'Aktuelle Datei umbenennen', () => this.active && !ro() && void this.renamePrompt(this.active.path), 'F2');
    c('delete', 'Aktuelle Datei löschen', () => this.active && !ro() && void this.deletePath(this.active.path));
    c('close', 'Aktuellen Tab schließen', () => this.active && this.closeTab(this.active), 'Strg+W');
    c('left', 'Linke Seitenleiste ein/aus', () => this.toggleSidebar('left'));
    c('right', 'Rechte Seitenleiste ein/aus', () => this.toggleSidebar('right'));
    c('backlinks', 'Rückverweise anzeigen', () => ((this.rightTab = 'backlinks'), this.root.classList.remove('right-collapsed'), this.renderRight()));
    c('outline', 'Gliederung anzeigen', () => ((this.rightTab = 'outline'), this.root.classList.remove('right-collapsed'), this.renderRight()));
    c('tags', 'Tags anzeigen', () => ((this.leftTab = 'tags'), this.root.classList.remove('left-collapsed'), this.renderLeft()));
    c('random', 'Zufällige Notiz öffnen', () => {
      const n = this.index.notes();
      if (n.length) void this.openFile(n[Math.floor(Math.random() * n.length)]);
    });
    c('reload', 'Vault neu laden', () => void this.onExternalChange(null));
    c('theme', 'Hell/Dunkel umschalten', () => {
      const dark = document.body.classList.contains('theme-dark');
      this.prefs.theme = dark ? 'light' : 'dark';
      savePrefs(this.prefs);
    });
    c('settings', 'Einstellungen', () => this.settingsDialog());
    c('exit', 'Vault wechseln / abmelden', () => void this.exit());
    if (this.adapter.kind === 'demo') c('demo-reset', 'Demo zurücksetzen', () => this.onDemoReset?.());
  }

  private onKey = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (document.querySelector('.modal-container')) return;
    if (mod && k === 'p') {
      e.preventDefault();
      this.commandPalette();
    } else if (mod && k === 'o') {
      e.preventDefault();
      this.quickSwitcher();
    } else if (mod && e.shiftKey && k === 'f') {
      e.preventDefault();
      this.commands.find((c) => c.id === 'search')!.run();
    } else if (mod && k === 'e') {
      e.preventDefault();
      this.commands.find((c) => c.id === 'toggle-mode')!.run();
    } else if (mod && k === 's') {
      e.preventDefault();
      if (this.active) void this.saveTab(this.active);
    } else if (mod && !e.shiftKey && k === 'n' && !this.adapter.readOnly) {
      e.preventDefault();
      void this.createNote();
    } else if (mod && k === 'w' && this.active) {
      // Browser lässt Strg+W meist nicht abfangen; Alt+W als Alternative
      e.preventDefault();
      this.closeTab(this.active);
    } else if (e.altKey && k === 'w' && this.active) {
      e.preventDefault();
      this.closeTab(this.active);
    } else if (e.altKey && e.key === 'ArrowLeft' && this.active) {
      e.preventDefault();
      void this.goBack(this.active);
    } else if (e.altKey && e.key === 'ArrowRight' && this.active) {
      e.preventDefault();
      void this.goForward(this.active);
    } else if (e.key === 'F2' && this.active && !this.adapter.readOnly) {
      e.preventDefault();
      void this.renamePrompt(this.active.path);
    }
  };

  settingsDialog() {
    const p = this.prefs;
    const row = (label: string, desc: string, control: HTMLElement) =>
      h('div.setting-item', {}, h('div.setting-item-info', {}, h('div.setting-item-name', { text: label }), h('div.setting-item-description', { text: desc })), h('div.setting-item-control', {}, control));
    const select = (value: string, opts: [string, string][], on: (v: string) => void) => {
      const s = h('select.dropdown', { onchange: () => on(s.value) }, ...opts.map(([v, l]) => h('option', { value: v, text: l, selected: v === value })));
      return s;
    };
    const toggle = (value: boolean, on: (v: boolean) => void) => {
      const t = h('div.checkbox-container', { class: value ? 'is-enabled' : '', onclick: () => on(t.classList.toggle('is-enabled')) });
      return t;
    };
    const apply = () => savePrefs(p);
    const body = h(
      'div.settings',
      {},
      row('Farbschema', 'Hell, dunkel oder wie das System', select(p.theme, [['system', 'System'], ['dark', 'Dunkel'], ['light', 'Hell']], (v) => ((p.theme = v as Prefs['theme']), apply()))),
      row('Standardansicht', 'Wie neue Notizen geöffnet werden', select(p.defaultMode, [['preview', 'Leseansicht'], ['source', 'Bearbeiten']], (v) => ((p.defaultMode = v as Mode), apply()))),
      row('Lesbare Zeilenlänge', 'Textbreite begrenzen', toggle(p.readableWidth, (v) => ((p.readableWidth = v), apply()))),
      row('Schriftgröße', `${p.fontSize}px`, (() => {
        const r = h('input.slider', { type: 'range', min: 12, max: 24, value: p.fontSize });
        r.addEventListener('input', () => {
          p.fontSize = Number(r.value);
          (r.closest('.setting-item')!.querySelector('.setting-item-description') as HTMLElement).textContent = `${p.fontSize}px`;
          apply();
        });
        return r;
      })()),
      row('Interne Links aktualisieren', 'Beim Umbenennen/Verschieben Links in anderen Notizen anpassen', toggle(p.updateLinks, (v) => ((p.updateLinks = v), apply()))),
      h('div.setting-item.setting-info', {}, h('div.setting-item-info', {}, h('div.setting-item-name', { text: 'Vault' }), h('div.setting-item-description', { text: `${this.adapter.name} · ${sourceLabel(this.adapter)} · ${this.index.notes().length} Notizen` }))),
      h(
        'div.setting-item.setting-info',
        {},
        h(
          'div.setting-item-info',
          {},
          h('div.setting-item-name', { text: 'Über Vault Browser' }),
          h('div.setting-item-description', {}, `Freie Software unter ${LICENSE_NAME}. `, h('a.source-link', { href: SOURCE_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Quellcode ansehen' })),
        ),
      ),
    );
    modal('Einstellungen', body, { wide: true });
  }

  private async exit() {
    for (const t of this.tabs) if (t.dirty) await this.saveTab(t);
    if (this.adapter instanceof ServerAdapter) await this.adapter.logout().catch(() => {});
    this.destroy();
    if (this.adapter.ephemeral) {
      try {
        sessionStorage.clear();
      } catch {
        /* egal */
      }
    }
    this.onExit();
  }

  private handleError(e: unknown) {
    console.error(e);
    if (e instanceof AuthError) {
      notice(e.message, 6000, 'error');
      this.destroy();
      this.onExit();
      return;
    }
    notice((e as Error)?.message ?? String(e), 6000, 'error');
  }

  // ======================= Sitzung merken =======================

  private sessionKey() {
    return `obui.session.${this.adapter.kind}.${this.adapter.name}`;
  }

  private store() {
    return this.adapter.ephemeral ? sessionStorage : localStorage;
  }

  private saveSession() {
    try {
      this.store().setItem(this.sessionKey(), JSON.stringify({ tabs: this.tabs.map((t) => ({ path: t.path, mode: t.mode })), active: this.active ? this.tabs.indexOf(this.active) : -1 }));
    } catch {
      /* egal */
    }
  }

  private restoreSession() {
    let s: { tabs: { path: string; mode: Mode }[]; active: number } | null = null;
    try {
      s = JSON.parse(this.store().getItem(this.sessionKey()) ?? 'null');
    } catch {
      /* egal */
    }
    // Deep-Link: #/pfad/zur/notiz.md
    const hashPath = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    if (hashPath && this.index.files.has(hashPath)) {
      void this.openFile(hashPath, { newTab: true });
      return;
    }
    const tabs = (s?.tabs ?? []).filter((t) => this.index.files.get(t.path)?.type === 'file');
    if (!tabs.length) {
      this.showEmpty();
      return;
    }
    void (async () => {
      for (const t of tabs) await this.openFile(t.path, { newTab: true, mode: t.mode });
      const a = this.tabs[s!.active] ?? this.tabs[0];
      if (a) this.activate(a);
    })();
  }
}

function rotated(el: SVGElement, deg: number) {
  el.style.transform = `rotate(${deg}deg)`;
  return el;
}

function sourceLabel(a: VaultAdapter) {
  return { server: 'Server', localfs: 'Lokaler Ordner', restapi: 'Obsidian REST API', readonly: 'Lokal (nur lesen)', demo: 'Demo', livesync: 'Self-hosted LiveSync' }[a.kind];
}

function highlightTerms(text: string, terms: string[]) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (!terms.length) return esc;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('|')})`, 'gi');
  return esc.replace(re, '<mark>$1</mark>');
}

/** Sammelt Datei-Events und liefert sie gebündelt */
function debounceExternal(cb: (paths: string[]) => void) {
  let set = new Set<string>();
  const fire = debounce(() => {
    const paths = [...set];
    set = new Set();
    cb(paths);
  }, 400);
  return (e: { path: string }) => {
    set.add(e.path);
    fire();
  };
}
