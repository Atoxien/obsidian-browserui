// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Atoxien
export interface VaultFile {
  path: string;
  type: 'file' | 'folder';
  mtime?: number;
  size?: number;
}

export type ChangeEvent = { event: string; path: string };

/** Gemeinsame Schnittstelle aller Vault-Quellen (Server, lokaler Ordner, Obsidian REST API, später WebDAV). */
export interface VaultAdapter {
  readonly kind: 'server' | 'localfs' | 'restapi' | 'readonly' | 'demo';
  readonly name: string;
  readonly readOnly: boolean;
  /** true = keine Spuren (geöffnete Tabs etc.) dauerhaft im Browser hinterlassen, z.B. auf fremden Rechnern */
  readonly ephemeral?: boolean;
  list(): Promise<VaultFile[]>;
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<Blob>;
  write(path: string, content: string | Blob): Promise<void>;
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  delete(path: string): Promise<void>;
  watch?(cb: (e: ChangeEvent) => void): () => void;
  close?(): void;
}

export class ConflictError extends Error {}
export class AuthError extends Error {}
