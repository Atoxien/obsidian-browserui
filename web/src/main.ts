import 'katex/dist/katex.min.css';
import './styles/obsidian.css';
import type { VaultAdapter } from './adapters/types';
import { ServerAdapter, probeServer, serverLogin } from './adapters/server';
import { ReadOnlyFilesAdapter, pickLocalVault, rememberedLocalVault, reopenLocalVault, supportsFSAccess } from './adapters/localfs';
import { RestApiAdapter } from './adapters/restapi';
import { App } from './ui/app';
import { h, icon, notice } from './ui/dom';
import { applyPrefs, loadPrefs } from './ui/settings';

const host = document.getElementById('app')!;
const LAST = 'obui.last';
const REST = 'obui.rest';

applyPrefs(loadPrefs());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyPrefs(loadPrefs()));

let app: App | null = null;

async function start(adapter: VaultAdapter) {
  try {
    localStorage.setItem(LAST, adapter.kind);
  } catch {
    /* egal */
  }
  app = new App(adapter, () => {
    app = null;
    try {
      localStorage.removeItem(LAST);
    } catch {
      /* egal */
    }
    void showStart();
  });
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
  document.title = 'Obsidian BrowserUI';
  const server = await probeServer();
  const last = localStorage.getItem(LAST);

  // Automatisch verbinden, wenn möglich
  if (server && server.loggedIn && (last === 'server' || !last)) {
    return start(new ServerAdapter(server.vaultName));
  }

  const cards: HTMLElement[] = [];

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

  // 4) WebDAV – später
  cards.push(card('cloud', 'WebDAV / Nextcloud', 'Direkter Cloud-Zugriff ohne Sync-Client – kommt in einer späteren Version.', h('div.source-hint', { text: 'Demnächst verfügbar' }), true));

  host.replaceChildren(
    h(
      'div.start-screen',
      {},
      h('div.start-header', {}, h('div.start-logo', {}, icon('vault', 40)), h('h1', { text: 'Obsidian BrowserUI' }), h('p', { text: 'Wähle, wie du auf deinen Vault zugreifen möchtest.' })),
      h('div.source-grid', {}, ...cards),
      h('div.start-footer', { text: 'Dein Vault bleibt, wo er ist – diese Seite liest und schreibt direkt die Markdown-Dateien, kompatibel mit Obsidian.' }),
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
