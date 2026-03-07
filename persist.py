"""
Persistenz der abgefragten Finanzdaten in SQLite3.

- save_record: speichert einen Datensatz in der Tabelle finance_records
- load_history: liest Datensätze (optional nach Land, mit Limit)
- export_csv: exportiert alle Einträge als CSV (z. B. für Excel)
"""
import csv
import json
import logging
import sqlite3
from datetime import datetime
from pathlib import Path

_log = logging.getLogger(__name__)

# Standardordner und Datenbankdatei
DATA_DIR = Path(__file__).resolve().parent / "data"
DB_PATH = DATA_DIR / "finance.db"


def _ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _get_conn():
    _ensure_data_dir()
    return sqlite3.connect(str(DB_PATH))


def init_db(db_path: str = None) -> str:
    """
    Tabelle finance_records anlegen (wird bei save_record automatisch aufgerufen).
    :return: verwendeter DB-Pfad
    """
    _ensure_data_dir()
    path = db_path or str(DB_PATH)
    conn = sqlite3.connect(path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS finance_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            country TEXT NOT NULL,
            date TEXT NOT NULL,
            value REAL NOT NULL,
            unit TEXT,
            label TEXT,
            fetched_at TEXT,
            extra TEXT
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_finance_country_date ON finance_records(country, date)"
    )
    conn.commit()
    conn.close()
    return path


def init_news_db(db_path: str = None) -> None:
    """Tabelle news und news_fetch anlegen (News von Alpha Vantage)."""
    _ensure_data_dir()
    path = db_path or str(DB_PATH)
    conn = sqlite3.connect(path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS news (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            time_published TEXT NOT NULL,
            title TEXT,
            summary TEXT,
            url TEXT,
            source TEXT,
            fetched_at TEXT NOT NULL,
            payload TEXT
        )
    """)
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_news_symbol_time_url ON news(symbol, time_published, COALESCE(url, ''))"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_news_symbol ON news(symbol)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS news_fetch (
            symbol TEXT PRIMARY KEY,
            last_fetched_at TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


def init_ai_questions_table(db_path: str = None) -> None:
    """Tabelle ai_preset_questions für konfigurierbare AI-Standardfragen (News-Dropdown)."""
    _ensure_data_dir()
    path = db_path or str(DB_PATH)
    conn = sqlite3.connect(path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ai_preset_questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            key TEXT NOT NULL UNIQUE,
            text_de TEXT NOT NULL,
            text_en TEXT NOT NULL
        )
    """)
    conn.commit()
    cur = conn.execute("SELECT COUNT(*) FROM ai_preset_questions")
    if cur.fetchone()[0] == 0:
        conn.executemany(
            "INSERT INTO ai_preset_questions (sort_order, key, text_de, text_en) VALUES (?, ?, ?, ?)",
            [
                (0, "stocks", "Welche Aktienkurse könnte diese Nachricht betreffen?", "Which stock prices could this message affect?"),
                (1, "btc", "Wirkt diese Nachricht bullish oder bearisch auf BTC?", "Does this message have a bullish or bearish effect on BTC?"),
            ],
        )
        conn.commit()
    conn.close()


def get_ai_preset_questions(lang: str = "de") -> list:
    """Liste der AI-Standardfragen in der gewünschten Sprache für das News-Dropdown. Jedes Element: { key, text }."""
    if not DB_PATH.exists():
        return []
    init_ai_questions_table()
    lang_key = (lang or "de").strip().lower()[:2]
    if lang_key not in ("de", "en"):
        lang_key = "de"
    col = "text_de" if lang_key == "de" else "text_en"
    conn = _get_conn()
    try:
        rows = conn.execute(
            f'SELECT key, {col} FROM ai_preset_questions ORDER BY sort_order ASC, id ASC'
        ).fetchall()
        return [{"key": r[0], "text": r[1] or ""} for r in rows]
    finally:
        conn.close()


def get_ai_preset_questions_all() -> list:
    """Alle AI-Standardfragen mit beiden Sprachen für die Konfigurationsseite. Jedes Element: { key, text_de, text_en, sort_order }."""
    if not DB_PATH.exists():
        return []
    init_ai_questions_table()
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT key, text_de, text_en, sort_order FROM ai_preset_questions ORDER BY sort_order ASC, id ASC"
        ).fetchall()
        return [{"key": r[0], "text_de": r[1] or "", "text_en": r[2] or "", "sort_order": r[3]} for r in rows]
    finally:
        conn.close()


