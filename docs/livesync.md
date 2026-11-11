# Vault Browser mit Self-hosted LiveSync

Du synchronisierst deinen Vault mit [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync) (CouchDB)? Dann kannst du ihn im Vault Browser lesen und bearbeiten. Änderungen landen über LiveSync auf allen deinen Obsidian-Geräten, und umgekehrt.

Es gibt zwei Wege:

| | **A: Direkt im Browser** (empfohlen) | **B: Über livesync-bridge** |
| --- | --- | --- |
| Wie | Der Browser verbindet sich direkt mit deiner CouchDB – wie die Obsidian-App am Handy | Ein Server spiegelt die Datenbank in einen Ordner, der Vault Browser bearbeitet den Ordner |
| Zusätzlich nötig | Einmal CORS in CouchDB freigeben | Zwei Container + eigene Subdomain |
| Zugangsdaten | Nur im Browser-Tab, für die Dauer der Sitzung | Auf dem Server gespeichert |
| Live-Änderungen anderer Geräte | Ja | Ja |

> **Wichtig, egal welcher Weg:** Mach vorher ein Backup (Vault-Ordner auf einem Gerät kopieren) und probiere es zuerst mit einer **Test-Datenbank** aus.

---

## Weg A: Direkt im Browser

Der Vault Browser nutzt dafür dieselbe Bibliothek wie die LiveSync-Apps ([`@vrtmrz/livesync-commonlib`](https://www.npmjs.com/package/@vrtmrz/livesync-commonlib) vom LiveSync-Autor). Das Datenformat und die Verschlüsselung werden also nicht nachgebaut. Die Ende-zu-Ende-Verschlüsselung passiert in deinem Browser; die CouchDB sieht nur verschlüsselte Daten, wie bei deinen anderen Geräten.

Beim Verbinden liest der Vault Browser die Einstellungen, die das LiveSync-Plugin in der Datenbank hinterlegt hat (Verschlüsselungsverfahren, Chunk-Größe, Pfad-Verschleierung, ID-Schlüssel …), und schreibt genauso wie deine anderen Geräte. Stimmt die Passphrase nicht, bricht er ab, **bevor** irgendetwas geschrieben wird.

### 1. CORS in CouchDB freigeben (einmalig)

Der Browser darf nur mit deiner CouchDB sprechen, wenn sie die Adresse der Oberfläche erlaubt. Für die gehostete Seite ist das `https://atoxien.github.io` (bei einem Fork: `https://<dein-user>.github.io`, bei eigenem Hosting: deine Adresse). LiveSync hat bei der Einrichtung schon CORS eingeschaltet und die Obsidian-Apps erlaubt – du ergänzt nur eine Adresse.

**Variante 1 – Fauxton (Weboberfläche von CouchDB):**

1. `https://<deine-couchdb>/_utils` öffnen und als Admin anmelden.
2. Links **Configuration → CORS**.
3. Unter „Origin Domains“ die Adresse **`https://atoxien.github.io`** hinzufügen. Die vorhandenen Einträge (`app://obsidian.md`, `capacitor://localhost`, `http://localhost`) **nicht entfernen** – die brauchen deine Obsidian-Apps.

**Variante 2 – per Kommandozeile:**

Aktuelle Liste ansehen:

```bash
curl -u ADMIN:PASSWORT https://<deine-couchdb>/_node/_local/_config/cors/origins
```

Neue Liste setzen – die vorhandenen Einträge übernehmen und die Adresse anhängen:

```bash
curl -u ADMIN:PASSWORT -X PUT https://<deine-couchdb>/_node/_local/_config/cors/origins -d '"app://obsidian.md,capacitor://localhost,http://localhost,https://atoxien.github.io"'
```

**Mit 1Panel:** CouchDB läuft dort als App hinter OpenResty. Variante 1 oder 2 funktioniert direkt über deine CouchDB-Domain. Wichtig ist nur, dass in der Reverse-Proxy-Konfiguration der Website **keine eigenen CORS-Regeln** stehen, die die von CouchDB überschreiben, und dass `OPTIONS`-Anfragen zu CouchDB durchgereicht werden (Standard).

Prüfen, ob es klappt (erwartet: eine Zeile `access-control-allow-origin: https://atoxien.github.io`):

```bash
curl -s -o /dev/null -D - -X OPTIONS https://<deine-couchdb>/<datenbank> -H "Origin: https://atoxien.github.io" -H "Access-Control-Request-Method: GET" | grep -i access-control
```

### 2. Verbinden

Auf der Startseite die Karte **„Self-hosted LiveSync“** wählen:

- **Setup-URI (am einfachsten):** In Obsidian die Befehlspalette öffnen → „Self-hosted LiveSync: Copy the setup URI“ (je nach Version auch in den LiveSync-Einstellungen). Dabei vergibst du ein Passwort für die URI. URI und dieses Passwort im Vault Browser einfügen.
- **Manuell:** CouchDB-Adresse, Datenbankname, Benutzer und Passwort, dazu die E2EE-Passphrase. Neuere Vaults verlangen zusätzlich den **Wiederherstellungscode** (`sls-id-v1:…`, in LiveSync unter „Show current recovery code“); der Vault Browser fragt danach, wenn er nötig ist.

Zugangsdaten bleiben nur im aktuellen Tab und sind beim Schließen oder über „Vault wechseln / abmelden“ weg. Optional kannst du dir Adresse, Datenbank und Benutzer merken lassen – Passwörter nie.

### Gut zu wissen (Weg A)

- **Gleichzeitiges Bearbeiten** derselben Notiz auf zwei Geräten löst LiveSync wie zwischen zwei Obsidian-Geräten auf.
- **Gelöschte Notizen** werden wie in LiveSync als gelöscht markiert und auf allen Geräten entfernt.
- **Leere Ordner** kennt LiveSync nicht: Ein neuer Ordner entsteht mit der ersten Datei darin.
- **Einstellungen und Plugins** (`.obsidian`) werden nicht angezeigt oder verändert.
- Die Verbindung braucht etwas mehr Rechenleistung als die anderen Wege (Entschlüsselung im Browser); das Paket dafür wird erst geladen, wenn du LiveSync wählst.

### Getestet (Weg A)

Mit einem CouchDB-kompatiblen Testserver, Ende-zu-Ende-Verschlüsselung und Pfad-Verschleierung, und einer livesync-bridge als „zweites Gerät“ – im echten Browser über die Oberfläche:

- Verbinden per Setup-URI und manuell; falsches Setup-Passwort, falsche Passphrase und falsches CouchDB-Passwort werden verständlich gemeldet, ohne etwas zu schreiben
- Lesen (auch Bilder), Bearbeiten, neue Notizen, Umbenennen – kommen auf dem zweiten Gerät an, Umlaute und Emoji unverändert
- Änderungen vom zweiten Gerät erscheinen live im Browser
- Neuladen behält die Sitzung, Abmelden entfernt alle Zugangsdaten

**Nicht getestet:** gegen eine echte CouchDB mit dem Obsidian-Plugin. Deshalb zuerst mit einer Test-Datenbank ausprobieren.

---

## Weg B: Über livesync-bridge (Server)

LiveSync speichert Notizen nicht als Dateien, sondern als zerlegte, meist verschlüsselte Dokumente in CouchDB. Bei diesem Weg übernimmt **[livesync-bridge](https://github.com/vrtmrz/livesync-bridge)** (ebenfalls vom LiveSync-Autor) die Übersetzung zwischen Datenbank und einem Ordner auf deinem Server. Der Vault Browser bearbeitet dann diesen Ordner.

```
Obsidian-Geräte ⇄ CouchDB (LiveSync) ⇄ livesync-bridge ⇄ Ordner ⇄ Vault Browser ⇄ Browser
```

> livesync-bridge ist ein eigenständiges Projekt mit eigenem Entwicklungsstand. Ihr Code ist **nicht** Teil dieses Repos; unser Compose-File baut sie direkt aus ihrem GitHub-Repo. Sie steht derzeit unter keiner ausdrücklichen Lizenz – prüfe das selbst, bevor du sie einsetzt.

### Voraussetzungen (Bridge)

- Ein Server mit Docker und Docker Compose, z.B. derselbe, auf dem deine CouchDB läuft
- Deine CouchDB ist per **HTTPS** erreichbar
- Die LiveSync-Datenbank wurde **vom Obsidian-Plugin eingerichtet** und wird von mindestens einem Gerät benutzt. Bei einer frisch angelegten, leeren Datenbank schickt die Bridge nur und hört nicht auf Änderungen.

### 0. Backup – nicht überspringen

Ein Fehler in der Konfiguration (falsche Passphrase, falscher Ordner) kann sich über LiveSync auf alle Geräte verteilen.

1. Auf einem Gerät den Vault-Ordner komplett kopieren, z.B. als ZIP.
2. Einen Dump der CouchDB-Datenbank anlegen, z.B. mit `curl -u USER:PASS https://couchdb.example.com/obsidian/_all_docs?include_docs=true > backup.json` oder dem Backup deines Hosters.

**Empfehlung:** Teste den ganzen Ablauf zuerst mit einer **Test-Datenbank** und einem Test-Vault (in Obsidian einen neuen Vault anlegen, LiveSync mit einer neuen Datenbank einrichten, ein paar Notizen schreiben). Erst danach deinen echten Vault anbinden.

### 1. Zugangsdaten aus LiveSync holen

In Obsidian unter **Einstellungen → Self-hosted LiveSync**:

| Was | Wo | Feld in `config.json` |
| --- | --- | --- |
| Server-URL, Benutzer, Passwort, Datenbankname | „Remote Configuration“ | `url`, `username`, `password`, `database` |
| Ende-zu-Ende-Passphrase | „Remote Configuration“ → End-to-End Encryption | `passphrase` (leer lassen, wenn nicht aktiviert) |
| Pfad-Verschleierung | „Remote Configuration“ → Path Obfuscation | `obfuscatePassphrase` (bei LiveSync meist dieselbe Passphrase; leer lassen, wenn aus) |
| ID-Schlüssel (neuere Vaults) | **„Show current recovery code“** | `idDerivationKey` (Zeile löschen, wenn dein Vault keinen hat) |

### 2. Einrichten

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

#### Was die Beispiel-Konfiguration macht

- **CouchDB-Peer** und **Storage-Peer** stehen in derselben `group`, dadurch werden sie miteinander synchronisiert.
- `"baseDir": ""` heißt: der ganze Vault, nicht nur ein Unterordner.
- `"useRemoteTweaks": true` übernimmt Chunk-Größe usw. aus den Einstellungen deiner LiveSync-Datenbank.
- `ignore` sorgt dafür, dass die Bridge nie Folgendes überträgt:
  - `**/*.obui-tmp`: kurzlebige Zwischendateien des Vault Browsers beim Speichern
  - `.trash/**`: der Papierkorb des Vault Browsers. Gelöschte Notizen werden auf allen Geräten gelöscht, die Sicherungskopie bleibt nur auf dem Server.
- `.obsidian` (Plugins, Einstellungen) wird nicht synchronisiert; das ist bei der Bridge standardmäßig so.

### 3. Von außen erreichbar machen (HTTPS)

Der Vault Browser lauscht nur auf `127.0.0.1:8080`. Davor gehört dein Reverse Proxy, z.B. Caddy:

```
notizen.deine-domain.at {
  reverse_proxy 127.0.0.1:8080
}
```

Danach erreichst du deinen Vault unter `https://notizen.deine-domain.at`. Deine CouchDB bleibt, wie sie ist.

#### Über die GitHub-Pages-Seite (ohne eigene Oberfläche)

Du kannst auch die gehostete Oberfläche nutzen und dort unter **„Eigener Server“** `https://notizen.deine-domain.at` eintragen. Dafür in `docker-compose.yml` die Adresse der Oberfläche erlauben, also die Domain **ohne Pfad**:

```yaml
ALLOWED_ORIGINS: "https://atoxien.github.io"
```

Nutzt du einen eigenen Fork, steht hier deine eigene Pages-Adresse (`https://<dein-user>.github.io`).

### Gut zu wissen

- **Gleichzeitiges Bearbeiten:** Bearbeitest du dieselbe Notiz zur selben Zeit im Browser und in Obsidian, löst LiveSync den Konflikt wie zwischen zwei Obsidian-Geräten. Der Vault Browser warnt außerdem, wenn eine Datei während des Bearbeitens von außen geändert wurde.
- **Live-Aktualisierung:** Änderungen von anderen Geräten erscheinen im Vault Browser nach wenigen Sekunden.
- **Updates der Bridge:** `docker compose build --pull livesync-bridge && docker compose up -d`. Nach Updates liest die Bridge die Datenbank laut ihrer Doku einmal neu ein.
- **Neu einlesen erzwingen** (z.B. nach einem „Rebuild“ der Datenbank in LiveSync): Bridge stoppen und einmal mit `--reset` starten:
  ```bash
  docker compose run --rm livesync-bridge deno run -A main.ts --reset
  ```
- **Groß-/Kleinschreibung und Unicode in Dateinamen:** Wenn du in LiveSync Einstellungen zur Pfad-Normalisierung geändert hast, müssen die Felder `pathNormalizationVersion` bzw. `handleFilenameCaseSensitive` in der Bridge dazu passen (siehe deren README).

### Getestet (Bridge)

Lokal mit zwei Bridge-Instanzen (eine für den Vault Browser, eine als „zweites Gerät“), Ende-zu-Ende-Verschlüsselung und Pfad-Verschleierung, gegen einen CouchDB-kompatiblen Testserver:

- Vault → verschlüsselte Datenbank → zweites Gerät: Notizen und Bilder identisch, in der Datenbank kein Klartext
- Neue Notiz und Änderung im Vault Browser → nach ca. 2 s auf dem zweiten Gerät, ohne Zwischendateien
- Neue Notiz auf dem zweiten Gerät → nach ca. 2 s im Vault Browser
- Löschen im Vault Browser → auf dem zweiten Gerät gelöscht, Papierkorb bleibt auf dem Server

Nicht getestet: gegen eine echte CouchDB mit dem Obsidian-Plugin. Mach deshalb zuerst den Test mit einer Test-Datenbank (siehe oben).

