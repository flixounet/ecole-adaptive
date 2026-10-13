#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
ECOLE_START_LOG_DIR="$HOME/Library/Caches/EcoleAdaptive/student"
mkdir -p "$ECOLE_START_LOG_DIR"
ECOLE_START_LOG="$ECOLE_START_LOG_DIR/start.log"
exec > >(/usr/bin/tee -a "$ECOLE_START_LOG") 2>&1
printf '\n--- École-Start %s ---\n' "$(date '+%Y-%m-%d %H:%M:%S')"

# Keep actionable errors visible when launched with a Finder double-click.
ecole_on_exit() {
  local status=$?
  if [[ "$status" -ne 0 && "$status" -ne 130 ]]; then
    printf '\nÉcole konnte nicht gestartet werden (Fehler %s).\n' "$status"
    printf 'Bitte die Meldung oberhalb prüfen. Projekt: %s\n' "$PWD"
    printf 'Startprotokoll: %s\n' "$ECOLE_START_LOG"
    if [[ -t 0 ]]; then read -r -p 'Mit Enter schließen.' || true; fi
  fi
}
trap ecole_on_exit EXIT

ECOLE_URL='http://127.0.0.1:5173/'
# A second double-click should reopen the running app, not fail with EADDRINUSE.
if ECOLE_EXISTING="$(/usr/bin/curl --location --max-redirs 3 --proto-redir =http --noproxy '*' --fail --silent --connect-timeout 2 --max-time 3 "$ECOLE_URL" 2>/dev/null)"; then
  if [[ "$ECOLE_EXISTING" == *'<title>École Adaptive · Dein Lernraum</title>'* ]]; then
    printf 'École läuft bereits: %s\n' "$ECOLE_URL"
    if [[ "${ECOLE_NO_OPEN:-0}" != 1 ]]; then /usr/bin/open "$ECOLE_URL"; fi
    exit 0
  fi
  printf 'Port 5173 wird von einem anderen Dienst verwendet. Bitte diesen zuerst beenden.\n' >&2
  exit 1
fi
if /usr/sbin/lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  printf 'Port 5173 ist belegt, aber École antwortet noch nicht. Bitte das erste Startfenster prüfen.\n' >&2
  exit 1
fi

ECOLE_NODE=''
for candidate in "$(command -v node || true)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"; do
  [[ -x "$candidate" ]] || continue
  if "$candidate" -e 'const [major,minor,patch]=process.versions.node.split(".").map(Number);process.exit((major===22&&(minor>22||(minor===22&&patch>=2)))||(major===24&&minor>=15)||major>=26?0:1)' 2>/dev/null; then
    ECOLE_NODE="$candidate"
    break
  fi
done
if [[ -z "$ECOLE_NODE" ]]; then
  printf 'Eine unterstützte Node.js-Version fehlt (22.22.2+, 24.15+ oder 26+). Siehe README.md.\n' >&2
  exit 1
fi
export PATH="$(dirname "$ECOLE_NODE"):$PATH"
if [[ ! -f node_modules/vite/bin/vite.js ]]; then
  printf 'Abhängigkeiten fehlen. Bitte im Projektordner npm install ausführen.\n' >&2
  exit 1
fi
if [[ ! -f apps/student/dist/index.html ]]; then
  printf 'Produktionsbuild fehlt. Bitte zuerst npm run build ausführen.\n' >&2
  exit 1
fi
printf 'École Schüler-App: %s\n' "$ECOLE_URL"
printf 'Dieses Terminalfenster geöffnet lassen. Stoppen mit Ctrl+C.\n'
printf 'Für Unterrichtsdateien den separaten Starter „Start Teacher Studio.command“ verwenden.\n'
if [[ "${ECOLE_NO_OPEN:-0}" == 1 ]]; then
  "$ECOLE_NODE" node_modules/vite/bin/vite.js preview --config apps/student/vite.config.ts --host 127.0.0.1 --port 5173 --strictPort
else
  "$ECOLE_NODE" node_modules/vite/bin/vite.js preview --config apps/student/vite.config.ts --host 127.0.0.1 --port 5173 --strictPort --open
fi
