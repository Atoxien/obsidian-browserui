// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Atoxien
import 'katex/dist/katex.min.css';
import './styles/obsidian.css';
import type { VaultAdapter } from './adapters/types';
import { ServerAdapter, normalizeServerUrl, probeServer, serverLogin } from './adapters/server';
import { ReadOnlyFilesAdapter, pickLocalVault, rememberedLocalVault, reopenLocalVault, supportsFSAccess } from './adapters/localfs';
import { RestApiAdapter } from './adapters/restapi';
import { DemoAdapter, demoSeed } from './adapters/demo';
import { App } from './ui/app';
import { h, icon, notice } from './ui/dom';
import { applyPrefs, loadPrefs } from './ui/settings';
import { LICENSE_NAME, SOURCE_URL } from './meta';

const host = document.getElementById('app')!;
const LAST = 'obui.last';
const REST = 'obui.rest';
const REMOTE = 'obui.remote'; // sessionStorage: {url, token, name} – verschwindet mit dem Tab
const REMOTE_URL = 'obui.remote.url'; // localStorage: nur wenn "Adresse merken" gewählt
const LIVESYNC = 'obui.livesync'; // sessionStorage: Zugangsdaten nur für diesen Tab
const LIVESYNC_SAVED = 'obui.livesync.saved'; // localStorage: nur Adresse/Datenbank/Benutzer, wenn gewünscht

/** Felder einer LiveSync-Verbindung (das Adapter-Modul selbst wird erst beim Verbinden geladen) */
interface LiveSyncConfig {
  url: string;
  database: string;
  username: string;
  password: string;
  passphrase: string;
  idDerivationKey?: string;
}

async function startLiveSync(cfg: LiveSyncConfig) {
  const { LiveSyncAdapter } = await import('./adapters/livesync');
  const adapter = await LiveSyncAdapter.connect(cfg);
  try {
    sessionStorage.setItem(LIVESYNC, JSON.stringify(cfg));
  } catch {
    /* egal */
  }
  await start(adapter);
}

