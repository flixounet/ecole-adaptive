# Teacher Studio

Lokaler FastAPI-Server für Unterrichtsfotos/PDFs, explizites Quellenreview, KI-gestützte Aufgabenerstellung, Validierung und Veröffentlichung.

```bash
source .venv/bin/activate
python -m pip install -e '.[test]'
python -m teacher
```

`http://127.0.0.1:8000` öffnen. `OPENAI_API_KEY` ausschließlich in der lokalen Projekt-`.env` setzen. Kein `VITE_`-Präfix und kein Key im Schülerteil. Standardmodell `gpt-4.1`, konfigurierbar.

Vollständige Bedienung, API-Verträge, Limits, Datenschutz und Testbefehle: [TEACHER_STUDIO.md](../docs/TEACHER_STUDIO.md). Veröffentlichte Inhalte: [CONTENT_PACKAGES.md](../docs/CONTENT_PACKAGES.md).

Nur Tests injizieren einen FakeProvider. `python -m teacher` verwendet immer den echten Provider für ausdrücklich gestartete KI-Aktionen.