def save_ai_preset_questions(questions: list) -> bool:
    """AI-Standardfragen speichern. questions: Liste von { key, text_de, text_en, sort_order? }. Bestehende werden ersetzt."""
    if not DB_PATH.exists():
        return False
    init_ai_questions_table()
    conn = _get_conn()
    try:
        conn.execute("DELETE FROM ai_preset_questions")
        for i, q in enumerate(questions):
            key = (q.get("key") or "").strip() or f"q{i}"
            text_de = (q.get("text_de") or "").strip() or ""
            text_en = (q.get("text_en") or "").strip() or ""
            sort_order = int(q.get("sort_order", i))
            conn.execute(
                "INSERT INTO ai_preset_questions (sort_order, key, text_de, text_en) VALUES (?, ?, ?, ?)",
                (sort_order, key, text_de, text_en),
            )
        conn.commit()
        return True
    except Exception as e:
        _log.warning("save_ai_preset_questions: %s", e)
        return False
    finally:
        conn.close()


def save_news_feed(symbol: str, feed: list, fetched_at: str = None) -> int:
    """
    News-Feed für ein Symbol speichern. Doppelte (symbol, time_published, url) werden übersprungen.
    :param symbol: Ticker oder '' für Fallback/All
    :param feed: Liste von Dicts wie von Alpha Vantage (title, summary, url, time_published, source, ticker_sentiment, ...)
    :param fetched_at: ISO-Zeitpunkt; default jetzt UTC
    :return: Anzahl neu eingefügter Einträge
    """
    init_news_db()
    ts = fetched_at or (datetime.utcnow().isoformat() + "Z")
    sym = (symbol or "").strip().upper() or ""
    conn = _get_conn()
    inserted = 0
    try:
        for item in feed:
            if not isinstance(item, dict):
                continue
            time_pub = (item.get("time_published") or "").strip() or None
            url = (item.get("url") or "").strip() or ""
            if not time_pub:
                continue
            title = item.get("title") or ""
            summary = item.get("summary") or ""
            source = item.get("source") or ""
            payload = {k: v for k, v in item.items() if k not in ("title", "summary", "url", "time_published", "source")}
            payload_str = json.dumps(payload, ensure_ascii=False) if payload else None
            try:
                conn.execute(
                    """INSERT OR IGNORE INTO news (symbol, time_published, title, summary, url, source, fetched_at, payload)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (sym, time_pub, title, summary, url, source, ts, payload_str),
                )
                if conn.total_changes:
                    inserted += 1
            except Exception:
                pass
        conn.execute(
            "INSERT OR REPLACE INTO news_fetch (symbol, last_fetched_at) VALUES (?, ?)",
            (sym, ts),
        )
        conn.commit()
    finally:
        conn.close()
    return inserted


def load_news_from_db(symbol: str = None, limit: int = 15, lang: str = None, return_payload: bool = False) -> list:
    """
    Gespeicherte News lesen (neueste zuerst).
    :param symbol: Ticker oder None/'' für Fallback-Symbol (gespeichert unter '' oder AAPL); für Finnhub z. B. FH_AAPL
    :param limit: max. Anzahl
    :param lang: Zielsprache (z. B. de, en); falls gesetzt und in payload.translated vorhanden, werden title/summary überschrieben
    :param return_payload: wenn True, wird das rohe payload als _payload pro Item mitgeliefert (für Backend: fehlende Übersetzung prüfen)
    :return: Liste von Dicts im Feed-Format (title, summary, url, time_published, source, ...)
    """
    if not DB_PATH.exists():
        return []
    init_news_db()
    sym = (symbol or "").strip().upper() or ""
    lang_key = (lang or "").strip().lower()[:2] if lang else None
    conn = _get_conn()
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """SELECT time_published, title, summary, url, source, payload
               FROM news WHERE symbol = ? ORDER BY time_published DESC LIMIT ?""",
            (sym, limit),
        ).fetchall()
        out = []
        for row in rows:
            d = {
                "time_published": row[0],
                "title": row[1] or "",
                "summary": row[2] or "",
                "url": row[3] or "",
                "source": row[4] or "",
            }
            if row[5]:
                try:
                    payload = json.loads(row[5])
                    if return_payload:
                        d["_payload"] = payload
                    tr_container = payload.get("payload") or payload
                    trans = tr_container.get("translated") if isinstance(tr_container, dict) else payload.get("translated")
                    if lang_key and isinstance(trans, dict) and lang_key in trans:
                        tr = trans[lang_key]
                        if isinstance(tr, dict):
                            if tr.get("title") is not None:
                                d["title"] = tr["title"] or d.get("title") or ""
                            if tr.get("summary") is not None:
                                d["summary"] = tr["summary"] or d.get("summary") or ""
                    if not return_payload:
                        for k, v in payload.items():
                            if k != "translated" and k not in d:
                                d[k] = v
                except (TypeError, json.JSONDecodeError):
                    pass
            out.append(d)
        return out
    finally:
        conn.close()


def load_news_all_recent(limit: int = 30, lang: str = None, return_payload: bool = False) -> list:
    """
    Neueste News aus allen Quellen (alle symbol-Werte), zeitlich sortiert.
    Jedes Item erhält 'symbol' (DB) und 'api_source' ('finnhub' wenn symbol mit FH_ beginnt, sonst 'alpha_vantage').
    """
    if not DB_PATH.exists():
        return []
    init_news_db()
    lang_key = (lang or "").strip().lower()[:2] if lang else None
    conn = _get_conn()
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """SELECT symbol, time_published, title, summary, url, source, payload
               FROM news ORDER BY time_published DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        out = []
        for row in rows:
            sym = (row[0] or "").strip()
            d = {
                "symbol": sym,
                "api_source": "finnhub" if sym.startswith("FH_") else "alpha_vantage",
                "time_published": row[1],
                "title": row[2] or "",
                "summary": row[3] or "",
                "url": row[4] or "",
                "source": row[5] or "",
            }
            if row[6]:
                try:
                    payload = json.loads(row[6])
                    if return_payload:
                        d["_payload"] = payload
                    tr_container = payload.get("payload") or payload
                    trans = tr_container.get("translated") if isinstance(tr_container, dict) else payload.get("translated")
                    if lang_key and isinstance(trans, dict) and lang_key in trans:
                        tr = trans[lang_key]
                        if isinstance(tr, dict):
                            if tr.get("title") is not None:
                                d["title"] = tr["title"] or d.get("title") or ""
                            if tr.get("summary") is not None:
                                d["summary"] = tr["summary"] or d.get("summary") or ""
                    if not return_payload:
                        for k, v in payload.items():
                            if k != "translated" and k not in d:
                                d[k] = v
                except (TypeError, json.JSONDecodeError):
                    pass
            out.append(d)
        return out
    finally:
        conn.close()


def update_news_translation(symbol: str, time_published: str, url: str, lang: str, title_tr: str, summary_tr: str) -> bool:
    """
    Übersetzung für eine News-Zeile in payload.translated[lang] speichern (UPDATE).
    :return: True wenn ein Update durchgeführt wurde
    """
    if not DB_PATH.exists():
        return False
    init_news_db()
    sym = (symbol or "").strip().upper() or ""
    lang_key = (lang or "").strip().lower()[:2]
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT payload FROM news WHERE symbol = ? AND time_published = ? AND COALESCE(url, '') = COALESCE(?, '') LIMIT 1",
            (sym, (time_published or "").strip(), (url or "").strip()),
        ).fetchone()
        if not row or not row[0]:
            _log.warning("update_news_translation: Zeile nicht gefunden symbol=%r time_published=%r url=%r", sym, (time_published or "").strip(), (url or "").strip()[:80])
            return False
        payload = json.loads(row[0])
        tr_container = payload.get("payload") if isinstance(payload.get("payload"), dict) else payload
        if "translated" not in tr_container or not isinstance(tr_container["translated"], dict):
            tr_container["translated"] = {}
        tr_container["translated"][lang_key] = {"title": title_tr or "", "summary": summary_tr or ""}
        payload_str = json.dumps(payload, ensure_ascii=False)
        conn.execute(
            "UPDATE news SET payload = ? WHERE symbol = ? AND time_published = ? AND COALESCE(url, '') = COALESCE(?, '')",
            (payload_str, sym, (time_published or "").strip(), (url or "").strip()),
        )
        conn.commit()
        return True
    except (TypeError, json.JSONDecodeError, Exception) as e:
        _log.warning("update_news_translation: Fehler %s", e)
        return False
    finally:
        conn.close()


