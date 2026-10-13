# Abnahmenachtrag vom 11.10.2026

Dieser Nachtrag aktualisiert den Schlüsselstatus aus PHASE_3_ACCEPTANCE.md vom 10.10.2026.

- OPENAI_API_KEY ist lokal in .env eingetragen. Der Schlüssel wird hier nicht dokumentiert.
- Authentifizierung und Modellzugriff auf gpt-4.1 über die OpenAI-API waren erfolgreich.
- Es wurden keine Unterrichtsdateien übertragen und keine Inhalte generiert. Der vereinbarte Ordner quellen/ war bei der Prüfung leer.
- Die echte fachliche Abnahme, physische iPad-Prüfung und Live-Bereitstellung bleiben offen. Version weiterhin 1.0.0-rc.1.

Mehrere Teacher- und Python-Paketdateien waren unter macOS als compressed,dataless markiert. Der SDK-Import wartete beim Lesen dieser ausgelagerten Dateien. Die reine Modellabfrage ohne diese Zusatzpakete war erfolgreich. Das Datenvolume hatte etwa 3 GiB frei (99 % belegt). Vor dem echten Teacher-Test müssen die Projekt- und Umgebungsdateien vollständig lokal verfügbar sein. Es wurde nichts gelöscht oder neu installiert.
