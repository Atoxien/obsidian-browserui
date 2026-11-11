// Markdown-Editor auf Basis von CodeMirror 6.
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine, dropCursor, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';

const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, class: 'cm-h1' },
  { tag: t.heading2, class: 'cm-h2' },
  { tag: t.heading3, class: 'cm-h3' },
  { tag: t.heading4, class: 'cm-h4' },
  { tag: [t.heading5, t.heading6], class: 'cm-h5' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, class: 'cm-md-link' },
  { tag: t.url, class: 'cm-md-url' },
  { tag: t.monospace, class: 'cm-md-code' },
  { tag: t.quote, class: 'cm-md-quote' },
  { tag: [t.processingInstruction, t.meta], class: 'cm-md-formatting' },
  { tag: t.keyword, color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--code-string)' },
  { tag: t.comment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.atom], color: 'var(--code-value)' },
  { tag: [t.function(t.variableName), t.propertyName], color: 'var(--code-function)' },
  { tag: [t.typeName, t.className], color: 'var(--code-tag)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--text-normal)' },
  '.cm-scroller': { fontFamily: 'var(--font-text)', lineHeight: '1.6', overflow: 'auto' },
  '.cm-content': { padding: '24px 0 40vh', maxWidth: 'var(--line-width)', margin: '0 auto', caretColor: 'var(--text-accent)' },
  '.cm-line': { padding: '0 24px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--background-active-line)' },
  '.cm-cursor': { borderLeftColor: 'var(--text-accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--text-selection) !important' },
  '.cm-tooltip': { backgroundColor: 'var(--background-secondary)', border: '1px solid var(--background-modifier-border)', borderRadius: '6px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--interactive-accent)', color: 'var(--text-on-accent)' },
  '.cm-panels': { backgroundColor: 'var(--background-secondary)', color: 'var(--text-normal)' },
});

export interface EditorHooks {
  onChange(text: string): void;
  /** Vervollständigung für [[ ]] */
  linkCompletions(query: string): { label: string; detail?: string }[];
  tagCompletions(query: string): string[];
  /** Strg/Cmd-Klick auf einen Link */
  openLink(target: string, newTab: boolean): void;
  /** Bild/Datei eingefügt oder abgelegt – liefert einzufügenden Markdown-Text */
  saveAttachment?(file: File): Promise<string | null>;
  onSave(): void;
}

export class MarkdownEditor {
  view: EditorView;
  private readOnly = new Compartment();
  private suppress = false;

