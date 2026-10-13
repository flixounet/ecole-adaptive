# Architektur

## Leitentscheidung

Der Schülerteil liest vollständig vorbereitete, validierte JSON-Pakete. Seine Aufgabenbewertung arbeitet lokal und deterministisch. Das lokale Teacher Studio ist ein separater Python-/FastAPI-Teil ohne Laufzeitabhängigkeit der Student-App. Die Schüler-App wird als statische PWA bereitgestellt. OpenAI wird ausschließlich im lokalen Teacher-Prozess auf bewusste Benutzeraktion angesprochen.

Das Repository verwendet ein Root-Paket für React, TypeScript, Vite und Vitest sowie ein Python-Projekt für lokale Inhaltsvalidierung. Dexie kapselt IndexedDB; Ajv und Python `jsonschema` verwenden dieselben JSON-Schemas nach Draft 7. Es gibt in Phase 2 keinen Server und keine Schülerkonten.

## Verzeichnisse

| Pfad                | Verantwortung                                                      |
| ------------------- | ------------------------------------------------------------------ |
| `apps/student/src/` | React-Oberfläche, Antwort- und Sitzungslogik, lokale Speicherung   |
| `shared/types.ts`   | TypeScript-Verträge für Profile, Aufgaben und Fragenbanken         |
| `shared/schemas/`   | Kanonische JSON-Schemas für beide Sprachen                         |
| `shared/fixtures/`  | Öffentliche, künstliche Entwicklungsdaten                          |
| `teacher/`          | Lokales FastAPI-Studio, OpenAI-Provider, Quellenreview, Validierung und Publisher |
| `content/<profil>/` | Zielstruktur für künftig freigegebene Aufgabenpakete               |
| `sources/<profil>/` | Private Originalunterlagen, vom Versionsstand ausgeschlossen       |
| `tests/`            | Automatisierte Prüfungen                                           |
| `docs/`             | Bedienung, Format, Architektur und Phasengrenzen                   |

## Datenfluss in Phase 2

1. Profile und Demofragenbank werden beim Start validiert und lokal bereitgestellt.
2. Eine neue Sitzung enthält eine Kopie des vollständigen Pakets einschließlich Version, Aufgabenreihenfolge und Lösungen. Sie ist an ein Profil gebunden.
3. Antworten und Navigation aktualisieren die aktive Sitzung in IndexedDB. Der Lernmodus zählt Prüfversuche und Hinweise. Erst ein endgültiger Ausgang erzeugt einen Attempt und aktualisiert alle betroffenen Skills atomar. Adaptive Planänderungen betreffen nur noch unberührte Aufgaben.
4. Im Testmodus bestimmt ein absoluter Zeitstempel das Fristende. Die Restzeit wird daraus berechnet, statt von einem fortlaufenden Zähler abhängig zu sein. Ein Neuladen setzt die Frist nicht zurück.
5. Bei Abschluss werden Korrektur und Ergebnis aus dem gespeicherten Paketstand berechnet. Sitzung und Ergebnis werden gemeinsam abgeschlossen, damit wiederholte Abgabe kein zweites Ergebnis erzeugt.

Die Paketkopie schützt eine laufende Arbeit und deren Korrektur vor späteren Änderungen an den ursprünglichen Aufgaben. Eine gewichtete Auswahl ohne doppelte Aufgabe liefert normale Runden mit `questionCount` Aufgaben. Im Demopaket sind das 12 aus 48 Aufgaben. Kompetenzwerte, jüngste Fehler, Schwierigkeit und angezeigte Aufgaben beeinflussen die Auswahl. Fehlertraining verwendet normalerweise bis zu acht Varianten. Beim Fortsetzen bleibt der gespeicherte Plan bestehen; im Lernmodus kann ein endgültiger Fehler spätere unberührte Positionen für Transferaufgaben anpassen. Zwei neue Runden können sich trotz Wiederholungsregeln überschneiden.

## Antwortprüfung und Bewertung

Die Antwortlogik ist unabhängig von React und IndexedDB. Zahlen werden ohne Gleitkomma-Rundung normalisiert. Ausdrücke werden als normalisierte Schreibweisen verglichen; weder `eval()` noch symbolische Algebra werden eingesetzt. Eine äquivalente, aber nicht hinterlegte Umformung kann deshalb abgelehnt werden. Das ist bei der Aufgabenformulierung zu berücksichtigen.

Punkte sind pro Aufgabe vollständig oder null. Aus den Gesamtpunkten werden `score20 = earnedPoints / maxPoints × 20` und der Prozentwert abgeleitet, jeweils mit einer Nachkommastelle gespeichert. Hinweise im Lernmodus reduzieren die Punkte nicht. Der Lernmodus ist deshalb eine Übungsrückmeldung und keine mit einer unbeaufsichtigten Klassenarbeit vergleichbare Leistungsmessung.

