"""
FastAPI-Backend für Finanzdaten: API für History (SQLite) und Live-Abfrage.
"""
import asyncio
import json
import os
import sys
import threading
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

from fastapi import FastAPI, Query, HTTPException, WebSocket, WebSocketDisconnect
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


LM_STUDIO_URL = (os.environ.get("LM_STUDIO_URL") or "http://localhost:1234").strip().rstrip("/")
LM_STUDIO_MODEL = (os.environ.get("LM_STUDIO_MODEL") or "google/gemma-3-4b").strip()
LM_STUDIO_API_KEY = (os.environ.get("LM_STUDIO_API_KEY") or "").strip() or None

GEMINI_API_KEY = (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or "").strip() or None
GEMINI_MODELS = ("gemini-2.5-flash", "gemini-2.5-pro")

ANTHROPIC_API_KEY = (os.environ.get("ANTHROPIC_API_KEY") or "").strip() or None
SONNET_MODEL_ID = "claude-sonnet-4-6"


def _is_gemini_model(model: str | None) -> bool:
    return bool(model and (model.strip().lower() in GEMINI_MODELS))


def _ask_gemini(question: str, title: str = "", summary: str = "", model_override: str | None = None) -> tuple[str | None, str | None]:
    """Stellt die Frage an die Google Gemini API (z. B. Gemini 2.5 Flash/Pro). Returns (answer, error)."""
    import requests
    if not GEMINI_API_KEY:
        return None, "GEMINI_API_KEY nicht gesetzt"
    model = (model_override or "").strip().lower()
    if model not in GEMINI_MODELS:
        model = GEMINI_MODELS[0]
    context_str = "\n".join([f"Titel: {title}", f"Zusammenfassung: {summary}"]) if (title or summary) else "(kein Kontext)"
    user_content = f"{context_str}\n\nFrage: {question}" if (title or summary) else question
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"
    payload = {
        "contents": [{"parts": [{"text": user_content}]}],
        "generationConfig": {"maxOutputTokens": 8192, "temperature": 0.3},
    }
    try:
        r = requests.post(url, json=payload, timeout=120)
        r.encoding = "utf-8"
        data = r.json()
        if not r.ok:
            err = (data.get("error") or {}).get("message") or data.get("message") or r.text or str(r.status_code)
            return None, err
        candidates = (data.get("candidates") or [None])[0]
        if not candidates:
            return None, "Keine Antwort vom Modell"
        parts = (candidates.get("content") or {}).get("parts") or []
        text = "".join((p.get("text") or "") for p in parts).strip()
        return (text or None), None
    except requests.exceptions.ConnectionError:
        return None, "Gemini API nicht erreichbar"
    except requests.exceptions.Timeout:
        return None, "Zeitüberschreitung"
    except Exception as e:
        log.exception("Gemini Anfrage fehlgeschlagen")
        return None, str(e)


def _check_gemini(model: str | None) -> tuple[bool, str]:
    """Prüft, ob Gemini mit dem angegebenen Modell antwortet."""
    ans, err = _ask_gemini("Antworte nur mit: OK", model_override=model)
    if err:
        return False, err
    return True, "Gemini erreichbar"


def _is_sonnet_model(model: str | None) -> bool:
    return bool(model and model.strip().lower() == SONNET_MODEL_ID.lower())