  constructor(parent: HTMLElement, doc: string, hooks: EditorHooks, readOnly = false) {
    const linkSource = (ctx: CompletionContext): CompletionResult | null => {
      const before = ctx.matchBefore(/!?\[\[[^\]\n]*/);
      if (!before) return null;
      const start = before.text.indexOf('[[') + 2;
      const query = before.text.slice(start);
      const hashOrPipe = /[#|]/.test(query);
      if (hashOrPipe) return null;
      const after = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2);
      return {
        from: before.from + start,
        options: hooks.linkCompletions(query).map((o) => ({
          label: o.label,
          detail: o.detail,
          apply: after === ']]' ? o.label : `${o.label}]]`,
        })),
        filter: false,
      };
    };
    const tagSource = (ctx: CompletionContext): CompletionResult | null => {
      const before = ctx.matchBefore(/(?:^|\s)#[\p{L}\p{N}_\-/]*/u);
      if (!before || (before.text.trim() === '#' && !ctx.explicit && before.text.length < 2)) return null;
      const hash = before.text.indexOf('#');
      const q = before.text.slice(hash + 1);
      // Überschriften am Zeilenanfang nicht vervollständigen
      const line = ctx.state.doc.lineAt(ctx.pos);
      if (before.from + hash === line.from && /^#+\s/.test(line.text)) return null;
      return {
        from: before.from + hash + 1,
        options: hooks.tagCompletions(q).map((tag) => ({ label: tag, type: 'keyword' })),
        validFor: /^[\p{L}\p{N}_\-/]*$/u,
      };
    };

    const linkAt = (view: EditorView, pos: number): string | null => {
      const line = view.state.doc.lineAt(pos);
      const off = pos - line.from;
      for (const m of line.text.matchAll(/!?\[\[([^\]]+)\]\]/g)) {
        if (off >= m.index! && off <= m.index! + m[0].length) return m[1].split('|')[0];
      }
      for (const m of line.text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        if (off >= m.index! && off <= m.index! + m[0].length) return m[1];
      }
      for (const m of line.text.matchAll(/https?:\/\/[^\s)>\]]+/g)) {
        if (off >= m.index! && off <= m.index! + m[0].length) return m[0];
      }
      return null;
    };

    const handleFiles = (files: FileList | null | undefined, view: EditorView, pos?: number) => {
      if (!files?.length || !hooks.saveAttachment) return false;
      const list = Array.from(files);
      void (async () => {
        for (const f of list) {
          const text = await hooks.saveAttachment!(f);
          if (!text) continue;
          const at = pos ?? view.state.selection.main.head;
          view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } });
        }
      })();
      return true;
    };

    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          history(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
          syntaxHighlighting(mdHighlight),
          autocompletion({ override: [linkSource, tagSource], activateOnTyping: true }),
          placeholder('Schreib los …'),
          theme,
          this.readOnly.of(EditorState.readOnly.of(readOnly)),
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => (hooks.onSave(), true) },
            { key: 'Mod-b', run: (v) => wrap(v, '**') },
            { key: 'Mod-i', run: (v) => wrap(v, '*') },
            { key: 'Mod-Shift-h', run: (v) => wrap(v, '==') },
            { key: 'Mod-l', run: toggleTask },
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...searchKeymap,
            ...historyKeymap,
            indentWithTab,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !this.suppress) hooks.onChange(u.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            mousedown: (e, view) => {
              if (!(e.ctrlKey || e.metaKey)) return false;
              const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
              if (pos == null) return false;
              const target = linkAt(view, pos);
              if (!target) return false;
              e.preventDefault();
              if (/^https?:/.test(target)) window.open(target, '_blank', 'noopener');
              else hooks.openLink(target, e.shiftKey);
              return true;
            },
            paste: (e, view) => {
              if (e.clipboardData?.files.length) {
                e.preventDefault();
                return handleFiles(e.clipboardData.files, view);
              }
              return false;
            },
            drop: (e, view) => {
              if (!e.dataTransfer?.files.length) return false;
              e.preventDefault();
              const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? undefined;
              return handleFiles(e.dataTransfer.files, view, pos);
            },
          }),
        ],
      }),
    });
  }

  get text() {
    return this.view.state.doc.toString();
  }

  /** Inhalt ersetzen (z.B. nach externer Änderung), Cursor möglichst beibehalten */
  setText(text: string) {
    if (text === this.text) return;
    const head = Math.min(this.view.state.selection.main.head, text.length);
    this.suppress = true;
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text }, selection: { anchor: head } });
    this.suppress = false;
  }

  scrollToLine(line: number) {
    const l = this.view.state.doc.line(Math.min(Math.max(line + 1, 1), this.view.state.doc.lines));
    this.view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'start', yMargin: 40 }) });
  }

  focus() {
    this.view.focus();
  }

  destroy() {
    this.view.destroy();
  }
}

function wrap(view: EditorView, mark: string) {
  const changes = view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to);
    if (text.startsWith(mark) && text.endsWith(mark) && text.length >= mark.length * 2) {
      const inner = text.slice(mark.length, -mark.length);
      return { changes: { from: range.from, to: range.to, insert: inner }, range: { anchor: range.from, head: range.from + inner.length } as never };
    }
    return {
      changes: [
        { from: range.from, insert: mark },
        { from: range.to, insert: mark },
      ],
      range: { anchor: range.from + mark.length, head: range.to + mark.length } as never,
    };
  });
  view.dispatch(view.state.update(changes as never, { scrollIntoView: true }));
  return true;
}

function toggleTask(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const m = /^(\s*)([-*+]|\d+\.)\s+\[(.)\]\s/.exec(line.text);
  let insert: string;
  let from = line.from;
  let to = line.from;
  if (m) {
    const pos = line.from + m[0].indexOf('[') + 1;
    from = pos;
    to = pos + 1;
    insert = m[3] === ' ' ? 'x' : ' ';
  } else {
    const lm = /^(\s*)([-*+]|\d+\.)\s+/.exec(line.text);
    if (lm) {
      from = to = line.from + lm[0].length;
      insert = '[ ] ';
    } else {
      const indent = /^\s*/.exec(line.text)![0].length;
      from = to = line.from + indent;
      insert = '- [ ] ';
    }
  }
  view.dispatch({ changes: { from, to, insert } });
  return true;
}
