# Statische Bereitstellung mit GitHub Pages

Die Student-App ist statisch. Der Teacher-Server wird nicht auf GitHub Pages betrieben. Der fertige Ordner `apps/student/dist/` enthält ausschließlich App Shell und freigegebene Pakete.

Im geprüften lokalen Repository ist noch kein Git-Remote eingetragen. Deshalb gibt es noch keine verifizierte öffentliche App-Adresse. Die folgenden Schritte werden bewusst vom Betreiber ausgelöst; die Entwicklungsarbeiten führen keinen automatischen Push aus.

## Erstes Repository verbinden

Auf GitHub ein Repository anlegen. Keine Zugangsdaten oder Originalschulunterlagen hochladen. Lokal nach Prüfung der Dateien:

```bash
cd "$HOME/Desktop/RevaMode/Python/ecole adaptive"
git status --short
# OWNER durch dein GitHub-Konto ersetzen:
git remote add origin https://github.com/OWNER/ecole-adaptive.git
```

Es gibt zwei Workflows: `checks.yml` prüft Pushes/Pull Requests und kann manuell gestartet werden. `pages.yml` baut und veröffentlicht ausschließlich nach manuellem Start. Beide installieren Node/Python, prüfen beide Stacks und führen Chromium-/WebKit-Browsertests aus. Der Deployment-Job läuft nur nach erfolgreichem Build. Der Teacher-Key ist dafür weder nötig noch vorgesehen.

## Inhalte prüfen und hochladen

```bash
source .venv/bin/activate
python -m teacher publish
npm run check
python -m pytest
git status --short
git add .
git diff --cached --stat
git diff --cached --name-only
```

Vor dem Commit sicherstellen: keine `.env`, `.teacher-data/`, Originaldateien oder persönlichen Backups im Index. `.gitignore` schließt die vorgesehenen privaten Pfade aus; frei irgendwo abgelegte Dateien müssen dennoch geprüft werden.

Solange die echte Abnahme fehlt, einen RC-Commit verwenden:

```bash
git commit -m "feat: Ecole Adaptive V1 release candidate"
git push -u origin HEAD
```

## Pages aktivieren

1. Im GitHub-Repository **Settings → Pages** öffnen.
2. Als Quelle **GitHub Actions** wählen.
3. Unter **Actions → Deploy Student App to Pages → Run workflow** den hochgeladenen Branch wählen.
4. Nach erfolgreichem Lauf die angezeigte Pages-Adresse in Safari öffnen.

Mit bereits eingerichteter GitHub CLI ist alternativ möglich:

```bash
gh workflow run pages.yml --ref "$(git branch --show-current)"
gh run list --workflow pages.yml
gh run watch
```

Die CLI muss vorher vom Betreiber mit seinem Konto eingerichtet werden. Diese Anleitung meldet niemanden automatisch an und akzeptiert keine Hostingbedingungen.

Der Workflow ermittelt den Pages-Unterpfad über `configure-pages` und baut `VITE_BASE_PATH` passend. Für einen manuell gebauten Repository-Unterpfad:

```bash
VITE_BASE_PATH=/ecole-adaptive/ npm run build
```

Manifest, Assets, Service-Worker-Scope, Navigationsfallback und Katalogadresse verwenden denselben Basis-Pfad. Keine Handänderungen in generiertem JavaScript nötig.

## Spätere Unterrichtspakete

Teacher Studio: prüfen → freigeben → lokal veröffentlichen. Danach `python -m teacher publish`, Prüfungen/Build, geprüfte Änderungen committen/pushen und Pages-Workflow erneut starten. Das iPad erkennt den neuen Katalog, sobald diese Version online ist. Der Download bleibt ausdrücklich vom Schüler ausgelöst.

## Anderer statischer Host

Auch ein HTTPS-Host wie Cloudflare Pages kann den erzeugten Ordner `apps/student/dist/` ausliefern. `VITE_BASE_PATH=/` für die Domainwurzel verwenden. Keine serverseitigen Funktionen, Teacher-Schlüssel oder Python-Laufzeit im Hosting nötig. GitHub Pages bleibt der vorbereitete Standardweg.

## Öffentliche Inhalte

Ohne Benutzerkonten sind statische Pakete und Profil-IDs öffentlich abrufbar. Die Filterung pro Kind ist eine lokale Inhaltszuordnung, keine Zugriffskontrolle. Keine sensiblen Angaben, identifizierenden Dateinamen oder Originalfotos in veröffentlichten Aufgaben belassen. Der Build kopiert nur validierte Katalogeinträge und deren Paketdateien.
