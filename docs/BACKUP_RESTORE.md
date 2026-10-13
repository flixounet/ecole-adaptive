# Backup und Wiederherstellung

## Sichern

In der Schüler-App **Profile & Backup → Daten exportieren** wählen. Der Browser speichert `ecole-backup-JJJJ-MM-TT.json`. Das Backup enthält alle Profile auf diesem Gerät: Profile, Fragenbanken, installierte Pakete, Sitzungen mit Antworten und Deadlines, Ergebnisse, Skillzustände, Abschlussversuche und Fragehistorie. Es ist keine Synchronisierung und wird nicht automatisch irgendwo hochgeladen.

Bewahre die Datei sicher auf. Auch archivierte Profile und deren Lernverläufe sind enthalten. Eine aktive Klassenarbeit kann gesichert werden; die absolute Frist läuft weiter und beginnt beim Wiederherstellen nicht neu.

## Auf einem neuen Gerät wiederherstellen

1. École über dieselbe bereitgestellte Anwendung öffnen.
2. Ein Profil wählen und **Profile & Backup** öffnen.
3. Die Backup-JSON-Datei auswählen.
4. **Backup prüfen und importieren** wählen und die Ergänzung bestätigen.
5. Nach Erfolg Profile, Ergebnisse und Lernstand kontrollieren.

Vor dem Import offene Runden auf dem Zielgerät abschließen. Alle JSON-Schemas, Paket-Hashes und Beziehungen zwischen Schülern, Sitzungen, Ergebnissen und Versuchen werden geprüft, bevor Daten geschrieben werden. Es werden höchstens 100 MB in der Importoberfläche akzeptiert.

## Konflikte

Die Zusammenführung geschieht in einer einzigen IndexedDB-Transaktion. Identische vorhandene Datensätze werden übersprungen, fehlende ergänzt. Haben dieselben IDs abweichende persönliche Daten, wird der gesamte Import abgelehnt: kein Teilimport und kein stilles Überschreiben. Die Fehlermeldung benennt den Konflikt. Sichere dann beide Geräte getrennt und kläre, welche Daten übernommen werden sollen.

Einzige Ausnahme: völlig unbenutzte anfängliche Demo-/Standardprofile auf einem frischen Gerät dürfen durch die entsprechende Sicherung ersetzt werden. Vorhandene Lernhistorie verhindert diese Ausnahme. Das ermöglicht eine echte Wiederherstellung nach dem ersten Start, ohne persönliche Daten zu überschreiben.

Bei Speichermangel oder defekter Datei bleibt die Ziel-Datenbank unverändert. Lösche nicht vorschnell die Originaldatei oder Browserdaten.

## Teacher-Sicherung

Das Schülerbackup enthält keine privaten Unterrichtsdateien und keine Teacher-Aufträge. Sichere auf dem Mac zusätzlich `.teacher-data/`, `content/` und bei Bedarf `sources/` mit deiner normalen lokalen Datensicherung. `.env` enthält den Schlüssel und gehört separat geschützt. Keine dieser privaten Teacher-Dateien gehört in das öffentliche Repository oder den statischen Build.
