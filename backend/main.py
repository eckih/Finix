"""
FastAPI-Backend für Finanzdaten: API für History (SQLite) und Live-Abfrage.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

# Projektroot (über backend/) für Imports
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Optional: FRED_API_KEY aus .env laden (z. B. wenn Backend aus IDE gestartet wird)
try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

# Logging mit Rotation und Level (data/finix.log)
from backend import log_config
log_config.setup_logging(ROOT / "data")
log = log_config.get_logger(__name__)

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from starlette.requests import Request

app = FastAPI(
    title="Finix API",
    description="Abfrage und Verlauf von Staatsfinanz-Daten (USA, DE, AT, CA, MX, CH)",
    version="1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Alle Nutzer-Anfragen (Methode, Pfad, Query) und Antwort-Status ins Log."""
    query = request.scope.get("query_string", b"").decode("utf-8")
    path = request.scope.get("path", "")
    method = request.method
    log.info("Eingabe: %s %s%s", method, path, ("?" + query) if query else "")
    response = await call_next(request)
    log.info("Antwort: %s %s → Status %d", method, path, response.status_code)
    return response


@app.on_event("startup")
def startup():
    log.info("Finix API gestartet (data/finix.log)")

# Länder für Frontend: mehrsprachige Anzeigenamen (id bleibt immer gleich)
COUNTRIES_I18N = {
    "de": [
        {"id": "us", "name": "USA (TGA)"},
        {"id": "de", "name": "Deutschland"},
        {"id": "at", "name": "Österreich"},
        {"id": "ca", "name": "Kanada"},
        {"id": "mx", "name": "Mexiko"},
        {"id": "ch", "name": "Schweiz"},
    ],
    "en": [
        {"id": "us", "name": "USA (TGA)"},
        {"id": "de", "name": "Germany"},
        {"id": "at", "name": "Austria"},
        {"id": "ca", "name": "Canada"},
        {"id": "mx", "name": "Mexico"},
        {"id": "ch", "name": "Switzerland"},
    ],
}
SUPPORTED_LANGS = ("de", "en")
DEFAULT_LANG = "de"


def _get_countries(lang: str | None) -> list:
    """Länderliste für Sprache lang (de/en). Fallback: de."""
    if lang and lang.lower() in SUPPORTED_LANGS:
        return COUNTRIES_I18N[lang.lower()]
    return COUNTRIES_I18N[DEFAULT_LANG]


def _get_app_version() -> str:
    """Aktuelle App-Version aus VERSION-Datei oder Fallback."""
    version_file = ROOT / "VERSION"
    if version_file.exists():
        try:
            return version_file.read_text(encoding="utf-8").strip() or "1.0.0"
        except Exception:
            pass
    return "1.0.0"


@app.get("/api/version")
def get_version():
    """Aktuelle Version (für Update-Check)."""
    v = _get_app_version()
    log.info("App: Version abgefragt → %s", v)
    return {"version": v}


@app.get("/api/countries")
def get_countries(
    lang: str | None = Query(None, description="Sprache für Ländernamen: de, en"),
):
    """Liste der unterstützten Länder. Optional ?lang=en für englische Namen."""
    countries = _get_countries(lang)
    log.info("App: Länderliste geliefert (lang=%s), %d Länder", lang or "default", len(countries))
    return {"countries": countries}


@app.get("/api/history")
def get_history(
    country: str | None = Query(None, description="Ländercode (us, de, at, markets, …)"),
    limit: int = Query(100, ge=1, le=10000),
    min_date: str | None = Query(None, description="Optional: nur Einträge mit date >= min_date (z. B. 2020-01-01)"),
):
    """Gespeicherte Verlaufsdaten aus SQLite. Bei USA: pro (Datum, Indikator) nur neuester Eintrag."""
    import persist
    log.info("App: Lade History country=%s limit=%s min_date=%s", country, limit, min_date)
    is_us = country and country.lower() == "us"
    is_markets = country and country.lower() == "markets"
    if is_us and min_date is None:
        min_date = "2020-01-01"
    fetch_limit = min(limit * 100, 15000) if is_us else limit
    records = persist.load_history(
        country=country,
        limit=fetch_limit,
        min_date=min_date,
        newest_first=is_markets,
    )
    if country and country.lower() == "us" and records:
        seen = {}
        for r in records:
            key = (r.get("date") or "", r.get("label") or "")
            if key not in seen or (r.get("fetched_at") or "") > (seen[key].get("fetched_at") or ""):
                seen[key] = r
        records = sorted(seen.values(), key=lambda x: (x.get("date") or "", x.get("label") or ""))
    log.info("App: History geliefert, %d Einträge", len(records))
    return {"data": records, "count": len(records)}