def get_news_last_fetched(symbol: str = None) -> str | None:
    """Zeitpunkt des letzten API-Abrufs für dieses Symbol (ISO-String). None wenn noch nie."""
    if not DB_PATH.exists():
        return None
    init_news_db()
    sym = (symbol or "").strip().upper() or ""
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT last_fetched_at FROM news_fetch WHERE symbol = ?",
            (sym,),
        ).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def record_exists(country: str, date: str, label: str = "") -> bool:
    """
    Prüft, ob ein Eintrag mit (country, date, label) bereits existiert.
    """
    if not DB_PATH.exists():
        return False
    conn = _get_conn()
    try:
        lab = label or ""
        row = conn.execute(
            """SELECT 1 FROM finance_records
               WHERE LOWER(country) = ? AND date = ? AND COALESCE(label, '') = ?
               LIMIT 1""",
            (country.lower(), date, lab),
        ).fetchone()
        return row is not None
    finally:
        conn.close()


def save_record(country: str, date: str, value: float, unit: str, label: str = "", **extra) -> bool:
    """
    Einen Abfrage-Datensatz in SQLite speichern, nur wenn (country, date, label) noch nicht existiert.

    :param country: Ländercode (z. B. us, de, at, ch)
    :param date: Stichtag/Periode (z. B. 2026-03-02 oder Januar 2026)
    :param value: Hauptwert (z. B. Saldo in Mrd.)
    :param unit: Einheit (z. B. Mrd. USD, Mrd. EUR)
    :param label: optionale Bezeichnung
    :param extra: weitere Felder werden als JSON in extra gespeichert
    :return: True wenn gespeichert, False wenn bereits vorhanden (übersprungen)
    """
    init_db()
    if record_exists(country, date, label):
        return False
    conn = _get_conn()
    try:
        extra_json = json.dumps(extra, ensure_ascii=False) if extra else None
        conn.execute(
            """INSERT INTO finance_records (country, date, value, unit, label, fetched_at, extra)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                country.lower(),
                date,
                value,
                unit,
                label or "",
                datetime.utcnow().isoformat() + "Z",
                extra_json,
            ),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def load_history(country: str = None, limit: int = None, min_date: str = None, newest_first: bool = False):
    """
    Gespeicherte Datensätze aus SQLite lesen.

    :param country: nur dieses Land (z. B. us, de, markets); None = alle
    :param limit: maximale Anzahl Einträge pro Land (bei min_date: Einträge ab min_date)
    :param min_date: optional z. B. '2020-01-01' – nur Datensätze mit date >= min_date
    :param newest_first: bei limit die neuesten Einträge nehmen (für Kurse/Zeitreihen)
    :return: Liste von Dicts mit country, date, value, unit, label, fetched_at, extra (geparst)
    """
    if not DB_PATH.exists():
        return []
    conn = _get_conn()
    conn.row_factory = sqlite3.Row
    try:
        if country:
            sql = """SELECT id, country, date, value, unit, label, fetched_at, extra
                     FROM finance_records WHERE LOWER(country) = ?"""
            args = [country.lower()]
            if min_date:
                sql += " AND date >= ?"
                args.append(min_date)
            if newest_first and limit:
                sql += " ORDER BY date DESC, fetched_at DESC LIMIT ?"
                args.append(limit)
                rows = list(reversed(conn.execute(sql, args).fetchall()))
            else:
                sql += " ORDER BY date ASC, fetched_at DESC"
                rows = conn.execute(sql, args).fetchall()
        else:
            sql = """SELECT id, country, date, value, unit, label, fetched_at, extra
                     FROM finance_records"""
            args = []
            if min_date:
                sql += " WHERE date >= ?"
                args.append(min_date)
            sql += " ORDER BY country, date ASC, fetched_at DESC"
            rows = conn.execute(sql, args).fetchall() if args else conn.execute(sql).fetchall()
        records = []
        for row in rows:
            r = dict(row)
            if r.get("extra"):
                try:
                    r.update(json.loads(r["extra"]))
                except (TypeError, json.JSONDecodeError):
                    pass
            r.pop("extra", None)
            r.pop("id", None)
            records.append(r)
        if limit:
            by_country = {}
            for r in records:
                c = r.get("country", "")
                if c not in by_country:
                    by_country[c] = []
                by_country[c].append(r)
            out = []
            for c, lst in by_country.items():
                out.extend(lst[:limit])
            out.sort(key=lambda x: (x.get("date", ""), x.get("country", "")))
            return out
        return records
    finally:
        conn.close()


def get_max_dates_by_country(country: str):
    """
    Pro Label das neueste vorhandene Datum (YYYY-MM-DD).
    Für inkrementellen Abruf: nur Daten nach diesem Datum nachladen.

    :param country: z. B. 'us', 'markets'
    :return: Dict label -> max_date (z. B. {"S&P 500": "2024-03-01", "BTC": "2024-03-05"})
    """
    if not DB_PATH.exists():
        return {}
    conn = _get_conn()
    try:
        rows = conn.execute(
            """SELECT label, MAX(date) FROM finance_records
               WHERE LOWER(country) = ? AND date IS NOT NULL AND date != ''
               GROUP BY COALESCE(label, '')""",
            (country.lower(),),
        ).fetchall()
        return {row[0] or "": row[1] for row in rows if row[1]}
    finally:
        conn.close()


def get_db_stats():
    """
    Zusammenfassung der Datenbank: Größe, Anzahl Einträge, Verteilung nach Land/Label, Datumsbereich.

    :return: Dict mit file_size_bytes, total_records, by_country, by_label, date_min, date_max, last_fetched_at
    """
    if not DB_PATH.exists():
        return {
            "file_size_bytes": 0,
            "total_records": 0,
            "by_country": [],
            "by_label": [],
            "by_unit": [],
            "date_min": None,
            "date_max": None,
            "last_fetched_at": None,
            "news_total": 0,
            "news_by_symbol": [],
        }
    file_size_bytes = DB_PATH.stat().st_size
    conn = _get_conn()
    try:
        total_records = conn.execute("SELECT COUNT(*) FROM finance_records").fetchone()[0]
        init_news_db()
        news_total = 0
        news_by_symbol = []
        try:
            news_total = conn.execute("SELECT COUNT(*) FROM news").fetchone()[0]
            news_by_symbol = [
                {"symbol": row[0] or "(leer)", "count": row[1]}
                for row in conn.execute(
                    "SELECT symbol, COUNT(*) FROM news GROUP BY symbol ORDER BY COUNT(*) DESC"
                ).fetchall()
            ]
        except Exception:
            pass
        by_country = [
            {"country": row[0], "count": row[1]}
            for row in conn.execute(
                "SELECT country, COUNT(*) FROM finance_records GROUP BY country ORDER BY COUNT(*) DESC"
            ).fetchall()
        ]
        by_label = [
            {"label": row[0] or "(ohne Label)", "count": row[1]}
            for row in conn.execute(
                "SELECT label, COUNT(*) FROM finance_records GROUP BY label ORDER BY COUNT(*) DESC"
            ).fetchall()
        ]
        by_unit = [
            {"unit": row[0] or "(ohne Einheit)", "count": row[1]}
            for row in conn.execute(
                "SELECT unit, COUNT(*) FROM finance_records GROUP BY unit ORDER BY COUNT(*) DESC"
            ).fetchall()
        ]
        row = conn.execute("SELECT MIN(date), MAX(date) FROM finance_records").fetchone()
        date_min, date_max = (row[0], row[1]) if row else (None, None)
        row = conn.execute("SELECT MAX(fetched_at) FROM finance_records").fetchone()
        last_fetched_at = row[0] if row and row[0] else None
        return {
            "file_size_bytes": file_size_bytes,
            "total_records": total_records,
            "by_country": by_country,
            "by_label": by_label,
            "by_unit": by_unit,
            "date_min": date_min,
            "date_max": date_max,
            "last_fetched_at": last_fetched_at,
            "news_total": news_total,
            "news_by_symbol": news_by_symbol,
        }
    finally:
        conn.close()


def export_csv(path: str = None) -> str:
    """
    Alle Datensätze aus SQLite als CSV exportieren.

    :param path: Zieldatei; default: data/finance_history.csv
    :return: verwendeter Pfad
    """
    _ensure_data_dir()
    out_path = path or str(DATA_DIR / "finance_history.csv")
    records = load_history()
    if not records:
        with open(out_path, "w", encoding="utf-8-sig") as f:
            f.write("country,date,value,unit,label,fetched_at\n")
        return out_path
    keys = ["country", "date", "value", "unit", "label", "fetched_at"]
    all_keys = keys + [k for r in records for k in r if k not in keys]
    all_keys = list(dict.fromkeys(all_keys))
    with open(out_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=all_keys, extrasaction="ignore")
        w.writeheader()
        w.writerows(records)
    return out_path
