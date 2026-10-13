# Datenmodell und lokale Migration

Die Inhaltsverträge stehen in `shared/types.ts` und den Draft-7-Schemas unter `shared/schemas/`. Sitzungs- und Ergebnisverträge liegen in `apps/student/src/domain/session.ts`, die adaptiven Verträge in `apps/student/src/domain/adaptive/types.ts`. Speicherung und Abfragen bleiben hinter `apps/student/src/storage/database.ts`; React benötigt keine eigenen komplexen Dexie-Abfragen.

## Aufgabenpakete und Skills

Eine `QuestionBank` besitzt stabile `id`, positive Inhalts-`version`, Profilzuordnungen, Fach, Kapitel, Herkunft, Skilldefinitionen und Aufgaben. `schemaVersion` bleibt in Phase 2 bei `1.0`. Die neue Prüfung akzeptiert sowohl die ursprünglichen Pakete als auch die additive Erweiterung um Difficulty 4 und optionale Skill-Metadaten. Eine alte App kann neue Inhalte deshalb nicht zwingend lesen.

`Skill` beziehungsweise `SkillDefinition` enthält `id`, `name` sowie optional `subject`, `chapter` und `description`. Die optionalen Angaben erhalten unveränderte alte Paketkopien; neue Pakete sollen `subject` ausdrücklich setzen. Wenn vorhanden, muss das Fach zur Fragenbank passen.

Neue Skillnamen verwenden einen fachlichen Namensraum:

```text
math.order_operations
math.parentheses
math.powers
math.distributivity
math.factorization
math.word_problems
english.irregular_verbs
french.conjugation.present
```

Das Paketfach der Mathematikdemo heißt weiterhin `maths`; ihr Skill-Namensraum heißt `math`. Zusätzlich wird das Fach separat im Zustandsschlüssel gespeichert. Dadurch bleiben selbst alte, noch nicht qualifizierte IDs verschiedener Fächer getrennt.

Die Demo `lutz-maths-demo` hat jetzt Inhaltsversion 2 und 48 Aufgaben. Die IDs `demo_math_001` bis `demo_math_020` und ihre Inhalte sind erhalten; nur deren Skillverweise wurden gezielt auf die neuen Namen abgebildet. Die genaue alte Demo liegt als Migrationstest unter `shared/fixtures/lutz-maths-demo-v1.json`. Beide Fassungen bleiben ausdrücklich künstliche Entwicklungsdaten.

## StudentSkillState

Identität: **`studentId + subject + skillId`**. Ein anderer Schüler oder ein anderes Fach besitzt einen vollständig eigenen Zustand.

| Feld                                             | Bedeutung                                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `mastery`                                        | Endliche Zahl von 0 bis 1; ohne Versuche Startwert 0,50                                             |
| `attempts`                                       | Anzahl abgeschlossener Aufgabenergebnisse für diesen Skill                                          |
| `correctCount`, `incorrectCount`, `skippedCount` | Disjunkte Abschlusszähler; ihre Summe entspricht `attempts`                                         |
| `hintedCorrectCount`                             | Teilmenge der richtigen Antworten mit mindestens einem Hinweis                                      |
| `currentStreak`, `bestStreak`                    | Aktuelle und längste Folge richtiger Abschlüsse, einschließlich Lösungen mit Hinweis                |
| `lastPracticedAt`, `lastIncorrectAt`             | Zeitpunkt der letzten Übung beziehungsweise des letzten endgültigen Fehlers; vorerst `null` möglich |
| `recentOutcomes`, `recentErrorCount`             | Letzte zehn Abschlüsse dieses Skills und darin enthaltene endgültige Fehler                         |
| `lastAttemptId`, `lastDifficulty`                | Letztes angewandtes Ergebnis und dessen Schwierigkeit                                               |

Die Domain validiert Bereich, endliche Zahlen und Zählerkonsistenz. Bei mehreren Skills einer Frage erhält jeder zugeordnete Skill eine Aktualisierung; doppelte Skill-IDs erzeugen keine zweite Änderung.