def _ask_anthropic(question: str, title: str = "", summary: str = "", model_override: str | None = None) -> tuple[str | None, str | None]:
    """Stellt die Frage an die Anthropic API (Claude Sonnet 4.6). Returns (answer, error)."""
    import requests
    if not ANTHROPIC_API_KEY:
        return None, "ANTHROPIC_API_KEY nicht gesetzt"
    model = (model_override or "").strip() or SONNET_MODEL_ID
    if model.lower() != SONNET_MODEL_ID.lower():
        model = SONNET_MODEL_ID
    context_str = "\n".join([f"Titel: {title}", f"Zusammenfassung: {summary}"]) if (title or summary) else "(kein Kontext)"
    user_content = f"{context_str}\n\nFrage: {question}" if (title or summary) else question
    url = "https://api.anthropic.com/v1/messages"
    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    payload = {
        "model": model,
        "max_tokens": 8192,
        "messages": [{"role": "user", "content": user_content}],
    }
    try:
        r = requests.post(url, json=payload, headers=headers, timeout=120)
        r.encoding = "utf-8"
        data = r.json()
        if not r.ok:
            err = (data.get("error") or {}).get("message") or data.get("message") or r.text or str(r.status_code)
            return None, err
        content_blocks = data.get("content") or []
        text = "".join((b.get("text") or "") for b in content_blocks if b.get("type") == "text").strip()
        return (text or None), None
    except requests.exceptions.ConnectionError:
        return None, "Anthropic API nicht erreichbar"
    except requests.exceptions.Timeout:
        return None, "Zeitüberschreitung"
    except Exception as e:
        log.exception("Anthropic Anfrage fehlgeschlagen")
        return None, str(e)


def _check_anthropic(model: str | None) -> tuple[bool, str]:
    """Prüft, ob Anthropic Sonnet 4.6 erreichbar ist."""
    ans, err = _ask_anthropic("Antworte nur mit: OK", model_override=model)
    if err:
        return False, err
    return True, "Sonnet 4.6 erreichbar"


def _lm_studio_chat_url() -> str:
    """Basis-URL mit /v1 → nur /chat/completions anhängen; sonst /v1/chat/completions (OpenClaw-kompatibel)."""
    if LM_STUDIO_URL.endswith("/v1"):
        return f"{LM_STUDIO_URL}/chat/completions"
    return f"{LM_STUDIO_URL}/v1/chat/completions"


def _lm_studio_models_url() -> str:
    """URL für GET /v1/models (Liste der geladenen Modelle)."""
    if LM_STUDIO_URL.endswith("/v1"):
        return f"{LM_STUDIO_URL}/models"
    return f"{LM_STUDIO_URL}/v1/models"


def _lm_studio_headers() -> dict:
    """Optional Authorization Header, wenn LM_STUDIO_API_KEY gesetzt (z. B. lm-studio)."""
    if LM_STUDIO_API_KEY:
        return {"Authorization": f"Bearer {LM_STUDIO_API_KEY}"}
    return {}


def _get_lm_studio_models() -> tuple[list[dict], str | None]:
    """Holt die Liste der in LM Studio geladenen Modelle (OpenAI-kompatibel GET /v1/models). Returns (models, error)."""
    import requests
    try:
        r = requests.get(
            _lm_studio_models_url(),
            headers=_lm_studio_headers(),
            timeout=15,
        )
        r.raise_for_status()
        r.encoding = "utf-8"
        data = r.json()
        raw = data.get("data") if isinstance(data, dict) else None
        if not isinstance(raw, list):
            return [], "Keine Modellliste erhalten"
        models = []
        for m in raw:
            if isinstance(m, dict) and m.get("id"):
                models.append({"id": m["id"], "object": m.get("object", "model")})
            elif isinstance(m, dict):
                models.append({"id": str(m.get("id", "")), "object": "model"})
        return models, None
    except requests.exceptions.ConnectionError:
        return [], "LM Studio nicht erreichbar"
    except requests.exceptions.Timeout:
        return [], "Zeitüberschreitung"
    except Exception as e:
        log.exception("LM Studio Modelle abrufen fehlgeschlagen")
        return [], str(e)


def _check_lm_studio(model_override: str | None = None) -> tuple[bool, str]:
    """Prüft, ob LM Studio erreichbar ist und das Modell antwortet. model_override: optionales Modell für diesen Aufruf."""
    import requests
    model = (model_override or "").strip() or LM_STUDIO_MODEL
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Antworte nur mit: OK"}],
        "max_tokens": 10,
        "temperature": 0,
    }
    try:
        r = requests.post(
            _lm_studio_chat_url(),
            json=payload,
            headers=_lm_studio_headers(),
            timeout=90,
        )
        r.raise_for_status()
        r.encoding = "utf-8"
        data = r.json()
        choice = (data.get("choices") or [None])[0]
        if choice and (choice.get("message") or {}).get("content"):
            return True, "Lokales Modell erreichbar"
        return False, "Modell hat keine Antwort geliefert"
    except requests.exceptions.ConnectionError:
        return False, "LM Studio nicht erreichbar (Server unter %s starten?)" % LM_STUDIO_URL
    except requests.exceptions.Timeout:
        return False, "Zeitüberschreitung (90 s)"
    except Exception as e:
        log.exception("LM Studio Test fehlgeschlagen")
        return False, str(e)


