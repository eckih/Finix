"""
Zentrale Log-Konfiguration für Finix (Rotation, Level, Format).
Log-Datei: data/finix.log mit RotatingFileHandler.

Umgebungsvariable (optional in .env):
  LOG_LEVEL=DEBUG   # DEBUG | INFO | WARNING | ERROR | CRITICAL (Default: INFO)
"""
import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

# Default: 5 MB pro Datei, 5 Backups (finix.log.1 … finix.log.5)
LOG_MAX_BYTES = 5 * 1024 * 1024
LOG_BACKUP_COUNT = 5
LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
LOG_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

_initialized = False


def setup_logging(
    log_dir: Path,
    level: str | None = None,
    log_to_console: bool = True,
    max_bytes: int = LOG_MAX_BYTES,
    backup_count: int = LOG_BACKUP_COUNT,
) -> None:
    """
    Logging einmalig einrichten (Rotating-Datei + optional Konsole).

    :param log_dir: Verzeichnis für finix.log (z. B. Projektroot/data)
    :param level: LOG_LEVEL aus Umgebung oder 'INFO', 'DEBUG', 'WARNING', 'ERROR'
    :param log_to_console: zusätzlich auf stderr ausgeben
    :param max_bytes: maximale Größe einer Log-Datei in Bytes vor Rotation
    :param backup_count: Anzahl Rotations-Backups
    """
    global _initialized
    if _initialized:
        return
    _initialized = True

    log_dir = Path(log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "finix.log"

    level_str = (level or os.environ.get("LOG_LEVEL", "INFO")).upper()
    level_map = {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
        "CRITICAL": logging.CRITICAL,
    }
    log_level = level_map.get(level_str, logging.INFO)

    formatter = logging.Formatter(LOG_FORMAT, datefmt=LOG_DATE_FORMAT)

    root = logging.getLogger()
    root.setLevel(log_level)
    # Alte Handler entfernen (z. B. von uvicorn)
    for h in root.handlers[:]:
        root.removeHandler(h)

    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8",
    )
    file_handler.setLevel(log_level)
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)

    if log_to_console:
        console = logging.StreamHandler()
        console.setLevel(log_level)
        console.setFormatter(formatter)
        root.addHandler(console)


def get_logger(name: str) -> logging.Logger:
    """Logger für ein Modul (z. B. get_logger(__name__))."""
    return logging.getLogger(name)
