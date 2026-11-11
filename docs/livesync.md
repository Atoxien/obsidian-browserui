# Vault Browser mit Self-hosted LiveSync

Du synchronisierst deinen Vault mit [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync) (CouchDB)? Dann kannst du denselben Vault im Vault Browser bearbeiten. Änderungen landen über LiveSync auf allen deinen Obsidian-Geräten, und umgekehrt.

```
Obsidian-Geräte ⇄ CouchDB (LiveSync) ⇄ livesync-bridge ⇄ Ordner ⇄ Vault Browser ⇄ Browser
```

LiveSync speichert Notizen nicht als Dateien, sondern als zerlegte, meist verschlüsselte Dokumente in CouchDB. Den Weg zwischen Datenbank und Ordner übernimmt **[livesync-bridge](https://github.com/vrtmrz/livesync-bridge)**, ein Werkzeug vom Autor von LiveSync. Sie versteht Ende-zu-Ende-Verschlüsselung, Pfad-Verschleierung und den ID-Schlüssel. Der Vault Browser liest und schreibt dann ganz normal diesen Ordner.

> **Wichtig:** livesync-bridge ist ein eigenständiges Projekt mit eigenem Entwicklungsstand. Teile davon sind laut ihrer Doku noch unveröffentlicht. Ihr Code ist **nicht** Teil dieses Repos; unser Compose-File baut sie direkt aus ihrem GitHub-Repo. Sie steht derzeit unter keiner ausdrücklichen Lizenz, prüfe das selbst, bevor du sie einsetzt.

## Voraussetzungen

- Ein Server mit Docker und Docker Compose, z.B. derselbe, auf dem deine CouchDB läuft
- Deine CouchDB ist per **HTTPS** erreichbar
- Die LiveSync-Datenbank wurde **vom Obsidian-Plugin eingerichtet** und wird von mindestens einem Gerät benutzt. Bei einer frisch angelegten, leeren Datenbank schickt die Bridge nur und hört nicht auf Änderungen.

## 0. Backup – nicht überspringen

Ein Fehler in der Konfiguration (falsche Passphrase, falscher Ordner) kann sich über LiveSync auf alle Geräte verteilen.

1. Auf einem Gerät den Vault-Ordner komplett kopieren, z.B. als ZIP.
2. Einen Dump der CouchDB-Datenbank anlegen, z.B. mit `curl -u USER:PASS https://couchdb.example.com/obsidian/_all_docs?include_docs=true > backup.json` oder dem Backup deines Hosters.

**Empfehlung:** Teste den ganzen Ablauf zuerst mit einer **Test-Datenbank** und einem Test-Vault (in Obsidian einen neuen Vault anlegen, LiveSync mit einer neuen Datenbank einrichten, ein paar Notizen schreiben). Erst danach deinen echten Vault anbinden.

## 1. Zugangsdaten aus LiveSync holen

In Obsidian unter **Einstellungen → Self-hosted LiveSync**:

| Was | Wo | Feld in `config.json` |
| --- | --- | --- |
| Server-URL, Benutzer, Passwort, Datenbankname | „Remote Configuration“ | `url`, `username`, `password`, `database` |
| Ende-zu-Ende-Passphrase | „Remote Configuration“ → End-to-End Encryption | `passphrase` (leer lassen, wenn nicht aktiviert) |
| Pfad-Verschleierung | „Remote Configuration“ → Path Obfuscation | `obfuscatePassphrase` (bei LiveSync meist dieselbe Passphrase; leer lassen, wenn aus) |
| ID-Schlüssel (neuere Vaults) | **„Show current recovery code“** | `idDerivationKey` (Zeile löschen, wenn dein Vault keinen hat) |

## 2. Einrichten

```bash
git clone https://github.com/Atoxien/obsidian-browserui.git
cd obsidian-browserui/deploy/livesync
```

```bash
mkdir -p data/vault && sudo chown -R 1993:1993 data
```

```bash
cp dat/config.example.json dat/config.json && chmod 600 dat/config.json
```

`dat/config.json` mit deinen Werten ausfüllen. In `docker-compose.yml` mindestens `VAULT_PASSWORD` und `SESSION_SECRET` ändern. Dann:

```bash
docker compose up -d
```

```bash
docker compose logs -f livesync-bridge
```

Beim ersten Start lädt die Bridge den ganzen Vault aus der Datenbank nach `data/vault`. Das kann je nach Größe ein paar Minuten dauern. Fertig ist es, wenn dort deine Notizen liegen.

### Was die Beispiel-Konfiguration macht

- **CouchDB-Peer** und **Storage-Peer** stehen in derselben `group`, dadurch werden sie miteinander synchronisiert.
- `"baseDir": ""` heißt: der ganze Vault, nicht nur ein Unterordner.
- `"useRemoteTweaks": true` übernimmt Chunk-Größe usw. aus den Einstellungen deiner LiveSync-Datenbank.
- `ignore` sorgt dafür, dass die Bridge nie Folgendes überträgt:
  - `**/*.obui-tmp`: kurzlebige Zwischendateien des Vault Browsers beim Speichern
  - `.trash/**`: der Papierkorb des Vault Browsers. Gelöschte Notizen werden auf allen Geräten gelöscht, die Sicherungskopie bleibt nur auf dem Server.
- `.obsidian` (Plugins, Einstellungen) wird nicht synchronisiert; das ist bei der Bridge standardmäßig so.

## 3. Von außen erreichbar machen (HTTPS)

Der Vault Browser lauscht nur auf `127.0.0.1:8080`. Davor gehört dein Reverse Proxy, z.B. Caddy:

```
notizen.deine-domain.at {
  reverse_proxy 127.0.0.1:8080
}
```

Danach erreichst du deinen Vault unter `https://notizen.deine-domain.at`. Deine CouchDB bleibt, wie sie ist.

### Über die GitHub-Pages-Seite (ohne eigene Oberfläche)

Du kannst auch die gehostete Oberfläche nutzen und dort unter **„Eigener Server“** `https://notizen.deine-domain.at` eintragen. Dafür in `docker-compose.yml` die Adresse der Oberfläche erlauben, also die Domain **ohne Pfad**:

```yaml
ALLOWED_ORIGINS: "https://atoxien.github.io"
```

Nutzt du einen eigenen Fork, steht hier deine eigene Pages-Adresse (`https://<dein-user>.github.io`).

## Gut zu wissen

- **Gleichzeitiges Bearbeiten:** Bearbeitest du dieselbe Notiz zur selben Zeit im Browser und in Obsidian, löst LiveSync den Konflikt wie zwischen zwei Obsidian-Geräten. Der Vault Browser warnt außerdem, wenn eine Datei während des Bearbeitens von außen geändert wurde.
- **Live-Aktualisierung:** Änderungen von anderen Geräten erscheinen im Vault Browser nach wenigen Sekunden.
- **Updates der Bridge:** `docker compose build --pull livesync-bridge && docker compose up -d`. Nach Updates liest die Bridge die Datenbank laut ihrer Doku einmal neu ein.
- **Neu einlesen erzwingen** (z.B. nach einem „Rebuild“ der Datenbank in LiveSync): Bridge stoppen und einmal mit `--reset` starten:
  ```bash
  docker compose run --rm livesync-bridge deno run -A main.ts --reset
  ```
- **Groß-/Kleinschreibung und Unicode in Dateinamen:** Wenn du in LiveSync Einstellungen zur Pfad-Normalisierung geändert hast, müssen die Felder `pathNormalizationVersion` bzw. `handleFilenameCaseSensitive` in der Bridge dazu passen (siehe deren README).

## Getestet

Lokal mit zwei Bridge-Instanzen (eine für den Vault Browser, eine als „zweites Gerät“), Ende-zu-Ende-Verschlüsselung und Pfad-Verschleierung, gegen einen CouchDB-kompatiblen Testserver:

- Vault → verschlüsselte Datenbank → zweites Gerät: Notizen und Bilder identisch, in der Datenbank kein Klartext
- Neue Notiz und Änderung im Vault Browser → nach ca. 2 s auf dem zweiten Gerät, ohne Zwischendateien
- Neue Notiz auf dem zweiten Gerät → nach ca. 2 s im Vault Browser
- Löschen im Vault Browser → auf dem zweiten Gerät gelöscht, Papierkorb bleibt auf dem Server

Nicht getestet: gegen eine echte CouchDB mit dem Obsidian-Plugin. Mach deshalb zuerst den Test mit einer Test-Datenbank (siehe oben).

## Ausblick

Ein eingebauter LiveSync-Client direkt im Browser (ohne Bridge und ohne eigenen Vault-Browser-Server) wäre möglich, ist aber deutlich aufwendiger: Das Datenformat von LiveSync ist keine stabile Schnittstelle, und ein Fehler könnte die Sync-Datenbank beschädigen. Deshalb vorerst der Weg über die offizielle Bridge.