## AttemptRecord

Ein `AttemptRecord` beschreibt **den endgültigen Ausgang einer Aufgabe in einer Sitzung**, nicht jeden Klick auf „Prüfen“. `attemptNumber` und `hintsUsed` halten die Zwischenversuche fest. Die ID ist `${session.id}:${questionId}` und dient auch als persistenter Idempotenzschlüssel.

| Feldgruppe | Inhalt                                                                                  |
| ---------- | --------------------------------------------------------------------------------------- |
| Identität  | `id`, `sessionId`, `studentId`, `subject`, `questionId`, optional `testId` als Paket-ID |
| Kontext    | `mode`: `learn`, `exam` oder `error_training`; `timestamp`, `difficulty`, `skillIds`    |
| Antwort    | `answer`, `correct`, `attemptNumber`, `hintsUsed`, `skipped`                            |
| Einordnung | `outcome`: direkt richtig, nach einem/zwei Hinweisen richtig, falsch oder übersprungen  |
| Wirkung    | `masteryBefore`, `masteryAfter`: Skill-ID → Kompetenzwert für die betroffenen Skills    |
| Zeit       | `responseTimeMs`, gegebenenfalls `null`, wenn keine belastbare Startmarke vorhanden ist |

Die Antwortzeit ist die verstrichene Zeit vom ersten Öffnen bis zum Abschluss und enthält Pausen, Tabwechsel und andere Unterbrechungen. Sie ist keine Messung aktiver Denkzeit. Bei migrierten Antworten ohne Startmarke wird `null` gespeichert und kein Wert geschätzt.

Im Lernmodus wird erst nach Erfolg oder dem dritten Fehler ein Record erzeugt. Bei vorzeitiger Abgabe gilt eine noch nie geprüfte Lernantwort als übersprungen; eine bereits erfolglos geprüfte und noch nicht aufgelöste Antwort als endgültig falsch. Im Prüfungsmodus wird erst bei Abgabe gewertet; leere Antworten sind übersprungen. Navigation allein erzeugt keine Mastery-Änderung.

## QuestionHistory

Diese Tabelle hält tatsächlich angezeigte Aufgaben getrennt von abgeschlossenen Versuchen. Eine geöffnete, dann übersprungene Aufgabe gehört somit zur Auswahlhistorie, auch wenn noch kein Attempt existiert.

Die Identität ist ebenfalls `${session.id}:${questionId}`, in einer eigenen Tabelle. Gespeichert werden `studentId`, `subject`, `questionId`, `bankId`, `sessionId`, `mode` und `shownAt`. Ein erneutes tatsächliches Öffnen derselben Frage aktualisiert `shownAt` anhand von `lastViewedAt`; bloßes Autosave verändert die Anzeigereihenfolge nicht. Der Verlauf wird profil- und fachbezogen abgefragt. Er ist keine zweite Tabelle für Testantworten.

## Session

Die bestehende Sitzung bleibt das fortsetzbare Arbeitsdokument. Sie speichert vollständige `bankSnapshot`, deren Version, Aufgabenreihenfolge, Antworten, Navigation, Zeitstempel und Status. Die Prüfung hat weiterhin eine absolute Abgabefrist. Ein geschlossener Tab hält diese Frist nicht an.

Phase 2 ergänzt optionale Felder für adaptive Runden: `adaptive`, `targetQuestionCount`, `targetSkillIds`, `sourceResultId`, `sourceMistakeQuestionIds`, `masteryBefore` und `planRevision`. Die Zielanzahl erlaubt ein kürzeres Fehlertraining, ohne die Anzahl des ursprünglichen Pakets zu ändern. Antwortzustände können `firstViewedAt`, `lastViewedAt` und `finalizedAt` speichern.

Eine adaptive Planänderung betrifft nur noch unberührte Aufgaben. Bereits geöffnete, beantwortete oder abgeschlossene Aufgaben sind geschützt. Persistenz liefert den aktualisierten Plan an die Oberfläche zurück, damit ein verzögertes Speichern ihn nicht still durch einen älteren Plan ersetzt.