def _ask_lm_studio(question: str, title: str = "", summary: str = "", model_override: str | None = None) -> tuple[str | None, str | None]:
    """Stellt die Frage an LM Studio (OpenAI-kompatibel). model_override: optionales Modell für diesen Aufruf."""
    import requests
    model = (model_override or "").strip() or LM_STUDIO_MODEL
    context = []
    if title:
        context.append(f"Titel: {title}")
    if summary:
        context.append(f"Zusammenfassung: {summary}")
    context_str = "\n".join(context) if context else "(kein Kontext)"
    user_content = f"{context_str}\n\nFrage: {question}"
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": user_content}],
        "max_tokens": 512,
        "temperature": 0.3,
    }
    try:
        r = requests.post(
            _lm_studio_chat_url(),
            json=payload,
            headers=_lm_studio_headers(),
            timeout=300,
        )
        r.raise_for_status()
        r.encoding = "utf-8"
        data = r.json()
        choice = (data.get("choices") or [None])[0]
        if not choice:
            return None, "Keine Antwort vom Modell"
        text = (choice.get("message") or {}).get("content") or ""
        return (text.strip() or None), None
    except requests.exceptions.ConnectionError:
        return None, "LM Studio nicht erreichbar (Server starten? Bei Docker: LM_STUDIO_URL=http://host.docker.internal:1234)"
    except requests.exceptions.Timeout:
        return None, "Zeitüberschreitung (5 Min.)"
    except Exception as e:
        log.exception("LM Studio Anfrage fehlgeschlagen")
        return None, str(e)


from pydantic import BaseModel


class AIAskBody(BaseModel):
    question: str
    title: str = ""
    summary: str = ""
    model: str | None = None
    stream: bool = False


def _stream_lm_studio_ask(question: str, title: str, summary: str, model_override: str | None):
    """
    Generator: ruft LM Studio mit stream=True auf, liefert NDJSON-Zeilen
    mit type=reasoning|message und content; am Ende type=done mit answer.
    """
    import requests
    model = (model_override or "").strip() or LM_STUDIO_MODEL
    context_str = "\n".join([f"Titel: {title}", f"Zusammenfassung: {summary}"]) if (title or summary) else "(kein Kontext)"
    user_content = f"{context_str}\n\nFrage: {question}" if context_str != "(kein Kontext)" else question
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": user_content}],
        "max_tokens": 512,
        "temperature": 0.3,
        "stream": True,
    }
    full_answer = []
    try:
        r = requests.post(
            _lm_studio_chat_url(),
            json=payload,
            headers={**_lm_studio_headers(), "Accept": "text/event-stream"},
            timeout=300,
            stream=True,
        )
        r.raise_for_status()
        r.encoding = "utf-8"
        for line in r.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data: "):
                continue
            data_str = line[6:].strip()
            if data_str == "[DONE]":
                break
            try:
                data = json.loads(data_str)
            except json.JSONDecodeError:
                continue
            choice = (data.get("choices") or [None])[0]
            if not choice:
                continue
            delta = choice.get("delta") or {}
            reasoning = (delta.get("reasoning_content") or "").strip()
            if reasoning:
                yield json.dumps({"type": "reasoning", "content": reasoning}, ensure_ascii=False) + "\n"
            content = (delta.get("content") or "").strip()
            if content:
                full_answer.append(content)
                yield json.dumps({"type": "message", "content": content}, ensure_ascii=False) + "\n"
        answer = "".join(full_answer).strip() if full_answer else ""
    except requests.exceptions.ConnectionError:
        yield json.dumps({"type": "error", "message": "LM Studio nicht erreichbar"}, ensure_ascii=False) + "\n"
        return
    except requests.exceptions.Timeout:
        yield json.dumps({"type": "error", "message": "Zeitüberschreitung (5 Min.)"}, ensure_ascii=False) + "\n"
        return
    except Exception as e:
        log.exception("LM Studio Stream fehlgeschlagen")
        yield json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False) + "\n"
        return
    yield json.dumps({"type": "done", "answer": answer}, ensure_ascii=False) + "\n"


