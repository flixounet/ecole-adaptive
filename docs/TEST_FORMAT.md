# Datenformat und Antwortvergleich

Maßgeblich sind die JSON-Schemas unter `shared/schemas/` und die Verträge in `shared/types.ts`. Aktuell ist `schemaVersion` genau `"1.0"`. Zusätzliche, unbekannte Eigenschaften werden vom Schema abgelehnt.

## Fragenbank

| Feld                          | Bedeutung                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`, `version`               | Stabile Paket-ID und positive ganzzahlige Inhaltsversion                                                   |
| `title`, `subject`, `chapter` | Titel, Fach-ID und Kapitel                                                                                 |
| `grade`, `language`           | Klassenstufe und Sprachkennung, z. B. `de` oder `fr`                                                       |
| `studentIds`                  | Profile, für die das Paket freigegeben ist                                                                 |
| `isDemo`, `sourceNotice`      | Demo-Kennzeichnung und sichtbarer Herkunftshinweis                                                         |
| `skills`                      | Skill-IDs, Namen sowie optional Fach, Kapitel und Beschreibung; neue Pakete geben das Fach ausdrücklich an |
| `sourceRefs`                  | Quellen-IDs mit Bezeichnung und Art `fixture`, `image` oder `pdf`                                          |
| `durationMinutes`             | Klassenarbeitsdauer zwischen 1 und 240 Minuten                                                             |
| `questionCount`               | Aufgabenanzahl für eine Sitzung; höchstens die Größe der Fragenbank                                        |
| `questions`                   | Fragenpool, unabhängig von der späteren Auswahlmethode                                                     |

## Aufgabe

| Feld                          | Bedeutung                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `id`                          | Eindeutige ID innerhalb des Pakets                                                                            |
| `subject`, `chapter`          | Fach und Kapitel der Aufgabe                                                                                  |
| `skillIds`                    | Verweise auf mindestens einen definierten Skill                                                               |
| `difficulty`                  | Stufe 1, 2, 3 oder 4                                                                                          |
| `points`                      | Positive Punktezahl, höchstens 100                                                                            |
| `questionType`                | `numeric`, `decimal`, `short_text`, `expression` oder `multiple_choice`                                       |
| `question`, `instruction`     | Aufgabe und Eingabehinweis                                                                                    |
| `acceptedAnswers`             | Explizit akzeptierte Antworten als Zeichenfolgen; enthält `correctAnswer` auch in dessen exakter Schreibweise |
| `correctAnswer`               | Musterantwort; bei Multiple Choice die richtige Choice-ID                                                     |
| `explanationSteps`            | Liste der Lösungsschritte                                                                                     |
| `hint`, `secondHint`          | Erste und zweite Hilfestufe                                                                                   |
| `memoryRule`, `commonMistake` | Merksatz und typische Fehlerquelle                                                                            |
| `sourceRefs`                  | Verweise auf definierte Quellen-IDs                                                                           |
| `estimatedSeconds`            | Geschätzte Bearbeitungsdauer in Sekunden                                                                      |
| `choices`                     | Nur bei Multiple Choice: mindestens zwei Objekte mit `id` und `text`                                          |

IDs bestehen aus Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich und beginnen alphanumerisch. Inhaltstexte müssen mindestens ein Nicht-Leerzeichen enthalten. Zusätzlich zum Schema werden Beziehungen wie eindeutige IDs, gültige Skill-/Quellenverweise und nutzbare Antwortdefinitionen geprüft. Die Tests halten TypeScript- und Python-Prüfung an gemeinsamen Fixtures nachvollziehbar.

Python prüft außerdem numerische Aufgaben, deren vollständiger Text mit `Berechne: ` beginnt, mit einem begrenzten Arithmetikparser. Dieser unterstützt einfache Zahlen, Klammern, Grundrechenarten und kleine nichtnegative ganzzahlige Potenzen. Er führt keinen beliebigen Code aus. Freitextaufgaben, sprachliche Eindeutigkeit und allgemeine algebraische Gleichheit sind damit nicht umfassend geprüft.

## Normalisierung

| Typ                  | Akzeptierte Normalisierung                                                                                                                                     | Bewusste Grenze                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `numeric`, `decimal` | Unicode-Normalisierung, äußere Leerzeichen, Minusvarianten, Dezimalkomma, führende Nullen, nachgestellte Dezimalnullen, positives Vorzeichen und negative Null | Exakter Dezimalwert; keine Toleranz, Einheiten, Brüche, Exponenten oder Tausendergruppen                    |
| `expression`         | Groß-/Kleinschreibung, Leerraum, `×`/`·`/`⋅`/`*`, Divisionzeichen, Komma/Punkt, `²`/`³` und `**` als Potenzschreibweise                                        | Kein Rechnen und keine algebraische Gleichheit; Leerraum zwischen Ziffern wird nicht zur Verkettung benutzt |
| `short_text`         | Unicode-Normalisierung, äußere Leerzeichen, Groß-/Kleinschreibung und mehrfacher Leerraum                                                                      | Keine automatische Synonym-, Rechtschreib- oder Akzentkorrektur                                             |
| `multiple_choice`    | Äußere Leerzeichen um eine vorhandene Choice-ID                                                                                                                | Sichtbarer Antworttext ist keine ID; Auswahl-IDs sind groß-/kleinschreibungssensitiv                        |

Beispiele: `−02,500` entspricht `-2.5`. `0.30000000000000004` entspricht **nicht** `0.3`. `2 × (3 + 4)` entspricht `2*(3+4)`, aber nicht automatisch `14`. `1 2` wird nicht als `12` behandelt. Leere Antworten sind immer falsch.

## Sitzung und Ergebnis

Die Sitzung speichert Profil und Paketversion, eine Paketkopie, ausgewählte Aufgaben-IDs, Antworten, Navigation, Startzeit und gegebenenfalls eine absolute Abgabefrist. Im Lernmodus kommen Prüfversuche, Hinweise und der Abschlussstatus je Aufgabe hinzu.

Ein Ergebnis enthält `studentId`, `testId`, Paketversion, Modus, Datum als Unix-Zeitstempel in Millisekunden, Dauer in Sekunden, Gesamtpunkte, `score20`, Prozentwert und Details je Antwort. `mistakes` enthält die IDs der nicht richtig abgeschlossenen Aufgaben. `skillsBefore` und `skillsAfter` spiegeln die neuen Felder `masteryBefore` und `masteryAfter`. Bei alten Phase-1-Ergebnissen bleiben fehlende historische Kompetenzwerte leer. Die Paketkopie hält die später angezeigte Korrektur an denselben Aufgabenstand gebunden.

Die Bewertung verwendet die Summe der Punkte der tatsächlich ausgewählten Aufgaben, nicht aller Aufgaben im Pool. Note und Prozentwert werden auf eine Nachkommastelle gerundet. Eine erneute Abgabe derselben Sitzung soll dasselbe gespeicherte Ergebnis zurückgeben.

## Kompatibilität von Phase 1 und Phase 2

Phase 2 erweitert das weiterhin als `1.0` gekennzeichnete Format additiv um optionale Skill-Metadaten und Difficulty 4. Die neue App liest unveränderte Phase-1-Pakete weiterhin. Dies bedeutet nicht, dass eine alte Phase-1-App neue Inhalte mit Difficulty 4 bereits verarbeiten kann. Die Demo trägt jetzt Inhaltsversion 2; ihre frühere Fassung bleibt als unverändertes Migrationstest-Fixture erhalten. Laufende Sitzungen und alte Korrekturen behalten ihre jeweilige Paketkopie.

Neue Skill-IDs verwenden fachliche Namensräume, etwa `math.powers`, `english.irregular_verbs` und `french.conjugation.present`. In der Datenbank gehört außerdem das Fach zur Identität eines Skillzustands. Die Details zu Profiltrennung, Versuchsverlauf und Ergebnissen stehen in [DATA_MODEL.md](DATA_MODEL.md).
