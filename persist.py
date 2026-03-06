"""
Persistenz der abgefragten Finanzdaten in SQLite3.

- save_record: speichert einen Datensatz in der Tabelle finance_records
- load_history: liest Datensätze (optional nach Land, mit Limit)
- export_csv: exportiert alle Einträge als CSV (z. B. für Excel)
"""
import csv
import json
import sqlite3
from datetime import datetime
from pathlib import Path

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
        }
    file_size_bytes = DB_PATH.stat().st_size
    conn = _get_conn()
    try:
        total_records = conn.execute("SELECT COUNT(*) FROM finance_records").fetchone()[0]
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