@app.get("/api/ai/models")
async def get_ai_models():
    """Listet Gemini, Sonnet 4.6 (wenn Keys gesetzt) und LM-Studio-Modelle."""
    log.info("App: AI-Modelle abfragen")
    gemini_list = [{"id": m, "object": "model"} for m in GEMINI_MODELS] if GEMINI_API_KEY else []
    sonnet_list = [{"id": SONNET_MODEL_ID, "object": "model"}] if ANTHROPIC_API_KEY else []
    lm_models, err = await asyncio.to_thread(_get_lm_studio_models)
    if err:
        lm_models = []
    return {"models": gemini_list + sonnet_list + lm_models}


@app.get("/api/ai/test")
async def get_ai_test(model: str | None = Query(None, description="Modell-ID für diesen Test")):
    """Prüft, ob das gewählte Modell (Gemini, Sonnet oder LM Studio) erreichbar ist."""
    log.info("App: AI-Test model=%s", model or "(default)")
    if _is_gemini_model(model):
        ok, message = await asyncio.to_thread(_check_gemini, model)
    elif _is_sonnet_model(model):
        ok, message = await asyncio.to_thread(_check_anthropic, model)
    else:
        ok, message = await asyncio.to_thread(_check_lm_studio, model)
    return {"ok": ok, "message": message}


@app.post("/api/ai/ask")
async def post_ai_ask(body: AIAskBody):
    """Stellt eine Frage an das gewählte Modell (Gemini, Sonnet oder LM Studio). Bei LM Studio und stream=true: NDJSON-Stream."""
    log.info("App: AI-Anfrage question=%s model=%s stream=%s", (body.question or "")[:80], body.model or "(default)", body.stream)
    if _is_gemini_model(body.model):
        answer, err = await asyncio.to_thread(
            _ask_gemini, body.question, body.title or "", body.summary or "", body.model
        )
        if err:
            raise HTTPException(status_code=502, detail=err)
        return {"answer": answer or ""}
    if _is_sonnet_model(body.model):
        answer, err = await asyncio.to_thread(
            _ask_anthropic, body.question, body.title or "", body.summary or "", body.model
        )
        if err:
            raise HTTPException(status_code=502, detail=err)
        return {"answer": answer or ""}
    if body.stream:
        def gen():
            for line in _stream_lm_studio_ask(
                body.question or "",
                body.title or "",
                body.summary or "",
                body.model,
            ):
                yield line
        return StreamingResponse(
            gen(),
            media_type="application/x-ndjson",
            headers={"Cache-Control": "no-store"},
        )
    answer, err = await asyncio.to_thread(
        _ask_lm_studio, body.question, body.title or "", body.summary or "", body.model
    )
    if err:
        raise HTTPException(status_code=502, detail=err)
    return {"answer": answer or ""}


NEWS_CACHE_SEC = 300  # 5 Min. – API nur alle 5 Min. pro Symbol aufrufen
_news_fetch_locks = {}  # symbol -> threading.Lock (kein doppelter API-Call pro Symbol)


