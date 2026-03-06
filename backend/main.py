"""
FastAPI-Backend für Finanzdaten: API für History (SQLite) und Live-Abfrage.
"""
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

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware

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
    return {"version": _get_app_version()}


@app.get("/api/countries")
def get_countries(
    lang: str | None = Query(None, description="Sprache für Ländernamen: de, en"),
):
    """Liste der unterstützten Länder. Optional ?lang=en für englische Namen."""
    countries = _get_countries(lang)
    return {"countries": countries}


@app.get("/api/history")
def get_history(
    country: str | None = Query(None, description="Ländercode (us, de, at, …)"),
    limit: int = Query(100, ge=1, le=500),
    min_date: str | None = Query(None, description="Optional: nur Einträge mit date >= min_date (z. B. 2020-01-01)"),
):
    """Gespeicherte Verlaufsdaten aus SQLite. Bei USA: pro (Datum, Indikator) nur neuester Eintrag."""
    import persist
    is_us = country and country.lower() == "us"
    if is_us and min_date is None:
        min_date = "2020-01-01"
    fetch_limit = min(limit * 100, 15000) if is_us else limit
    records = persist.load_history(country=country, limit=fetch_limit, min_date=min_date)
    if country and country.lower() == "us" and records:
        seen = {}
        for r in records:
            key = (r.get("date") or "", r.get("label") or "")
            if key not in seen or (r.get("fetched_at") or "") > (seen[key].get("fetched_at") or ""):
                seen[key] = r
        records = sorted(seen.values(), key=lambda x: (x.get("date") or "", x.get("label") or ""))
    return {"data": records, "count": len(records)}


@app.post("/api/fetch/{country}")
def fetch_country(country: str):
    """Live-Abfrage für ein Land ausführen und in DB speichern."""
    country = country.lower()
    if country not in [c["id"] for c in COUNTRIES_I18N[DEFAULT_LANG]]:
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
    # USA: WDTGAL, RRPONTSYD und WRESBAL als eigene Zeitreihen speichern (für Chart)
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
    return {"ok": True, "record": result}


@app.post("/api/fetch/us/history")
def fetch_us_history(
    limit: int = Query(100, ge=10, le=500, description="Anzahl historischer Einträge pro Reihe"),
    start_date: str = Query("2020-01-01", description="Ab diesem Datum (YYYY-MM-DD), z. B. 2020-01-01"),
):
    """Historische Daten für TGA, WDTGAL, RRPONTSYD und WRESBAL abrufen und in der DB speichern (ab start_date)."""
    import USA_Kontostand as api
    import persist
    records = api.get_us_historical(limit_treasury=limit, limit_fred=limit, start_date=start_date)
    if not records:
        raise HTTPException(status_code=502, detail="Keine historischen Daten erhalten (evtl. FRED_API_KEY setzen)")
    by_label = {}
    for r in records:
        lbl = r.get("label") or "(ohne Label)"
        by_label[lbl] = by_label.get(lbl, 0) + 1
        persist.save_record(
            country=r["country"],
            date=r["date"],
            value=r["value"],
            unit=r["unit"],
            label=r["label"],
        )
    return {
        "ok": True,
        "saved": len(records),
        "by_label": by_label,
        "message": f"{len(records)} historische Einträge gespeichert.",
    }


@app.get("/api/latest")
def get_latest(country: str | None = Query(None)):
    """Neuesten Eintrag pro Land (oder für ein Land)."""
    import persist
    records = persist.load_history(country=country, limit=1)
    return {"data": records}