/** Karte „Self-hosted LiveSync“: direkt mit der CouchDB verbinden, wie die Obsidian-App */
function liveSyncCard(): HTMLElement {
  const err = errorLine();
  let saved: Partial<LiveSyncConfig> = {};
  try {
    saved = JSON.parse(localStorage.getItem(LIVESYNC_SAVED) ?? '{}');
  } catch {
    /* egal */
  }
  const busy = (btn: HTMLButtonElement, on: boolean, label: string) => {
    btn.disabled = on;
    btn.textContent = on ? 'Verbinde …' : label;
  };
  const fail = (ex: unknown) => {
    err.textContent = (ex as Error).message || String(ex);
  };

  // a) Setup-URI (empfohlen) – enthält alle Einstellungen
  const uri = h('textarea.source-textarea', { rows: 3, placeholder: 'obsidian://setuplivesync?settings=…', spellcheck: 'false' }) as HTMLTextAreaElement;
  const uriPw = h('input', { type: 'password', placeholder: 'Passwort der Setup-URI', autocomplete: 'off' }) as HTMLInputElement;
  const uriBtn = h('button.mod-cta', { type: 'submit', text: 'Mit Setup-URI verbinden' }) as HTMLButtonElement;
  const uriForm = h(
    'form.source-form',
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        err.textContent = '';
        busy(uriBtn, true, 'Mit Setup-URI verbinden');
        try {
          const { configFromSetupURI } = await import('./adapters/livesync');
          await startLiveSync(await configFromSetupURI(uri.value, uriPw.value));
        } catch (ex) {
          fail(ex);
        } finally {
          busy(uriBtn, false, 'Mit Setup-URI verbinden');
        }
      },
    },
    uri,
    uriPw,
    uriBtn,
    h('div.source-hint', { text: 'In Obsidian: Befehlspalette → „Self-hosted LiveSync: Copy the setup URI“ (bzw. in den LiveSync-Einstellungen). Das Passwort ist das, das du dabei vergibst.' }),
  );

  // b) Manuell
  const url = h('input', { type: 'url', value: saved.url ?? '', placeholder: 'CouchDB-Adresse, z.B. https://couchdb.example.com', autocomplete: 'url' }) as HTMLInputElement;
  const db = h('input', { type: 'text', value: saved.database ?? '', placeholder: 'Datenbankname', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const user = h('input', { type: 'text', value: saved.username ?? '', placeholder: 'CouchDB-Benutzer', autocomplete: 'username' }) as HTMLInputElement;
  const pw = h('input', { type: 'password', placeholder: 'CouchDB-Passwort', autocomplete: 'current-password' }) as HTMLInputElement;
  const pass = h('input', { type: 'password', placeholder: 'E2EE-Passphrase (leer, wenn nicht verschlüsselt)', autocomplete: 'off' }) as HTMLInputElement;
  const idKey = h('input', { type: 'password', placeholder: 'Wiederherstellungscode sls-id-v1:… (nur falls verlangt)', autocomplete: 'off' }) as HTMLInputElement;
  const remember = h('input', { type: 'checkbox', checked: Boolean(saved.url) }) as HTMLInputElement;
  const manBtn = h('button.mod-cta', { type: 'submit', text: 'Verbinden' }) as HTMLButtonElement;
  const manForm = h(
    'form.source-form',
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        err.textContent = '';
        const cfg: LiveSyncConfig = {
          url: url.value.trim(),
          database: db.value.trim(),
          username: user.value.trim(),
          password: pw.value,
          passphrase: pass.value,
          idDerivationKey: idKey.value.trim() || undefined,
        };
        if (!cfg.url || !cfg.database) {
          err.textContent = 'Bitte CouchDB-Adresse und Datenbanknamen angeben.';
          return;
        }
        try {
          if (remember.checked) localStorage.setItem(LIVESYNC_SAVED, JSON.stringify({ url: cfg.url, database: cfg.database, username: cfg.username }));
          else localStorage.removeItem(LIVESYNC_SAVED);
        } catch {
          /* egal */
        }
        busy(manBtn, true, 'Verbinden');
        try {
          await startLiveSync(cfg);
        } catch (ex) {
          fail(ex);
        } finally {
          busy(manBtn, false, 'Verbinden');
        }
      },
    },
    url,
    db,
    user,
    pw,
    pass,
    idKey,
    h('label.source-check', {}, remember, ' Adresse, Datenbank und Benutzer merken (keine Passwörter)'),
    manBtn,
  );

  // Umschalter Setup-URI / Manuell
  const tabs = h('div.source-tabs');
  const body = h('div');
  const show = (which: 'uri' | 'manual') => {
    body.replaceChildren(which === 'uri' ? uriForm : manForm);
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === which));
  };
  tabs.append(
    h('button', { type: 'button', 'data-tab': 'uri', text: 'Setup-URI', onclick: () => show('uri') }),
    h('button', { type: 'button', 'data-tab': 'manual', text: 'Manuell', onclick: () => show('manual') }),
  );
  show(saved.url ? 'manual' : 'uri');

  const c = card(
    'cloud',
    'Self-hosted LiveSync',
    'Direkt mit deiner LiveSync-Datenbank (CouchDB) verbinden – wie die Obsidian-App am Handy. Ende-zu-Ende-Verschlüsselung wird im Browser entschlüsselt; nichts läuft über fremde Server.',
    h(
      'div.source-form',
      {},
      tabs,
      body,
      h(
        'div.source-hint',
        {},
        `Einmalig nötig: In CouchDB unter CORS „${location.origin}“ erlauben. `,
        h('a', { href: `${SOURCE_URL}/blob/main/docs/livesync.md`, target: '_blank', rel: 'noopener noreferrer', text: 'Anleitung' }),
      ),
      h('div.source-hint', { text: 'Zugangsdaten bleiben nur in diesem Tab und sind beim Schließen weg.' }),
      err,
    ),
  );
  c.classList.add('mod-livesync');
  return c;
}

applyPrefs(loadPrefs());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyPrefs(loadPrefs()));

let app: App | null = null;
let demoTimer: ReturnType<typeof setInterval> | undefined;

/** Demo-Vault starten (eigene Kopie nur in diesem Tab). `reset` = auf Ausgangszustand zurücksetzen. */
function startDemo(reset = false) {
  const demo = new DemoAdapter(demoSeed());
  if (reset) demo.reset();
  return start(demo);
}

