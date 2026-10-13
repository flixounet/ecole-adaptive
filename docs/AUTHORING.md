# Aufgaben erstellen und prüfen

In Phase 2 ist das Aufgabenpaket `shared/fixtures/lutz-maths-demo.json` die eingebundene Demo. Die Oberfläche bietet noch keinen Import eigener Dateien. Eine Datei unter `content/` wird nicht automatisch in der App veröffentlicht.

## Ein Paket vorbereiten

1. Ein vorhandenes Demo-Paket als Formatbeispiel verwenden und eine eigene Paket-ID vergeben.
2. Profilzuordnung, Fach, Kapitel, Sprache und Klassenstufe bewusst setzen. Unbekannte Angaben nicht aus Vermutungen ergänzen.
3. Skills und Quellen auf Paketebene anlegen. Jede Aufgabe verweist auf bestehende IDs.
4. Pro Aufgabe Antwortvarianten, Lösungsschritte, zwei gestufte Hinweise, Merksatz und typische Fehlerquelle ausarbeiten.
5. Das Paket mit Schema und semantischen Prüfungen validieren. Anschließend jede Aufgabe fachlich und sprachlich prüfen; ein Schema bestätigt keine mathematische Wahrheit.
6. Erst ein geprüftes Paket gezielt in die lokale Bibliothek integrieren. Der reguläre Weg ist das lokale Teacher Studio mit Freigabe und Publish, siehe TEACHER_STUDIO.md.

Die Fragenbank darf größer sein als eine einzelne Arbeit. `questionCount` bestimmt die Aufgabenzahl je Runde in beiden Modi und darf die Größe der Bank nicht überschreiten. Phase 2 wählt ohne doppelte Aufgabe und gewichtet Kompetenz, jüngste Fehler und Schwierigkeit. Das Fehlertraining verwendet standardmäßig bis zu acht Varianten zu den betroffenen Skills. `durationMinutes` ist die feste Dauer einer Klassenarbeit, `estimatedSeconds` lediglich eine Autorenangabe je Aufgabe.

## Antworten eindeutig halten

Für `numeric` und `decimal` nur das Zahlenergebnis verlangen. Komma und Punkt sind gleichwertige Dezimaltrennzeichen; Einheiten, Tausendertrennzeichen, Brüche und wissenschaftliche Schreibweise werden nicht als Zahlen ausgewertet. Exakt gleiche Werte wie `2,50` und `2.5` stimmen überein; es gibt keine Rundungstoleranz. Bei Rundungsaufgaben die geforderte Genauigkeit in der Anweisung nennen und passende Antworten hinterlegen.

Bei `expression` werden übliche Rechenzeichen, Leerraum und einfache Hochzahlen normalisiert. Die Prüfung vereinfacht keine Terme. Soll beispielsweise sowohl `2*(x+3)` als auch `2*x+6` akzeptiert werden, müssen beide Schreibweisen in `acceptedAnswers` stehen. Aufgaben mit zahlreichen gleichwertigen Ausdrucksformen sind für diese einfache Prüfung ungeeignet.

Die Musterantwort `correctAnswer` muss in ihrer exakten Schreibweise auch in `acceptedAnswers` enthalten sein. Zusätzliche erlaubte Varianten kommen daneben in die Liste; die Schülerantwort wird anschließend nach ihrem Aufgabentyp normalisiert.

`short_text` ignoriert Groß-/Kleinschreibung und mehrfachen Leerraum, prüft aber keine Synonyme automatisch. Bei `multiple_choice` wird die gewählte **ID** bewertet, nicht der sichtbare Text. Auch `correctAnswer` und `acceptedAnswers` verwenden dafür die Choice-ID.

## Hinweise didaktisch abstufen

- `hint`: lenkt nach dem ersten Fehler auf die passende Regel.
- `secondHint`: gibt nach dem zweiten Fehler einen konkreteren Ansatz, ohne gleich das Ergebnis zu verraten.
- `explanationSteps`: vollständiger, nachvollziehbarer Lösungsweg nach Erfolg oder dem dritten Versuch.
- `memoryRule`: kurze übertragbare Regel.
- `commonMistake`: typische Verwechslung. Dieses Autorenwissen ist keine automatisch bewiesene Diagnose des individuellen Fehlers.

## Quellen und Privatsphäre

Private Bilder und PDFs liegen unter `sources/<profil>/<fach>/<kapitel>/`; ihr Inhalt wird nicht eingecheckt. `sourceRefs` enthält nachvollziehbare Referenzen wie eine Seite oder Bildkennung, keine eingebetteten Dateien und keine privaten Zugangsdaten. Prüfen, ob ein freizugebendes Paket selbst personenbezogene Inhalte aus den Quellen enthält.

Für die Demo lautet die Herkunft ausdrücklich „künstliche Entwicklungsdaten“. Reale Schulquellen werden im Teacher Studio zuerst in ein prüfbares Quellenmodell überführt. Daraus erzeugte Fragen dürfen erst nach automatischer Validierung und fachlicher Kontrolle an die Schüler-App übergeben werden. Diese Pipeline ist in der abschließenden Phase 3 umgesetzt.

Bei einer inhaltlichen Änderung eines veröffentlichten Pakets `version` erhöhen. Eine inkompatible Änderung des Datenformats benötigt eine bewusst neue `schemaVersion` und eine Migrationsentscheidung; eine Versionsnummer allein migriert keine Daten.

Für adaptive Auswahl mindestens mehrere Varianten pro Skill und mehrere Schwierigkeitsstufen bereitstellen. Die aktuelle Demo enthält 48 Aufgaben über sechs Skills; jeder Skill ist mit mindestens acht Aufgaben und den Stufen 1–4 vertreten. Mehrfachzuordnungen zählen dabei zu jedem betroffenen Skill. Die automatische Fixture-Prüfung rechnet sämtliche numerischen Demoantworten nach; die acht Sachaufgaben haben dafür separat geprüfte Rechenmodelle. Ausdrucksvarianten werden zusätzlich an negativen, positiven und Nullwerten geprüft. Diese spezifischen Entwicklungstests ersetzen keine vollständige algebraische oder didaktische Prüfung beliebiger importierter Aufgaben.
