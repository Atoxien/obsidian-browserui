# Drittanbieter-Software

Dieses Projekt verwendet bzw. enthält folgende Open-Source-Komponenten. Die jeweiligen Lizenztexte liegen den Paketen in `node_modules/` bei; im gebauten Frontend (`web/dist`) sind sie gebündelt enthalten.

| Komponente | Lizenz | Verwendung |
| --- | --- | --- |
| [CodeMirror 6](https://codemirror.net/) (`@codemirror/*`, `@lezer/*`) | MIT | Markdown-Editor |
| [markdown-it](https://github.com/markdown-it/markdown-it) | MIT | Markdown-Rendering |
| ↳ `entities` | BSD-2-Clause | Abhängigkeit von markdown-it |
| ↳ `argparse` | PSF-2.0 | Abhängigkeit von markdown-it (nur CLI, nicht im Browser-Bundle) |
| [KaTeX](https://katex.org/) inkl. Schriften | MIT | Formeln (`$…$`) |
| [DOMPurify](https://github.com/cure53/DOMPurify) | MPL-2.0 oder Apache-2.0 (wählbar) | HTML-Bereinigung |
| [Fastify](https://fastify.dev/) und Plugins (`@fastify/static`, `@fastify/cookie`) | MIT (einzelne Unterpakete BSD-3-Clause, ISC) | Server |
| [chokidar](https://github.com/paulmillr/chokidar) | MIT | Datei-Überwachung |
| `glob`, `minimatch`, `minipass`, `lru-cache`, `path-scurry` | BlueOak-1.0.0 | Abhängigkeiten von `@fastify/static` |
| [Lucide Icons](https://lucide.dev/) (einzelne SVG-Pfade in `web/src/ui/dom.ts`) | ISC | Symbole |

## Lucide – ISC License

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## Hinweis zu Obsidian

„Obsidian“ ist eine Marke von Dynalist Inc. Dieses Projekt ist ein unabhängiges Community-Projekt, steht in keiner Verbindung zu Obsidian/Dynalist Inc. und enthält keinen Code, keine Grafiken und keine Theme-Dateien aus Obsidian. Das Aussehen ist eigenständig nachempfunden.
