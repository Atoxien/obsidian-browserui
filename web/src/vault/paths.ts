// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Atoxien
export const HIDDEN_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);

export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const extname = (p: string) => {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
};
export const stripExt = (p: string) => {
  const e = extname(p);
  return e ? p.slice(0, -(e.length + 1)) : p;
};
export const joinPath = (...parts: string[]) => parts.filter(Boolean).join('/');

export const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
export const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'webm']);
export const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'ogv']);
export const TEXT_EXT = new Set(['md', 'txt', 'canvas', 'json', 'css', 'js', 'csv']);
