# École Adaptive

Lokaler Lernraum für mehrere Schüler: adaptive Übungen, feste Klassenarbeiten, Fehlertraining, Lernstand und Ergebnisverlauf. Das Teacher Studio bereitet Unterrichtsfotos/PDFs mit einer kontrollierten KI-Pipeline auf. Die Schüler-App lädt freigegebene Pakete und arbeitet anschließend vollständig offline.

**Stand: 1.0.0-rc.1.** Die technische Umsetzung ist vorhanden. Die endgültige 1.0.0-Freigabe setzt den im [Abnahmebericht](docs/PHASE_3_ACCEPTANCE.md) dokumentierten echten Quellen-/KI-Test und die Geräteabnahme voraus. Automatische Tests mit einem isolierten Testprovider sind kein Nachweis für die fachliche Qualität echter KI-Ausgaben.

## Auf diesem Mac per Doppelklick starten

Im Ordner `$HOME/Desktop/RevaMode/Python/ecole adaptive`:

- **Start Ecole Adaptive.command** öffnet die Schüler-App unter `http://127.0.0.1:5173/`.
- **Start Teacher Studio.command** öffnet das Teacher Studio unter `http://127.0.0.1:8000/`.

Das jeweilige Terminalfenster geöffnet lassen, solange die Anwendung gebraucht wird. Mit Ctrl+C stoppen. Ein zweiter Start öffnet die bereits laufende Anwendung. Bei Startfehlern bleibt eine verständliche Meldung stehen. Die alte Kopie unter `Documents/ChatGPT` ist nicht der aktuelle Projektstand.

Die Starter verwenden die bereits eingerichteten Laufzeiten. Für das Teacher Studio liegt der Python-Cache außerhalb von iCloud unter `~/Library/Caches/EcoleAdaptive/teacher/`; so wartet Python nicht auf ausgelagerte alte Cachedateien. Startprotokolle liegen dort beziehungsweise unter `~/Library/Caches/EcoleAdaptive/student/start.log`. Falls der Finder für Projektdateien Wolkensymbole zeigt: den Projektordner vollständig herunterladen und **Downloads behalten** verwenden. Die erstmalige Einrichtung auf einem anderen Rechner folgt unten.

## A. Schüler-App starten

Voraussetzungen: Node.js 24 ab 24.15 (oder unterstützte Node-22-/26-Version laut package.json), npm und Python 3.12 oder neuer für das Teacher Studio und die vollständigen Browserprüfungen.

```bash
cd "$HOME/Desktop/RevaMode/Python/ecole adaptive"
npm install
npm run dev
```

Die ausgegebene lokale Adresse öffnen. Für reproduzierbare Entwicklung und CI ist zusätzlich `pnpm-lock.yaml` hinterlegt; alternativ `pnpm install --frozen-lockfile` und `pnpm dev` verwenden. Nicht abwechselnd verschiedene Lockfiles einchecken.

Max startet mit 3eme, Lutz mit 5eme, Ben mit CM1. Neue Profile lassen sich unter **+ Schüler · Profile verwalten** anlegen. Die klar markierte Lutz-Mathematikdemo enthält künstliche Aufgaben. Weitere Fächer und Profile sind frei bearbeitbar. Profile werden archiviert, nicht mitsamt Lernständen gelöscht.

Der Entwicklungsserver verwendet keinen Service Worker. Für Offline-Tests den Produktionsbuild starten:

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Einmal online öffnen, „App offline bereit“ abwarten und Pakete unter **Neue Inhalte** herunterladen. Auf einem iPad ist für den installierbaren Offlinebetrieb eine HTTPS-Adresse erforderlich: [iPad-Anleitung](docs/IPAD_SETUP.md).

## B. Teacher Studio starten

```bash
cd "$HOME/Desktop/RevaMode/Python/ecole adaptive"
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[test]'
```

Falls noch nicht vorhanden, `.env.example` nach `.env` kopieren. In `.env` lokal `OPENAI_API_KEY` eintragen; `OPENAI_MODEL` ist optional und steht standardmäßig auf `gpt-4.1`. Vorhandene `.env` niemals mit einer Vorlage überschreiben. Schlüssel weder in den Chat noch in die Schüler-App übernehmen.

```bash
python -m teacher
```

