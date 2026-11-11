// Dateibaum (linke Seitenleiste).
import type { VaultFile } from '../adapters/types';
import { basename, dirname, extname, stripExt } from '../vault/paths';
import { contextMenu, h, icon } from './dom';

export interface TreeActions {
  open(path: string, newTab: boolean): void;
  newNote(folder: string): void;
  newFolder(folder: string): void;
  rename(path: string): void;
  move(path: string, toFolder: string): void;
  remove(path: string): void;
  upload(files: FileList, folder: string): void;
  readOnly: boolean;
}

interface Node {
  name: string;
  path: string;
  folder: boolean;
  children: Node[];
}

const STORE = 'obui.tree.open';

export class FileTree {
  el = h('div.nav-files-container');
  private expanded: Set<string>;
  private active: string | null = null;
  private files: VaultFile[] = [];

  constructor(private actions: TreeActions) {
    try {
      this.expanded = new Set(JSON.parse(localStorage.getItem(STORE) ?? '[]'));
    } catch {
      this.expanded = new Set();
    }
    this.el.addEventListener('contextmenu', (e) => {
      if (e.target === this.el && !actions.readOnly) {
        contextMenu(e, [
          { label: 'Neue Notiz', action: () => actions.newNote('') },
          { label: 'Neuer Ordner', action: () => actions.newFolder('') },
        ]);
      }
    });
    this.makeDropTarget(this.el, '');
  }

  private save() {
    try {
      localStorage.setItem(STORE, JSON.stringify([...this.expanded]));
    } catch {
      /* egal */
    }
  }

  setFiles(files: VaultFile[]) {
    this.files = files;
    this.render();
  }

  setActive(path: string | null) {
    this.active = path;
    if (path) {
      let d = dirname(path);
      let changed = false;
      while (d) {
        if (!this.expanded.has(d)) {
          this.expanded.add(d);
          changed = true;
        }
        d = dirname(d);
      }
      if (changed) this.save();
    }
    this.render();
    this.el.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  collapseAll() {
    this.expanded.clear();
    this.save();
    this.render();
  }

  private build(): Node {
    const root: Node = { name: '', path: '', folder: true, children: [] };
    const map = new Map<string, Node>([['', root]]);
    const ensure = (p: string): Node => {
      const existing = map.get(p);
      if (existing) return existing;
      const n: Node = { name: basename(p), path: p, folder: true, children: [] };
      map.set(p, n);
      ensure(dirname(p)).children.push(n);
      return n;
    };
    for (const f of this.files) {
      if (f.type === 'folder') ensure(f.path);
      else {
        const parent = ensure(dirname(f.path));
        parent.children.push({ name: basename(f.path), path: f.path, folder: false, children: [] });
      }
    }
    const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const sort = (n: Node) => {
      n.children.sort((a, b) => (a.folder === b.folder ? coll.compare(a.name, b.name) : a.folder ? -1 : 1));
      n.children.forEach(sort);
    };
    sort(root);
    return root;
  }

  render() {
    const root = this.build();
    const frag = document.createDocumentFragment();
    for (const c of root.children) frag.append(this.renderNode(c, 0));
    this.el.replaceChildren(frag);
  }

  private renderNode(n: Node, depth: number): HTMLElement {
    const a = this.actions;
    const pad = `${8 + depth * 16}px`;
    if (n.folder) {
      const open = this.expanded.has(n.path);
      const title = h(
        'div.tree-item-self.nav-folder-title',
        { style: `padding-left:${pad}`, draggable: a.readOnly ? 'false' : 'true', 'data-path': n.path, title: n.path },
        h('span.tree-item-icon.collapse-icon', { class: open ? '' : 'is-collapsed' }, icon('chevron', 14)),
        h('span.tree-item-inner', { text: n.name }),
      );
      title.addEventListener('click', () => {
        if (open) this.expanded.delete(n.path);
        else this.expanded.add(n.path);
        this.save();
        this.render();
      });
      title.addEventListener('contextmenu', (e) =>
        contextMenu(
          e,
          a.readOnly
            ? []
            : [
                { label: 'Neue Notiz', action: () => a.newNote(n.path) },
                { label: 'Neuer Ordner', action: () => a.newFolder(n.path) },
                '-',
                { label: 'Umbenennen', action: () => a.rename(n.path) },
                { label: 'Löschen', danger: true, action: () => a.remove(n.path) },
              ],
        ),
      );
      this.makeDraggable(title, n.path);
      this.makeDropTarget(title, n.path);
      const wrap = h('div.tree-item.nav-folder', {}, title);
      if (open) {
        const kids = h('div.tree-item-children');
        for (const c of n.children) kids.append(this.renderNode(c, depth + 1));
        wrap.append(kids);
      }
      return wrap;
    }
    const ext = extname(n.path);
    const isActive = this.active === n.path;
    const title = h(
      'div.tree-item-self.nav-file-title',
      { class: isActive ? 'is-active' : '', style: `padding-left:${pad + ''}`, draggable: a.readOnly ? 'false' : 'true', 'data-path': n.path, title: n.path },
      h('span.tree-item-inner', { text: ext === 'md' ? stripExt(n.name) : n.name }),
      ext && ext !== 'md' ? h('span.nav-file-tag', { text: ext }) : null,
    );
    title.style.paddingLeft = `${8 + depth * 16 + 18}px`;
    title.addEventListener('click', (e) => a.open(n.path, e.ctrlKey || e.metaKey));
    title.addEventListener('auxclick', (e) => e.button === 1 && a.open(n.path, true));
    title.addEventListener('contextmenu', (e) =>
      contextMenu(e, [
        { label: 'In neuem Tab öffnen', action: () => a.open(n.path, true) },
        { label: 'Pfad kopieren', action: () => void navigator.clipboard?.writeText(n.path) },
        ...(a.readOnly
          ? []
          : ([
              '-',
              { label: 'Umbenennen', action: () => a.rename(n.path) },
              { label: 'Löschen', danger: true, action: () => a.remove(n.path) },
            ] as const)),
      ]),
    );
    this.makeDraggable(title, n.path);
    return h('div.tree-item.nav-file', {}, title);
  }

  private makeDraggable(el: HTMLElement, path: string) {
    if (this.actions.readOnly) return;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer!.setData('application/x-obui-path', path);
      e.dataTransfer!.effectAllowed = 'move';
    });
  }

  private makeDropTarget(el: HTMLElement, folder: string) {
    if (this.actions.readOnly) return;
    el.addEventListener('dragover', (e) => {
      const dt = e.dataTransfer!;
      if (dt.types.includes('application/x-obui-path') || dt.types.includes('Files')) {
        e.preventDefault();
        e.stopPropagation();
        el.classList.add('is-being-dragged-over');
      }
    });
    el.addEventListener('dragleave', () => el.classList.remove('is-being-dragged-over'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('is-being-dragged-over');
      const dt = e.dataTransfer!;
      const p = dt.getData('application/x-obui-path');
      if (p) {
        e.preventDefault();
        e.stopPropagation();
        if (p !== folder && dirname(p) !== folder && !folder.startsWith(`${p}/`)) this.actions.move(p, folder);
      } else if (dt.files.length) {
        e.preventDefault();
        e.stopPropagation();
        this.actions.upload(dt.files, folder);
      }
    });
  }
}