@app.post("/api/fetch/{country}")
def fetch_country(country: str):
    """Live-Abfrage für ein Land ausführen und in DB speichern."""
    country = country.lower()
    log.info("App: Live-Abfrage gestartet country=%s", country)
    if country not in [c["id"] for c in COUNTRIES_I18N[DEFAULT_LANG]]:
        log.warning("App: Unbekanntes Land angefordert: %s", country)
        raise HTTPException(status_code=404, detail=f"Unbekanntes Land: {country}")
    import USA_Kontostand as api
    import persist
    getters = {
        "us": api.get_us_account_balance_pro,
        "de": api.get_de_account_balance,
        "at": api.get_at_account_balance,
        "ca": api.get_ca_account_balance,
        "mx": api.get_mx_account_balance,
        "ch": api.get_ch_account_balance,
    }
    fn = getters[country]
    result = fn()
    if result is None or not isinstance(result, dict):
        log.warning("Abfrage lieferte keine Daten: country=%s", country)
        raise HTTPException(status_code=502, detail="Abfrage lieferte keine Daten")
    extra = {k: v for k, v in result.items() if k not in ("country", "date", "value", "unit", "label")}
    persist.save_record(
        country=result.get("country", ""),
        date=result.get("date", ""),
        value=result.get("value", 0),
        unit=result.get("unit", ""),
        label=result.get("label", ""),
        **extra,
    )
    # USA: WDTGAL, RRPONTSYD, WRESBAL, SOFR, EFFR als eigene Zeitreihen speichern (für Chart)
    if result.get("country") == "us":
        if result.get("fred_wdtgal_date") is not None and result.get("fred_wdtgal_value_mio") is not None:
            persist.save_record(
                country="us",
                date=result["fred_wdtgal_date"],
                value=result["fred_wdtgal_value_mio"] / 1000.0,
                unit="Mrd. USD",
                label="WDTGAL (TGA Wed)",
            )
        if result.get("fred_rrpontsyd_date") is not None and result.get("fred_rrpontsyd_value_mrd") is not None:
            persist.save_record(
                country="us",
                date=result["fred_rrpontsyd_date"],
                value=result["fred_rrpontsyd_value_mrd"],
                unit="Mrd. USD",
                label="RRPONTSYD (Overnight RRP)",
            )
        if result.get("fred_wresbal_date") is not None and result.get("fred_wresbal_value_mio") is not None:
            persist.save_record(
                country="us",
                date=result["fred_wresbal_date"],
                value=result["fred_wresbal_value_mio"] / 1000.0,
                unit="Mrd. USD",
                label="WRESBAL (Reserve Balances)",
            )
        if result.get("fred_sofr_date") is not None and result.get("fred_sofr_value") is not None:
            persist.save_record(
                country="us",
                date=result["fred_sofr_date"],
                value=result["fred_sofr_value"],
                unit="%",
                label="SOFR",
            )
        if result.get("fred_effr_date") is not None and result.get("fred_effr_value") is not None:
            persist.save_record(
                country="us",
                date=result["fred_effr_date"],
                value=result["fred_effr_value"],
                unit="%",
                label="EFFR",
            )
    log.info("Fetch gespeichert: country=%s date=%s", result.get("country"), result.get("date"))
    return {"ok": True, "record": result}


def _save_records(records):
    """Hilfsfunktion: Liste von Records in DB speichern (nur neue; für Executor). Gibt Anzahl neu gespeicherter zurück."""
    import persist
    n = 0
    for r in records:
        if persist.save_record(
            country=r["country"],
            date=r["date"],
            value=r["value"],
            unit=r["unit"],
            label=r["label"],
        ):
            n += 1
    return n


async def _stream_us_history_events(limit: int, start_date: str):
    """Async-Generator: NDJSON-Zeilen mit Fortschritt (progress) und abschließend done."""
    from datetime import datetime
    import USA_Kontostand as api
    loop = asyncio.get_event_loop()

    def _line(obj):
        obj = {**obj, "ts": datetime.now().strftime("%H:%M:%S")}
        return json.dumps(obj, ensure_ascii=False) + "\n"

    yield _line({"type": "progress", "message": "US-Historie wird geladen (Treasury + FRED)."})
    try:
        records = await loop.run_in_executor(
            None,
            lambda: api.get_us_historical(limit_treasury=limit, limit_fred=limit, start_date=start_date),
        )
    except Exception as e:
        log.exception("get_us_historical failed")
        yield _line({"type": "error", "message": str(e)})
        return
    if not records:
        yield _line({"type": "error", "message": "Keine historischen US-Daten erhalten (evtl. FRED_API_KEY setzen)."})
        return

    CHUNK_SIZE = 500
    total_saved_us = 0
    by_label = {}
    for r in records:
        lbl = r.get("label") or "(ohne Label)"
        by_label[lbl] = by_label.get(lbl, 0) + 1
    for i in range(0, len(records), CHUNK_SIZE):
        chunk = records[i : i + CHUNK_SIZE]
        saved = await loop.run_in_executor(None, lambda c=chunk: _save_records(c))
        total_saved_us += saved
        done = min(i + CHUNK_SIZE, len(records))
        yield _line({
            "type": "progress",
            "message": f"US-Daten: {done}/{len(records)} verarbeitet, {total_saved_us} neue gespeichert.",
        })
    yield _line({"type": "progress", "message": f"US-Daten fertig: {total_saved_us} neue, {len(records) - total_saved_us} bereits in DB."})

    yield _line({"type": "progress", "message": "Kurse (S&P 500, DJIA, NASDAQ, BTC, ETH, LTC) werden geladen."})
    try:
        markets_records = await loop.run_in_executor(
            None,
            lambda: api.get_markets_historical(limit_fred=limit, start_date=start_date),
        )
    except Exception as e:
        log.exception("get_markets_historical failed")
        yield _line({"type": "progress", "message": f"Kurse fehlgeschlagen: {e}"})
        markets_records = []
    saved_markets = 0
    if markets_records:
        for r in markets_records:
            lbl = r.get("label") or "(ohne Label)"
            by_label[lbl] = by_label.get(lbl, 0) + 1
        for i in range(0, len(markets_records), CHUNK_SIZE):
            chunk = markets_records[i : i + CHUNK_SIZE]
            saved = await loop.run_in_executor(None, lambda c=chunk: _save_records(c))
            saved_markets += saved
            done = min(i + CHUNK_SIZE, len(markets_records))
            yield _line({
                "type": "progress",
                "message": f"Kurse: {done}/{len(markets_records)} verarbeitet, {saved_markets} neue gespeichert.",
            })
        yield _line({"type": "progress", "message": f"Kurse fertig: {saved_markets} neue, {len(markets_records) - saved_markets} bereits in DB."})

    total_saved = total_saved_us + saved_markets
    log.info("Historie: %d neue US + %d neue Kurse gespeichert (übersprungen: bereits in DB)", total_saved_us, saved_markets)
    yield _line({
        "type": "done",
        "ok": True,
        "saved": total_saved,
        "by_label": by_label,
        "message": f"{total_saved} neue Einträge gespeichert (bereits vorhandene übersprungen).",
    })


