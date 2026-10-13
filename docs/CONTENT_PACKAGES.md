# Inhaltspakete und Katalog

## Getrennte Versionen

Die App hat eine Softwareversion. Ein `ContentPackage` hat zusätzlich `packageVersion: 1` als Formatversion sowie `id`, ganzzahlige `version` und `contentHash` als Inhaltsidentität. Eine neue App erfordert kein neues Aufgabenpaket; ein neuer Inhalt keine neue App-Version.

Ein Paket enthält `createdAt`, `studentIds`, `subject`, `grade`, `chapter`, `title`, `modes`, eine vollständige `questionBank` und `tests`. Die Kernmetadaten müssen mit der Fragenbank übereinstimmen. Die fünf bestehenden Fragetypen bleiben erhalten. Es werden keine Originalfotos oder PDFs ausgeliefert.

Ein Prüfungsplan besteht aus `id`, `title`, `mode: exam`, `durationMinutes` und geordneten eindeutigen `questionIds`. Erlaubte Prüfungsdauern: 10, 20, 30, 40, 45 und 60 Minuten. Optional: Auswahlseed und Prozentverteilungen über Skills/Difficulty. Die gespeicherten IDs bestimmen die Prüfung; keine neue Zufallsauswahl beim Start. Für Learn-only-Pakete ist `tests` leer.

## Hash und Veröffentlichung

SHA-256 wird über die RFC-8785-kanonisierte JSON-Darstellung des gesamten Pakets **ohne** `contentHash` berechnet. Python verwendet `rfc8785`, TypeScript kanonische ECMAScript-Zahlen/UTF-16-Schlüsselreihenfolge. Ein sprachübergreifender Test vergleicht beide Implementierungen.

Dateistruktur:

```text
content/
  catalog.json
  packages/
    course-<auftrag>-v1.json
    course-<auftrag>-v2.json
```

Der Katalog (`catalogVersion: 1`, `updatedAt`, `packages`) enthält pro Paket die aktuelle Metadatenzeile plus `url: packages/<id>-v<version>.json`. Pfade müssen exakt dieses Format erfüllen. Ein neuer Publish erzeugt eine höhere Version; alte Paketdateien bleiben für Nachvollziehbarkeit vorhanden. Unveränderte wiederholte Veröffentlichung desselben freigegebenen Auftrags ist idempotent.

Paket- und Katalogdateien werden unter einer Publish-Sperre geprüft und atomar ersetzt. Erst eine gültige Paketdatei, dann der aktualisierte Katalog: Ein abgebrochener Vorgang darf keinen Katalog mit unfertiger Datei erzeugen. `python -m teacher publish` validiert Pakete und stellt den Katalog wieder her; es führt keinen Git-Push aus.

## Auf dem Schülergerät

Nach Profilauswahl und beim Wiederkehren der Netzverbindung wird der Katalog geprüft. **Neue Inhalte** filtert nach Schüler-ID, aktiven Fächern und zunächst nach Klassenstufe. Andere Klassenstufen lassen sich bewusst einblenden. `3eme` und `3ème` werden gleich behandelt. Herunterladen erfolgt ausschließlich per Button; automatisches Herunterladen ist nicht aktiviert.

Download: Größenlimit → JSON → Schema/Metadaten → Inhalts-Hash → Zuordnung → IndexedDB-Transaktion. Erst nach erfolgreichem Speichern erscheint „Offline verfügbar“. Installationen sind durch `[studentId+packageId]` getrennt. Dass mehrere Kinder einem Paket zugeordnet sind, installiert es nicht automatisch bei allen.

Gleiche Version und gleicher Hash: keine Änderung. Gleiche Version mit anderem Hash: Ablehnung. Niedrigere Version: kein Downgrade. Höhere Version: explizites Updateangebot. Historische Ergebnisse und aktive Sitzungssnapshots werden nie auf neue Aufgaben umgeschrieben. Während einer Klassenarbeit blockiert die Datenbank den Paketaustausch.

Bereits installierte Inhalte bleiben unabhängig vom HTTP-Cache verwendbar. Die App Shell liegt im Service-Worker-Cache; vollständige Aufgaben, Prüfungspläne und Ergebnisse liegen in IndexedDB. Quellcode und Dateien: `shared/content.ts`, `shared/schemas/content-*.schema.json`, `storage/contentRepository.ts`, `services/contentClient.ts`, `teacher/publishing.py`.
