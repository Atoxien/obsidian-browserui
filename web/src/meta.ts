// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Atoxien

/**
 * Quellcode dieser Instanz (AGPL-3.0 §13: Nutzer über das Netzwerk müssen den Quellcode erhalten können).
 * Beim Build über VITE_SOURCE_URL gesetzt – GitHub Actions trägt automatisch das jeweilige Repo ein,
 * Forks zeigen so auf ihren eigenen Code.
 */
export const SOURCE_URL: string = (import.meta.env.VITE_SOURCE_URL as string | undefined)?.replace(/\/+$/, '') || 'https://github.com/Atoxien/obsidian-browserui';
export const LICENSE_NAME = 'AGPL-3.0-or-later';