def _fetch_alpha_vantage_news(symbol: str | None, limit: int = 15):
    """Holt die neuesten News von Alpha Vantage (NEWS_SENTIMENT). Mit Symbol gefiltert; ohne Symbol Fallback AAPL."""
    import requests
    key = os.environ.get("ALPHA_VANTAGE_KEY", "").strip()
    if not key:
        return [], "ALPHA_VANTAGE_KEY nicht gesetzt"
    url = "https://www.alphavantage.co/query"
    params = {
        "function": "NEWS_SENTIMENT",
        "apikey": key,
        "limit": min(max(1, limit), 50),
        "sort": "LATEST",
    }
    ticker = (symbol or "").strip().upper() if symbol else ""
    params["tickers"] = ticker if ticker else "AAPL"
    try:
        r = requests.get(url, params=params, timeout=15)
        r.raise_for_status()
        data = r.json()
        if isinstance(data.get("Information"), str):
            return [], data["Information"]
        if isinstance(data.get("Note"), str):
            return [], data["Note"]
        if isinstance(data.get("Error Message"), str):
            return [], data["Error Message"]
        feed = data.get("feed")
        if not isinstance(feed, list):
            feed = []
        if not feed:
            log.warning("Alpha Vantage: leerer Feed. keys=%s", list(data.keys()))
        else:
            log.info("Alpha Vantage: %d News geladen (tickers=%s)", len(feed), params.get("tickers"))
        return feed, None
    except Exception as e:
        log.exception("Alpha Vantage News fehlgeschlagen")
        return [], str(e)


def _news_storage_key(symbol: str | None) -> str:
    """Symbol für DB-Speicherung: leer = '' (Fallback-Abruf mit AAPL)."""
    return (symbol or "").strip().upper() or ""


def _news_api_ticker(symbol: str | None) -> str:
    """Ticker für Alpha-Vantage-Request: leer = AAPL."""
    s = (symbol or "").strip().upper()
    return s if s else "AAPL"


def _get_news_feed_sync(symbol: str | None, limit: int = 15, force_refresh: bool = False):
    """
    News aus DB liefern; nur bei Bedarf API aufrufen (max. 1x pro NEWS_CACHE_SEC pro Symbol).
    Returns (feed_list, error_string or None).
    """
    import persist
    from datetime import datetime, timezone
    storage_key = _news_storage_key(symbol)
    now = datetime.now(timezone.utc)
    if not force_refresh:
        last = persist.get_news_last_fetched(storage_key)
        if last:
            try:
                dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
                if (now - dt).total_seconds() < NEWS_CACHE_SEC:
                    feed = persist.load_news_from_db(storage_key, limit)
                    if feed:
                        log.info("News aus DB (symbol=%s, %d Einträge)", storage_key or "(Fallback)", len(feed))
                        return feed, None
            except Exception:
                pass
    key = storage_key or "__default__"
    if key not in _news_fetch_locks:
        _news_fetch_locks[key] = threading.Lock()
    with _news_fetch_locks[key]:
        last = persist.get_news_last_fetched(storage_key)
        if not force_refresh and last:
            try:
                dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
                if (now - dt).total_seconds() < NEWS_CACHE_SEC:
                    feed = persist.load_news_from_db(storage_key, limit)
                    if feed:
                        return feed, None
            except Exception:
                pass
        feed, err = _fetch_alpha_vantage_news(symbol, limit)
        if err:
            cached = persist.load_news_from_db(storage_key, limit)
            if cached:
                log.info("API-Fehler, News aus DB ausgeliefert (symbol=%s)", storage_key or "(Fallback)")
                return cached, None
            return [], err
        persist.save_news_feed(storage_key, feed)
    return feed, None


@app.get("/api/news")
def get_news(
    symbol: str = Query("", description="Ticker-Symbol (z. B. TSLA, AAPL)"),
    limit: int = Query(15, ge=1, le=50, description="Anzahl der neuesten Meldungen"),
    refresh: bool = Query(False, description="True = API-Abruf erzwingen (Rate-Limit beachten)"),
):
    """News aus DB; bei Bedarf (alle 5 Min.) von Alpha Vantage nachladen. Keine doppelten API-Requests."""
    symbol_clean = (symbol or "").strip().upper() or None
    log.info("App: News abgefragt symbol=%s limit=%s refresh=%s", symbol_clean or "(ohne Filter)", limit, refresh)
    feed, err = _get_news_feed_sync(symbol_clean, limit=limit, force_refresh=refresh)
    if err:
        raise HTTPException(status_code=502, detail=err)
    return {"symbol": symbol_clean or "", "feed": feed}


