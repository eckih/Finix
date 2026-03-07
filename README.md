# Finix

**Staatsfinanzen im Überblick – offizielle Daten, Kurse, News & KI.**  
**Public finances at a glance – official data, prices, news & AI.**

---

## Deutsch

### Was ist Finix?

Finix ist eine Web-App für den Überblick über **Staatsfinanzen** (u. a. TGA, Kreditbestand, Nettofinanzierungssaldo), **Kurse** (Aktien, Krypto), **News** mit Übersetzung sowie **KI-Antworten** zu Nachrichten. Die Oberfläche ist auf Deutsch und Englisch verfügbar.

### Funktionen

| Bereich | Beschreibung |
|--------|--------------|
| **Staatsfinanzen** | Offizielle Daten (z. B. USA, DE, AT, CA, MX, CH), FRED-Indikatoren, historischer Verlauf, Diagramme |
| **Kurse** | Vergleich von Aktien (S&P 500, DJIA, NASDAQ) und Krypto (BTC, ETH, LTC) mit Zeitbereichs-Slider |
| **Statistik** | Datenbank-Übersicht: Einträge, Größe, Datumsbereich, News-Anzahl |
| **News** | Zwei Quellen (Alpha Vantage, Finnhub), zeitlich sortiert, Übersetzung (DE/EN), KI-Fragen pro Meldung |
| **Konfiguration** | KI-Modell wählen (Gemini, Claude Sonnet, LM Studio), AI-Standardfragen bearbeiten, Modell testen |
| **Datenbank (Admin)** | SQLite-Tabellen einsehen, Zeilen bearbeiten/löschen, Tabellen leeren |

KI-Antworten werden gecacht; gespeicherte Antworten zeigen Herkunft (Cache/Modell) und können per „Aktualisieren“ neu erzeugt werden.

### Voraussetzungen

- **Docker** und **Docker Compose**
- Optional: **LibreTranslate** (lokal) für News-Übersetzung → siehe `libretranslate/lt-local/`

### Installation & Start

1. **Repository klonen** (oder Projektordner nutzen).

