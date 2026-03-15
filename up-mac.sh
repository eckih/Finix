#!/usr/bin/env bash
# up-mac.sh – macOS (und Linux)
# Startet zuerst LibreTranslate (aus libretranslate/lt-local), falls noch nicht laufend.
# Anschließend: docker compose up mit allen übergebenen Argumenten (z. B. -f docker-compose.dev.yml).
# Verwendung: ./up-mac.sh up   oder   ./up-mac.sh -f docker-compose.dev.yml up

set -e
cd "$(dirname "$0")"

# Container-Check portabel (macOS/Linux) per Docker-Filter statt grep
if [ -z "$(docker ps -q -f name=^libretranslate$ 2>/dev/null)" ]; then
  echo "Starte LibreTranslate (libretranslate/lt-local) …"
  docker compose -f libretranslate/lt-local/docker-compose.yml up -d
fi

# Basis-Compose immer mit angeben, damit backend/frontend (build/image) definiert sind
exec docker compose -f docker-compose.yml "$@"
