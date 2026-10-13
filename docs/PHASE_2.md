# Phase 2 – Implementierung und Abnahme

Prüfstand: 10. Oktober 2026, direkt in `$HOME/Desktop/RevaMode/Python/ecole adaptive`.

## A. Implementiert

- Reine Mastery-, Auswahl-, Empfehlungs-, Wiederholungs- und Fehlertrainingsdienste mit zentraler Konfiguration.
- Finale Attempts und Kompetenzstände pro Profil, Fach und Skill; atomare, idempotente Speicherung.
- Lernstand, filterbarer Ergebnisverlauf, Fehlertraining und Vorher-/Nachher-Anzeige.
- 48 künstliche Mathematikaufgaben, sechs Skillgruppen, alle vier Schwierigkeitsstufen je Skillgruppe.
- Bestehende Klassenarbeit, Hilfestufen, Bewertung auf 20 und historische Paketkopien erhalten.

## B. Wesentliche neue/geänderte Dateien

| Bereich | Dateien |
| --- | --- |
| Reine adaptive Logik | `apps/student/src/domain/adaptive/{config,types,mastery,selection,recommendations,errorTraining,scheduling}.ts` |
| Sitzungen und Bewertung | `apps/student/src/domain/session.ts` |
| Persistenz und Abfragen | `apps/student/src/storage/{database,repositories}.ts` |
| UI-Koordination | `apps/student/src/App.tsx`, `hooks/useLearningApp.ts` |
| Oberflächen | `components/{ProfilePicker,LibraryView,MasteryView,HistoryView,SessionView,ResultView,ConfirmDialog,format}.tsx` bzw. `.ts`, `styles.css` |
| Datenverträge und Demo | `shared/types.ts`, `shared/validation.ts`, `shared/fixture-migrations.ts`, `shared/schemas/question-bank.schema.json`, `shared/fixtures/lutz-maths-demo*.json` |
| Tests | `domain/adaptive/adaptive.test.ts`, `storage/adaptivePersistence.test.ts`, `hooks/useLearningApp.test.tsx`, Schema-/Python-Regressionen |
| Werkzeugkonfiguration | `package.json`, `pnpm-lock.yaml`, `eslint.config.js`, `vitest.config.ts`, `apps/student/vite.config.ts`, Mac-Starter |
| Dokumentation | `ADAPTIVE_ENGINE.md`, `DATA_MODEL.md`, README und bestehende Architektur-/Autorenhinweise |

## C. Datenbank und Migration

Die vorhandene Datenbank `ecole-adaptive-v1` wird mit Dexie-Schemaversion 2 geöffnet. Die Tabellen `profiles`, `banks`, `sessions` und `results` bleiben erhalten. Hinzu kommen `studentSkillStates`, `attemptRecords` und `questionHistory`.

Der Kompetenzschlüssel ist `[studentId+subject+skillId]`. Attempts sind über Sitzung und Frage eindeutig. Speichern, Kompetenzbuchung und Abschluss erfolgen transaktional. `loadResult` benötigt ausdrücklich die Schüler-ID; der bestehende Test wurde nur um diesen Parameter ergänzt.

Die neue Demo ersetzt ausschließlich eine exakt unveränderte alte Demo-Fixture. Selbst bearbeitete Pakete und alte Sitzungskopien werden nicht überschrieben. Historische Ergebnisse erhalten beim Lesen neue Metadaten, aber keine nachträglich erfundenen Kompetenzwerte. Die echte Migration einer gefüllten Version-1-Datenbank ist getestet.

## D. Algorithmus

Ausgangswert 0,50. Finale Änderungen: direkt richtig +0,06; mit einem Hinweis +0,03; mit zwei Hinweisen +0,015; falsch −0,08; übersprungen −0,03. Positive Änderungen erhalten den Schwierigkeitsfaktor 0,8/1/1,2/1,35. Der Endwert wird auf 0…1 begrenzt.

Auswahlgewicht je Skill: `1 + 2 × (1 − mastery)`, ergänzt um 0,75 je Fehler im jüngsten Zehnerfenster (Bonus höchstens 2,25) und weiche Schwierigkeitsgewichte. Fünf jüngst gezeigte Fragen werden nach Möglichkeit vermieden. Transferfragen nach Fehlern erhalten einen Abstand; bereits besuchte oder bearbeitete Aufgaben bleiben erhalten. Fehlertraining bleibt auch nach Multi-Skill-Aufgaben im ursprünglichen Fehlerfokus.

Rechenbeispiel Lutz / `math.parentheses`: endgültig falsch **0,50 → 0,42**; Grundgewicht **2,00 → 2,16**; mit einem jüngeren Fehler **2,91** vor Schwierigkeitsgewichtung. Eine Aufgabe der Stufe 2 steigt damit von 3,00 auf 4,365. Gewicht ist keine feste Auswahlwahrscheinlichkeit.

## E. Automatische Tests