async function start(adapter: VaultAdapter) {
  clearInterval(demoTimer);
  try {
    localStorage.setItem(LAST, adapter.kind);
  } catch {
    /* egal */
  }
  const restartDemo = () => {
    app?.destroy();
    app = null;
    void startDemo(true);
  };
  app = new App(
    adapter,
    () => {
      app = null;
      clearInterval(demoTimer);
      try {
        localStorage.removeItem(LAST);
        sessionStorage.removeItem(REMOTE);
        sessionStorage.removeItem(LIVESYNC);
      } catch {
        /* egal */
      }
      void showStart();
    },
    adapter instanceof DemoAdapter ? restartDemo : undefined,
  );
  if (adapter instanceof DemoAdapter) {
    // Automatischer Reset nach Ablauf (zusätzlich zur Prüfung beim Laden)
    demoTimer = setInterval(() => {
      if (adapter.expired) {
        notice('Die Demo wurde nach 4 Stunden automatisch zurückgesetzt.', 6000);
        restartDemo();
      }
    }, 60_000);
  }
  try {
    await app.mount(host);
  } catch (e) {
    notice(`Vault konnte nicht geladen werden: ${(e as Error).message}`, 8000, 'error');
    app.destroy();
    app = null;
    void showStart();
  }
}

function card(ic: Parameters<typeof icon>[0], title: string, desc: string, body: HTMLElement, disabled = false) {
  return h('div.source-card', { class: disabled ? 'is-disabled' : '' }, h('div.source-card-head', {}, h('div.source-card-icon', {}, icon(ic, 22)), h('div', {}, h('div.source-card-title', { text: title }), h('div.source-card-desc', { text: desc }))), body);
}

function errorLine() {
  return h('div.source-error');
}

