#!/usr/bin/env bash
# Startet zuerst LibreTranslate (aus libretranslate/lt-local), falls noch nicht laufend.
# Anschließend: docker compose up mit allen übergebenen Argumenten (z. B. -f docker-compose.dev.yml).

set -e
cd "$(dirname "$0")"

if ! docker ps --format '{{.Names}}' | grep -qx 'libretranslate'; then
  echo "Starte LibreTranslate (libretranslate/lt-local) …"
  docker compose -f libretranslate/lt-local/docker-compose.yml up -d
fi

# Basis-Compose immer mit angeben, damit backend/frontend (build/image) definiert sind
exec docker compose -f docker-compose.yml "$@"