Abgedeckt sind alle Mastery-Ausgänge und Begrenzungen, Multi-Skill-Updates, konfigurierbare Schwierigkeit, deterministischer Seed, 1.000 simulierte Ziehungen, Fehlerhäufigkeit und ähnliche Schwierigkeit, Wiederholungsabstand, Themenfokus, kleine Pools, Profile/Fächer, Migration, unveränderbare Snapshots, doppelte Abgabe, verspätete Autosaves, Rollback, beschädigte Daten, offene Aufgaben, Zeitablauf sowie Profilwechsel während einer auslaufenden Prüfung.

Vor Beginn waren 66 TypeScript- und 47 Python-Tests grün. Ihre fachlichen Regressionen bleiben erhalten; Anpassungen betreffen die additive Difficulty-Stufe, zusätzliche Fixture-Abdeckung und die explizite Schüler-ID beim Ergebnisabruf.

## F. Bestätigte Ergebnisse

| Prüfung | Ergebnis |
| --- | --- |
| TypeScript/Vitest | **158 Tests in 7 Dateien bestanden** |
| Python/pytest | **59 Tests bestanden** |
| TypeScript strict | **bestanden**, `tsc --noEmit` |
| ESLint | **bestanden**, 0 Warnungen |
| Production Build | **bestanden**, ohne Chunk-Größenwarnung |

Ausgeführt: `pnpm check` (alle Tests, Lint und Build einschließlich Typecheck) und `.venv/bin/python -m pytest`. Node v24.19.0, pnpm 11.25.0, Python 3.13.0.

Zusätzlicher Browserdurchlauf gegen den Production Build:

- Eine falsche Zwischenantwort zeigte einen Hinweis; der Skill blieb bei 50 %. Der dritte Fehlversuch senkte ihn auf 42 %.
- Pausieren, Neuladen und Fortsetzen erhielten Eingaben und finalen Status.
- Eine Lernrunde und ein vollständiges Fehlertraining wurden abgeschlossen; im Training ergaben acht richtige Aufgaben 23/23 Punkte und 20,0/20 sowie positive Kompetenzänderungen.
- Prüfung mit absichtlichem Fehler und richtiger Antwort: Neuladen erhielt die Antwort und die weiterlaufende Frist; vorzeitige Abgabe ergab 2/18 Punkte, 11,1 % und 2,2/20.
- Historische Phase-1-Ergebnisse blieben sichtbar; Modusfilter funktionierte. Max zeigte keine Ergebnisse von Lutz.
- Ansichten bei 1440, 768 und 390 Pixeln geprüft. Das ist eine Browserdarstellungsprüfung, keine Freigabe auf echter iPad-Hardware.

Die im lokalen Testbrowser sichtbaren neuen Lutz-Ergebnisse sind absichtliche Entwicklungs-Testläufe. Der frühere Stand wurde nicht gelöscht.

## G. Manuell testen

1. `Start Ecole Adaptive.command` im Projektordner doppelklicken; denselben Browser und `http://127.0.0.1:5173` verwenden.
2. Lutz → Mathematik → Lernen. Eine Aufgabe dreimal bewusst falsch prüfen.
3. „Mein Lernstand“ öffnen: Der betroffene Skill ist um 0,08 gesunken. Die Runde bleibt gespeichert und kann unter „Meine Fächer“ fortgesetzt werden.
4. Die Runde abschließen. Noch nicht bearbeitete Aufgaben werden dabei mit −0,03 je zugeordnetem Skill gewertet.
5. Klassenarbeit starten, einige Antworten geben und abgeben. Punkte, Note, Skill-Auswertung und Korrektur prüfen.
6. „Meine Fehler trainieren“ öffnen: Bei genügend Varianten erscheinen andere Aufgaben; danach die Vorher-/Nachher-Werte ansehen.
7. „Meine Ergebnisse“ nach Modus filtern, altes Ergebnis öffnen und den Browser neu laden. Anschließend Max oder Ben auswählen und die Trennung prüfen.

## H. Grenzen

Lokale Profile sind keine Anmeldung. Daten bleiben an Browser und Origin gebunden. Die Demo ist künstlich, das Kompetenzmodell eine transparente Heuristik. Kleine Variantenpools können weniger als acht Fragen liefern oder keine passende Runde erlauben. Algebrawerte werden weiterhin gegen hinterlegte Antwortvarianten geprüft. Keine Cloud-Synchronisierung und kein zuverlässiger Offline-Neustart der Anwendung.

**Stopp nach Phase 2.** Service Worker, App-Installation und vollständiger Offlinebetrieb sind nicht Bestandteil dieses Auftrags.

## I. Commit-Vorschlag

`feat: add adaptive mastery, focused error training and learning history`

Es wurde kein Commit angelegt.

## Ansichtsbelege

Lokaler Bildschirmnachweis: `docs/screenshots/phase2-mastery-desktop.png` (wegen sichtbarer Lernstände nicht im Git-Upload).

Lokaler Bildschirmnachweis: `docs/screenshots/phase2-mastery-ipad.png` (wegen sichtbarer Lernstände nicht im Git-Upload).

Lokaler Bildschirmnachweis: `docs/screenshots/phase2-history-mobile.png` (wegen sichtbarer Ergebnisse nicht im Git-Upload).