2. **Umgebungsvariablen:** Datei `.env` im Projektroot anlegen bzw. anpassen (siehe Abschnitt [Umgebung](#umgebung-de)).

3. **Start (mit LibreTranslate, falls nicht läuft):**
   - **Windows (PowerShell):**  
     `.\up.ps1 -f docker-compose.yml -f docker-compose.dev.yml up`  
     oder nur Basis: `.\up.ps1 up`
   - **Linux/macOS/Git Bash:**  
     `chmod +x up.sh` dann  
     `./up.sh -f docker-compose.yml -f docker-compose.dev.yml up`  
     bzw. `./up.sh up`

   Die Skripte starten zuerst den LibreTranslate-Container aus `libretranslate/lt-local/`, falls er noch nicht läuft, und danach die Finix-Services.

4. **Ohne Skript (nur Finix):**  
   `docker compose up --build`  
   Für Entwicklung mit Live-Reload:  
   `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`

5. **App im Browser:**  
   - Frontend: **http://localhost:5173**  
   - Backend-API: http://localhost:8000  

### Umgebung (.env)

| Variable | Beschreibung |
|----------|--------------|
| `FRED_API_KEY` | FRED (Federal Reserve Economic Data), kostenlos registrierbar |
| `ALPHA_VANTAGE_KEY` | Alpha Vantage (News) |
| `FINNHUB_API_KEY` | Finnhub (zweiter News-Feed) |
| `GEMINI_API_KEY` | Google Gemini (KI-Modelle) |
| `ANTHROPIC_API_KEY` | Anthropic Claude Sonnet |
| `LM_STUDIO_URL` | LM Studio (lokal), z. B. `http://host.docker.internal:1234` |
| `LM_STUDIO_MODEL`, `LM_STUDIO_API_KEY` | Optional für LM Studio |
| `LIBRETRANSLATE_URL` | Lokales LibreTranslate, z. B. `http://host.docker.internal:5000` |
| `MYMEMORY_EMAIL`, `SIMPLYTRANSLATE_API_KEY` | Optionale Übersetzungsdienste |

Ohne Keys laufen Teile der App eingeschränkt (z. B. keine FRED-Daten, keine News, keine Cloud-KI).

### Projektstruktur (kurz)

- `backend/` – FastAPI, FRED/Alpha Vantage/Finnhub, KI (Gemini, Anthropic, LM Studio), SQLite, Übersetzung
- `frontend/` – React, Vite, Recharts, i18n (DE/EN)
- `data/` – SQLite-Datenbank, Logs (nach Start)
- `libretranslate/lt-local/` – eigenes Docker-Compose für LibreTranslate
- `up.ps1` / `up.sh` – Start mit optionalem LibreTranslate

---

## English

### What is Finix?

Finix is a web app for **public finances** (e.g. TGA, debt, net financing balance), **prices** (stocks, crypto), **news** with translation, and **AI answers** on news items. The UI is available in German and English.

### Features

| Area | Description |
|------|-------------|
| **Public finances** | Official data (e.g. USA, DE, AT, CA, MX, CH), FRED indicators, history, charts |
| **Prices** | Compare stocks (S&P 500, DJIA, NASDAQ) and crypto (BTC, ETH, LTC) with time-range sliders |
| **Statistics** | Database overview: record counts, size, date range, news count |
| **News** | Two sources (Alpha Vantage, Finnhub), sorted by time, translation (DE/EN), AI questions per item |
| **Configuration** | Choose AI model (Gemini, Claude Sonnet, LM Studio), edit preset AI questions, test model |
| **Database (Admin)** | View SQLite tables, edit/delete rows, clear tables |

AI answers are cached; stored answers show source (cache/model) and can be refreshed with “Refresh”.

### Requirements

- **Docker** and **Docker Compose**
- Optional: **LibreTranslate** (local) for news translation → see `libretranslate/lt-local/`

### Installation & Run

1. **Clone the repository** (or use the project folder).

2. **Environment:** Create or edit a `.env` file in the project root (see [Environment](#environment-en) below).

3. **Run (with LibreTranslate if not already running):**
   - **Windows (PowerShell):**  
     `.\up.ps1 -f docker-compose.yml -f docker-compose.dev.yml up`  
     or base only: `.\up.ps1 up`
   - **Linux/macOS/Git Bash:**  
     `chmod +x up.sh` then  
     `./up.sh -f docker-compose.yml -f docker-compose.dev.yml up`  
     or `./up.sh up`

   The scripts start the LibreTranslate container from `libretranslate/lt-local/` first if it is not running, then the Finix services.

4. **Without script (Finix only):**  
   `docker compose up --build`  
   For development with live reload:  
   `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`

5. **Open in browser:**  
   - Frontend: **http://localhost:5173**  
   - Backend API: http://localhost:8000  

### Environment (.env)

| Variable | Description |
|----------|-------------|
| `FRED_API_KEY` | FRED (Federal Reserve Economic Data), free registration |
| `ALPHA_VANTAGE_KEY` | Alpha Vantage (news) |
| `FINNHUB_API_KEY` | Finnhub (second news feed) |
| `GEMINI_API_KEY` | Google Gemini (AI models) |
| `ANTHROPIC_API_KEY` | Anthropic Claude Sonnet |
| `LM_STUDIO_URL` | LM Studio (local), e.g. `http://host.docker.internal:1234` |
| `LM_STUDIO_MODEL`, `LM_STUDIO_API_KEY` | Optional for LM Studio |
| `LIBRETRANSLATE_URL` | Local LibreTranslate, e.g. `http://host.docker.internal:5000` |
| `MYMEMORY_EMAIL`, `SIMPLYTRANSLATE_API_KEY` | Optional translation services |

Without keys, some parts of the app are limited (e.g. no FRED data, no news, no cloud AI).

### Project structure (brief)

- `backend/` – FastAPI, FRED/Alpha Vantage/Finnhub, AI (Gemini, Anthropic, LM Studio), SQLite, translation
- `frontend/` – React, Vite, Recharts, i18n (DE/EN)
- `data/` – SQLite database, logs (after first run)
- `libretranslate/lt-local/` – separate Docker Compose for LibreTranslate
- `up.ps1` / `up.sh` – Run with optional LibreTranslate

---

## Version / Lizenz

- **Version:** siehe `VERSION`
- **Lizenz:** siehe Repository / Projektangaben
