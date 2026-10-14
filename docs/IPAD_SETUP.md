# École auf dem iPad einrichten

Du brauchst zunächst Internet. Die Schüler-App ist unter [https://flixounet.github.io/ecole-adaptive/](https://flixounet.github.io/ecole-adaptive/) erreichbar. Das Teacher Studio läuft auf dem Mac; es muss während des Lernens nicht eingeschaltet bleiben. Wie neue Kurse vom Mac auf die Website gelangen, steht in der [Deployment-Anleitung](DEPLOYMENT.md).

## Einmal einrichten

1. Öffne **Safari** auf dem iPad.
2. Öffne **https://flixounet.github.io/ecole-adaptive/**.
3. Tippe auf **Teilen** (Quadrat mit Pfeil nach oben).
4. Wähle **Zum Home-Bildschirm**, dann **Hinzufügen**.
5. Öffne École über das neue Symbol auf dem Home-Bildschirm.
6. Bleibe zunächst online. Warte auf die Anzeige **App offline bereit**.
7. Wähle das gewünschte Profil, zum Beispiel **Max**.
8. Öffne **Neue Inhalte → Katalog aktualisieren**. Tippe beim gewünschten Kapitel auf **Herunterladen**.
9. Warte auf **Offline verfügbar**. Erst dann ist das ganze Paket gespeichert.
10. Öffne **Meine Fächer** und starte eine Lernrunde oder Klassenarbeit.

Ein Symbol allein beweist noch keinen Offlinebetrieb. Prüfe ihn einmal: Aktiviere den Flugmodus, schließe École vollständig und öffne das Symbol erneut. Das Profil und heruntergeladene Kapitel müssen erscheinen. Deaktiviere den Flugmodus anschließend wieder, wenn du neue Inhalte laden möchtest.

## Im Alltag

**Lernen:** Antworten prüfen, Hinweise nutzen und Schritt für Schritt verstehen. Ein Fehler ist ein Anlass zum Üben. Unter **Mein Lernstand** siehst du deine bisherigen Themen.

**Klassenarbeit:** Der Timer läuft auch weiter, wenn du École schließt. Zum Fortsetzen dasselbe Profil öffnen und **Fortsetzen** wählen. Nach Ablauf wird die Arbeit beim nächsten Öffnen abgegeben.

**Meine Ergebnisse:** Frühere Runden öffnen, Lösungen ansehen und **Meine Fehler trainieren** starten. Es werden andere Aufgaben zu den Fehlerthemen gewählt, soweit vorhanden.

**Ergebnis teilen:** Nutze die angebotene Teilen-Funktion. Falls sie nicht verfügbar ist, erscheint Text zum Kopieren. Zum Versenden über Messenger oder Mail kann die betreffende andere App eine Verbindung benötigen; École selbst erstellt den Ergebnistext offline.

## Neue Aufgaben und Updates

**Neue Kurse:** Bleibe online und wähle das richtige Profil, zum Beispiel **Max → Neue Inhalte → Katalog aktualisieren**. Tippe beim gewünschten Kurs auf **Herunterladen** und warte auf **Offline verfügbar**. „Lokal veröffentlicht“ im Teacher Studio reicht dafür noch nicht: Die Dateien müssen erst mit GitHub Desktop übertragen und der Pages-Lauf erfolgreich beendet worden sein.

**Neue App-Version:** Dafür erscheint ein eigener Hinweis **Aktualisieren**. Schließe offene Runden erst ab. Das App-Update erneuert die Anwendung; **Katalog aktualisieren** sucht Unterrichtspakete, und **Herunterladen** speichert das gewählte Paket. Gespeicherte Ergebnisse werden durch ein App- oder Inhaltsupdate nicht absichtlich gelöscht.

## Daten sichern

Öffne **Profile & Backup → Daten exportieren** und speichere die JSON-Datei in der Dateien-App an einem sicheren Ort. Die Sicherung enthält alle Profile dieses Geräts. Vor einem Gerätewechsel oder dem Löschen von Safari-Daten unbedingt ein aktuelles Backup erstellen. Auf dem neuen Gerät dasselbe École öffnen und **Backup prüfen und importieren** verwenden.

## Wenn etwas fehlt

- Prüfe, ob das richtige Profil ausgewählt ist.
- Fehlt bei Max **Geschichte-Geographie**, öffne **Profile & Backup → Schüler verwalten → Bearbeiten** bei Max. Ergänze im Feld **Aktive Fächer (durch Komma getrennt)** die Fach-ID `history_geography`; lasse die übrigen Fächer stehen. Wähle **Profil speichern**, dann **Neue Inhalte → Katalog aktualisieren** und lade den gewünschten Kurs herunter.
- Prüfe, ob du École über Safari oder das Home-Screen-Symbol verwendest. Bleibe möglichst bei einem Zugang.
- Ein anderer Hostname oder Port ist für den Browser eine andere Datenablage.
- Inhalte müssen ausdrücklich heruntergeladen worden sein.
- Eine lokale Adresse wie `http://192.168…` genügt für die installierbare Offline-App nicht.
- Keine Browserdaten löschen, um einen Fehler zu beheben. Zuerst Backup und [Fehlerhilfe](TROUBLESHOOTING.md).
