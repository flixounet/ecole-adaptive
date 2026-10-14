# Statische Bereitstellung mit GitHub Pages

Die Student-App ist statisch. Der Teacher-Server wird nicht auf GitHub Pages betrieben. Der fertige Ordner `apps/student/dist/` enthält ausschließlich App Shell und freigegebene Pakete.

Das öffentliche Repository und GitHub Pages sind bereits eingerichtet:

- Repository: [flixounet/ecole-adaptive](https://github.com/flixounet/ecole-adaptive)
- Schüler-App: [École Adaptive öffnen](https://flixounet.github.io/ecole-adaptive/)
- Veröffentlichung prüfen: [Deploy Student App to Pages](https://github.com/flixounet/ecole-adaptive/actions/workflows/pages.yml)

**„Lokal veröffentlicht“ im Teacher Studio bedeutet: Das Paket liegt auf diesem Mac.** Auf dem iPad erscheint es erst, nachdem es zu GitHub übertragen und die Website erfolgreich aktualisiert wurde.

## Neue Kurse vom Mac auf die iPads bringen

1. Öffne den gewünschten Kurs im **Teacher Studio**. Prüfe Quellen, Aufgaben, Lösungen und Hinweise. Bestätige die Kontroll-Checkbox und wähle **Aufgaben freigeben**.
2. Klicke auf **Für Schüler veröffentlichen**. Warte auf **Lokal veröffentlicht**. Damit entstehen der Katalog `content/catalog.json` und die Paketdatei unter `content/packages/`. Ein zusätzlicher Terminalbefehl ist für diesen Studio-Ablauf nicht nötig.
3. Öffne **GitHub Desktop**. Wähle das Repository **ecole-adaptive** und bei **Current Branch** den Branch **main**.
4. Öffne **Changes**. Entferne zunächst die Häkchen bei allen Dateien. Wähle dann nur `content/catalog.json` und die gewünschten, dazugehörigen Dateien unter `content/packages/` aus. Klicke die Dateien zur Kontrolle an. Jede neue Paketdatei, die der Katalog nennt, muss mit hochgeladen werden; bereits auf GitHub vorhandene Pakete müssen nicht erneut ausgewählt werden.
5. Schreibe bei **Summary** zum Beispiel `Neue Kurse für Max veröffentlichen`. Klicke auf **Commit to main**. Der Button kann zusätzlich die Anzahl der ausgewählten Dateien nennen. Dieser Schritt speichert die Auswahl zunächst nur auf dem Mac.
6. Klicke oben auf **Push origin**. Erst jetzt werden die ausgewählten Änderungen zu GitHub übertragen.
7. Öffne [Actions → Deploy Student App to Pages](https://github.com/flixounet/ecole-adaptive/actions/workflows/pages.yml). Der Push startet die Veröffentlichung automatisch, wenn er auf **main** Dateien unter `content/` oder `.github/workflows/pages.yml` geändert hat. Öffne den Lauf zu deinem neuen Commit und warte, bis **build** und **deploy** erfolgreich sind. Der separate Lauf **Checks** allein bestätigt noch keine aktualisierte Website.
8. Öffne auf dem iPad [École Adaptive](https://flixounet.github.io/ecole-adaptive/) mit Internetverbindung. Wähle **Max → Neue Inhalte → Katalog aktualisieren**. Tippe bei jedem gewünschten Kurs auf **Herunterladen** und warte auf **Offline verfügbar**. Danach liegt er unter **Meine Fächer** bereit.

Die Datei `.env`, der Ordner `.teacher-data/`, Originalschulunterlagen, Fotos und persönliche Backups gehören nicht in diese Auswahl. Sie bleiben auf dem Mac. Auch bei aktivem `.gitignore` die Dateiliste vor dem Commit kontrollieren; nicht pauschal alle Änderungen übernehmen.

Ist der Pages-Lauf rot, wurde die neue Version nicht veröffentlicht. Öffne den fehlgeschlagenen Schritt und behebe den gemeldeten Fehler. Auf dem iPad bleibt bis dahin die zuletzt erfolgreich veröffentlichte Version verfügbar. Wiederholtes **Katalog aktualisieren** kann fehlende GitHub-Dateien oder einen fehlgeschlagenen Build nicht ersetzen.

## Veröffentlichung von Hand starten

Der manuelle Start bleibt als Alternative erhalten, zum Beispiel nach einer reinen Änderung am App-Code:

1. Zuerst die gewünschten Änderungen mit **Commit to main → Push origin** übertragen.
2. [Actions → Deploy Student App to Pages](https://github.com/flixounet/ecole-adaptive/actions/workflows/pages.yml) öffnen.
3. **Run workflow** wählen, den Branch **main** auswählen und mit **Run workflow** bestätigen.
4. Den erfolgreichen Abschluss von **build** und **deploy** abwarten. Danach auf dem iPad den Katalog aktualisieren und neue Kurse herunterladen.

**Run workflow** lädt keine Dateien vom Mac hoch. Es veröffentlicht den Stand, der bereits auf GitHub liegt. Die Pages-Quelle unter **Settings → Pages** ist für dieses Repository auf **GitHub Actions** eingerichtet.

## Technischer Ablauf

Es gibt zwei Workflows: `checks.yml` prüft Pushes und Pull Requests. `pages.yml` prüft, baut und veröffentlicht nach dem oben beschriebenen Push oder einem manuellen Start. Beide installieren Node und Python, prüfen beide Stacks und führen Chromium-/WebKit-Browsertests aus. Der Deployment-Job läuft nur nach erfolgreichem Build. Der Teacher-Key ist dafür weder nötig noch vorgesehen.

Der Workflow ermittelt den Pages-Unterpfad über `configure-pages` und baut `VITE_BASE_PATH` passend. Für einen manuell gebauten Repository-Unterpfad:

```bash
VITE_BASE_PATH=/ecole-adaptive/ npm run build
```

Manifest, Assets, Service-Worker-Scope, Navigationsfallback und Katalogadresse verwenden denselben Basis-Pfad. Keine Handänderungen in generiertem JavaScript nötig.

## Anderer statischer Host

Auch ein HTTPS-Host wie Cloudflare Pages kann den erzeugten Ordner `apps/student/dist/` ausliefern. `VITE_BASE_PATH=/` für die Domainwurzel verwenden. Keine serverseitigen Funktionen, Teacher-Schlüssel oder Python-Laufzeit im Hosting nötig. GitHub Pages bleibt der vorbereitete Standardweg.

## Öffentliche Inhalte

Ohne Benutzerkonten sind statische Pakete und Profil-IDs öffentlich abrufbar. Die Filterung pro Kind ist eine lokale Inhaltszuordnung, keine Zugriffskontrolle. Keine sensiblen Angaben, identifizierenden Dateinamen oder Originalfotos in veröffentlichten Aufgaben belassen. Der Build kopiert nur validierte Katalogeinträge und deren Paketdateien.

Die GitHub-Schritte entsprechen der offiziellen Anleitung zu [Dateiauswahl, Commit und Push in GitHub Desktop](https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop) sowie zum [manuellen Start eines Workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow?tool=webui).
