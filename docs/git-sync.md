# Vault aus Git (z.B. GitLab) im Browser bearbeiten

Liegt dein Vault in einem Git-Repository, zum Beispiel einem privaten GitLab, läuft auf deinem Server:

```
Handy / PC (Obsidian + Git-Plugin) ⇄ GitLab ⇄ git-sync ⇄ Vault-Ordner ⇄ Vault Browser ⇄ Browser
```

- **git-sync** klont das Repository in einen Ordner. Alle 2 Minuten (einstellbar) committet und pusht es Änderungen aus dem Browser und holt Änderungen von anderen Geräten.
- **Vault Browser** arbeitet direkt auf diesem Ordner. Im Browser verbindest du dich über die Karte **„Eigener Vault-Browser-Server“**.

Es gibt keine Datenbank, keine Verschlüsselungsschlüssel und keine Bridge. Im Repository liegen einfach deine Markdown-Dateien.

## 1. Zugangs-Token in GitLab anlegen

Im Vault-Projekt: **Settings → Access tokens → Add new token**

- Name: `vault-browser`
- Rolle: **Developer** (darf auf nicht geschützte Branches pushen; ist `main` geschützt, **Maintainer** oder unter *Settings → Repository → Protected branches* Developers das Pushen erlauben)
- Berechtigungen: **read_repository** und **write_repository**
- Ablaufdatum: nach Wunsch. Danach muss das Token erneuert werden.

Das Token gilt nur für dieses eine Projekt. Teile es mit niemandem und füge es nirgends ein außer in die `.env`-Datei auf dem Server.

## 2. Auf dem Server einrichten (1Panel)

1. Dateien aus [`deploy/git`](../deploy/git) in einen Ordner auf dem Server kopieren, z.B. `/opt/vault-browser`: `docker-compose.yml`, `sync.sh` und `.env.example`.
2. `.env.example` nach `.env` kopieren und ausfüllen:
   - `VAULT_PASSWORD`: dein Login-Passwort für den Vault Browser
   - `SESSION_SECRET`: Zufallswert, z.B. `openssl rand -hex 32`
   - `GIT_REMOTE`: `https://oauth2:<TOKEN>@<dein-gitlab>/<gruppe>/<projekt>.git`
   - `GIT_BRANCH`: meist `main` (bei älteren Repos manchmal `master`)
3. Leeren Ordner `vault` daneben anlegen und dem Benutzer 1000 geben: `mkdir vault && chown 1000:1000 vault`
4. In 1Panel unter **Container → Compose → Erstellen** den Ordner wählen (oder `docker compose up -d` im Ordner ausführen).
5. Logs von `vault-git-sync` prüfen. Dort sollte `Klone Repository …` stehen und danach keine Fehlermeldung.

## 3. Subdomain mit HTTPS (1Panel)

**Websites → Erstellen → Reverse-Proxy**

- Domain: z.B. `notizen.example.com`
- Ziel: `http://127.0.0.1:8080`
- Danach unter **HTTPS** ein Let's-Encrypt-Zertifikat anfordern.

Dann auf <https://atoxien.github.io/obsidian-browserui/> die Karte **„Eigener Vault-Browser-Server“** wählen, `https://notizen.example.com` eintragen und mit deinem `VAULT_PASSWORD` anmelden. Alternativ öffnest du die Subdomain direkt, der Server liefert die Oberfläche selbst mit.

## 4. Obsidian auf Handy und PC

Damit Änderungen aus dem Browser auch auf den Geräten ankommen, müssen die Geräte ebenfalls mit GitLab abgleichen, zum Beispiel mit dem Community-Plugin **Git** (Vinzent03):

- *Auto commit-and-sync interval* z.B. 5 Minuten
- *Pull on startup* einschalten

Am Handy funktioniert das Plugin auch, ist dort aber langsamer.

**Wichtig:** Lass nicht zwei Sync-Systeme gleichzeitig dieselben Dateien abgleichen, z.B. LiveSync **und** Git auf demselben Vault. Wenn Git dein Hauptweg wird, schalte LiveSync auf den Geräten ab, sobald alles in GitLab vollständig ist. Vorher ein Backup machen.

## Konflikte

Wurde dieselbe Stelle gleichzeitig im Browser und auf einem Gerät geändert, kann git-sync nicht automatisch zusammenführen. Dann geht nichts verloren:

- Die Browser-Änderungen werden auf einen eigenen Branch `vault-browser-konflikt-<Datum>` in GitLab gepusht.
- Der Ordner übernimmt den Stand vom Server, und der Abgleich läuft weiter.

In GitLab kannst du den Branch ansehen und die Änderung von Hand übernehmen. Je kürzer `SYNC_INTERVAL`, desto seltener passiert das.