## Result und Skill-Auswertung

Die bestehende Tabelle `results` wird weiterverwendet. Die neuen Felder ergänzen das Modell; es wird keine konkurrierende `testResults`-Tabelle eingeführt.

| Feldgruppe             | Inhalt                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------- |
| Identität und Kontext  | `id` = Sitzungs-ID, `studentId`, `testId`, `bankVersion`, `mode`, `subject`, `chapter`  |
| Zeit                   | `startedAt`, `completedAt`, `durationSeconds`                                           |
| Gesamtwertung          | `earnedPoints`, `maxPoints`, `score20`, `percentage`                                    |
| Korrektur              | `answers` und die unveränderte `bankSnapshot` dieser Sitzung                            |
| Fachliche Auswertung   | `skillPerformance`, `mistakeQuestionIds`, `mistakeSkillIds`                             |
| Lernstand              | `masteryBefore`, `masteryAfter`                                                         |
| Bestehende Aliasfelder | `date` = Abschlusszeit, `duration` = Sekunden, `skillsBefore`/`skillsAfter`, `mistakes` |

Alle Zeitstempel sind Unix-Millisekunden. Dauerfelder sind Sekunden; `responseTimeMs` sind Millisekunden. Die Oberfläche formatiert Datum und Zahlen für die gewählte Locale.

`score20 = earnedPoints / maxPoints × 20` bleibt unverändert. Bewertung und Prozentwert werden wie in Phase 1 auf eine Nachkommastelle gespeichert. Ein Ergebnis mit null möglichen Punkten wird abgelehnt.

Jeder Skill in `skillPerformance` erhält `earned`, `possible` und `percentage`. Eine Frage mit zwei Skills trägt ihre vollen Punkte zu beiden Skill-Auswertungen bei. Diese Teilwerte überlappen und dürfen deshalb nicht zu einer zweiten Gesamtpunktzahl addiert werden. Die Gesamtwertung zählt jede Frage genau einmal.

## Dexie-Version 2

Der Datenbankname bleibt **`ecole-adaptive-v1`**. Der Name bezeichnet die bestehende Datenbank; ihre interne Dexie-Schemaversion ist jetzt **2**. Ein neuer Name würde die bisherigen Daten unsichtbar machen und wird deshalb bewusst vermieden.

| Tabelle              | Schlüssel                     | Wesentliche Indizes                                          |
| -------------------- | ----------------------------- | ------------------------------------------------------------ |
| `profiles`           | `id`                          | —                                                            |
| `banks`              | `id`                          | mehrwertiger Index `studentIds`                              |
| `sessions`           | `id`                          | `studentId`, `status`, `[studentId+status]`, `startedAt`     |
| `results`            | `id`                          | `studentId`, `date`                                          |
| `studentSkillStates` | `[studentId+subject+skillId]` | `studentId`, `[studentId+subject]`                           |
| `attemptRecords`     | `id`                          | `studentId`, `[studentId+subject]`, `sessionId`, `timestamp` |
| `questionHistory`    | `id`                          | `studentId`, `[studentId+subject]`, `sessionId`, `shownAt`   |

Die drei neuen Tabellen werden additiv angelegt. Bereits vorhandene Profile, Banken, Sitzungen und Ergebnisse werden nicht gelöscht. Auch Fehler bei der Initialisierung rechtfertigen kein stilles Zurücksetzen der Datenbank.

### Migration alter Daten

