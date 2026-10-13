# Fehlerhilfe

| Problem | Sinnvoller nächster Schritt |
| --- | --- |
| Teacher Studio öffnet nicht | Im Projekt `.venv` aktivieren, `python -m teacher` starten, `http://127.0.0.1:8000` öffnen. Bei belegtem Port `python -m teacher --port 8001`. |
| API-Schlüssel fehlt | `.env` im Projekt lokal befüllen und Teacher neu starten. Schlüssel nie in Browsercode oder Chat kopieren. |
| OpenAI-Limit/Verbindungsfehler | Verbindung/Kontingent prüfen, später ausdrücklich erneut versuchen. Erzeugte Entwürfe bleiben vor dem Validierungsschritt gespeichert. |
| KI-Ausgabe unvollständig/ungültig | Quellen lesbarer wählen, Scope reduzieren, erneut analysieren. Es gibt nur begrenzte Wiederholungen und keine erfundene Ersatzbank. |
| PDF nicht lesbar | Passwortschutz entfernen oder eine lesbare, unverschlüsselte PDF verwenden. Bis 40 Seiten, 20 MB pro Datei. |
| Bild abgelehnt | Tatsächliches JPEG/PNG/WebP verwenden; eine umbenannte Datei genügt nicht. 20 MB je Datei, 25 Millionen Pixel. |
| Uploadbatch fehlerhaft | Meldung prüfen. Der ganze Batch wird abgelehnt; vorhandene Dateien bleiben erhalten, keine neue Datei verschwindet unbemerkt. |
| Fachlich leere/unlesbare Quellen | Unsicherheiten prüfen und bessere Unterlagen hinzufügen. Ohne belegte Lernziele/Skills/Aufgabentypen gibt es keine Bestätigung. |
| Freigabe blockiert | Alle Fehler beheben, nach Fragenänderungen erneut validieren, Warnungen bewusst prüfen und bestätigen. |
| Vorbereitung in anderem Fenster geändert | Aktuelle Fassung neu prüfen. Versionsschutz verhindert das Überschreiben eines neueren Stands. |
| Katalog leer | Richtiges Profil und aktive Fächer prüfen. Standardprofil-ID muss mit Teacher übereinstimmen. Klassenfilter gegebenenfalls öffnen. |
| Lokal veröffentlicht, iPad sieht nichts | Neuen statischen Build auf dem HTTPS-Host veröffentlichen. Lokales Publish überträgt keine Dateien ins Internet. |
| Katalog offline nicht erreichbar | Heruntergeladene Kapitel unter **Meine Fächer** verwenden. Neue Inhalte benötigen einmal Internet. |
| Paket beschädigt/Hash falsch | Nicht installieren; im Teacher Studio neu validieren und unter höherer Version veröffentlichen. Kein manuelles Überschreiben derselben Version. |
| Download unterbrochen | Verbindung wiederherstellen und erneut herunterladen. Erst eine vollständige geprüfte Transaktion gilt als installiert. |
| App startet offline nicht | Produktionsadresse nutzen, einmal online „App offline bereit“ abwarten und Kapitel herunterladen. Lokales WLAN-HTTP ist auf dem iPad kein PWA-Installationsweg. |
| Lernstand scheint leer | Profil, Browser, Home-Screen-/Safari-Zugang und Adresse/Port vergleichen. Daten nicht löschen. |
| Backup-Konflikt | Beide Bestände getrennt sichern. Der Import überschreibt abweichende persönliche IDs nicht. |
| Speichern fehlgeschlagen | Eingaben auf dem Bildschirm belassen, erneut speichern. Freien Gerätespeicher prüfen; keine Browserdaten löschen. |
| Update ausgegraut | Offene Runden auch anderer Profile beenden. Danach aktualisieren. |
| Fehlertraining kürzer oder nicht möglich | Der lokale Pool enthält zu wenige andere Aufgaben zu diesen Skills. Zusätzliche Varianten aus denselben Quellen veröffentlichen. |
| Richtige freie Antwort nicht anerkannt | Akzeptierte Varianten im Teacher Studio ergänzen, erneut validieren und neue Paketversion veröffentlichen. Freitext/Algebra ist keine unbegrenzte semantische Bewertung. |

Teacher-Logs liegen unter `.teacher-data/teacher.log` mit begrenzter Rotation. Sie enthalten Ereignisse und Fehlerarten, keine kompletten Quellpayloads oder API-Schlüssel. Normale UI-Fehler zeigen keine Stacktraces. Bei Support nur gezielt benötigte, geprüfte Ausschnitte weitergeben.

Vor dem Löschen irgendeiner Datenablage zuerst ein Backup anlegen. Es gibt bewusst keinen „Datenbank bei Fehler zurücksetzen“-Automatismus.

## Start per Doppelklick auf diesem Mac

Verwende den aktuellen Ordner `$HOME/Desktop/RevaMode/Python/ecole adaptive`.

- `Start Ecole Adaptive.command`: Schüler-App, `http://127.0.0.1:5173/`.
- `Start Teacher Studio.command`: Unterricht vorbereiten, `http://127.0.0.1:8000/`.

Beide Starter erkennen einen bereits laufenden Dienst. Das erste Terminalfenster muss geöffnet bleiben. Ein fremder Dienst auf dem benötigten Port wird nicht beendet; der Starter zeigt eine Fehlermeldung. Startprotokolle: `~/Library/Caches/EcoleAdaptive/student/start.log` und `~/Library/Caches/EcoleAdaptive/teacher/start.log`.

### iCloud-Dateien blockieren Python-Imports

Am 11.10.2026 waren noch Python-Cachedateien und eingebaute JSON-Schemata als `dataless` ausgelagert. Betroffene Paketdaten wurden gezielt heruntergeladen. Der Teacher-Starter und der direkte Mac-CLI-Start verwenden jetzt einen Cache außerhalb iCloud. Das vermeidet das Warten auf alte ausgelagerte `.pyc`-Dateien. Projekt und `.venv` müssen trotzdem vollständig lokal verfügbar bleiben; im Finder **Downloads behalten** verwenden. Keine Neuinstallation, kein Löschen persönlicher Daten und keine KI-Anfrage waren für diese Startreparatur erforderlich.

Verifiziert: Schüler-Kaltstart und wiederholter Start, erreichbarer Inhaltskatalog, sichtbare Profilauswahl und Lernraum; Teacher-Oberfläche und APIs, direkter CLI-Start, wiederholter Start, verständlicher Portkonflikt sowie lokale Bereitschaftsprüfung bei ungültiger Proxykonfiguration. Die fachliche KI-/iPad-Endabnahme bleibt ein gesonderter Schritt.
