# Offline-Architektur

## Zwei getrennte Speicher

Der Service Worker hält ausschließlich die gebaute App Shell vor: HTML, JavaScript, CSS, Manifest und lokale Icons. Veröffentlichte Pakete sind ausdrücklich nicht Teil des Shell-Precaches. Sie werden über den Katalog entdeckt, geprüft und vollständig in IndexedDB installiert. Damit bleibt „offline verfügbar“ eine überprüfte Inhaltsinstallation statt einer zufällig noch vorhandenen HTTP-Antwort.

`vite-plugin-pwa` baut über `injectManifest` den eigenen Worker `apps/student/src/sw.ts`. Workbox versioniert die Precache-Einträge. Navigationsfallback und Scope berücksichtigen `VITE_BASE_PATH`, beispielsweise `/ecole-adaptive/` auf GitHub Pages. Die Build-Erweiterung kopiert nur den validierten Katalog und dessen referenzierte Pakete. `.env`, Teacher-Quellen und Originaldateien gehören nicht zum Build.

## Erster Start und Offline-Start

Produktionsbuild einmal über HTTPS oder localhost öffnen. Die Registrierung startet bereits auf der Profilauswahl. Sobald der Worker bereit ist, zeigt die App „App offline bereit“. Danach gewünschte Pakete herunterladen. Ein Offline-Kaltstart lädt die App Shell aus dem Precache und die Lerninhalte aus IndexedDB.

Der Vite-Entwicklungsmodus registriert keinen Service Worker. Für die lokale Prüfung `npm run build` und `npm run preview` verwenden. Eine HTTP-Adresse des Macs im WLAN ist auf dem iPad kein sicherer Kontext und ermöglicht keinen zuverlässigen installierten Offlinebetrieb; dafür den statischen Build per HTTPS bereitstellen.

## App-Updates

Eine neue Shell wird im Hintergrund installiert, aber nicht automatisch mitten in einer Runde neu geladen. Die App zeigt „Eine neue Version von École ist verfügbar“. **Aktualisieren** prüft vor und nach Aktivierung, ob eine Runde läuft oder noch gespeichert wird. Zusätzlich werden aktive Sitzungen aller Profile aus IndexedDB geprüft. Ein `controllerchange` in einem anderen Tab löst ausdrücklich keinen automatischen Reload aus.

Nach dem Schließen aller alten Tabs kann der Browser einen wartenden Worker selbst aktivieren. Die eigentliche Datensicherung sind daher unveränderte persistierte Sitzungs- und Paketkopien, nicht ein Versprechen, eine Worker-Version unbegrenzt festzuhalten. Migrationen sind additiv.

## Prüfungszeit und Wiederherstellung

Beim Start werden Fragen, Reihenfolge, Antworten, Beginn und absolute Deadline lokal gespeichert. Die Frist bleibt beim Reload/Schließen erhalten. Ist sie beim Wiederöffnen überschritten, wird die Sitzung abgegeben. Während einer Klassenarbeit gibt es keine neuen Online-Fragen. Ein absichtlich verstellter Gerätezeitgeber lässt sich ohne vertrauenswürdigen Zeitdienst nicht manipulationssicher erkennen.

## Grenzen

Browserdaten sind an Browser, Origin und Port gebunden. iPad-Safari und eine Home-Screen-Installation können getrennte Speicherkontexte verwenden: nach Installation Inhalte dort prüfen/herunterladen. Browser und Betriebssystem können lokale Daten entfernen. Regelmäßige JSON-Backups sind deshalb Teil der Nutzung. Kein Cloud-Sync, keine Konten, keine Tracking- oder Werbedienste.

Automatisierte Prüfungen umfassen echte Service-Worker-Registrierung, Offline-Prüfung, vollständiges Browser-Schließen mit anschließendem Offline-Start und Unterpfad-Builds. WebKit im iPad-Viewport prüft die Browserengine und das Layout; eine echte iPadOS-Geräteabnahme bleibt eine gesonderte Prüfung.
