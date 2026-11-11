# Obsidian BrowserUI

Deinen [Obsidian](https://obsidian.md)-Vault im Browser **lesen und bearbeiten** – mit einer Oberfläche im Obsidian-Stil und voller Kompatibilität zu deinen Markdown-Dateien. Obsidian selbst kann parallel auf denselben Vault zugreifen.

![Screenshot](docs/screenshot-dark.png)

> Unabhängiges Community-Projekt – nicht mit Obsidian / Dynalist Inc. verbunden.

## Drei Wege zum Vault

| Modus | Wofür | Voraussetzung |
| --- | --- | --- |
| **Self-hosted Server** | Zugriff von überall (Handy, Arbeits-PC …) auf einen Vault, der auf NAS/Homeserver/VPS liegt | Docker oder Node ≥ 20 |
| **Lokaler Ordner** | Vault direkt vom eigenen PC öffnen – auch aus **OneDrive, Dropbox, Google Drive, iCloud**, wenn deren Sync-Ordner eingebunden ist. Es wird nichts hochgeladen. | Chrome, Edge oder Brave (Firefox/Safari: nur lesen) |
| **Obsidian Local REST API** | Mit dem laufenden Obsidian verbinden | Community-Plugin [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) |
| WebDAV / Nextcloud | *geplant* | |

Modus 2 und 3 funktionieren auch, wenn die Seite rein statisch gehostet wird (z.B. `web/dist` auf GitHub Pages) – dann ohne Server-Karte.

![Startseite](docs/screenshot-start.png)

## Funktionen

- Dateibaum mit Ordnern, Kontextmenü, Drag & Drop (verschieben, Dateien hochladen)
- Tabs, Zurück/Vor, Sitzung wird gemerkt, Deep-Links (`/#/Ordner/Notiz.md`)
- **Leseansicht** und **Bearbeiten** (CodeMirror 6), Umschalten mit `Strg+E`, Auto-Speichern
- Obsidian-Markdown: `[[Wikilinks|Alias]]`, `[[Notiz#Überschrift]]`, `[[Notiz#^block]]`, Embeds `![[Bild.png|300]]` / `![[Notiz#Abschnitt]]` / PDF / Audio / Video, `#tags/verschachtelt`, Callouts (`> [!tip]`, faltbar mit `+`/`-`), Aufgaben (anklickbar), `==Hervorhebung==`, `%%Kommentare%%`, Mathe mit KaTeX, Frontmatter als **Eigenschaften**, Aliase
- Link-Auflösung wie Obsidian (kürzester Pfad), Klick auf fehlenden Link legt die Notiz an
- **Rückverweise**, unverlinkte Erwähnungen, ausgehende Links, Gliederung, Tag-Übersicht
- Volltextsuche (`tag:#x`, `path:ordner`, `file:name`, `"Phrase"`, `-ausschließen`)
- Schnellwechsel (`Strg+O`), Befehlspalette (`Strg+P`), Autovervollständigung für `[[` und `#`
- Umbenennen/Verschieben **aktualisiert Links** in anderen Notizen
- Liest `.obsidian/app.json`, `daily-notes.json`, `templates.json`: Tagesnotiz mit Vorlage, Vorlagen einfügen, Anhang-Ordner für eingefügte Bilder (Einfügen/Drag & Drop in den Editor)
- Löschen verschiebt in `.trash` (wie Obsidian)
- Konflikterkennung: wurde eine Datei extern (z.B. in Obsidian) geändert, wird nicht stillschweigend überschrieben; Änderungen von außen erscheinen live (Server-Modus)
- Hell/Dunkel, mobil nutzbar

### Tastenkürzel

| Kürzel | Aktion |
| --- | --- |
| `Strg+O` | Schnellwechsel / Notiz erstellen |
| `Strg+P` | Befehlspalette |
| `Strg+E` | Lesen ↔ Bearbeiten |
| `Strg+N` | Neue Notiz |
| `Strg+S` | Speichern (passiert sonst automatisch) |
| `Strg+Umschalt+F` | Suche |
| `F2` | Umbenennen |
| `Alt+←` / `Alt+→` | Zurück / Vor |
| `Alt+W` | Tab schließen |
| Strg+Klick auf Link | In neuem Tab öffnen (im Editor: Link folgen) |
| `Strg+L` (Editor) | Aufgabe umschalten |

## Installation (Self-hosted)

### Docker Compose

```yaml
services:
  obsidian-browserui:
    build: https://github.com/Atoxien/obsidian-browserui.git
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      VAULT_PASSWORD: "dein-passwort"
      SESSION_SECRET: "zufälliger-langer-wert"
      # SECURE_COOKIE: "1"   # hinter HTTPS
    volumes:
      - /pfad/zu/deinem/vault:/vault
```

```bash
docker compose up -d
```

Dann `http://<server>:8080` öffnen. Der Container läuft als Benutzer `node` (UID 1000) – der Vault-Ordner muss für diese UID beschreibbar sein.

### Ohne Docker

```bash
npm ci
```

```bash
npm run build
```

```bash
VAULT_PATH=/pfad/zum/vault VAULT_PASSWORD=geheim npm start
```

### Konfiguration

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `VAULT_PATH` | – | Pfad zum Vault (Pflicht) |
| `VAULT_PASSWORD` | – | Login-Passwort (Pflicht, außer `NO_AUTH=1`) |
| `SESSION_SECRET` | zufällig | Signatur der Login-Cookies; setzen, damit Logins Neustarts überleben |
| `SECURE_COOKIE` | `0` | `1` = Cookie nur über HTTPS (hinter Reverse-Proxy empfohlen) |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | |
| `NO_AUTH` | – | `1` = ohne Passwort (nur für lokale Tests!) |

### Sicherheit

- **Immer hinter HTTPS betreiben**, wenn der Server aus dem Internet erreichbar ist (z.B. Caddy, Traefik, nginx; oder nur über VPN/Tailscale). Dann `SECURE_COOKIE=1` setzen.
- Login mit Rate-Limit, signiertem HttpOnly-/SameSite-Cookie, CSRF-Schutz über Pflicht-Header.
- Dateizugriffe sind auf den Vault beschränkt (Schutz gegen `../` und Symlink-Ausbrüche).
- Gerendertes HTML wird mit DOMPurify bereinigt.

Beispiel Caddy:

```
notes.example.com {
  reverse_proxy localhost:8080
}
```

## Obsidian Local REST API

1. In Obsidian das Community-Plugin **Local REST API** installieren und aktivieren.
2. API-Key aus den Plugin-Einstellungen kopieren.
3. In der BrowserUI „Obsidian (Local REST API)“ wählen, URL `https://127.0.0.1:27124` und Key eintragen.
4. Das Plugin nutzt ein selbstsigniertes Zertifikat: einmal **„Zertifikat im Browser akzeptieren“** anklicken und bestätigen – oder im Plugin den HTTP-Port `27123` aktivieren.

Hinweis: Die REST-API kennt keine leeren Ordner und kein natives Umbenennen; Umbenennen erfolgt als Kopieren + Löschen.

## Entwicklung

```bash
npm ci
```

```bash
VAULT_PATH=examples/vault NO_AUTH=1 npm start
```

```bash
npm run dev
```

`npm run dev` startet Vite (Port 5173) und leitet `/api` an den Server auf Port 8080 weiter.

```bash
npm test
```

Aufbau:

```
server/   Fastify-Server: Vault-API, Login, Datei-Watch (SSE)
web/      Frontend (Vite + TypeScript, ohne Framework)
  src/adapters/   VaultAdapter: server, localfs, restapi (WebDAV folgt)
  src/vault/      Index, Link-Auflösung, Backlinks, Suche, Frontmatter
  src/markdown/   markdown-it mit Obsidian-Erweiterungen
  src/ui/         Workspace, Editor, Lese-Ansicht, Dateibaum
examples/vault/   Beispiel-Vault zum Ausprobieren
```

Neue Quellen (z.B. WebDAV) implementieren das Interface in `web/src/adapters/types.ts`.

## Lizenz

Siehe [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) für die verwendeten Bibliotheken.