NEWS_WS_REFRESH_SEC = 5 * 60  # 5 Minuten


async def _news_ws_sender(websocket: WebSocket, symbol: str | None):
    """Sendet News aus DB; nur alle 5 Min. einmal API-Abruf pro Symbol."""
    storage_key = _news_storage_key(symbol)
    try:
        while True:
            feed, err = await asyncio.to_thread(_get_news_feed_sync, symbol, 15, False)
            if err:
                await websocket.send_json({"type": "error", "message": err})
            else:
                await websocket.send_json({
                    "type": "feed",
                    "symbol": storage_key,
                    "feed": feed,
                })
            await asyncio.sleep(NEWS_WS_REFRESH_SEC)
    except Exception as e:
        log.debug("News-WebSocket sender beendet: %s", e)


@app.websocket("/api/news/ws")
async def news_websocket(websocket: WebSocket):
    """WebSocket für News: Verbindung offen halten, alle 5 Min. neueste News senden. Client kann Symbol per Query oder Nachricht senden."""
    await websocket.accept()
    qs = (websocket.scope.get("query_string") or b"").decode("utf-8")
    symbol = None
    if "symbol=" in qs:
        symbol = qs.split("symbol=", 1)[1].split("&")[0].strip().upper() or None
    log.info("News-WebSocket verbunden symbol=%s", symbol or "(ohne Filter)")
    sender = asyncio.create_task(_news_ws_sender(websocket, symbol))
    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=NEWS_WS_REFRESH_SEC + 30)
            except asyncio.TimeoutError:
                continue
            try:
                msg = json.loads(data)
                new_sym = (msg.get("symbol") or "").strip().upper() or None
                if new_sym != symbol:
                    symbol = new_sym
                    sender.cancel()
                    try:
                        await sender
                    except asyncio.CancelledError:
                        pass
                    sender = asyncio.create_task(_news_ws_sender(websocket, symbol))
                    log.info("News-WebSocket Symbol geändert: %s", symbol or "(ohne Filter)")
            except (json.JSONDecodeError, TypeError):
                pass
    except WebSocketDisconnect:
        pass
    finally:
        sender.cancel()
        try:
            await sender
        except asyncio.CancelledError:
            pass
    log.info("News-WebSocket getrennt")


def _translate_text(text: str, target_lang: str) -> str | None:
    """Übersetzt Text mit MyMemory (en↔de). Blockiert nicht den Event-Loop (synchrone HTTP-Call)."""
    if not (text or text.strip()):
        return text or ""
    import requests
    target = (target_lang or "de").lower()[:2]
    if target not in ("de", "en"):
        target = "de"
    # MyMemory: en|de oder de|en; News sind meist Englisch
    langpair = "en|de" if target == "de" else "de|en" if target == "en" else "en|de"
    # MyMemory Limit ~500 Zeichen pro Request
    q = (text or "").strip()[:500]
    if not q:
        return text
    try:
        r = requests.get(
            "https://api.mymemory.translated.net/get",
            params={"q": q, "langpair": langpair},
            timeout=8,
        )
        r.raise_for_status()
        data = r.json()
        out = (data.get("responseData") or {}).get("translatedText")
        if out and out.strip() and out.strip() != q.strip():
            return out
        if target == "de":
            return None
        return text
    except Exception as e:
        log.debug("Übersetzung fehlgeschlagen: %s", e)
        return None if target == "de" else text


@app.get("/api/translate")
def get_translate(
    text: str = Query(..., description="Zu übersetzender Text"),
    target: str = Query("de", description="Zielsprache: de oder en"),
):
    """Übersetzt kurzen Text in die Zielsprache (MyMemory). Für Tooltips, blockiert nicht den Ablauf."""
    if not text or not text.strip():
        return {"translated": ""}
    translated = _translate_text(text, target)
    if translated is None or (target == "de" and not translated.strip()):
        return {"translated": ""}
    return {"translated": translated or text}
