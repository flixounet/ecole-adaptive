# Phase 1: Umfang und Abnahme

Phase 1 legt den ausführbaren Schülerteil und gemeinsame Datenverträge an. Der folgende Prüfstand gilt für die lokale Implementierung vom **10. Oktober 2026**. Die manuelle Checkliste bleibt davon getrennt.

## Umgesetzt

- React-/TypeScript-/Vite-Grundstruktur und getrennte lokale Python-Validierung.
- Gemeinsame JSON-Schemas, TypeScript-Verträge und künstliche Mathematik-Fixture mit 20 Aufgaben für Lutz.
- Lokale Profile Max, Lutz und Ben sowie profilbezogene Paketzuordnung.
- Lernmodus mit bis zu drei Versuchen, zwei Hilfestufen und anschließender Lösung.
- Klassenarbeit mit absoluter Abgabefrist, Navigation, vorzeitiger und automatischer Abgabe.
- Lokale Persistenz mit Dexie/IndexedDB und Fortsetzen einer gespeicherten Sitzung.
- Korrektur je Aufgabe, Punkte, Prozentwert und Bewertung auf 20.
- Unit-Tests für Antwortvergleich, Sitzungs-/Timerlogik, Bewertung, Validierung und Speicherverhalten.

## Automatische Abnahme

Vom Projektstamm aus:

```sh
pnpm test
pnpm typecheck
pnpm build
python -m pytest
```

Python benötigt zuvor die in der README beschriebene Installation. Tests für Mastery-Updates, adaptive Auswahl und Service Worker folgen mit den zugehörigen Implementierungen in Phase 2 beziehungsweise 3.

Bestätigter automatischer Prüfstand, abschließend auch direkt im Desktop-Zielordner ausgeführt:

| Prüfung | Ergebnis |
| --- | --- |
| Vitest | 66 Tests bestanden |
| pytest | 47 Tests bestanden |
| TypeScript im Strict-Modus | Ohne Fehler bestanden |
| Produktionsbuild | Erfolgreich erstellt |

Der gebaute Stand wurde im Codex-Browser geprüft: Profilauswahl, Lernhinweise, Lösung nach drei Fehlversuchen, Dezimalkomma, Prüfungsnavigation, Antwort- und Timererhalt nach Neuladen, vorzeitige Abgabe und Korrektur. Darstellung bei 768 × 1024 und 390 × 844 geprüft; Screenshots liegen unter `docs/screenshots/`. Das ist keine Prüfung auf einem echten iPad. Die Paketverwaltung ist auf pnpm 11.25.0 festgelegt. In `pnpm-workspace.yaml` ist das Build-Skript von `esbuild` ausdrücklich freigegeben.

## Manueller Durchlauf

- [x] Alle drei Profile lassen sich wählen; nur Lutz erhält das zugeordnete Demopaket.
- [x] Eine richtige Lernantwort zeigt Lösung und Merksatz; die erste und zweite falsche Antwort schalten die passende Hilfe frei.
- [x] Nach dem dritten Fehlversuch lässt sich die Aufgabe nicht nochmals bewerten; die vollständige Korrektur ist sichtbar.
- [x] In einer Klassenarbeit erscheinen vor Abgabe keine Hinweise oder Lösungen.
- [x] Vorwärts, zurück und überspringen erhalten bereits eingegebene Antworten.
- [x] Neuladen stellt eine aktive Sitzung und ihren bisherigen Stand wieder her.
- [ ] Eine Klassenarbeit behält ihre ursprüngliche Frist nach Neuladen oder Tabwechsel; nach Fristende wird sie abgeschlossen.
- [ ] Vorzeitige Abgabe bewertet leere Antworten mit null Punkten; wiederholte Abgabe erzeugt kein Duplikat.
- [x] Bewertung und Korrektur stimmen mit den ausgewählten Aufgaben überein.
- [x] Gespeicherte Ergebnisse und aktive Sitzungen bleiben dem jeweiligen Profil zugeordnet.
- [ ] Speicherfehler werden sichtbar, statt eine erfolgreiche Speicherung vorzutäuschen.

Zeitablauf, idempotente Abgabe und Schreibfehler/Transaktionsrollback sind automatisiert getestet; diese Fehlerfälle wurden nicht zusätzlich im Browser künstlich ausgelöst.

Browser-Unit-Tests mit einer IndexedDB-Nachbildung sind keine Prüfung auf realem Safari oder einem iPad. Eine native Geräteabnahme und Offline-Kaltstart-Tests bleiben offen.

## Nächster abgegrenzter Schritt

Phase 2 ergänzt eine zentrale, konfigurierbare Mastery-Engine mit begrenzten Werten zwischen 0 und 1. Darauf bauen adaptive Auswahl, Wiederholung schwieriger Skills mit neuen Aufgabenvarianten, Fehlertraining und eine Ergebnis-Historienansicht auf. Bisher leere Kompetenzfelder werden erst dann mit tatsächlichen Berechnungen gefüllt. Die bestehende Paketversionierung und Ergebniskopie bleiben erhalten.

Ein möglicher Commit nach erfolgreicher Abnahme:

```text
feat: implement phase 1 local student learning and exam flows
```

Dies ist ein Commit-Vorschlag und keine Behauptung, dass bereits ein Commit erstellt wurde.