[Teacher Studio lokal öffnen](http://127.0.0.1:8000). Der Server bindet standardmäßig ausschließlich an `127.0.0.1`.

1. Schüler, Fach, Klasse, Sprache, Modus, Dauer und Anspruch wählen.
2. Mehrere JPG/PNG/WebP/PDF-Dateien hinzufügen.
3. **Unterlagen analysieren** bewusst starten: Dabei werden diese Unterlagen an OpenAI übertragen.
4. Kapitel, Lernziele, Regeln, Skills und Unsicherheiten prüfen, korrigieren und **Analyse bestätigen**.
5. Aufgabenpool erzeugen, Prüfhinweise bearbeiten; Fragen einzeln ansehen, ändern, deaktivieren oder neu generieren.
6. Nach Änderungen erneut validieren; festen Prüfungsplan prüfen und speichern.
7. Aufgaben freigeben und **Für Schüler veröffentlichen**.

Originaldateien, Entwürfe und Logs bleiben unter `.teacher-data/` auf dem Mac. Freigegebene Pakete liegen unter `content/`. Details: [Teacher Studio](docs/TEACHER_STUDIO.md).

## C. Veröffentlichen und bereitstellen

```bash
source .venv/bin/activate
python -m teacher publish
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

`publish` prüft vorhandene Pakete, baut den Katalog neu und zeigt den Git-Status. Ein noch nicht veröffentlichtes, bereits freigegebenes Studio-Projekt kann mit `python -m teacher publish --job JOB_ID` veröffentlicht werden. Kein Befehl pusht automatisch.

Für GitHub Pages ist ein Workflow vorbereitet: [Deployment](docs/DEPLOYMENT.md). Nur `apps/student/dist/` wird bereitgestellt, niemals Teacher, `.env` oder Originalquellen. Ein lokales Publish ist noch keine Übertragung auf das iPad; dafür den neuen Build auf dem Host veröffentlichen.

## Prüfen

```bash
source .venv/bin/activate
python -m pip install -e '.[test]'
npm run test:e2e:install
npm run check
python -m pytest
```

`check` führt TypeScript-Tests, Typecheck, Lint, Produktionsbuild und Playwright-Tests in Chromium und WebKit aus. Der Teacher-Browsertest startet einen isolierten lokalen Testserver. Nur der KI-Provider ist dort ersetzt; keine echten API-Aufrufe und keine API-Kosten. Mit `make check` werden beide Stacks geprüft. Eine vollständige Python-Umgebung ist für die Teacher-Browsertests erforderlich.

## Lern- und Datenregeln

- Lernmodus: bis zu drei Versuche, abgestufte Hinweise, abschließende Lösung; ein Mastery-Update pro finalisierter Frage.
- Klassenarbeit: gespeicherter fester Plan und absolute Deadline; Zeit läuft auch bei geschlossener App weiter. Nach Ablauf wird beim nächsten Öffnen abgegeben.
- Bewertung: volle Punkte oder null je Aufgabe; `/20 = erreichte / mögliche Punkte × 20`, auf eine Nachkommastelle gerundet. Keine Teilpunkte ohne ausdrücklich modellierte Teilaufgaben.
- Fehlertraining: andere Aufgaben zu ursprünglichen Fehlerschwerpunkten, soweit im lokalen Pool verfügbar. Kleine Pools liefern gegebenenfalls kürzere Runden.
- Mastery startet bei 50 % als neutralem Ausgangswert, nicht als gemessener Leistung. Das Modell ist eine transparente Lernheuristik.
- Antworten, Ergebnisse und Lernstände werden je Schüler getrennt gespeichert. Ein Profil ist keine Zugangssicherung.
- **Profile & Backup** exportiert alle lokalen Daten als JSON und importiert validierte Sicherungen ohne stilles Überschreiben persönlicher Konflikte.
- Ergebnis teilen nutzt die native Teilen-Funktion oder kopierbaren Text, auch offline und ohne eigenen Server.

## Dokumentation

[Architektur](docs/ARCHITECTURE.md) · [Datenmodell](docs/DATA_MODEL.md) · [Adaptive Engine](docs/ADAPTIVE_ENGINE.md) · [Teacher Studio](docs/TEACHER_STUDIO.md) · [Inhaltspakete](docs/CONTENT_PACKAGES.md) · [Offline-Architektur](docs/OFFLINE_ARCHITECTURE.md) · [iPad einrichten](docs/IPAD_SETUP.md) · [Deployment](docs/DEPLOYMENT.md) · [Backup](docs/BACKUP_RESTORE.md) · [Fehlerhilfe](docs/TROUBLESHOOTING.md) · [Abnahmestand](docs/PHASE_3_ACCEPTANCE.md).

`PHASE_1.md` und `PHASE_2.md` dokumentieren historische Prüfstände. Die ursprünglichen Schuldateien gehören nicht ins Repository. Öffentliche statische Pakete sind ohne Login abrufbar; vor Veröffentlichung persönliche Angaben und Quellenbezeichnungen prüfen.
