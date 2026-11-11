// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Atoxien
// Minimaler YAML-Frontmatter-Parser (deckt die in Obsidian-Properties üblichen Formen ab).

export type FMValue = string | number | boolean | null | FMValue[];
export interface Frontmatter {
  data: Record<string, FMValue>;
  body: string;
  /** Anzahl Zeilen des Frontmatter-Blocks inkl. Begrenzer (0 wenn keiner) */
  lines: number;
  raw: string;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export function parseFrontmatter(src: string): Frontmatter {
  const m = FM_RE.exec(src);
  if (!m) return { data: {}, body: src, lines: 0, raw: '' };
  const raw = m[1];
  return {
    data: parseYamlSubset(raw),
    body: src.slice(m[0].length),
    lines: m[0].split('\n').length - (m[0].endsWith('\n') ? 1 : 0),
    raw,
  };
}

function scalar(v: string): FMValue {
  const s = v.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return splitFlow(inner).map(scalar);
  }
  return s;
}

function splitFlow(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q: string | null = null;
  let depth = 0;
  for (const ch of s) {
    if (q) {
      if (ch === q) q = null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
    } else if (ch === '[') {
      depth++;
      cur += ch;
    } else if (ch === ']') {
      depth--;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function parseYamlSubset(raw: string): Record<string, FMValue> {
  const data: Record<string, FMValue> = {};
  let key: string | null = null;
  let block: string[] | null = null;
  let blockStyle: '|' | '>' | null = null;
  const flushBlock = () => {
    if (key && block && blockStyle) data[key] = block.join(blockStyle === '|' ? '\n' : ' ').trim();
    block = null;
    blockStyle = null;
  };
  for (const line of raw.split(/\r?\n/)) {
    if (blockStyle && (/^\s+/.test(line) || line === '')) {
      block!.push(line.trim());
      continue;
    }
    flushBlock();
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const item = /^\s*-\s*(.*)$/.exec(line);
    if (item && key) {
      const cur = data[key];
      const arr = Array.isArray(cur) ? cur : [];
      arr.push(scalar(item[1]));
      data[key] = arr;
      continue;
    }
    const kv = /^([^:\s][^:]*?)\s*:(?:\s+(.*))?$/.exec(line);
    if (kv) {
      key = kv[1].trim().replace(/^["']|["']$/g, '');
      const v = kv[2] ?? '';
      if (v === '|' || v === '>' || v === '|-' || v === '>-') {
        blockStyle = v[0] as '|' | '>';
        block = [];
        data[key] = '';
      } else {
        data[key] = v === '' ? null : scalar(v);
      }
    }
  }
  flushBlock();
  return data;
}

/** Tags aus dem Frontmatter (tags / tag, als Liste oder komma-/leerzeichengetrennt). */
export function frontmatterTags(data: Record<string, FMValue>): string[] {
  const v = data.tags ?? data.tag;
  if (v == null) return [];
  const list = Array.isArray(v) ? v : String(v).split(/[,\s]+/);
  return list
    .filter((x) => x != null && x !== '')
    .map((x) => String(x).replace(/^#/, ''))
    .filter(Boolean);
}

export function frontmatterAliases(data: Record<string, FMValue>): string[] {
  const v = data.aliases ?? data.alias;
  if (v == null) return [];
  return (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean);
}