1. Die Bibliotheksdemo wird nur dann auf Version 2 aktualisiert, wenn ihre gespeicherte Version 1 strukturell genau dem bekannten Original-Fixture entspricht. Lokal veränderte Pakete bleiben erhalten.
2. Laufende Sitzungen und abgeschlossene Ergebnisse behalten ihre vollständige alte Paketkopie, Aufgabenreihenfolge und Antworten.
3. Bekannte Skill-Aliase werden ausschließlich für die Demo über `canonicalFixtureSkillId` abgebildet. Externe Pakete werden nicht pauschal umbenannt.
4. Alte Ergebnisse werden beim Lesen strukturell ergänzt: Fach/Kapitel aus ihrer Paketkopie, Zeitfelder aus bestehenden Angaben und Skill-Auswertungen aus ihren Antworten. Die gespeicherten Ursprungszeilen werden dabei nicht umgeschrieben.
5. Fehlende historische Mastery-Werte bleiben leer. Abgeschlossene Phase-1-Runden erzeugen keine rückwirkend erfundenen AttemptRecords oder Kompetenzverläufe.
6. Eine noch aktive Phase-1-Lernrunde kann weiterlaufen. Bereits aufgelöste Antworten werden bei ihrem ersten neuen Speichern einmalig als endgültige Ergebnisse übernommen; ohne alte Zeitmarke bleibt ihre Antwortzeit `null`.

`persistSession` schreibt Abschlussversuche, Skillzustände, Präsentationshistorie und Sitzung gemeinsam. `completeSession` speichert zusätzlich das Ergebnis in derselben Transaktion. Vorhandene Attempt- und Ergebnis-IDs verhindern eine zweite Anwendung. `saveSession` bleibt als kompatible Schnittstelle erhalten; die neue Oberfläche verwendet `persistSession`, um den angepassten Aufgabenplan zurückzubekommen.

Die Abfragen `listSkillStates`, `listAttempts`, `getQuestionHistory`, `loadResult(id, studentId, database?)` und `listResults` berücksichtigen den Schüler und, sofern fachbezogen, das Fach. Lokale Profile sind weiterhin keine Zugangssicherung. Daten gehören zum Browser und seiner Origin; ein Cloud-Abgleich ist nicht vorgesehen. Phase 3 ergänzt vollständige JSON-Backups und sichere lokale Wiederherstellung.

## Phase 3: Schema-Version 3

Der Datenbankname `ecole-adaptive-v1` bleibt gleich. Eine additive Migration ergänzt `installedPackages` mit Primärschlüssel `[studentId+packageId]` und `studentId`-Index. Die Attempt-Tabelle erhält `[studentId+timestamp]` und `[studentId+subject+timestamp]`. Die UI lädt höchstens zehn jüngste Versuche pro aktivem Fach statt die gesamte Versuchshistorie in React.

Profile erhalten `createdAt`, optional `updatedAt` und `archived`. Bekannte, unverändert gebliebene Platzhalterklassen werden für Max/Lutz/Ben auf `3eme`/`5eme`/`CM1` ergänzt. Persönliche Änderungen und aktive Fächer werden nicht überschrieben. Frische Profile verwenden die Standardfächer `maths`, `french`, `english`, `svt`, `history_geography`; freie Fach-IDs sind weiterhin zulässig. Profil-IDs bleiben beim Bearbeiten unverändert.

`InstalledPackage` enthält `studentId`, `packageId`, `installedAt` und das vollständige geprüfte `ContentPackage`. Es gibt keine profilübergreifende Aktualisierung durch einen Download. Neue feste Prüfungssitzungen speichern zusätzlich `blueprintSnapshot` und `packageContentHash`; die ursprüngliche Bankkopie bleibt Grundlage von Abgabe und Ergebnis.

`BackupDTO` hat `backupVersion: 1` und enthält alle acht Tabellen. Import prüft Envelope, Profile, Banken, Pakete/Hashes, Domainwerte und Beziehungen; danach atomare konfliktbewusste Zusammenführung. Keine Ergebnis-/Mastery-Neuberechnung beim Import. Details unter [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

Teacher-Daten sind davon getrennt: `SourceModel` mit Datei-/Seitenbelegen, bestätigter Status, Fragenbank, deaktivierte IDs, Validierungsreport, Prüfungsplan, Freigabehash und Publishreport. Aufträge besitzen eine monotone Revision; alte Browserstände dürfen neuere Daten nicht unbemerkt ersetzen. Die privaten Auftragsdateien gelangen nicht in Schülerbackups.
