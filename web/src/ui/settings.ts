// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Atoxien
// Benutzer-Einstellungen (pro Browser) und Obsidian-Vault-Konfiguration (.obsidian/*.json).
import type { VaultAdapter } from '../adapters/types';

export interface Prefs {
  theme: 'system' | 'dark' | 'light';
  defaultMode: 'preview' | 'source';
  readableWidth: boolean;
  fontSize: number;
  updateLinks: boolean;
}

const KEY = 'obui.prefs';
const DEFAULTS: Prefs = { theme: 'system', defaultMode: 'preview', readableWidth: true, fontSize: 16, updateLinks: true };

export function loadPrefs(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* privat-Modus */
  }
  applyPrefs(p);
}

export function applyPrefs(p: Prefs) {
  const root = document.documentElement;
  const dark = p.theme === 'dark' || (p.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.classList.toggle('theme-dark', dark);
  document.body.classList.toggle('theme-light', !dark);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.setProperty('--font-text-size', `${p.fontSize}px`);
  root.style.setProperty('--line-width', p.readableWidth ? '46rem' : '100%');
}

export interface ObsidianConfig {
  newFileLocation: 'root' | 'current' | 'folder';
  newFileFolderPath: string;
  attachmentFolderPath: string;
  useMarkdownLinks: boolean;
  daily: { folder: string; format: string; template: string };
  templatesFolder: string;
}

async function readJson(adapter: VaultAdapter, path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await adapter.read(path));
  } catch {
    return {};
  }
}

export async function loadObsidianConfig(adapter: VaultAdapter): Promise<ObsidianConfig> {
  const [app, daily, templates] = await Promise.all([
    readJson(adapter, '.obsidian/app.json'),
    readJson(adapter, '.obsidian/daily-notes.json'),
    readJson(adapter, '.obsidian/templates.json'),
  ]);
  const s = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
  return {
    newFileLocation: (s(app.newFileLocation, 'root') as ObsidianConfig['newFileLocation']) || 'root',
    newFileFolderPath: s(app.newFileFolderPath).replace(/^\/+|\/+$/g, ''),
    attachmentFolderPath: s(app.attachmentFolderPath, '/'),
    useMarkdownLinks: app.useMarkdownLinks === true,
    daily: {
      folder: s(daily.folder).replace(/^\/+|\/+$/g, ''),
      format: s(daily.format) || 'YYYY-MM-DD',
      template: s(daily.template),
    },
    templatesFolder: s(templates.folder).replace(/^\/+|\/+$/g, ''),
  };
}

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Teilmenge der Moment.js-Formate, die in Obsidian üblich ist. */
export function formatDate(d: Date, fmt: string): string {
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  const tokens: Record<string, () => string> = {
    YYYY: () => String(d.getFullYear()),
    YY: () => String(d.getFullYear()).slice(-2),
    MMMM: () => MONTHS[d.getMonth()],
    MMM: () => MONTHS[d.getMonth()].slice(0, 3),
    MM: () => pad(d.getMonth() + 1),
    M: () => String(d.getMonth() + 1),
    DD: () => pad(d.getDate()),
    D: () => String(d.getDate()),
    dddd: () => WEEKDAYS[d.getDay()],
    ddd: () => WEEKDAYS[d.getDay()].slice(0, 2),
    HH: () => pad(d.getHours()),
    mm: () => pad(d.getMinutes()),
    ss: () => pad(d.getSeconds()),
    ww: () => pad(isoWeek(d)),
    W: () => String(isoWeek(d)),
  };
  return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|mm|ss|ww|W/g, (m, lit) => (lit !== undefined ? lit : tokens[m]()));
}

function isoWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** {{date}}, {{time}}, {{title}} wie im Core-Plugin "Vorlagen" */
export function applyTemplate(tpl: string, title: string, now = new Date()) {
  return tpl
    .replace(/\{\{date(?::([^}]+))?\}\}/g, (_m, f) => formatDate(now, f ?? 'YYYY-MM-DD'))
    .replace(/\{\{time(?::([^}]+))?\}\}/g, (_m, f) => formatDate(now, f ?? 'HH:mm'))
    .replace(/\{\{title\}\}/g, title);
}
