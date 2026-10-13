#!/bin/bash
set -u
cd "$(dirname "$0")" || exit 1
ECOLE_PYTHON="$PWD/.venv/bin/python"
ECOLE_TEACHER_CACHE_DIR="${ECOLE_TEACHER_CACHE_DIR:-$HOME/Library/Caches/EcoleAdaptive/teacher}"
export ECOLE_TEACHER_CACHE_DIR
export PYTHONPYCACHEPREFIX="$ECOLE_TEACHER_CACHE_DIR/pycache"

teacher_error() {
  printf '\n%s\n' "$1"
  if [[ -t 0 && "${ECOLE_NO_PAUSE:-0}" != "1" ]]; then
    read -r -p 'Mit Enter schließen.'
  fi
}
if [[ ! -x "$ECOLE_PYTHON" ]]; then
  teacher_error 'Die Python-Umgebung fehlt. Bitte die Teacher-Einrichtung in docs/TEACHER_STUDIO.md ausführen.'
  exit 1
fi
if ! mkdir -p "$ECOLE_TEACHER_CACHE_DIR/pycache"; then
  teacher_error 'Der lokale Cache-Ordner konnte nicht angelegt werden. Bitte Zugriffsrechte und freien Speicher prüfen.'
  exit 1
fi
printf 'École Teacher Studio startet. Dieses Fenster geöffnet lassen. Stoppen mit Ctrl+C.\n'
"$ECOLE_PYTHON" -X "pycache_prefix=$PYTHONPYCACHEPREFIX" -u scripts/start_teacher.py
ECOLE_EXIT=$?
if [[ "$ECOLE_EXIT" -ne 0 ]]; then
  teacher_error 'Teacher Studio konnte nicht gestartet werden. Hinweise zur Ursache stehen oben.'
fi
exit "$ECOLE_EXIT"
