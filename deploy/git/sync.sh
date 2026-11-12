#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Atoxien
#
# Hält den Vault-Ordner mit einem Git-Repository (z.B. GitLab) synchron:
# Änderungen aus dem Vault Browser werden committet und gepusht,
# Änderungen von anderen Geräten werden geholt.
set -eu

: "${GIT_REMOTE:?GIT_REMOTE fehlt (z.B. https://oauth2:TOKEN@gitlab.example.com/ich/vault.git)}"
BRANCH="${GIT_BRANCH:-main}"
INTERVAL="${SYNC_INTERVAL:-120}"
DIR="${VAULT_DIR:-/vault}"

export HOME="${HOME:-/tmp}"
mkdir -p "$HOME"
git config --global --add safe.directory "$DIR"
git config --global user.name "${GIT_AUTHOR_NAME:-Vault Browser}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-vault-browser@localhost}"

log() { echo "$(date '+%F %T') $*"; }

cd "$DIR"
if [ ! -d .git ]; then
  if [ -n "$(ls -A)" ]; then
    log "Fehler: $DIR ist nicht leer und kein Git-Repository. Bitte leeren Ordner verwenden."
    exit 1
  fi
  log "Klone Repository (Branch $BRANCH) ..."
  git clone -q --branch "$BRANCH" "$GIT_REMOTE" .
fi
git remote set-url origin "$GIT_REMOTE"
# Zwischendateien des Vault Browsers nie committen
grep -qx '\*.obui-tmp' .git/info/exclude 2>/dev/null || echo '*.obui-tmp' >> .git/info/exclude

while true; do
  git add -A
  if ! git diff --cached --quiet; then
    git commit -q -m "Vault Browser: $(date -u '+%F %T') UTC"
    log "Lokale Änderungen committet"
  fi
  if git pull -q --rebase --autostash origin "$BRANCH"; then
    if [ -n "$(git rev-list "origin/$BRANCH..HEAD" 2>/dev/null)" ]; then
      git push -q origin "HEAD:$BRANCH" && log "Gepusht" || log "Push fehlgeschlagen, neuer Versuch später"
    fi
  else
    # Konflikt: nichts verlieren. Eigene Commits auf einen eigenen Branch sichern,
    # dann den Stand vom Server übernehmen, damit die Synchronisierung weiterläuft.
    git rebase --abort 2>/dev/null || true
    SAFE="vault-browser-konflikt-$(date -u '+%Y%m%d-%H%M%S')"
    if git push -q origin "HEAD:refs/heads/$SAFE"; then
      git reset -q --hard "origin/$BRANCH"
      log "Konflikt! Eigene Änderungen gesichert auf Branch $SAFE, Stand vom Server übernommen."
    else
      log "Konflikt und Sicherung fehlgeschlagen, neuer Versuch später"
    fi
  fi
  sleep "$INTERVAL"
done
