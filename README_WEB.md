# Finanzdaten – Web-Projekt

Backend (Python/FastAPI) und Frontend (React/Vite) für die Abfrage und Darstellung von Staatsfinanz-Daten.

## Voraussetzungen

- Python 3.10+ (mit pip)
- Node.js 18+ (mit npm)

## Backend starten

Im **Projektroot** (Ordner `Python Abfragen`):

```bash
# Abhängigkeiten (einmalig)
pip install -r requirements.txt
pip install -r backend/requirements.txt

# Server starten (Port 8000)
python -m uvicorn backend.main:app --reload --host 127.0.0.1
```

API-Dokumentation: http://127.0.0.1:8000/docs

**USA + FRED:** Für die USA werden optional zusätzlich die FRED-Serien **WDTGAL** (TGA Mittwochsstand) und **RRPONTSYD** (Overnight Reverse Repurchase Agreements) abgefragt, wenn die Umgebungsvariable `FRED_API_KEY` gesetzt ist. Kostenloser Key: [fred.stlouisfed.org/docs/api/api_key.html](https://fred.stlouisfed.org/docs/api/api_key.html)

## Frontend starten

In einem **zweiten Terminal**:

```bash
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:5173

(Vite leitet `/api` an das Backend weiter.)

## Ablauf

1. Backend und Frontend starten (siehe oben).
2. Im Browser Land wählen und ggf. auf **„Jetzt abfragen & speichern“** klicken.
3. Verlauf wird aus der SQLite-Datenbank (`data/finance.db`) gelesen und im Chart sowie in der Tabelle angezeigt.

## Projektstruktur

```
Python Abfragen/
├── backend/
│   ├── main.py          # FastAPI-App, Endpoints /api/countries, /api/history, /api/fetch/:country
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx      # React: Länderauswahl, Chart (Recharts), Tabelle
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.js   # Proxy /api -> Backend
├── data/
│   └── finance.db       # SQLite (wird vom Backend genutzt)
├── USA_Kontostand.py    # Abfrage-Logik (US, DE, AT, CA, MX, CH)
├── persist.py           # SQLite-Persistenz
└── requirements.txt
```

## API-Endpoints

| Methode | URL | Beschreibung |
|--------|-----|--------------|
| GET | `/api/countries` | Liste der Länder (us, de, at, ca, mx, ch) |
| GET | `/api/history?country=us&limit=100` | Verlaufsdaten aus der DB |
| GET | `/api/latest?country=us` | Neuester Eintrag (pro Land) |
| POST | `/api/fetch/{country}` | Live-Abfrage ausführen und in DB speichern |
| POST | `/api/fetch/us/history?limit=500` | USA: Historische Daten (TGA, WDTGAL, RRPONTSYD) von Treasury & FRED laden und speichern |