## Lokale Speicherung

IndexedDB speichert Profile, Aufgabenpakete, laufende Sitzungen, Ergebnisse, Skillzustände, Abschlussversuche und Präsentationshistorie. Die additiven Dexie-Migrationen bis Version 3 erhalten bestehende Sitzungen und Paketkopien. Installierte Inhalte werden zusätzlich je Schüler gespeichert. Daten sind an den Browser und die Origin gebunden. Ein Browserwechsel, eine andere Adresse oder ein anderer Port kann wie eine leere Installation erscheinen. Browser können Websitedaten entfernen; die App stellt deshalb einen vollständig validierten lokalen JSON-Backup-/Importweg bereit.

Die App enthält Aufgabenlösungen für die lokale Korrektur. Sie ist eine familiäre Lernhilfe, kein gegen Manipulation abgesichertes Prüfungssystem. Eine absichtlich veränderte Geräteuhr lässt sich ohne vertrauenswürdigen Zeitdienst nicht zuverlässig erkennen.

## Ergänzungen der abschließenden Phase 3

- App Shell: Vite/PWA-Worker mit bewusstem Update, Offline-Kaltstart und Basis-Pfad für statisches Hosting.
- Inhalt: unabhängige Paketversionen, SHA-256/JCS, Katalogerkennung und explizite Installation in IndexedDB.
- Teacher: Upload → SourceModel → menschliche Bestätigung → Fragenbank → lokale/KI-Validierung → Review → Freigabe → unveränderliches Paket.
- Profile, Archivierung, vollständige Backups und natives Ergebnis-Teilen mit Textfallback.
- Playwright mit Chromium/WebKit; separater Testprovider ausschließlich in Tests.

Es wird keine zusätzliche Phase 4 begonnen. Die endgültige Releasefreigabe richtet sich nach `PHASE_3_ACCEPTANCE.md`.

Die bestehenden Ergebnisfelder `skillsBefore` und `skillsAfter` bleiben als Aliasfelder für `masteryBefore` und `masteryAfter` erhalten. In alten Phase-1-Ergebnissen bleiben fehlende Kompetenzwerte leer; abgeschlossene historische Runden werden nicht rückwirkend bewertet.

Die reinen Module in `domain/adaptive/` behandeln Mastery, gewichtete Auswahl, Wiederholungsplanung, Fehlertraining und Empfehlungen. Storage koordiniert Transaktionen und Idempotenz. Die Regeln stehen in [ADAPTIVE_ENGINE.md](ADAPTIVE_ENGINE.md), die Verträge und Migration in [DATA_MODEL.md](DATA_MODEL.md).

Die `AIProvider`-Grenze trennt Quellenauswertung, Fragengenerierung und Qualitätskontrolle. Der produktive OpenAI-Provider nutzt Responses mit Pydantic-Schemas und erhält Bilder/PDFs direkt. Ungültige oder unklare Erkennung wird nicht durch erfundene Daten ersetzt. Schlüssel bleiben ausschließlich im lokalen Teacher-Prozess; der Schülerteil importiert keinen Teacher-Code und keine `.env`-Datei.

## Gleichzeitige Verwendung

Pro Profil lässt die Datenbank nur eine aktive Sitzung zu; konkurrierende Starts werden atomar abgefangen. Dieselbe Sitzung sollte nur in einem Tab bearbeitet werden. Abgeschlossene Antworten und neuere adaptive Planrevisionen werden gegen verspätete Speichervorgänge geschützt. Ein nicht sicher auflösbarer Konflikt wird mit einer Aufforderung zum Neuladen gemeldet; die App ersetzt dabei keine geschützten Antworten stillschweigend.

## Autorisierung und Sicherheitsgrenzen

Teacher bindet localhost, prüft Host/Origin und CSRF-Token und schützt Auftragsänderungen durch Revisionen und Dateisperren. Der Schülerteil kommuniziert nicht mit der Teacher-API. Statisch publizierte Pakete enthalten Profilzuordnungen, aber keine Zugriffskontrolle. Originalquellen/Entwürfe/Logs liegen separat und werden vom Vite-Build ausgeschlossen. Unterrichtsmaterial ist Datenquelle, keine Anweisung an den KI-Provider.

Weitere Details: [Content](CONTENT_PACKAGES.md), [Offline](OFFLINE_ARCHITECTURE.md), [Teacher](TEACHER_STUDIO.md).