async function showStart() {
  document.title = 'Vault Browser';
  const server = await probeServer();
  const last = localStorage.getItem(LAST);

  // Bestehende Sitzung mit eigenem Server (in diesem Tab) fortsetzen
  try {
    const r = JSON.parse(sessionStorage.getItem(REMOTE) ?? 'null') as { url: string; token: string; name: string } | null;
    if (r && !server) return start(new ServerAdapter(r.name, r.url, r.token));
  } catch {
    /* egal */
  }

  // Bestehende LiveSync-Sitzung (in diesem Tab) fortsetzen
  try {
    const saved = JSON.parse(sessionStorage.getItem(LIVESYNC) ?? 'null') as LiveSyncConfig | null;
    if (saved && last === 'livesync') {
      try {
        return await startLiveSync(saved);
      } catch {
        sessionStorage.removeItem(LIVESYNC);
      }
    }
  } catch {
    /* egal */
  }

  // Abgelaufene Demo-Daten sofort löschen; laufende Demo in diesem Tab fortsetzen (z.B. nach Neuladen)
  DemoAdapter.purgeExpired();
  if (last === 'demo' && DemoAdapter.hasSession()) return startDemo();

  // Automatisch verbinden, wenn möglich
  if (server && server.loggedIn && (last === 'server' || !last)) {
    return start(new ServerAdapter(server.vaultName));
  }

  const cards: HTMLElement[] = [liveSyncCard()];

  // 1) Self-hosted Server
  if (server) {
    const err = errorLine();
    const pw = h('input', { type: 'password', placeholder: 'Passwort', autocomplete: 'current-password' });
    const form = h(
      'form.source-form',
      {
        onsubmit: async (e: Event) => {
          e.preventDefault();
          err.textContent = '';
          try {
            if (server.auth && !server.loggedIn) await serverLogin(pw.value);
            await start(new ServerAdapter(server.vaultName));
          } catch (ex) {
            err.textContent = (ex as Error).message;
          }
        },
      },
      server.auth && !server.loggedIn ? pw : null,
      h('button.mod-cta', { type: 'submit', text: server.loggedIn || !server.auth ? 'Öffnen' : 'Anmelden' }),
      err,
    );
    cards.push(card('server', `Server-Vault „${server.vaultName}“`, 'Vault auf diesem Server (self-hosted). Änderungen landen direkt im Vault-Ordner.', form));
  } else {
    // 1b) Eigener Server von einer anderen Adresse aus (z.B. diese Seite auf GitHub Pages, fremder Laptop)
    const err = errorLine();
    const savedUrl = localStorage.getItem(REMOTE_URL) ?? '';
    const url = h('input', { type: 'url', value: savedUrl, placeholder: 'https://notizen.example.com', autocomplete: 'url' });
    const pw = h('input', { type: 'password', placeholder: 'Passwort', autocomplete: 'current-password' });
    const remember = h('input', { type: 'checkbox', checked: Boolean(savedUrl) });
    const form = h(
      'form.source-form',
      {
        onsubmit: async (e: Event) => {
          e.preventDefault();
          err.textContent = '';
          const base = normalizeServerUrl(url.value);
          try {
            const info = await probeServer(base);
            if (!info) {
              throw new Error(
                'Server nicht erreichbar. Läuft er per HTTPS und steht diese Seite in ALLOWED_ORIGINS (' + location.origin + ')?',
              );
            }
            const token = info.auth ? await serverLogin(pw.value, base) : undefined;
            try {
              if (remember.checked) localStorage.setItem(REMOTE_URL, base);
              else localStorage.removeItem(REMOTE_URL);
              if (token) sessionStorage.setItem(REMOTE, JSON.stringify({ url: base, token, name: info.vaultName }));
            } catch {
              /* egal */
            }
            await start(new ServerAdapter(info.vaultName, base, token));
          } catch (ex) {
            err.textContent = (ex as Error).message;
          }
        },
      },
      url,
      pw,
      h('label.source-check', {}, remember, ' Adresse merken (nicht auf fremden Rechnern)'),
      h('button.mod-cta', { type: 'submit', text: 'Verbinden' }),
      h('div.source-hint', { text: 'Passwort und Sitzung werden nicht gespeichert – beim Schließen des Tabs bist du abgemeldet (spätestens nach 12 Stunden).' }),
      err,
    );
    cards.push(card('server', 'Eigener Vault-Browser-Server', 'Mit einem selbst gehosteten Vault-Browser-Server verbinden (Vault als Ordner auf dem Server).', form));
  }

  // 2) Lokaler Ordner
  {
    const err = errorLine();
    const body = h('div.source-form');
    if (supportsFSAccess()) {
      body.append(
        h('button.mod-cta', {
          text: 'Vault-Ordner wählen …',
          onclick: async () => {
            err.textContent = '';
            try {
              await start(await pickLocalVault());
            } catch (ex) {
              if ((ex as Error).name !== 'AbortError') err.textContent = (ex as Error).message;
            }
          },
        }),
      );
      const remembered = await rememberedLocalVault();
      if (remembered) {
        body.append(
          h('button', {
            text: `Zuletzt: „${remembered.name}“ öffnen`,
            onclick: async () => {
              try {
                await start(await reopenLocalVault(remembered));
              } catch (ex) {
                err.textContent = (ex as Error).message;
              }
            },
          }),
        );
      }
    } else {
      const input = h('input', { type: 'file', webkitdirectory: true, multiple: true, style: 'display:none' }) as HTMLInputElement;
      input.addEventListener('change', () => input.files?.length && void start(new ReadOnlyFilesAdapter(input.files)));
      body.append(
        h('div.source-hint', { text: 'Dieser Browser unterstützt keinen Schreibzugriff auf Ordner. Mit Chrome, Edge oder Brave kannst du auch bearbeiten – hier geht es nur lesend.' }),
        input,
        h('button.mod-cta', { text: 'Ordner wählen (nur lesen) …', onclick: () => input.click() }),
      );
    }
    body.append(err);
    cards.push(
      card(
        'folder',
        'Lokaler Ordner / Cloud-Ordner',
        'Vault direkt vom PC öffnen – auch aus OneDrive, Dropbox, Google Drive oder iCloud Drive, wenn deren Sync-Ordner eingebunden ist. Nichts wird hochgeladen.',
        body,
      ),
    );
  }

  // 3) Obsidian Local REST API
  let saved: { url?: string; key?: string } = {};
  try {
    saved = JSON.parse(localStorage.getItem(REST) ?? '{}');
  } catch {
    /* egal */
  }
  {
    const err = errorLine();
    const url = h('input', { type: 'url', value: saved.url ?? 'https://127.0.0.1:27124', placeholder: 'https://127.0.0.1:27124' });
    const key = h('input', { type: 'password', value: saved.key ?? '', placeholder: 'API-Key (Obsidian → Einstellungen → Local REST API)' });
    const remember = h('input', { type: 'checkbox', checked: Boolean(saved.key) });
    const certLink = h('a', { href: '#', text: 'Zertifikat im Browser akzeptieren', onclick: (e: Event) => (e.preventDefault(), window.open(url.value, '_blank', 'noopener')) });
    const form = h(
      'form.source-form',
      {
        onsubmit: async (e: Event) => {
          e.preventDefault();
          err.textContent = '';
          try {
            const a = await RestApiAdapter.connect(url.value.trim(), key.value.trim());
            try {
              localStorage.setItem(REST, JSON.stringify({ url: url.value.trim(), key: remember.checked ? key.value.trim() : undefined }));
            } catch {
              /* egal */
            }
            await start(a);
          } catch (ex) {
            err.textContent = (ex as Error).message;
          }
        },
      },
      url,
      key,
      h('label.source-check', {}, remember, ' API-Key in diesem Browser merken'),
      h('button.mod-cta', { type: 'submit', text: 'Verbinden' }),
      h('div.source-hint', {}, 'Bei HTTPS zuerst einmal ', certLink, '. Alternativ im Plugin den unverschlüsselten Port 27123 aktivieren (http://127.0.0.1:27123).'),
      err,
    );
    cards.push(card('plug', 'Obsidian (Local REST API)', 'Mit dem laufenden Obsidian auf diesem PC verbinden – über das Community-Plugin „Local REST API“.', form));
  }

  // Demo – für jeden Besucher eine eigene Kopie, nur in diesem Tab
  {
    const demoCard = card(
      'book',
      'Demo ausprobieren',
      'Ohne eigenen Vault testen: ein Beispiel-Vault nur in diesem Browser-Tab. Nichts wird gespeichert oder mit anderen geteilt; nach 4 Stunden oder beim Schließen des Tabs ist alles weg.',
      h('div.source-form', {}, h('button', { text: 'Demo starten', onclick: () => void startDemo(true) })),
    );
    demoCard.classList.add('mod-demo');
    cards.push(demoCard);
  }

  // 4) WebDAV – später
  cards.push(card('cloud', 'WebDAV / Nextcloud', 'Direkter Cloud-Zugriff ohne Sync-Client – kommt in einer späteren Version.', h('div.source-hint', { text: 'Demnächst verfügbar' }), true));

  host.replaceChildren(
    h(
      'div.start-screen',
      {},
      h('div.start-header', {}, h('div.start-logo', {}, icon('vault', 40)), h('h1', { text: 'Vault Browser' }), h('p', { text: 'Deine Obsidian-Notizen im Browser – wähle, wie du auf deinen Vault zugreifen möchtest.' })),
      h('div.source-grid', {}, ...cards),
      h(
        'div.start-footer',
        {},
        h('div', { text: 'Dein Vault bleibt, wo er ist – diese Seite liest und schreibt direkt die Markdown-Dateien, kompatibel mit Obsidian. Es gibt keinen Server dieser Seite, der deine Daten sieht.' }),
        h('div', { text: 'Auf fremden Rechnern: nach Benutzung unten links „Vault wechseln / abmelden“ wählen.' }),
        h(
          'div',
          {},
          'Freie Software unter ',
          h('a', { href: `${SOURCE_URL}/blob/main/LICENSE`, target: '_blank', rel: 'noopener noreferrer', text: LICENSE_NAME }),
          ' · ',
          h('a.source-link', { href: SOURCE_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Quellcode' }),
          ' · Unabhängiges Projekt, nicht verbunden mit Obsidian / Dynalist Inc.',
        ),
      ),
    ),
  );

  // Letzte REST-Verbindung automatisch wiederherstellen
  if (last === 'restapi' && saved.key && saved.url) {
    RestApiAdapter.connect(saved.url, saved.key)
      .then((a) => {
        if (!app) void start(a);
      })
      .catch(() => {});
  }
}

void showStart();
