# Vorschlag: Finix internationalisieren (i18n)

## 1. Ziele

- **Frontend:** Alle sichtbaren Texte (Buttons, Labels, Fehlermeldungen, Tabellenköpfe) in wählbarer Sprache (z.B. Deutsch, Englisch).
- **Backend:** Ländernamen und API-Meldungen optional mehrsprachig (z.B. über `Accept-Language`).
- **Daten:** Indikator-Labels (TGA, WDTGAL, …) können technisch bleiben oder übersetzt werden (z.B. in der Anzeige).

---

## 2. Frontend (React + Vite)

### Empfehlung: **react-i18next**

- Weit verbreitet, gute Dokumentation, funktioniert gut mit React.
- Übersetzungen als JSON pro Sprache, Schlüssel z.B. `common.country`, `chart.history`.

### Schritte

1. **Pakete installieren**
   ```bash
   cd frontend && npm install i18next react-i18next i18next-browser-languagedetector
   ```

2. **Ordnerstruktur**
   ```
   frontend/
   ├── src/
   │   ├── i18n/
   │   │   ├── index.js       # i18n init, Sprachdetektion
   │   │   ├── locales/
   │   │   │   ├── de.json
   │   │   │   └── en.json
   ```

3. **Sprachdateien anlegen** (Auszug)

   **`locales/de.json`**
   ```json
   {
     "app": {
       "title": "Finix",
       "subtitle": "Staatsfinanzen im Überblick – offizielle Daten (TGA, Kreditbestand, Nettofinanzierungssaldo)"
     },
     "controls": {
       "country": "Land",
       "fetch": "Jetzt abfragen & speichern",
       "fetching": "Abfrage läuft…",
       "loadHistory": "Historie laden (USA)",
       "loadHistoryBusy": "Historie wird geladen…",
       "loadHistoryTitle": "TGA, WDTGAL, RRPONTSYD und WRESBAL – bis zu 500 Einträge pro Reihe von Treasury & FRED"
     },
     "chart": {
       "history": "Verlauf",
       "show": "Anzeigen",
       "period": "Zeitraum (Slider)",
       "from": "Von",
       "to": "Bis",
       "fullRange": "Ganzer Zeitraum",
       "noData": "Noch keine Verlaufsdaten. Klicke auf „Jetzt abfragen & speichern“."
     },
     "table": {
       "lastEntries": "Letzte Einträge",
       "date": "Datum",
       "indicator": "Indikator",
       "value": "Wert",
       "unit": "Einheit",
       "fetchedAt": "Abgerufen",
       "noEntries": "Keine Einträge für dieses Land."
     },
     "messages": {
       "historyLoaded": "Historie geladen – pro Indikator:",
       "errorCountries": "Länder konnten nicht geladen werden",
       "errorHistory": "Verlauf konnte nicht geladen werden"
     },
     "labels": {
       "tga": "TGA Closing Balance",
       "wdtgal": "WDTGAL (TGA Wed)",
       "rrp": "RRPONTSYD (Overnight RRP)",
       "wresbal": "WRESBAL (Reserve Balances)"
     }
   }
   ```

   **`locales/en.json`** – gleiche Keys, englische Texte.

4. **i18n initialisieren** in `src/i18n/index.js`:
   - `i18n.use(LanguageDetector).init({ fallbackLng: 'de', resources: { de, en } })`.
   - In `main.jsx`: `import './i18n'`.

5. **In Komponenten nutzen**
   - `import { useTranslation } from 'react-i18next'`
   - `const { t, i18n } = useTranslation()`
   - Texte ersetzen: `t('app.title')`, `t('controls.country')` usw.
   - Zahlen/Datum: `i18n.language` für Locale (z.B. `toLocaleString(i18n.language === 'de' ? 'de-DE' : 'en-US')`).

6. **Sprachumschalter** im Header (z.B. DE | EN), der `i18n.changeLanguage('de')` / `'en'` aufruft.

---

## 3. Backend (FastAPI)

### Option A: Einfach (nur Ländernamen)

- Neue Route z.B. `GET /api/countries?lang=de|en` oder Header `Accept-Language`.
- Ländernamen in Python-Dict oder JSON pro Sprache zurückgeben, z.B.:
  ```python
  COUNTRIES_I18N = {
      "de": [{"id": "us", "name": "USA (TGA)"}, {"id": "de", "name": "Deutschland"}, ...],
      "en": [{"id": "us", "name": "USA (TGA)"}, {"id": "de", "name": "Germany"}, ...],
  }
  ```

### Option B: Vollständig

- Übersetzungsdateien (z.B. `backend/locales/de.json`, `en.json`) für Meldungen wie „Keine historischen Daten erhalten“.
- Hilfsfunktion `t(key, lang)` die aus den JSON-Dateien liest.
- `lang` aus Query-Parameter oder `Accept-Language` Header.

---

## 4. Daten / API-Labels

- **In der DB** bleiben die technischen Labels (z.B. `TGA Closing Balance`, `WDTGAL (TGA Wed)`) unverändert.
- **Anzeige im Frontend:** Entweder 1:1 anzeigen oder über Übersetzungsschlüssel mappen (z.B. `labels.tga` → „TGA Closing Balance“ / „TGA Closing Balance“), damit die Tabelle und die Chart-Legende konsistent sind.

---

## 5. Reihenfolge der Umsetzung

| Schritt | Beschreibung |
|--------|----------------|
| 1 | react-i18next einrichten, `de.json` / `en.json` anlegen |
| 2 | Alle Frontend-Strings in App.jsx auf `t('...')` umstellen |
| 3 | Sprachumschalter (DE/EN) im Header einbauen |
| 4 | Zahlen- und Datumsformat von `i18n.language` abhängig machen |
| 5 | Optional: Backend-Ländernamen und Fehlermeldungen nach Sprache ausliefern |

---

## 6. Nützliche Links

- [react-i18next](https://react.i18next.com/)
- [i18next Browser Language Detector](https://github.com/i18next/i18next-browser-languageDetector)

---

## 7. Bereits umgesetzt (Grundgerüst)

Im Projekt sind angelegt:

- **`frontend/src/i18n/index.js`** – Initialisierung mit Sprachdetektion, Fallback `de`, Sprachen `de` und `en`.
- **`frontend/src/i18n/locales/de.json`** und **`en.json`** – alle oben genannten Schlüssel mit deutschen bzw. englischen Texten.
- **`main.jsx`** – importiert `./i18n` vor der App.

**Pakete** (bitte installieren):  
`npm install i18next react-i18next i18next-browser-languagedetector`

**Nächster Schritt:** In `App.jsx` `useTranslation()` nutzen und alle fest eingetragenen Texte durch `t('app.title')`, `t('controls.country')` usw. ersetzen; optional einen Sprachumschalter (DE | EN) im Header einbauen, der `i18n.changeLanguage('de')` / `'en'` aufruft.