@app.post("/api/fetch/us/history/stream")
async def fetch_us_history_stream(
    limit: int = Query(100, ge=10, le=500, description="Anzahl historischer Einträge pro Reihe"),
    start_date: str = Query("2020-01-01", description="Ab diesem Datum (YYYY-MM-DD)"),
):
    """Historische USA- und Kurse-Daten laden; Antwort ist NDJSON-Stream mit type=progress|done|error."""
    log.info("App: Historie laden (Stream) gestartet limit=%s start_date=%s", limit, start_date)
    return StreamingResponse(
        _stream_us_history_events(limit, start_date),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/fetch/us/history")
def fetch_us_history(
    limit: int = Query(100, ge=10, le=500, description="Anzahl historischer Einträge pro Reihe"),
    start_date: str = Query("2020-01-01", description="Ab diesem Datum (YYYY-MM-DD), z. B. 2020-01-01"),
):
    """Historische Daten für TGA, WDTGAL, RRPONTSYD, WRESBAL, SOFR, EFFR sowie S&P 500 und BTC (Kurse) abrufen und speichern."""
    log.info("App: Historie laden (USA+Kurse) gestartet limit=%s start_date=%s", limit, start_date)
    import USA_Kontostand as api
    import persist
    records = api.get_us_historical(limit_treasury=limit, limit_fred=limit, start_date=start_date)
    if not records:
        log.warning("Keine historischen US-Daten erhalten (evtl. FRED_API_KEY setzen)")
        raise HTTPException(status_code=502, detail="Keine historischen Daten erhalten (evtl. FRED_API_KEY setzen)")
    by_label = {}
    saved_us = 0
    for r in records:
        lbl = r.get("label") or "(ohne Label)"
        by_label[lbl] = by_label.get(lbl, 0) + 1
        if persist.save_record(
            country=r["country"],
            date=r["date"],
            value=r["value"],
            unit=r["unit"],
            label=r["label"],
        ):
            saved_us += 1
    # Zusätzlich: Kurse (S&P 500, BTC) für Menüpunkt „Kurse“
    markets_records = api.get_markets_historical(limit_fred=limit, start_date=start_date)
    saved_markets = 0
    for r in markets_records:
        lbl = r.get("label") or "(ohne Label)"
        by_label[lbl] = by_label.get(lbl, 0) + 1
        if persist.save_record(
            country=r["country"],
            date=r["date"],
            value=r["value"],
            unit=r["unit"],
            label=r["label"],
        ):
            saved_markets += 1
    total_saved = saved_us + saved_markets
    log.info("Historie: %d neue US + %d neue Kurse gespeichert", saved_us, saved_markets)
    return {
        "ok": True,
        "saved": total_saved,
        "by_label": by_label,
        "message": f"{total_saved} neue Einträge gespeichert (bereits vorhandene übersprungen).",
    }


@app.get("/api/latest")
def get_latest(country: str | None = Query(None)):
    """Neuesten Eintrag pro Land (oder für ein Land)."""
    import persist
    log.info("App: Neueste Einträge abgefragt country=%s", country)
    records = persist.load_history(country=country, limit=1)
    log.info("App: Neueste Einträge geliefert, %d Treffer", len(records))
    return {"data": records}


@app.get("/api/stats")
def get_stats():
    """Zusammenfassung der Datenbank: Größe, Anzahl Einträge, Verteilung nach Land/Label, Datumsbereich."""
    import persist
    log.info("App: Statistik abgefragt")
    return persist.get_db_stats()
