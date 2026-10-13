# Teacher Studio auf dem Mac

Das Teacher Studio erstellt Unterrichtspakete aus deinen eigenen Fotos und PDFs. Es läuft auf deinem Mac unter `http://127.0.0.1:8000`. Die Schüler-App verwendet später ausschließlich die freigegebenen, heruntergeladenen Pakete. Sie braucht keinen OpenAI-Schlüssel und ruft keine KI auf.

## Einrichten und starten

Im Projektordner mit Python 3.12 oder neuer:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[test]'
test -e .env || cp .env.example .env
```

Öffne `.env` in einem Texteditor und trage bei `OPENAI_API_KEY=` deinen persönlichen API-Schlüssel ein. Lade diese Datei niemals auf einen öffentlichen Server oder in Git hoch. `OPENAI_MODEL=gpt-4.1` ist der Standard; ein anderes Modell muss Bilder, PDFs und Structured Outputs unterstützen.

```sh
python -m teacher
```

Öffne anschließend [Teacher Studio](http://127.0.0.1:8000). Beenden: im Terminal `Ctrl+C`. Ein anderer lokaler Port ist beispielsweise mit `python -m teacher --port 8001` möglich. Der Server bindet ausschließlich an `127.0.0.1`. Ein Start auf dem iPad oder das Freigeben des Teacher-Servers im Internet ist nicht vorgesehen.

Ohne Schlüssel funktionieren Profilverwaltung, Upload und gespeicherte Entwürfe bereits. Die vollständige erneute Aufgabenvalidierung enthält einen KI-Schritt und benötigt deshalb ebenfalls den Schlüssel. Die Schaltflächen zur KI-Analyse und Generierung benötigen einen Schlüssel. Es gibt keine künstliche Ersatzgenerierung im produktiven Ablauf. Nach einer Schlüsseländerung das Studio neu starten.

## Einen Unterricht vorbereiten

1. Wähle Max, Lutz, Ben oder lege ein zusätzliches Profil an. Die anfänglichen Klassenstufen sind `3eme`, `5eme` und `CM1`.
2. Wähle Fach, Klassenstufe und Aufgabensprache. Das Kapitel kann zunächst leer bleiben.
3. Wähle Lerntraining, Klassenarbeit oder beides. Die Dauer kann 10, 20, 30, 40, 45 oder 60 Minuten betragen.
4. Stelle den Anspruch ein: 0,9 etwas leichter, 1,0 Unterrichtsniveau, bis 1,3 komplexere Kombinationen des bekannten Stoffs. Diese Einstellung erlaubt keine neuen Unterrichtsthemen.
5. Lege die gewünschte Aufgabenmenge fest. Standard sind 48 Poolaufgaben und 18 Aufgaben pro Runde beziehungsweise Prüfungsplan. Die Testlänge darf den Pool nicht überschreiten.
6. Klicke **Vorbereitung anlegen**.

Teacher-Profile und Schülerprofile werden an unterschiedlichen Orten gespeichert: Teacher auf dem Mac, Schülerprofile im jeweiligen Browser. Verwende für zusätzliche Schüler auf beiden Seiten dieselbe Profil-ID. Diese steht in der Schülerverwaltung. Ein gleicher Anzeigename allein stellt die Zuordnung nicht her. Vor dem Download müssen auch Klassenstufe und Fach übereinstimmen.

## Unterlagen hochladen

Ziehe mehrere Dateien in das Upload-Feld oder wähle sie über den Dateidialog. Erlaubt sind JPG/JPEG, PNG, WebP und PDF. Bilder werden anhand ihrer tatsächlichen Bytes geprüft; eine umbenannte Datei genügt nicht.

Die Grenzen sind zentral in `teacher/config.py` festgelegt:

| Grenze | Wert |
|---|---:|
| Eine Datei | 20 MiB |
| Alle Dateien im Auftrag | 45 MiB |
| Dateien pro Auftrag | 20 |
| Seiten pro PDF | 40 |
| Quellenseiten insgesamt | 500 |
| Bildgröße | 25 Megapixel |

Beschädigte, leere, animierte oder falsch bezeichnete Bilder werden abgewiesen. Passwortgeschützte PDFs müssen zuerst lokal entsperrt werden. Bei einem Fehler in einem gemeinsam hochgeladenen Stapel wird der gesamte Stapel abgewiesen. Bereits gespeicherte Dateien bleiben erhalten; es werden keine Dateien stillschweigend weggelassen. Doppelte Dateiinhalte werden mit einem Hinweis abgewiesen.

Dateien lassen sich öffnen, hinzufügen und entfernen. Jede Änderung an den Unterlagen hebt die bisherige Quellenbestätigung auf und entfernt die darauf beruhenden Aufgaben aus dem aktuellen Entwurf. Bereits veröffentlichte Paketdateien bleiben bestehen.

## Quellenanalyse und Kontrolle

**Unterlagen analysieren** startet ausdrücklich die Übertragung der ausgewählten Quellen an OpenAI. Bilder werden direkt als Bildinput, PDFs als PDF-Dateiinput übertragen. Der produktive Ablauf verwendet keine OCR als primären Ersatz und keine öffentlichen Datei-URLs. `store=False` verhindert die angeforderte dauerhafte Speicherung der Responses-Antwort; die Datenverarbeitung und weitere Aufbewahrungsregeln des API-Anbieters bleiben davon unabhängig.

Das Ergebnis ist ein strukturiertes Quellenmodell mit Kapitel, Lernzielen, Skills, Begriffen, Regeln, Beispielen, Aufgabentypen, Niveaubeobachtungen, typischen Fehlern und Unsicherheiten. Jede fachliche Aussage nennt konkrete Quellen-IDs. Unter **Dateien und Seiten** lassen sich diese IDs zu Originaldatei und Seitennummer zuordnen.

Kontrolliere besonders handschriftliche Stellen, mathematische Zeichen, Sprachvokabular und Unsicherheiten. Korrigiere die Texte oder entferne unklare Einträge. Speichere Korrekturen, bevor du **Analyse bestätigen** betätigst. Eine vollständig unlesbare Quelle darf ein leeres fachliches Modell mit Unsicherheiten liefern; ohne sichere Lernziele, Skills und Aufgabentypen lässt sich die Analyse nicht bestätigen.

Erst das bestätigte Modell darf in die Aufgabengenerierung eingehen. Bei späterer Bearbeitung muss es erneut bestätigt werden. Neue Stoffgebiete dürfen nicht durch eine höhere Schwierigkeitseinstellung eingeführt werden.

## Aufgaben erzeugen und prüfen

**Aufgabenpool erzeugen** erzeugt einen quellengebundenen Pool und startet danach die automatische Validierung. Bei zu wenig belastbarem Quellenmaterial darf der Pool kleiner ausfallen. Ein Hinweis fordert die Kontrolle; die KI soll fehlenden Umfang nicht durch neue Themen auffüllen.

Die Prüfung kombiniert:

- Das gemeinsame JSON-Schema, eindeutige IDs, vollständige Pflichtfelder und bekannte Skill-/Quellenreferenzen.
- Numerische Antwortkonsistenz und eine begrenzte exakte Rechenprüfung für vollständige numerische Fragen mit dem Präfix `Berechne: `.
- Exakte Äquivalenz akzeptierter Antwortvarianten bei unterstützten Polynomen mit einer Variablen. Erlaubt sind begrenzte arithmetische Operationen, Klammern und kleine ganzzahlige Potenzen; es wird kein beliebiger Code ausgeführt.
- Exakte Dubletten und Hinweise auf sehr ähnlich formulierte Aufgaben.
- Eine weitere strukturierte KI-Prüfung jeder aktiven Frage auf Verständlichkeit, Antwort, Erklärung und Deckung durch das bestätigte Quellenmodell.

Diese Prüfungen sind keine mathematische oder pädagogische Vollständigkeitsgarantie. Sachaufgaben, offene Sprachantworten, fachliche Aussagen und nicht unterstützte Ausdrücke benötigen die KI-Prüfung und deine Kontrolle. Der lokale Schüler-Grader bewertet hinterlegte normalisierte Antworten; er beweist keine beliebige algebraische oder sprachliche Gleichwertigkeit. Prüfe deshalb insbesondere `acceptedAnswers`.

Fehler verhindern die Freigabe. Warnungen verlangen eine ausdrückliche Bestätigung. Die Anzeige unterscheidet Einzelbefunde und allgemeine Hinweise. Ein gültiges lokales Prüfergebnis allein ersetzt nicht die aktuelle KI-Prüfung; nach einem Verbindungsfehler muss **Aufgaben erneut validieren** erfolgreich beendet werden.

Jede Frage lässt sich ansehen, bearbeiten, deaktivieren oder einzeln neu generieren. Bearbeiten und Deaktivieren heben die aktuelle Prüfungsfreigabe auf. Eine deaktivierte Aufgabe fehlt im veröffentlichten Pool und in der Prüfung. Mindestens eine Aufgabe muss aktiv bleiben. Nach Änderungen erneut validieren und freigeben. Eine Einzelregeneration bewahrt die Frage-ID und die bisherigen Skills; eine vollständige Neugenerierung ersetzt den Pool.

Wenn die Generierung bereits erfolgreich war, aber die anschließende KI-Prüfung scheitert, bleibt der Aufgabenentwurf gespeichert. Die Studio-Oberfläche lädt den aktuellen Stand nach. Du kannst später die Validierung erneut starten, ohne den ganzen Pool neu zu erzeugen.

## Den Prüfungsplan festlegen

Bei Klassenarbeit oder beiden Modi entsteht automatisch ein fester Blueprint. Der Algorithmus berücksichtigt die angegebenen Skills und das Anspruchsniveau; bei gleicher Grundlage und gleichem Seed bleibt die Auswahl reproduzierbar. Maßgeblich ist die gespeicherte geordnete Liste der Frage-IDs.

Kontrolliere Dauer, Anzahl, Gesamtpunkte und die ausgewählten Aufgaben. Die UI erlaubt Titel, Dauer und Auswahl zu ändern. Das tatsächliche Arbeitstempo eines Kindes kann von der Schätzung abweichen; kontrolliere den Umfang anhand der Unterlagen und Erfahrungen. Die API unterstützt zusätzlich Prozentverteilungen für Skills und Difficulty als Planungsmetadaten. Maßgeblich für die Durchführung bleiben die ausgewählten IDs, nicht die Prozentangaben.

Das Lerntraining kann adaptiv aus dem aktiven Pool auswählen. Die Klassenarbeit verwendet ausschließlich den vorher festgelegten Plan und lädt während der Bearbeitung keine neuen Aufgaben nach.

## Freigeben und veröffentlichen

Prüfe Quellen, Aufgaben, Lösungen und offene Warnungen. Bestätige die Kontroll-Checkbox und wähle **Aufgaben freigeben**. Die Freigabe gilt nur für den unveränderten aktuellen Stand von Quellenmodell, Pool, Einstellungen und Blueprint.

**Für Schüler veröffentlichen** erstellt lokal:

```text
content/catalog.json
content/packages/<paket-id>-v<version>.json
```

Das Paket enthält die aktive Question Bank, Schülerzuordnung, erlaubte Modi und gegebenenfalls den festen Prüfungsplan. Schema, Metadaten, Quellen, Antworten, Blueprint und SHA-256 werden vor der Veröffentlichung geprüft. Der Hash entsteht aus RFC-8785-kanonischem JSON des gesamten Pakets ohne `contentHash`.

Jede neue veröffentlichte Fassung erhält eine höhere Version. Vorherige Paketdateien werden nicht überschrieben. Die Katalogdatei wird atomar durch einen gültigen neuen Stand ersetzt. Wiederholtes Klicken auf Veröffentlichung beim unveränderten freigegebenen Auftrag erzeugt keine neue Version. Schülerergebnisse und laufende Tests behalten ihre gespeicherten Aufgaben-Snapshots.

Der Bericht zeigt Pfade, Version, Hash und Umfang. Lokal können die Student-Entwicklungsserver diese Inhalte direkt lesen. Damit ein iPad die Inhalte über deine Website laden kann, müssen der statische Build und das Deployment aktualisiert werden. Das Teacher Studio pusht nichts automatisch nach GitHub.

**Öffentliche Inhalte:** Ein statischer Host hat in V1 keine Zugriffskontrolle pro Kind. Profil-IDs filtern die Anzeige, sind aber keine Berechtigung. Veröffentlicht werden Aufgaben, Antworten, Quellennamen und Profil-IDs. Prüfe diese Texte auf personenbezogene Angaben. Originalfotos, PDFs, das vollständige Quellenmodell, `.env` und lokale Teacher-Logs werden nicht mit veröffentlicht.

## Veröffentlichung im Terminal

```sh
python -m teacher publish
```

Dieser Befehl validiert alle lokalen veröffentlichten Paketversionen, baut den Katalog aus der jeweils neuesten gültigen Version auf und zeigt den Git-Status von `content/`. Ein fehlerhaftes Paket beendet den Vorgang mit einer Fehlermeldung und einem von null verschiedenen Exitcode. Ein beschädigtes altes Paket wird nicht heimlich übersprungen.

Ein im Studio freigegebener Auftrag lässt sich auch gezielt veröffentlichen:

```sh
python -m teacher publish --job job-<auftrags-id>
```

Der Befehl umgeht weder die Quellenbestätigung noch die automatische Prüfung und Freigabe. Es gibt keinen automatischen Commit oder Push. Die weitere Bereitstellung steht in `DEPLOYMENT.md`.

## Lokale Daten und Fehlerbehandlung

Private Dateien liegen unter `.teacher-data/`: Originale, Auftragsdateien, Teacher-Profile und rotierende `teacher.log`-Dateien. Dieser Ordner ist von Git ausgeschlossen. `ECOLE_TEACHER_DATA` erlaubt einen abweichenden lokalen Speicherort. Sichere diesen Ordner bei Bedarf separat; Schüler-Backups enthalten keine Teacher-Originale.

Die Logs enthalten Ereignisart, Schritt und Fehlerklasse, keine API-Schlüssel, Bilddaten oder vollständigen KI-Payloads. Fehler erscheinen im Studio verständlich, ohne technische Stack-Traces. Anfragen desselben Auftrags sind gegen gleichzeitige Dateimutationen gesperrt. Änderungen an nachgelagerten Inhalten müssen erneut freigegeben werden. Die API akzeptiert nur lokale Hosts, prüft Origin und benötigt für Änderungen einen Sitzungstoken aus der eigenen Oberfläche.

Die KI-Validierung versucht eine fehlerhafte strukturierte Antwort höchstens zweimal. Der SDK-Client erlaubt einen zusätzlichen Retry bei vorübergehenden Netzwerk-/API-Fehlern. Ein Timeout ist auf 180 Sekunden pro SDK-Anfrage begrenzt. Eine ausgeschöpfte Quote, ein ungültiger Schlüssel oder fehlende Internetverbindung führt zu einer erklärenden Fehlermeldung; es wird kein erfundener Ersatzinhalt veröffentlicht.

## Tests und bisherige Aussagekraft

```sh
python -m pytest
```

Die Teacher-Tests verwenden explizit injizierte Provider-Doubles. Sie prüfen echte Upload-Erkennung, mehrseitige PDFs, den gesamten Freigabeablauf, lokale Prüfungen, Versionierung, Hashes, Catalog und HTTP-Sicherheitsgrenzen ohne bezahlte KI-Aufrufe. Das tatsächliche veröffentlichte Demo-Paket wird zusätzlich auf TypeScript-Seite auf Hash-Parität geprüft.

Für Browser-Regressionen existiert ausschließlich unter `tests/`:

```sh
python tests/teacher_e2e_server.py --port 8137
```

Dieser Server verwendet die echte FastAPI und Studio-Oberfläche mit einem Testprovider; private Daten und Content liegen in einem temporären Ordner. Die Test-JPGs unter `tests/fixtures/` tragen sichtbar „DEMO“. Dieser Ablauf ersetzt keinen realen Acceptance-Test mit tatsächlichen Unterrichtsunterlagen und einem echten API-Schlüssel. Produktionsstart und Produktionsprovider bieten keinen Fake-Schalter.

Der reale abschließende Ablauf muss weiterhin mit eigenen Quellen überprüft werden: Analyse → Kontrolle → Generierung → fachliche Freigabe → Veröffentlichung → Download auf dem iPad → Offline-Test → Ergebnis und Fehlertraining → Neustart → Ergebnis teilen. Ohne diese reale Abnahme wird kein erfolgreich getesteter Version-1.0-Release behauptet.
